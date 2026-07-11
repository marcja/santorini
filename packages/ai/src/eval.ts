import type { GameState, Player } from '@santorini/engine';
import { NEIGHBORS, colOf, rowOf } from '@santorini/engine';

/** Standing on level 2 threatens to win; weight it steeply. Forced onto 3 is inert. */
const HEIGHT_SCORE = [0, 30, 100, 40, 0];
const CENTER_WEIGHT = 5;
const CLIMB_WEIGHT = 8;

/**
 * Static evaluation of a position from `me`'s perspective; higher is better.
 * Terms: worker heights, centrality, and reachable climbs (adjacent squares
 * exactly one level up). Intentionally cheap — this is the greedy baseline
 * and a candidate playout bias, not a strong evaluator.
 */
export function evaluate(state: GameState, me: Player): number {
  let score = 0;
  for (let i = 0; i < 4; i++) {
    const sq = state.workers[i];
    if (sq < 0) continue;
    const sign = (i >> 1) === me ? 1 : -1;
    const h = state.heights[sq];
    let s = HEIGHT_SCORE[h];
    s += CENTER_WEIGHT * (2 - Math.max(Math.abs(colOf(sq) - 2), Math.abs(rowOf(sq) - 2)));
    for (const n of NEIGHBORS[sq]) {
      if (state.heights[n] === h + 1) s += CLIMB_WEIGHT;
    }
    score += sign * s;
  }
  return score;
}
