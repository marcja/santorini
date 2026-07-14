import {
  DEFAULT_EVAL_WEIGHTS,
  EVAL_SCALE,
  type EvalFn,
  type EvalWeights,
  evaluate,
} from './eval.ts';
import { POLICY_LOGITS_V2 } from './encoding.ts';
import {
  encodeFeatures,
  encodeFeaturesV2,
  FEATURE_COUNT,
  FEATURE_COUNT_V2,
} from './features.ts';
import { MctsPlayer } from './mcts.ts';
import { Mlp, type MlpParams } from './mlp.ts';
import type { AiPlayer } from './player.ts';
import { ACTION_COUNT, type PolicyFn, policyPriors } from './policy.ts';
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
 *
 * `mlp@2`/`pv@2` are the god-aware counterparts: same net shapes, but over
 * feature encoding v2 (`FEATURE_COUNT_V2` = 295, god one-hots + state flags —
 * see `docs/milestones/god-ai-encoding-v2.md`). `pv@2`'s value head works
 * today; its policy head decodes against action encoding v2 (issue #19/T7),
 * which has not landed yet — `checkpointPolicyFn` throws for `pv@2` rather
 * than silently misreading logits through the v1 flat-action decoder.
 */
export type CheckpointEval =
  | { type: 'static@1'; weights: EvalWeights }
  | { type: 'mlp@1'; params: MlpParams }
  | { type: 'pv@1'; params: PvNetParams }
  | { type: 'mlp@2'; params: MlpParams }
  | { type: 'pv@2'; params: PvNetParams };

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

export const DEFAULT_SEARCH: SearchConfig = {
  iterations: 1000,
  c: 1.0,
  playoutDepth: 8,
};

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
export function createCheckpoint(
  createdAt: string,
  init: CheckpointInit = {},
): Checkpoint {
  const ckpt: Checkpoint = {
    format: CHECKPOINT_FORMAT,
    generation: init.generation ?? 0,
    createdAt,
    parent: init.parent ?? null,
    eval: init.eval ?? {
      type: 'static@1',
      weights: init.weights ?? DEFAULT_EVAL_WEIGHTS,
    },
    search: init.search ?? DEFAULT_SEARCH,
    elo: null,
  };
  if (init.notes !== undefined) ckpt.notes = init.notes;
  return ckpt;
}

function numberArray(x: unknown, length: number): x is number[] {
  return (
    Array.isArray(x) &&
    x.length === length &&
    x.every((v) => typeof v === 'number')
  );
}

type Fail = (msg: string) => never;

function requireStaticWeights(w: EvalWeights, fail: Fail): void {
  if (
    !numberArray(w?.heightScore, 5) ||
    typeof w.centerWeight !== 'number' ||
    typeof w.climbWeight !== 'number'
  ) {
    fail('eval.weights must have heightScore[5], centerWeight, climbWeight');
  }
}

function requireMlpParams(
  p: MlpParams,
  fail: Fail,
  evalType: 'mlp@1' | 'mlp@2',
  expectedInputSize: number,
  encodingLabel: string,
): void {
  if (p?.inputSize !== expectedInputSize) {
    fail(
      `${evalType} inputSize must be ${expectedInputSize} (${encodingLabel})`,
    );
  }
  if (
    !Number.isInteger(p.hiddenSize) ||
    p.hiddenSize < 1 ||
    !numberArray(p.w1, p.hiddenSize * p.inputSize) ||
    !numberArray(p.b1, p.hiddenSize) ||
    !numberArray(p.w2, p.hiddenSize) ||
    typeof p.b2 !== 'number'
  ) {
    fail(`${evalType} params have inconsistent shapes`);
  }
}

function requirePvParams(
  p: PvNetParams,
  fail: Fail,
  evalType: 'pv@1' | 'pv@2',
  expectedInputSize: number,
  featureEncodingLabel: string,
  expectedActionCount: number,
  actionEncodingLabel: string,
): void {
  if (p?.inputSize !== expectedInputSize) {
    fail(
      `${evalType} inputSize must be ${expectedInputSize} (${featureEncodingLabel})`,
    );
  }
  if (p.actionCount !== expectedActionCount) {
    fail(
      `${evalType} actionCount must be ${expectedActionCount} (${actionEncodingLabel})`,
    );
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
    fail(`${evalType} params have inconsistent shapes`);
  }
}

function requireSearchConfig(s: SearchConfig, fail: Fail): void {
  if (
    !Number.isInteger(s?.iterations) ||
    s.iterations < 1 ||
    typeof s.c !== 'number' ||
    !Number.isInteger(s.playoutDepth) ||
    s.playoutDepth < 1
  ) {
    fail('search must have iterations>=1, c, playoutDepth>=1');
  }
}

/** Dispatch on `ev.type` to the right shape check — factored out of
 * `validateCheckpoint` to keep its own branching under the complexity cap. */
function requireEvalParams(ev: CheckpointEval, fail: Fail): void {
  if (ev?.type === 'static@1') {
    requireStaticWeights(ev.weights, fail);
  } else if (ev?.type === 'mlp@1') {
    requireMlpParams(
      ev.params,
      fail,
      'mlp@1',
      FEATURE_COUNT,
      'feature encoding v1',
    );
  } else if (ev?.type === 'mlp@2') {
    requireMlpParams(
      ev.params,
      fail,
      'mlp@2',
      FEATURE_COUNT_V2,
      'feature encoding v2',
    );
  } else if (ev?.type === 'pv@1') {
    requirePvParams(
      ev.params,
      fail,
      'pv@1',
      FEATURE_COUNT,
      'feature encoding v1',
      ACTION_COUNT,
      'action encoding v1',
    );
  } else if (ev?.type === 'pv@2') {
    requirePvParams(
      ev.params,
      fail,
      'pv@2',
      FEATURE_COUNT_V2,
      'feature encoding v2',
      POLICY_LOGITS_V2,
      'policy action encoding v2',
    );
  } else {
    fail(
      `unknown eval type ${JSON.stringify((ev as { type?: unknown } | null)?.type)}`,
    );
  }
}

/** Structurally validate parsed JSON; throws with a specific message. */
export function validateCheckpoint(data: unknown): Checkpoint {
  const c = data as Checkpoint;
  const fail: Fail = (msg) => {
    throw new Error(`invalid checkpoint: ${msg}`);
  };
  if (typeof c !== 'object' || c === null) fail('not an object');
  if (c.format !== CHECKPOINT_FORMAT)
    fail(
      `format is ${JSON.stringify(c.format)}, expected ${CHECKPOINT_FORMAT}`,
    );
  if (!Number.isInteger(c.generation) || c.generation < 0)
    fail('generation must be a non-negative integer');
  if (typeof c.createdAt !== 'string') fail('createdAt must be a string');
  if (c.parent !== null && typeof c.parent !== 'string')
    fail('parent must be a string or null');
  requireEvalParams(c.eval, fail);
  requireSearchConfig(c.search, fail);
  if (c.elo !== null && typeof c.elo?.rating !== 'number')
    fail('elo must be null or a rating record');
  return c;
}

/** Build the EvalFn a checkpoint's eval spec describes. */
export function checkpointEvalFn(ev: CheckpointEval): EvalFn {
  if (ev.type === 'static@1') {
    const weights = ev.weights;
    return (state, me) => evaluate(state, me, weights);
  }
  const isV2 = ev.type === 'mlp@2' || ev.type === 'pv@2';
  const encode = isV2 ? encodeFeaturesV2 : encodeFeatures;
  const buf = new Float32Array(isV2 ? FEATURE_COUNT_V2 : FEATURE_COUNT);
  const net =
    ev.type === 'mlp@1' || ev.type === 'mlp@2'
      ? new Mlp(ev.params)
      : new PolicyValueNet(ev.params);
  const forward =
    net instanceof Mlp ? net.forward.bind(net) : net.valueForward.bind(net);
  return (state, me) => {
    // The net scores the player to move; negate for the other perspective.
    const logit = forward(encode(state, buf));
    return (state.player === me ? logit : -logit) * EVAL_SCALE;
  };
}

/**
 * Build the PolicyFn a checkpoint's eval spec describes, or null when the
 * eval has no policy head (such checkpoints search with plain UCT).
 *
 * `pv@2` checkpoints have a policy head shaped for action encoding v2
 * (`POLICY_LOGITS_V2` = 83 factorized-head logits, issue #19/T7), but that
 * decoder does not exist yet — `policyPriors`/`turnAction` are v1-only and
 * would silently misread a v2 logit layout (looking up out-of-range flat
 * action indices) rather than throw. Fail loudly instead: a `pv@2`
 * checkpoint's value head is fully usable today via `checkpointEvalFn`; its
 * policy head is not.
 */
export function checkpointPolicyFn(ev: CheckpointEval): PolicyFn | null {
  if (ev.type === 'pv@2') {
    throw new Error(
      'pv@2 policy decoding is not implemented yet (action encoding v2 / ' +
        'issue #19 has not landed) — use checkpointEvalFn for its value ' +
        'head only until then',
    );
  }
  if (ev.type !== 'pv@1') return null;
  const net = new PolicyValueNet(ev.params);
  const buf = new Float32Array(FEATURE_COUNT);
  const logits = new Float64Array(ACTION_COUNT);
  return (state, turns) => {
    if (state.phase !== 'play') return null; // placements take no priors
    return policyPriors(
      turns,
      net.policyForward(encodeFeatures(state, buf), logits),
    );
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
export function playerFromCheckpoint(
  ckpt: Checkpoint,
  opts: CheckpointPlayerOptions = {},
): AiPlayer {
  return new MctsPlayer({
    ...ckpt.search,
    iterations: opts.iterations ?? ckpt.search.iterations,
    seed: opts.seed,
    evaluate: checkpointEvalFn(ckpt.eval),
    policy: checkpointPolicyFn(ckpt.eval) ?? undefined,
    name: opts.name ?? `gen-${ckpt.generation}`,
  });
}
