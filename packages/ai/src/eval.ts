import type { GameState, Player } from '@santorini/engine';
import { NEIGHBORS, colOf, rowOf } from '@santorini/engine';

/** Tunable parameters of the static eval — what a `static@1` checkpoint persists. */
export interface EvalWeights {
  /** Score for a worker standing on each height 0–4. */
  heightScore: number[];
  centerWeight: number;
  climbWeight: number;
}

/** Standing on level 2 threatens to win; weight it steeply. Forced onto 3 is inert. */
export const DEFAULT_EVAL_WEIGHTS: EvalWeights = {
  heightScore: [0, 30, 100, 40, 0],
  centerWeight: 5,
  climbWeight: 8,
};

/** Position score from `me`'s perspective; higher is better. */
export type EvalFn = (state: GameState, me: Player) => number;

/**
 * Static evaluation of a position from `me`'s perspective; higher is better.
 * Terms: worker heights, centrality, and reachable climbs (adjacent squares
 * exactly one level up). Intentionally cheap — this is the greedy baseline
 * and a candidate playout bias, not a strong evaluator.
 */
export function evaluate(state: GameState, me: Player, w: EvalWeights = DEFAULT_EVAL_WEIGHTS): number {
  let score = 0;
  for (let i = 0; i < 4; i++) {
    const sq = state.workers[i];
    if (sq < 0) continue;
    const sign = (i >> 1) === me ? 1 : -1;
    const h = state.heights[sq];
    let s = w.heightScore[h];
    s += w.centerWeight * (2 - Math.max(Math.abs(colOf(sq) - 2), Math.abs(rowOf(sq) - 2)));
    for (const n of NEIGHBORS[sq]) {
      if (state.heights[n] === h + 1) s += w.climbWeight;
    }
    score += sign * s;
  }
  return score;
}
