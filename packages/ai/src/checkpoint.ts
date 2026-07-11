import { DEFAULT_EVAL_WEIGHTS, evaluate, type EvalWeights } from './eval.ts';
import { MctsPlayer } from './mcts.ts';
import type { AiPlayer } from './player.ts';

// Versioned model artifact stored as JSON in `models/`. Pure data + pure
// helpers — file I/O belongs to apps/trainer. Bump the format string on any
// breaking schema change so old artifacts fail loudly instead of misloading.

export const CHECKPOINT_FORMAT = 'santorini-checkpoint@1';

export interface OpponentRecord {
  wins: number;
  losses: number;
  draws: number;
}

/** Rating stamped by the trainer's gauntlet against calibrated baselines. */
export interface EloRating {
  rating: number;
  games: number;
  perOpponent: Record<string, OpponentRecord>;
  ratedAt: string;
}

export interface SearchConfig {
  iterations: number;
  c: number;
  playoutDepth: number;
}

export interface Checkpoint {
  format: typeof CHECKPOINT_FORMAT;
  generation: number;
  createdAt: string;
  /** Checkpoint file this one was trained from (null for gen 0). */
  parent: string | null;
  /** `static@1` = the linear hand-eval; learned evals add new types. */
  eval: { type: 'static@1'; weights: EvalWeights };
  /** Search settings the checkpoint plays/was rated with. */
  search: SearchConfig;
  elo: EloRating | null;
  notes?: string;
}

export const DEFAULT_SEARCH: SearchConfig = { iterations: 1000, c: 1.0, playoutDepth: 8 };

export interface CheckpointInit {
  generation?: number;
  parent?: string | null;
  weights?: EvalWeights;
  search?: SearchConfig;
  notes?: string;
}

/** `createdAt` is injected (ISO string) to keep this module clock-free. */
export function createCheckpoint(createdAt: string, init: CheckpointInit = {}): Checkpoint {
  const ckpt: Checkpoint = {
    format: CHECKPOINT_FORMAT,
    generation: init.generation ?? 0,
    createdAt,
    parent: init.parent ?? null,
    eval: { type: 'static@1', weights: init.weights ?? DEFAULT_EVAL_WEIGHTS },
    search: init.search ?? DEFAULT_SEARCH,
    elo: null,
  };
  if (init.notes !== undefined) ckpt.notes = init.notes;
  return ckpt;
}

/** Structurally validate parsed JSON; throws with a specific message. */
export function validateCheckpoint(data: unknown): Checkpoint {
  const c = data as Checkpoint;
  const fail = (msg: string): never => {
    throw new Error(`invalid checkpoint: ${msg}`);
  };
  if (typeof c !== 'object' || c === null) fail('not an object');
  if (c.format !== CHECKPOINT_FORMAT) fail(`format is ${JSON.stringify(c.format)}, expected ${CHECKPOINT_FORMAT}`);
  if (!Number.isInteger(c.generation) || c.generation < 0) fail('generation must be a non-negative integer');
  if (typeof c.createdAt !== 'string') fail('createdAt must be a string');
  if (c.parent !== null && typeof c.parent !== 'string') fail('parent must be a string or null');
  if (c.eval?.type !== 'static@1') fail(`unknown eval type ${JSON.stringify(c.eval?.type)}`);
  const w = c.eval.weights;
  if (
    !Array.isArray(w?.heightScore) ||
    w.heightScore.length !== 5 ||
    !w.heightScore.every((x) => typeof x === 'number') ||
    typeof w.centerWeight !== 'number' ||
    typeof w.climbWeight !== 'number'
  ) {
    fail('eval.weights must have heightScore[5], centerWeight, climbWeight');
  }
  const s = c.search;
  if (
    !Number.isInteger(s?.iterations) ||
    s.iterations < 1 ||
    typeof s.c !== 'number' ||
    !Number.isInteger(s.playoutDepth) ||
    s.playoutDepth < 1
  ) {
    fail('search must have iterations>=1, c, playoutDepth>=1');
  }
  if (c.elo !== null && typeof c.elo?.rating !== 'number') fail('elo must be null or a rating record');
  return c;
}

export interface CheckpointPlayerOptions {
  seed?: number;
  /** Override the checkpoint's search iterations (strength ladder knob). */
  iterations?: number;
  name?: string;
}

/** Build the playing agent a checkpoint describes: MCTS over its eval. */
export function playerFromCheckpoint(ckpt: Checkpoint, opts: CheckpointPlayerOptions = {}): AiPlayer {
  const weights = ckpt.eval.weights;
  return new MctsPlayer({
    ...ckpt.search,
    iterations: opts.iterations ?? ckpt.search.iterations,
    seed: opts.seed,
    evaluate: (state, me) => evaluate(state, me, weights),
    name: opts.name ?? `gen-${ckpt.generation}`,
  });
}
