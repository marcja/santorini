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
  type PlayerSpec,
  type PolicyFn,
  PolicyValueNet,
  parsePlayerSpec,
  playerFromSpec,
  type SelfPlayResult,
  selfPlay,
  specName,
} from '@santorini/ai';
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
  trainer calibrate [--players "random greedy mcts:200 mcts:1000"] [--games 40] [--seed 1]
                    [--out models/baselines.json]
  trainer gauntlet  <player> [--games 20] [--seed 1] [--baselines models/baselines.json]
                    [--update]
  trainer train     [--parent models/gen-000.json] [--out models/gen-NNN.json] [--games 200]
                    [--seed 1] [--iters PARENT] [--temp-turns 8] [--max-half-turns 400]
                    [--hidden 64] [--epochs 10] [--lr 0.2] [--batch 64] [--augment]
                    [--pv] [--wd 0] [--sgn FILE] [--notes TEXT] [--force]
                    (--pv trains a policy+value net -> PUCT search; implied by a pv parent.
                     --wd = L2 weight decay, pv nets only)

player specs: random | greedy | mcts:ITERS[,c=F][,depth=N] | ckpt:PATH[,iters=N]
(the --players pool is space-separated because specs may contain commas)`;

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
  onGame?: Parameters<typeof runMatch>[3],
): RunResult {
  const config: { games: number; seed: number; maxHalfTurns?: number } = {
    games,
    seed,
  };
  if (maxHalfTurns !== undefined) config.maxHalfTurns = maxHalfTurns;
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
    },
  });
  if (positionals.length !== 2)
    throw new Error('match needs exactly two player specs');
  const specA = parsePlayerSpec(positionals[0]);
  const specB = parsePlayerSpec(positionals[1]);
  const nameA = nameOf(specA);
  const nameB = nameOf(specB);
  const games = int('games', values.games);
  const seed = int('seed', values.seed);

  const result = playPair(
    specA,
    specB,
    games,
    seed,
    int('max-half-turns', values['max-half-turns']),
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
    },
  });
  const specStrings = values.players.split(/\s+/).filter(Boolean);
  if (specStrings.length < 2)
    throw new Error('calibrate needs at least two players');
  const specs = specStrings.map(parsePlayerSpec);
  const names = specs.map(nameOf);
  const games = int('games', values.games);
  const seed = int('seed', values.seed);

  const results: PairResult[] = [];
  let pairIndex = 0;
  for (let i = 0; i < specs.length; i++) {
    for (let j = i + 1; j < specs.length; j++) {
      const r = playPair(
        specs[i],
        specs[j],
        games,
        seed + SEED_STRIDE * pairIndex++,
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
  console.log(`\nfitted Elo (${anchor} = 0):`);
  const order = [...names].sort((a, b) => ratings[b] - ratings[a]);
  for (const name of order)
    console.log(`  ${name.padEnd(12)} ${Math.round(ratings[name])}`);

  const baselines: Baselines = {
    format: BASELINES_FORMAT,
    calibratedAt: new Date().toISOString(),
    seed,
    gamesPerPair: games,
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
    },
  });
  if (positionals.length !== 1)
    throw new Error('gauntlet needs exactly one player spec');
  const spec = parsePlayerSpec(positionals[0]);
  const name = nameOf(spec);
  const games = int('games', values.games);
  const seed = int('seed', values.seed);
  const baselines = readBaselines(values.baselines);

  const lines: GauntletLine[] = [];
  baselines.players.forEach((baseline, k) => {
    const oppSpec = parsePlayerSpec(baseline.spec);
    const r = playPair(spec, oppSpec, games, seed + SEED_STRIDE * k);
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
    `\n${name} performance rating: ${Math.round(rating)} ` +
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

/** Run self-play with the parent's search/eval config, logging progress. */
function runTrainingSelfPlay(
  parent: Checkpoint,
  games: number,
  seed: number,
  iterations: number,
  tempTurnsRaw: string,
  maxHalfTurnsRaw: string,
): { result: SelfPlayResult; parentPolicy: PolicyFn | null } {
  const parentPolicy = checkpointPolicyFn(parent.eval);
  console.log(
    `self-play: ${games} games, mcts ${iterations} iters` +
      (parentPolicy ? ' (PUCT)' : '') +
      `, eval ${parent.eval.type} (gen ${parent.generation})`,
  );
  const started = Date.now();
  let decided = 0;
  const result = selfPlay(
    {
      games,
      seed,
      search: { ...parent.search, iterations },
      evaluate: checkpointEvalFn(parent.eval),
      ...(parentPolicy ? { policy: parentPolicy } : {}),
      temperatureTurns: int('temp-turns', tempTurnsRaw),
      maxHalfTurns: int('max-half-turns', maxHalfTurnsRaw),
    },
    (game, i) => {
      if (game.winner !== null) decided++;
      console.log(
        `game ${String(i + 1).padStart(String(games).length)}/${games}  ` +
          `${game.winner === null ? 'draw' : `P${game.winner + 1} wins`} in ${game.sgn.length} half-turns`,
      );
    },
  );
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
