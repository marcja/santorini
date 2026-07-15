// One-off tool for T6 (docs/milestones/god-ai.md, "slice-1 trial
// generation"): originates the first v2-encoded (feature encoding v2,
// 295-wide, god one-hots + state flags) checkpoint lineage under
// `models/v2/`, runs a small god-pool self-play trial, trains a value net
// on it, and measures the god-pool wall-clock multiplier against a
// same-machine base-game control.
//
// Why a standalone script instead of `trainer train --god-pool`: T5 added
// a guard (`assertV2TrainingSupported` in apps/trainer/src/cli.ts) that
// rejects *any* mlp@2/pv@2 parent before self-play runs, because the CLI's
// net-training step (`selectPvNet`/`trainPvNet`) hard-codes v1 dimensions
// and a pv@2 lineage genuinely needs policy encoding v2 (issue #19/T7,
// blocked) to decode its action space. But *this* trial only needs a
// value-only `mlp@2` net (no policy head, plain UCT search) — the "free
// five" gods (Pan/Athena/Apollo/Minotaur/Artemis) need no policy-encoding
// change at all (T3's analysis: their turns are position-unambiguous under
// v1's action space; irrelevant anyway since mlp@2 has no policy head to
// decode). `Mlp`/`selfPlay` in packages/ai are already fully
// encoding-agnostic (inputSize/featureEncoding are plain parameters), so
// this script composes those existing, already-tested primitives directly
// — it does not touch or loosen `assertV2TrainingSupported`, which stays
// exactly as strict as T5 left it for pv@2/policy-bearing lineages.
//
// Usage: node scripts/god-ai-v2-trial.ts
//
// Resumable: skips gen-000 creation if models/v2/gen-000.json exists;
// skips the self-play/training trial entirely if models/v2/gen-001.json
// exists (delete it manually to redo).
//
// DISPOSABLE: gen-000/gen-001 under models/v2/ from this script are
// pipeline-validation artifacts (docs/milestones/god-ai.md Slice 1 preamble)
// — not a real trained generation, do not ship them.

import { existsSync } from 'node:fs';
import {
  augmentSamples,
  checkpointEvalFn,
  createCheckpoint,
  DEFAULT_SEARCH,
  FEATURE_COUNT_V2,
  Mlp,
  mulberry32,
  pick,
  selfPlay,
  type SelfPlayConfig,
  type SelfPlayGame,
  type SelfPlayResult,
} from '@santorini/ai';
import { Game } from '@santorini/engine';
import type { GodId } from '@santorini/engine';
import { gameToSgn } from '../apps/trainer/src/run.ts';
import { readCheckpoint, writeJson } from '../apps/trainer/src/io.ts';

const GEN0_PATH = process.env.T6_GEN0 ?? 'models/v2/gen-000.json';
const GEN1_PATH = process.env.T6_GEN1 ?? 'models/v2/gen-001.json';
const HIDDEN = Number(process.env.T6_HIDDEN ?? 64);
const GAMES = Number(process.env.T6_GAMES ?? 200);
const ITERS = Number(process.env.T6_ITERS ?? 600);
const SEED = Number(process.env.T6_SEED ?? 1); // recipe convention (TRAINING.md): seed = child generation number
const CONTROL_SEED = Number(process.env.T6_CONTROL_SEED ?? 9001); // distinct seed for the base-game timing control
const TEMP_TURNS = 8;
const MAX_HALF_TURNS = 400;
// The free five (T3/god-ai.md Slice 1) + base; Hermes excluded (T10: ~130x
// movegen cost, not measured/fixed yet).
const POOL: GodId[] = ['none', 'pan', 'athena', 'apollo', 'minotaur', 'artemis'];

function ensureParent(): void {
  if (existsSync(GEN0_PATH)) {
    console.log(`${GEN0_PATH} already exists, resuming from it`);
    return;
  }
  const net = Mlp.init(FEATURE_COUNT_V2, HIDDEN, 0);
  const ckpt = createCheckpoint(new Date().toISOString(), {
    eval: { type: 'mlp@2', params: net.toParams() },
    search: DEFAULT_SEARCH,
    notes:
      'T6 slice-1 trial parent (docs/milestones/god-ai.md): fresh ' +
      '(untrained) mlp@2 net over feature encoding v2 (295-wide, god ' +
      `one-hots + state flags), He-init hidden=${HIDDEN} seed=0. Mirrors ` +
      'the v1 lineage shape (gen-000 static -> gen-001 first mlp@1) but ' +
      'starts from a fresh net rather than the hand eval, since the point ' +
      'is to originate a v2-encoded parent for self-play (no static eval ' +
      'understands the god one-hot planes). DISPOSABLE pipeline-validation ' +
      'artifact - not a real trained generation.',
  });
  writeJson(GEN0_PATH, ckpt);
  console.log(`wrote ${GEN0_PATH} (fresh mlp@2, hidden=${HIDDEN}, gen 0)`);
}

/** Mirrors apps/trainer/src/cli.ts's godPoolMatchups exactly: seeded
 * per-game draw with replacement from the pool, deterministic in `seed`. */
function godPoolMatchups(
  pool: GodId[],
  games: number,
  seed: number,
): [GodId, GodId][] {
  const rand = mulberry32(seed ^ 0x90d5);
  return Array.from({ length: games }, () => [pick(rand, pool), pick(rand, pool)] as [
    GodId,
    GodId,
  ]);
}

/** Run one self-play game per pool matchup, seeded like a fixed-gods batch
 * would seed game i (mirrors apps/trainer/src/cli.ts's runPooledSelfPlayGame). */
function runPool(
  baseConfig: Omit<SelfPlayConfig, 'games' | 'seed' | 'gods'>,
  seed: number,
  games: number,
  pool: GodId[],
  onGame?: (game: SelfPlayGame, index: number) => void,
): SelfPlayResult {
  const matchups = godPoolMatchups(pool, games, seed);
  return matchups.reduce<SelfPlayResult>(
    (acc, gods, i) => {
      const one = selfPlay(
        { ...baseConfig, games: 1, seed: seed + 2 * i, gods },
        (g) => onGame?.(g, i),
      );
      acc.games.push(...one.games);
      acc.samples.push(...one.samples);
      return acc;
    },
    { games: [], samples: [] },
  );
}

/** Replay every self-play game through the engine's SGN round-trip and
 * confirm the replayed winner matches what self-play reported (TRAINING.md:
 * "replay-verify every self-play SGN dump before trusting a run"). */
function replayVerify(games: SelfPlayGame[]): void {
  for (const g of games) {
    const doc = gameToSgn({ ...g, aSeat: 0 }, 'trial', 'trial', 'T6 replay-verify');
    const replayed = Game.fromSGN(doc);
    if (replayed.winner !== g.winner) {
      throw new Error(
        `replay mismatch: self-play winner ${g.winner}, replayed ${replayed.winner}\n${doc}`,
      );
    }
  }
  console.log(`replay-verified ${games.length} games (winner matches, SGN round-trips)`);
}

function main(): void {
  ensureParent();
  if (existsSync(GEN1_PATH)) {
    console.log(
      `${GEN1_PATH} already exists - trial already ran, not repeating self-play/training. ` +
        'Delete it to redo.',
    );
    return;
  }

  const parent = readCheckpoint(GEN0_PATH);
  if (parent.eval.type !== 'mlp@2') {
    throw new Error(
      `${GEN0_PATH} must be an mlp@2 checkpoint for this trial (got ${parent.eval.type})`,
    );
  }

  const baseConfig: Omit<SelfPlayConfig, 'games' | 'seed' | 'gods'> = {
    search: { ...parent.search, iterations: ITERS },
    evaluate: checkpointEvalFn(parent.eval),
    temperatureTurns: TEMP_TURNS,
    maxHalfTurns: MAX_HALF_TURNS,
    featureEncoding: 'v2',
  };

  // 1. Same-machine base-game control: isolates the god-pool movegen/apply
  // overhead from encoding-v2/hardware/session noise (TRAINING.md's
  // documented ~15-40 min/gen baseline was measured in a different session,
  // possibly different hardware - a same-run control is the rigorous
  // comparison per the mistake log's "don't trust a plausible-looking
  // number" discipline).
  console.log(`\n=== base-game control: ${GAMES} games @ mcts(${ITERS}) iters, gods none/none ===`);
  const baseStart = Date.now();
  const baseResult = selfPlay({
    ...baseConfig,
    games: GAMES,
    seed: CONTROL_SEED,
    gods: ['none', 'none'],
  });
  const baseMs = Date.now() - baseStart;
  console.log(
    `base-game control: ${GAMES} games in ${(baseMs / 1000).toFixed(1)}s ` +
      `(${(baseMs / GAMES).toFixed(1)} ms/game)`,
  );

  // 2. God-pool trial: this self-play run's output is the actual training
  // data for gen-001.
  console.log(
    `\n=== god-pool trial: ${GAMES} games @ mcts(${ITERS}) iters, pool [${POOL.join(',')}] ===`,
  );
  let decided = 0;
  const godStart = Date.now();
  const godResult = runPool(baseConfig, SEED, GAMES, POOL, (game, i) => {
    if (game.winner !== null) decided++;
    console.log(
      `game ${String(i + 1).padStart(3)}/${GAMES}  [${game.gods[0]},${game.gods[1]}]  ` +
        `${game.winner === null ? 'draw' : `P${game.winner + 1} wins`} in ${game.sgn.length} half-turns`,
    );
  });
  const godMs = Date.now() - godStart;
  console.log(
    `\ngod-pool trial: ${GAMES} games (${decided} decided) in ${(godMs / 1000).toFixed(1)}s ` +
      `(${(godMs / GAMES).toFixed(1)} ms/game), ${godResult.samples.length} samples`,
  );

  const multiplier = godMs / baseMs;
  console.log(
    `\n*** wall-clock multiplier (god-pool vs same-machine base-game control): ` +
      `${multiplier.toFixed(2)}x ***`,
  );
  const trainingMdBaselineSecPerGame = (15 * 60) / 800; // ~15-40 min/gen, 800 games/gen
  console.log(
    `for context, TRAINING.md's documented base-game baseline (different ` +
      `session/hardware) is ~${trainingMdBaselineSecPerGame.toFixed(2)}-` +
      `${((40 * 60) / 800).toFixed(2)} s/game at 800 games/gen (~15-40 min ` +
      'total including SGD); this trial\'s own base-game control at ' +
      `${(baseMs / GAMES / 1000).toFixed(2)} s/game is the apples-to-apples ` +
      'reference used for the multiplier above.',
  );

  // 3. Replay-verify before trusting the run.
  replayVerify(godResult.games);

  // 4. Train a value-only net (matches selectMlpNet/trainMlpNet's mlp@1
  // convention: continue the parent net rather than reinit, since gen-000's
  // weights are an untrained random init anyway - continuing them is
  // equivalent to a fresh init at this seed).
  const net = new Mlp(parent.eval.params);
  const samples = augmentSamples(godResult.samples);
  console.log(
    `\naugmented ${godResult.samples.length} samples to ${samples.length} (8 symmetries)`,
  );
  const losses = net.train(samples, { epochs: 10, batchSize: 64, lr: 0.2, seed: SEED + 1 });
  losses.forEach((loss, e) => console.log(`epoch ${e + 1}/10  loss ${loss.toFixed(4)}`));

  const child = createCheckpoint(new Date().toISOString(), {
    generation: 1,
    parent: GEN0_PATH,
    eval: { type: 'mlp@2', params: net.toParams() },
    search: parent.search,
    notes:
      `T6 slice-1 trial (docs/milestones/god-ai.md): self-play ${GAMES} games ` +
      `@ mcts(${ITERS}) from ${GEN0_PATH}, --god-pool ${POOL.join(',')} ` +
      `(seed ${SEED}), 8-symmetry augmentation, value-only mlp@2 (no policy ` +
      'head - policy encoding v2/T7 not landed). Wall-clock: base-game ' +
      `control ${(baseMs / 1000).toFixed(1)}s, god-pool trial ` +
      `${(godMs / 1000).toFixed(1)}s, multiplier ${multiplier.toFixed(2)}x. ` +
      'DISPOSABLE pipeline-validation artifact - not a real trained ' +
      'generation, do not ship.',
  });
  writeJson(GEN1_PATH, child);
  console.log(`\nwrote ${GEN1_PATH} (gen 1, mlp@2, hidden ${net.hiddenSize})`);
  console.log(
    'rate it: node apps/trainer/src/cli.ts gauntlet ckpt:models/v2/gen-001.json --gods <g1,g2> --games 20 --seed <n>',
  );
}

main();
