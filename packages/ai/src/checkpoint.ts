import { DEFAULT_EVAL_WEIGHTS, EVAL_SCALE, evaluate, type EvalFn, type EvalWeights } from './eval.ts';
import { encodeFeatures, FEATURE_COUNT } from './features.ts';
import { Mlp, type MlpParams } from './mlp.ts';
import { MctsPlayer } from './mcts.ts';
import type { AiPlayer } from './player.ts';
import { ACTION_COUNT, policyPriors, type PolicyFn } from './policy.ts';
import { PolicyValueNet, type PvNetParams } from './pvnet.ts';

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
 * feature encoding v1 (its logit is the mover's win probability); `pv@1` =
 * the two-headed net — same value contract plus a policy head over action
 * encoding v1 (checkpoints of this type search with PUCT).
 */
export type CheckpointEval =
  | { type: 'static@1'; weights: EvalWeights }
  | { type: 'mlp@1'; params: MlpParams }
  | { type: 'pv@1'; params: PvNetParams };

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
  } else if (c.eval?.type === 'pv@1') {
    const p = c.eval.params;
    if (p?.inputSize !== FEATURE_COUNT) {
      fail(`pv@1 inputSize must be ${FEATURE_COUNT} (feature encoding v1)`);
    }
    if (p.actionCount !== ACTION_COUNT) {
      fail(`pv@1 actionCount must be ${ACTION_COUNT} (action encoding v1)`);
    }
    if (
      !Number.isInteger(p.hiddenSize) ||
      p.hiddenSize < 1 ||
      !numberArray(p.w1, p.hiddenSize * p.inputSize) ||
      !numberArray(p.b1, p.hiddenSize) ||
      !numberArray(p.wv, p.hiddenSize) ||
      typeof p.bv !== 'number' ||
      !numberArray(p.wp, p.actionCount * p.hiddenSize) ||
      !numberArray(p.bp, p.actionCount)
    ) {
      fail('pv@1 params have inconsistent shapes');
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
  const buf = new Float32Array(FEATURE_COUNT);
  const net = ev.type === 'mlp@1' ? new Mlp(ev.params) : new PolicyValueNet(ev.params);
  const forward = net instanceof Mlp ? net.forward.bind(net) : net.valueForward.bind(net);
  return (state, me) => {
    // The net scores the player to move; negate for the other perspective.
    const logit = forward(encodeFeatures(state, buf));
    return (state.player === me ? logit : -logit) * EVAL_SCALE;
  };
}

/**
 * Build the PolicyFn a checkpoint's eval spec describes, or null when the
 * eval has no policy head (such checkpoints search with plain UCT).
 */
export function checkpointPolicyFn(ev: CheckpointEval): PolicyFn | null {
  if (ev.type !== 'pv@1') return null;
  const net = new PolicyValueNet(ev.params);
  const buf = new Float32Array(FEATURE_COUNT);
  const logits = new Float64Array(ACTION_COUNT);
  return (state, turns) => {
    if (state.phase !== 'play') return null; // placements take no priors
    return policyPriors(turns, net.policyForward(encodeFeatures(state, buf), logits));
  };
}

export interface CheckpointPlayerOptions {
  seed?: number;
  /** Override the checkpoint's search iterations (strength ladder knob). */
  iterations?: number;
  name?: string;
}

/**
 * Build the playing agent a checkpoint describes: MCTS over its eval —
 * PUCT-guided by its policy head when the checkpoint has one.
 */
export function playerFromCheckpoint(ckpt: Checkpoint, opts: CheckpointPlayerOptions = {}): AiPlayer {
  return new MctsPlayer({
    ...ckpt.search,
    iterations: opts.iterations ?? ckpt.search.iterations,
    seed: opts.seed,
    evaluate: checkpointEvalFn(ckpt.eval),
    policy: checkpointPolicyFn(ckpt.eval) ?? undefined,
    name: opts.name ?? `gen-${ckpt.generation}`,
  });
}
