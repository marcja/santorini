import type { GameState, Player } from '@santorini/engine';
import { colOf, GODS, NEIGHBORS, rowOf } from '@santorini/engine';

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
 * MCTS maps eval scores onto (0,1) via sigmoid(score / EVAL_SCALE). Evals
 * that natively produce a win-probability logit (the MLP) multiply it by
 * this constant so the mapping recovers their probability exactly.
 */
export const EVAL_SCALE = 150;

/**
 * `heightScore[3]` is deliberately below `heightScore[2]` for the base game:
 * a worker *on* level 3 without having just moved up there this turn is
 * inert (it can't move up further, and the rulebook's "moved up" win check
 * is about the move, not the resting square — see `docs/reference/
 * rulebook.md` and the CLAUDE.md note on forced level-3 moves not winning).
 * That ordering is backwards for a god whose win condition is triggered by
 * *descending* two or more levels (Pan, `winOnDescend2`): standing on level
 * 3 is what makes the descent-win threat live (a drop to level 1 or 0 both
 * qualify), so it should score at least as well as level 2, not worse.
 * This is the minimal fix for issue #20 — it only touches the one height
 * that was actively adversarial to a real win condition, not a general
 * Pan-strategy evaluator.
 */
function heightScoreFor(owner: GameState['gods'][number], w: EvalWeights) {
  if (!GODS[owner].winOnDescend2) return w.heightScore;
  const adjusted = w.heightScore.slice();
  adjusted[3] = Math.max(adjusted[2], adjusted[3]);
  return adjusted;
}

/**
 * Static evaluation of a position from `me`'s perspective; higher is better.
 * Terms: worker heights, centrality, and reachable climbs (adjacent squares
 * exactly one level up). Intentionally cheap — this is the greedy baseline
 * and a candidate playout bias, not a strong evaluator.
 */
export function evaluate(
  state: GameState,
  me: Player,
  w: EvalWeights = DEFAULT_EVAL_WEIGHTS,
): number {
  let score = 0;
  for (let i = 0; i < 4; i++) {
    const sq = state.workers[i];
    if (sq < 0) continue;
    const owner = i >> 1;
    const sign = owner === me ? 1 : -1;
    const h = state.heights[sq];
    const heightScore = heightScoreFor(state.gods[owner], w);
    let s = heightScore[h];
    s +=
      w.centerWeight *
      (2 - Math.max(Math.abs(colOf(sq) - 2), Math.abs(rowOf(sq) - 2)));
    for (const n of NEIGHBORS[sq]) {
      if (state.heights[n] === h + 1) s += w.climbWeight;
    }
    score += sign * s;
  }
  return score;
}
