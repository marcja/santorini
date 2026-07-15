// Trainer CLI. Run from the repo root (Node strips types natively):
//   node apps/trainer/src/cli.ts <command> ...
//
//   init                     create a gen-0 checkpoint in models/
//   match <a> <b>            head-to-head match between two player specs
//   calibrate                round-robin the baselines, fit Elo, write models/baselines.json
//   gauntlet <player>        rate a player against the calibrated baselines
//
// Player specs: random | greedy | mcts:ITERS[,c=F][,depth=N] | ckpt:PATH[,iters=N]

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ACTION_COUNT,
  augmentPvSamples,
  augmentSamples,
  type Checkpoint,
  type CheckpointEval,
  checkpointEvalFn,
  checkpointPolicyFn,
  createCheckpoint,
  type EloRating,
  FEATURE_COUNT,
  Mlp,
  mulberry32,
  pick,
  type PlayerSpec,
  type PolicyFn,
  PolicyValueNet,
  parsePlayerSpec,
  playerFromSpec,
  type SelfPlayConfig,
  type SelfPlayGame,
  type SelfPlayResult,
  selfPlay,
  specName,
} from '@santorini/ai';
import { configTier, type GodId, godIdByName } from '@santorini/engine';
import {
  fitElo,
  type GauntletLine,
  type PairResult,
  performanceRating,
} from './elo.ts';
import {
  BASELINES_FORMAT,
  type Baselines,
  readBaselines,
  readCheckpoint,
  writeJson,
} from './io.ts';
import { gameToSgn, type RunResult, runMatch } from './run.ts';

const USAGE = `usage:
  trainer init      [--out models/gen-000.json] [--notes TEXT] [--force]
  trainer match     <a> <b> [--games 20] [--seed 1] [--max-half-turns 400] [--sgn FILE]
                    [--gods god1,god2]
  trainer calibrate [--players "random greedy mcts:200 mcts:1000"] [--games 40] [--seed 1]
                    [--out models/baselines.json] [--gods god1,god2]
  trainer gauntlet  <player> [--games 20] [--seed 1] [--baselines models/baselines.json]
                    [--update] [--gods god1,god2]
  trainer train     [--parent models/gen-000.json] [--out models/gen-NNN.json] [--games 200]
                    [--seed 1] [--iters PARENT] [--temp-turns 8] [--max-half-turns 400]
                    [--hidden 64] [--epochs 10] [--lr 0.2] [--batch 64] [--augment]
                    [--pv] [--wd 0] [--sgn FILE] [--notes TEXT] [--force]
                    [--gods god1,god2 | --god-pool god1,god2,...]
                    (--pv trains a policy+value net -> PUCT search; implied by a pv parent.
                     --wd = L2 weight decay, pv nets only)

player specs: random | greedy | mcts:ITERS[,c=F][,depth=N] | ckpt:PATH[,iters=N]
(the --players pool is space-separated because specs may contain commas)

--gods god1,god2: gods for board seats 0/1 (default none,none = base game).
Seat alternation swaps which player sits in each seat, so the god stays
attached to the seat, not to a given player. ckpt: player specs are
rejected under any non-none --gods (see the error message) until encoding
v2 lands.

trainer train's self-play generation additionally accepts:
--god-pool god1,god2,...: seeded per-game matchup sampling — each self-play
game independently draws two gods (with replacement) from the pool, seeded
by --seed so pool runs are as reproducible as a fixed --gods run. Mutually
exclusive with --gods. Self-play samples encode with feature encoding v2
(295-wide, god-aware) when the parent checkpoint's eval type is mlp@2/pv@2,
v1 (175-wide) otherwise — independent of whether gods are configured, since
a v1 parent's static/mlp/pv eval has no god-aware planes to fill in. Net
training after self-play still assumes v1 dimensions; a v2 parent is
rejected with a clear error before self-play runs (policy encoding v2,
issue #19/T7, lands training end-to-end).`;

const DEFAULT_BASELINES = 'random greedy mcts:200 mcts:1000';
/** Prime stride keeps per-pair seed ranges disjoint (games use seed+2i). */
const SEED_STRIDE = 10007;

const ckptCache = new Map<string, Checkpoint>();
function loadCheckpoint(path: string): Checkpoint {
  if (!ckptCache.has(path)) ckptCache.set(path, readCheckpoint(path));
  return ckptCache.get(path)!;
}

function int(name: string, value: string): number {
  const x = Number(value);
  if (!Number.isInteger(x))
    throw new Error(`--${name} must be an integer (got ${value})`);
  return x;
}

function float(name: string, value: string): number {
  const x = Number(value);
  if (!Number.isFinite(x))
    throw new Error(`--${name} must be a number (got ${value})`);
  return x;
}

function nameOf(spec: PlayerSpec): string {
  return specName(
    spec,
    spec.kind === 'ckpt' ? loadCheckpoint(spec.path) : undefined,
  );
}

/** Elo difference implied by a score fraction (clamped away from 0/1). */
function eloDiff(score: number): number {
  const s = Math.min(0.99, Math.max(0.01, score));
  return 400 * Math.log10(s / (1 - s));
}

function pct(x: number): string {
  return `${(100 * x).toFixed(1)}%`;
}

const BASE_GODS: [GodId, GodId] = ['none', 'none'];

/** Parse `--gods god1,god2` (case-insensitive god names/ids); default base. */
function parseGodsFlag(raw: string | undefined): [GodId, GodId] {
  if (raw === undefined) return BASE_GODS;
  const parts = raw.split(',');
  if (parts.length !== 2) {
    throw new Error(
      `--gods needs exactly two comma-separated god names, e.g. --gods pan,pan (got ${JSON.stringify(raw)})`,
    );
  }
  return [godIdByName(parts[0]), godIdByName(parts[1])];
}

/** Parse `--god-pool god1,god2,...` (case-insensitive god names/ids) into a
 * pool of at least two entries for seeded per-game matchup sampling. */
function parseGodPoolFlag(raw: string | undefined): GodId[] | undefined {
  if (raw === undefined) return undefined;
  const ids = raw.split(',').map((s) => godIdByName(s));
  if (ids.length < 2) {
    throw new Error(
      `--god-pool needs at least two comma-separated god names, e.g. ` +
        `--god-pool none,pan,athena (got ${JSON.stringify(raw)})`,
    );
  }
  return ids;
}

/**
 * Seeded per-game matchups for `--god-pool`: each game independently draws
 * two gods (with replacement — mirror matchups like pan/pan are valid) from
 * the pool, deterministic in `seed` so pool runs are as reproducible as
 * fixed-`--gods` runs.
 */
function godPoolMatchups(
  pool: GodId[],
  games: number,
  seed: number,
): [GodId, GodId][] {
  const rand = mulberry32(seed ^ 0x90d5);
  return Array.from({ length: games }, () => [
    pick(rand, pool),
    pick(rand, pool),
  ]);
}

/**
 * `mlp@2`/`pv@2` checkpoints carry samples encoded under feature encoding v2
 * (295-wide, god one-hots + state flags) — the same distinction
 * `checkpoint.ts`'s `checkpointEvalFn`/`requireEvalParams` dispatch on for
 * choosing an encoder/validating shapes (docs/milestones/
 * god-ai-encoding-v2.md). Self-play must encode samples the same way the
 * parent's own net was shaped for.
 */
function isV2Eval(ev: CheckpointEval): boolean {
  return ev.type === 'mlp@2' || ev.type === 'pv@2';
}

/**
 * ckpt: player specs encode positions under features v1, which has no
 * god/state-flag planes — under any non-base --gods they'd play silently
 * god-blind. Reject outright until encoding v2 (issue #18, T3) lands.
 */
function assertNoCkptWithGods(specs: PlayerSpec[], gods: [GodId, GodId]): void {
  if (gods[0] === 'none' && gods[1] === 'none') return;
  if (specs.some((s) => s.kind === 'ckpt')) {
    throw new Error(
      'ckpt: player specs are rejected under --gods: net players encode ' +
        'positions with features v1, which has no god/state-flag planes, ' +
        'so a checkpoint would play the configured gods silently god-blind. ' +
        'God-aware training lands in encoding v2 (docs/milestones/' +
        'god-ai-encoding-v2.md, issue #18); until then, use random, greedy, ' +
        'or mcts players for non-base god configurations.',
    );
  }
}

/** Human-readable configuration label for console output. */
function describeGods(gods: [GodId, GodId]): string {
  const tier = configTier(gods[0], gods[1]);
  if (gods[0] === 'none' && gods[1] === 'none') return `base game (${tier})`;
  return `${gods[0]},${gods[1]} (${tier})`;
}

function signed(x: number): string {
  const r = Math.round(x);
  return r >= 0 ? `+${r}` : `${r}`;
}

function playPair(
  specA: PlayerSpec,
  specB: PlayerSpec,
  games: number,
  seed: number,
  maxHalfTurns?: number,
  gods?: [GodId, GodId],
  onGame?: Parameters<typeof runMatch>[3],
): RunResult {
  const config: {
    games: number;
    seed: number;
    maxHalfTurns?: number;
    gods?: [GodId, GodId];
  } = { games, seed };
  if (maxHalfTurns !== undefined) config.maxHalfTurns = maxHalfTurns;
  if (gods !== undefined) config.gods = gods;
  return runMatch(
    (s) => playerFromSpec(specA, s, loadCheckpoint),
    (s) => playerFromSpec(specB, s, loadCheckpoint),
    config,
    onGame,
  );
}

function cmdInit(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: {
      out: { type: 'string', default: 'models/gen-000.json' },
      notes: { type: 'string' },
      force: { type: 'boolean', default: false },
    },
  });
  if (existsSync(values.out) && !values.force) {
    throw new Error(`${values.out} exists (use --force to overwrite)`);
  }
  const init: Parameters<typeof createCheckpoint>[1] = {};
  if (values.notes !== undefined) init.notes = values.notes;
  const ckpt = createCheckpoint(new Date().toISOString(), init);
  writeJson(values.out, ckpt);
  console.log(
    `wrote ${values.out} (gen ${ckpt.generation}, eval ${ckpt.eval.type}, ` +
      `mcts ${ckpt.search.iterations} iters)`,
  );
}

function cmdMatch(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      games: { type: 'string', default: '20' },
      seed: { type: 'string', default: '1' },
      'max-half-turns': { type: 'string', default: '400' },
      sgn: { type: 'string' },
      gods: { type: 'string' },
    },
  });
  if (positionals.length !== 2)
    throw new Error('match needs exactly two player specs');
  const specA = parsePlayerSpec(positionals[0]);
  const specB = parsePlayerSpec(positionals[1]);
  const gods = parseGodsFlag(values.gods);
  assertNoCkptWithGods([specA, specB], gods);
  const nameA = nameOf(specA);
  const nameB = nameOf(specB);
  const games = int('games', values.games);
  const seed = int('seed', values.seed);

  console.log(`configuration: ${describeGods(gods)}`);
  const result = playPair(
    specA,
    specB,
    games,
    seed,
    int('max-half-turns', values['max-half-turns']),
    gods,
    (game, i) => {
      const names: [string, string] =
        game.aSeat === 0 ? [nameA, nameB] : [nameB, nameA];
      const outcome =
        game.winner === null ? 'draw' : `${names[game.winner]} wins`;
      console.log(
        `game ${String(i + 1).padStart(String(games).length)}/${games}  ` +
          `P1=${names[0]}  ${outcome} in ${game.sgn.length} half-turns`,
      );
    },
  );

  const scored = (result.winsA + result.draws / 2) / games;
  console.log(
    `\n${nameA} ${result.winsA} — ${result.winsB} ${nameB}` +
      (result.draws ? `  (${result.draws} draws)` : ''),
  );
  console.log(
    `score ${pct(scored)} for ${nameA} ≈ ${signed(eloDiff(scored))} Elo`,
  );

  if (values.sgn !== undefined) {
    const event = `trainer match seed=${seed}`;
    const docs = result.games.map((g) => gameToSgn(g, nameA, nameB, event));
    mkdirSync(dirname(values.sgn), { recursive: true });
    writeFileSync(values.sgn, docs.join('\n'));
    console.log(`wrote ${result.games.length} games to ${values.sgn}`);
  }
}

function cmdCalibrate(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: {
      players: { type: 'string', default: DEFAULT_BASELINES },
      games: { type: 'string', default: '40' },
      seed: { type: 'string', default: '1' },
      out: { type: 'string', default: 'models/baselines.json' },
      gods: { type: 'string' },
    },
  });
  const specStrings = values.players.split(/\s+/).filter(Boolean);
  if (specStrings.length < 2)
    throw new Error('calibrate needs at least two players');
  const specs = specStrings.map(parsePlayerSpec);
  const gods = parseGodsFlag(values.gods);
  assertNoCkptWithGods(specs, gods);
  const names = specs.map(nameOf);
  const games = int('games', values.games);
  const seed = int('seed', values.seed);

  console.log(`configuration: ${describeGods(gods)}`);
  const results: PairResult[] = [];
  let pairIndex = 0;
  for (let i = 0; i < specs.length; i++) {
    for (let j = i + 1; j < specs.length; j++) {
      const r = playPair(
        specs[i],
        specs[j],
        games,
        seed + SEED_STRIDE * pairIndex++,
        undefined,
        gods,
      );
      results.push({
        a: names[i],
        b: names[j],
        winsA: r.winsA,
        winsB: r.winsB,
        draws: r.draws,
      });
      console.log(
        `${names[i]} ${r.winsA} — ${r.winsB} ${names[j]}` +
          (r.draws ? ` (${r.draws} draws)` : ''),
      );
    }
  }

  const anchor = names.includes('random') ? 'random' : names[0];
  const ratings = fitElo(results, { anchor, anchorRating: 0 });
  console.log(`\nfitted Elo (${anchor} = 0) [${describeGods(gods)}]:`);
  const order = [...names].sort((a, b) => ratings[b] - ratings[a]);
  for (const name of order)
    console.log(`  ${name.padEnd(12)} ${Math.round(ratings[name])}`);

  const baselines: Baselines = {
    format: BASELINES_FORMAT,
    calibratedAt: new Date().toISOString(),
    seed,
    gamesPerPair: games,
    gods,
    configTier: configTier(gods[0], gods[1]),
    players: names.map((name, i) => ({
      name,
      spec: specStrings[i],
      rating: ratings[name],
    })),
    results,
  };
  writeJson(values.out, baselines);
  console.log(`wrote ${values.out}`);
}

function cmdGauntlet(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      games: { type: 'string', default: '20' },
      seed: { type: 'string', default: '1' },
      baselines: { type: 'string', default: 'models/baselines.json' },
      update: { type: 'boolean', default: false },
      gods: { type: 'string' },
    },
  });
  if (positionals.length !== 1)
    throw new Error('gauntlet needs exactly one player spec');
  const spec = parsePlayerSpec(positionals[0]);
  const gods = parseGodsFlag(values.gods);
  const name = nameOf(spec);
  const games = int('games', values.games);
  const seed = int('seed', values.seed);
  const baselines = readBaselines(values.baselines);
  const oppSpecs = baselines.players.map((b) => parsePlayerSpec(b.spec));
  assertNoCkptWithGods([spec, ...oppSpecs], gods);

  const tier = configTier(gods[0], gods[1]);
  console.log(`configuration: ${describeGods(gods)}`);
  if (baselines.configTier !== undefined && baselines.configTier !== tier) {
    console.warn(
      `warning: baselines were calibrated at configuration tier ` +
        `'${baselines.configTier}' but this gauntlet run uses '${tier}' — ` +
        `ratings across different configuration tiers are not comparable ` +
        `(issues #22/#26/#27).`,
    );
  }

  const lines: GauntletLine[] = [];
  baselines.players.forEach((baseline, k) => {
    const r = playPair(
      spec,
      oppSpecs[k],
      games,
      seed + SEED_STRIDE * k,
      undefined,
      gods,
    );
    lines.push({
      opponent: baseline.name,
      rating: baseline.rating,
      wins: r.winsA,
      losses: r.winsB,
      draws: r.draws,
    });
    console.log(
      `vs ${baseline.name.padEnd(12)} ${r.winsA} — ${r.winsB}` +
        (r.draws ? ` (${r.draws} draws)` : '') +
        `  [opponent Elo ${Math.round(baseline.rating)}]`,
    );
  });

  const rating = performanceRating(lines);
  console.log(
    `\n${name} performance rating: ${Math.round(rating)} [${describeGods(gods)}] ` +
      `(scale: ${baselines.players.map((p) => `${p.name}=${Math.round(p.rating)}`).join(', ')})`,
  );

  if (values.update) {
    if (spec.kind !== 'ckpt')
      throw new Error('--update requires a ckpt: player spec');
    const ckpt = loadCheckpoint(spec.path);
    const perOpponent: EloRating['perOpponent'] = {};
    for (const l of lines) {
      perOpponent[l.opponent] = {
        wins: l.wins,
        losses: l.losses,
        draws: l.draws,
      };
    }
    ckpt.elo = {
      rating: Math.round(rating),
      games: games * lines.length,
      perOpponent,
      ratedAt: new Date().toISOString(),
    };
    writeJson(spec.path, ckpt);
    console.log(`stamped Elo into ${spec.path}`);
  }
}

/**
 * God configuration for a training self-play run: a fixed pair for the
 * whole batch (`--gods`), a pool for seeded per-game matchup sampling
 * (`--god-pool`), or neither (base game). Mutually exclusive — enforced by
 * the CLI before this is constructed.
 */
interface GodSelection {
  gods?: [GodId, GodId];
  pool?: GodId[];
}

/**
 * `mlp@2`/`pv@2` parents produce v2-encoded (295-wide, god-aware) self-play
 * samples correctly (see `isV2Eval`/`SelfPlayConfig.featureEncoding`), but
 * the net-training step below (`selectMlpNet`/`selectPvNet`,
 * `trainMlpNet`/`trainPvNet`) still assumes v1 dimensions (`FEATURE_COUNT`/
 * `ACTION_COUNT`) — training a v2 lineage end-to-end needs policy encoding
 * v2 (issue #19/T7) for pv nets and v2-aware net sizing for mlp nets,
 * neither of which has landed. Rather than silently truncating a 295-wide
 * sample to the net's 175 inputs (real risk: `Mlp.forward`/`PolicyValueNet`
 * only read `x[0..inputSize)`, so this would train a value net that's
 * blind to the very god one-hots the samples exist to carry), fail loudly —
 * the same convention `checkpointPolicyFn` uses for `pv@2` policy decoding.
 */
function assertV2TrainingSupported(parent: Checkpoint): void {
  if (!isV2Eval(parent.eval)) return;
  throw new Error(
    `trainer train: parent eval type ${parent.eval.type} encodes features ` +
      'under v2 (FEATURE_COUNT_V2=295) but net training still assumes v1 ' +
      'dimensions (FEATURE_COUNT=175/ACTION_COUNT=225) — end-to-end v2 ' +
      'training lands with policy encoding v2 (issue #19/T7) and v2-aware ' +
      'net sizing; self-play generation itself is already v2-aware ' +
      '(packages/ai/src/selfplay.ts), only this training step is blocked.',
  );
}

/** Parse `--gods`/`--god-pool` (mutually exclusive) into a `GodSelection`
 * for `trainer train` — factored out of `cmdTrain` to keep its own
 * branching under the complexity cap (mirrors `requireEvalParams`'s note in
 * checkpoint.ts). */
function parseTrainGodFlags(
  godsRaw: string | undefined,
  godPoolRaw: string | undefined,
): GodSelection {
  if (godsRaw !== undefined && godPoolRaw !== undefined) {
    throw new Error('--gods and --god-pool are mutually exclusive');
  }
  if (godPoolRaw !== undefined) return { pool: parseGodPoolFlag(godPoolRaw) };
  return { gods: godsRaw !== undefined ? parseGodsFlag(godsRaw) : undefined };
}

/** Self-play for one game index under `--god-pool`: seeded matchup, single
 * game, seeded identically to how a fixed-gods batch would seed game `i`. */
function runPooledSelfPlayGame(
  baseConfig: Omit<SelfPlayConfig, 'games' | 'seed' | 'gods'>,
  seed: number,
  i: number,
  gods: [GodId, GodId],
  onGame: (game: SelfPlayGame, index: number) => void,
): SelfPlayResult {
  return selfPlay({ ...baseConfig, games: 1, seed: seed + 2 * i, gods }, (g) =>
    onGame(g, i),
  );
}

/** Run self-play with the parent's search/eval config, logging progress. */
function runTrainingSelfPlay(
  parent: Checkpoint,
  games: number,
  seed: number,
  iterations: number,
  tempTurnsRaw: string,
  maxHalfTurnsRaw: string,
  godSelection: GodSelection,
): { result: SelfPlayResult; parentPolicy: PolicyFn | null } {
  const parentPolicy = checkpointPolicyFn(parent.eval);
  const featureEncoding = isV2Eval(parent.eval) ? 'v2' : 'v1';
  const baseConfig: Omit<SelfPlayConfig, 'games' | 'seed' | 'gods'> = {
    search: { ...parent.search, iterations },
    evaluate: checkpointEvalFn(parent.eval),
    ...(parentPolicy ? { policy: parentPolicy } : {}),
    temperatureTurns: int('temp-turns', tempTurnsRaw),
    maxHalfTurns: int('max-half-turns', maxHalfTurnsRaw),
    featureEncoding,
  };
  const godsLabel = godSelection.pool
    ? `, god-pool [${godSelection.pool.join(',')}]`
    : godSelection.gods
      ? `, gods ${describeGods(godSelection.gods)}`
      : '';
  console.log(
    `self-play: ${games} games, mcts ${iterations} iters` +
      (parentPolicy ? ' (PUCT)' : '') +
      `, eval ${parent.eval.type} (gen ${parent.generation})${godsLabel}`,
  );
  const started = Date.now();
  let decided = 0;
  const onGame = (game: SelfPlayGame, i: number): void => {
    if (game.winner !== null) decided++;
    const godsTag =
      game.gods[0] !== 'none' || game.gods[1] !== 'none'
        ? `  [${game.gods[0]},${game.gods[1]}]`
        : '';
    console.log(
      `game ${String(i + 1).padStart(String(games).length)}/${games}  ` +
        `${game.winner === null ? 'draw' : `P${game.winner + 1} wins`} in ${game.sgn.length} half-turns${godsTag}`,
    );
  };

  const result: SelfPlayResult = godSelection.pool
    ? godPoolMatchups(godSelection.pool, games, seed).reduce<SelfPlayResult>(
        (acc, gods, i) => {
          const one = runPooledSelfPlayGame(baseConfig, seed, i, gods, onGame);
          acc.games.push(...one.games);
          acc.samples.push(...one.samples);
          return acc;
        },
        { games: [], samples: [] },
      )
    : selfPlay({ ...baseConfig, games, seed, gods: godSelection.gods }, onGame);

  console.log(
    `${decided}/${games} decided, ${result.samples.length} samples ` +
      `in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  return { result, parentPolicy };
}

/** Dump self-play games to an SGN file when `--sgn` was given. */
function maybeWriteSelfPlaySgn(
  sgnPath: string | undefined,
  parent: Checkpoint,
  seed: number,
  result: SelfPlayResult,
): void {
  if (sgnPath === undefined) return;
  const name = `gen-${parent.generation}-selfplay`;
  const event = `trainer train seed=${seed}`;
  const docs = result.games.map((g) =>
    gameToSgn({ ...g, aSeat: 0 }, name, name, event),
  );
  mkdirSync(dirname(sgnPath), { recursive: true });
  writeFileSync(sgnPath, docs.join('\n'));
  console.log(`wrote ${result.games.length} games to ${sgnPath}`);
}

/** Warm start from an mlp parent: shared layer + value head continue the
 * lineage, the zero policy head starts at uniform priors. */
function selectPvNet(
  parent: Checkpoint,
  hiddenRaw: string,
  seed: number,
): PolicyValueNet {
  if (parent.eval.type === 'pv@1')
    return new PolicyValueNet(parent.eval.params);
  if (parent.eval.type === 'mlp@1')
    return PolicyValueNet.fromMlp(parent.eval.params, ACTION_COUNT);
  return PolicyValueNet.init(
    FEATURE_COUNT,
    int('hidden', hiddenRaw),
    ACTION_COUNT,
    seed + 999,
  );
}

/** Continue training a net parent; start fresh only from a static parent. */
function selectMlpNet(
  parent: Checkpoint,
  hiddenRaw: string,
  seed: number,
): Mlp {
  return parent.eval.type === 'mlp@1'
    ? new Mlp(parent.eval.params)
    : Mlp.init(FEATURE_COUNT, int('hidden', hiddenRaw), seed + 999);
}

interface TrainedNet {
  evalSpec: CheckpointEval;
  hiddenSize: number;
}

/** Warm-start (or init) a policy+value net and train it on self-play samples. */
function trainPvNet(
  parent: Checkpoint,
  result: SelfPlayResult,
  seed: number,
  hiddenRaw: string,
  epochs: number,
  batchSize: number,
  lr: number,
  weightDecay: number,
  augment: boolean,
): TrainedNet {
  const net = selectPvNet(parent, hiddenRaw, seed);
  const samples = augment ? augmentPvSamples(result.samples) : result.samples;
  if (augment)
    console.log(`augmented to ${samples.length} samples (8 symmetries)`);
  const losses = net.train(samples, {
    epochs,
    batchSize,
    lr,
    seed: seed + 1,
    weightDecay,
  });
  losses.forEach((l, e) =>
    console.log(
      `epoch ${e + 1}/${epochs}  value loss ${l.value.toFixed(4)}  policy loss ${l.policy.toFixed(4)}`,
    ),
  );
  return {
    evalSpec: { type: 'pv@1', params: net.toParams() },
    hiddenSize: net.hiddenSize,
  };
}

/** Train a value-only net on self-play samples. */
function trainMlpNet(
  parent: Checkpoint,
  result: SelfPlayResult,
  seed: number,
  hiddenRaw: string,
  epochs: number,
  batchSize: number,
  lr: number,
  augment: boolean,
): TrainedNet {
  const net = selectMlpNet(parent, hiddenRaw, seed);
  const samples = augment ? augmentSamples(result.samples) : result.samples;
  if (augment)
    console.log(`augmented to ${samples.length} samples (8 symmetries)`);
  const losses = net.train(samples, {
    epochs,
    batchSize,
    lr,
    seed: seed + 1,
  });
  losses.forEach((loss, e) =>
    console.log(`epoch ${e + 1}/${epochs}  loss ${loss.toFixed(4)}`),
  );
  return {
    evalSpec: { type: 'mlp@1', params: net.toParams() },
    hiddenSize: net.hiddenSize,
  };
}

function cmdTrain(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: {
      parent: { type: 'string', default: 'models/gen-000.json' },
      out: { type: 'string' },
      games: { type: 'string', default: '200' },
      seed: { type: 'string', default: '1' },
      iters: { type: 'string' },
      'temp-turns': { type: 'string', default: '8' },
      'max-half-turns': { type: 'string', default: '400' },
      hidden: { type: 'string', default: '64' },
      // Mild fitting wins: heavily-trained nets go overconfident, saturating
      // the playout values MCTS averages, and play *worse* (session-4 sweep).
      epochs: { type: 'string', default: '10' },
      lr: { type: 'string', default: '0.2' },
      batch: { type: 'string', default: '64' },
      // 8 board symmetries per sample — 8× data, teaches symmetry-invariance.
      augment: { type: 'boolean', default: false },
      // Train a two-headed policy+value net (PUCT priors). Implied by a pv
      // parent — a lineage never silently drops its policy head.
      pv: { type: 'boolean', default: false },
      // L2 weight decay (pv nets only) — the regularization lever.
      wd: { type: 'string', default: '0' },
      gods: { type: 'string' },
      'god-pool': { type: 'string' },
      sgn: { type: 'string' },
      notes: { type: 'string' },
      force: { type: 'boolean', default: false },
    },
  });
  const parent = readCheckpoint(values.parent);
  const generation = parent.generation + 1;
  const out =
    values.out ?? `models/gen-${String(generation).padStart(3, '0')}.json`;
  if (existsSync(out) && !values.force)
    throw new Error(`${out} exists (use --force to overwrite)`);
  const godSelection = parseTrainGodFlags(values.gods, values['god-pool']);
  assertV2TrainingSupported(parent);
  const games = int('games', values.games);
  const seed = int('seed', values.seed);
  const iterations =
    values.iters !== undefined
      ? int('iters', values.iters)
      : parent.search.iterations;
  const epochs = int('epochs', values.epochs);

  const { result, parentPolicy } = runTrainingSelfPlay(
    parent,
    games,
    seed,
    iterations,
    values['temp-turns'],
    values['max-half-turns'],
    godSelection,
  );

  maybeWriteSelfPlaySgn(values.sgn, parent, seed, result);

  // A pv parent stays pv (--pv implied); otherwise --pv upgrades the lineage.
  const pv = values.pv || parent.eval.type === 'pv@1';
  const weightDecay = float('wd', values.wd);
  const batchSize = int('batch', values.batch);
  const lr = float('lr', values.lr);
  const { evalSpec, hiddenSize } = pv
    ? trainPvNet(
        parent,
        result,
        seed,
        values.hidden,
        epochs,
        batchSize,
        lr,
        weightDecay,
        values.augment,
      )
    : trainMlpNet(
        parent,
        result,
        seed,
        values.hidden,
        epochs,
        batchSize,
        lr,
        values.augment,
      );

  const ckpt = createCheckpoint(new Date().toISOString(), {
    generation,
    parent: values.parent,
    eval: evalSpec,
    search: parent.search,
    notes:
      values.notes ??
      `self-play ${games} games @ mcts(${iterations})${parentPolicy ? ' PUCT' : ''} from ${values.parent}` +
        (values.augment ? '; 8-symmetry augmentation' : '') +
        (pv ? '; policy+value net' : '') +
        (weightDecay > 0 ? `; wd=${weightDecay}` : ''),
  });
  writeJson(out, ckpt);
  console.log(
    `wrote ${out} (gen ${generation}, ${evalSpec.type} ${hiddenSize} hidden)`,
  );
  console.log(
    `rate it: node apps/trainer/src/cli.ts gauntlet ckpt:${out} --update`,
  );
}

function main(): void {
  const [cmd, ...args] = process.argv.slice(2);
  try {
    switch (cmd) {
      case 'init':
        cmdInit(args);
        break;
      case 'match':
        cmdMatch(args);
        break;
      case 'calibrate':
        cmdCalibrate(args);
        break;
      case 'gauntlet':
        cmdGauntlet(args);
        break;
      case 'train':
        cmdTrain(args);
        break;
      default:
        console.error(USAGE);
        process.exitCode = 1;
    }
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}

main();
