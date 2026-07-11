import { DEFAULT_EVAL_WEIGHTS, EVAL_SCALE, evaluate, type EvalFn, type EvalWeights } from './eval.ts';
import { encodeFeatures, FEATURE_COUNT } from './features.ts';
import { Mlp, type MlpParams } from './mlp.ts';
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

/**
 * `static@1` = the linear hand eval; `mlp@1` = the learned value net over
 * feature encoding v1 (its logit is the mover's win probability).
 */
export type CheckpointEval =
  | { type: 'static@1'; weights: EvalWeights }
  | { type: 'mlp@1'; params: MlpParams };

export interface Checkpoint {
  format: typeof CHECKPOINT_FORMAT;
  generation: number;
  createdAt: string;
  /** Checkpoint file this one was trained from (null for gen 0). */
  parent: string | null;
  eval: CheckpointEval;
  /** Search settings the checkpoint plays/was rated with. */
  search: SearchConfig;
  elo: EloRating | null;
  notes?: string;
}

export const DEFAULT_SEARCH: SearchConfig = { iterations: 1000, c: 1.0, playoutDepth: 8 };

export interface CheckpointInit {
  generation?: number;
  parent?: string | null;
  /** Full eval spec; takes precedence over `weights`. */
  eval?: CheckpointEval;
  /** Shorthand for a `static@1` eval. */
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
    eval: init.eval ?? { type: 'static@1', weights: init.weights ?? DEFAULT_EVAL_WEIGHTS },
    search: init.search ?? DEFAULT_SEARCH,
    elo: null,
  };
  if (init.notes !== undefined) ckpt.notes = init.notes;
  return ckpt;
}

function numberArray(x: unknown, length: number): x is number[] {
  return Array.isArray(x) && x.length === length && x.every((v) => typeof v === 'number');
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
  if (c.eval?.type === 'static@1') {
    const w = c.eval.weights;
    if (
      !numberArray(w?.heightScore, 5) ||
      typeof w.centerWeight !== 'number' ||
      typeof w.climbWeight !== 'number'
    ) {
      fail('eval.weights must have heightScore[5], centerWeight, climbWeight');
    }
  } else if (c.eval?.type === 'mlp@1') {
    const p = c.eval.params;
    if (p?.inputSize !== FEATURE_COUNT) {
      fail(`mlp@1 inputSize must be ${FEATURE_COUNT} (feature encoding v1)`);
    }
    if (
      !Number.isInteger(p.hiddenSize) ||
      p.hiddenSize < 1 ||
      !numberArray(p.w1, p.hiddenSize * p.inputSize) ||
      !numberArray(p.b1, p.hiddenSize) ||
      !numberArray(p.w2, p.hiddenSize) ||
      typeof p.b2 !== 'number'
    ) {
      fail('mlp@1 params have inconsistent shapes');
    }
  } else {
    fail(`unknown eval type ${JSON.stringify((c.eval as { type?: unknown } | null)?.type)}`);
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

/** Build the EvalFn a checkpoint's eval spec describes. */
export function checkpointEvalFn(ev: CheckpointEval): EvalFn {
  if (ev.type === 'static@1') {
    const weights = ev.weights;
    return (state, me) => evaluate(state, me, weights);
  }
  const net = new Mlp(ev.params);
  const buf = new Float32Array(FEATURE_COUNT);
  return (state, me) => {
    // The net scores the player to move; negate for the other perspective.
    const logit = net.forward(encodeFeatures(state, buf));
    return (state.player === me ? logit : -logit) * EVAL_SCALE;
  };
}

export interface CheckpointPlayerOptions {
  seed?: number;
  /** Override the checkpoint's search iterations (strength ladder knob). */
  iterations?: number;
  name?: string;
}

/** Build the playing agent a checkpoint describes: MCTS over its eval. */
export function playerFromCheckpoint(ckpt: Checkpoint, opts: CheckpointPlayerOptions = {}): AiPlayer {
  return new MctsPlayer({
    ...ckpt.search,
    iterations: opts.iterations ?? ckpt.search.iterations,
    seed: opts.seed,
    evaluate: checkpointEvalFn(ckpt.eval),
    name: opts.name ?? `gen-${ckpt.generation}`,
  });
}
