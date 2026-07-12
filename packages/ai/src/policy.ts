import type { GameState, Turn } from '@santorini/engine';
import { colOf, rowOf } from '@santorini/engine';
import { SYMMETRY_MAPS, transformFeatures } from './features.ts';
import type { PvSample } from './pvnet.ts';

// Policy action encoding v1 — the `pv@1` checkpoint type pins this layout.
//
// A play-phase turn is summarized by (destination square, build direction):
// the square the moved worker ends on (25) × the first post-move build's
// direction relative to it (3×3 delta code, center = "no build" = a winning
// move), giving 225 actions. God extras — second moves, second builds,
// pre-builds, swaps/pushes — collapse onto their primary components, so turns
// sharing a summary share a prior; the search's values still tell them apart.
// Placement turns are not encoded (priors would starve into visit noise over
// ~600 pairs anyway — the coach learned this first).

/** Destination square (25) × 3×3 build-delta code (9, center = no build). */
export const ACTION_COUNT = 225;

const NO_BUILD = 4; // center of the 3×3 delta grid — impossible as a build

/**
 * Action index of a turn, or null when the turn has no encoding (placements,
 * or a future god whose first build isn't adjacent to the destination).
 */
export function turnAction(turn: Turn): number | null {
  if (turn.kind !== 'move') return null;
  const to = turn.path[turn.path.length - 1];
  let code = NO_BUILD;
  if (!turn.win) {
    const at = turn.builds[0].at;
    const dc = colOf(at) - colOf(to);
    const dr = rowOf(at) - rowOf(to);
    if (Math.abs(dc) > 1 || Math.abs(dr) > 1 || (dc === 0 && dr === 0)) return null;
    code = (dr + 1) * 3 + (dc + 1);
  }
  return to * 9 + code;
}

/**
 * Re-index an action under board symmetry s (see SYMMETRY_MAPS). Only valid
 * for actions produced by turnAction on legal turns — the implied build
 * square must be on the board.
 */
export function transformAction(action: number, s: number): number {
  const map = SYMMETRY_MAPS[s];
  const to = Math.floor(action / 9);
  const code = action % 9;
  const to2 = map[to];
  if (code === NO_BUILD) return to2 * 9 + NO_BUILD;
  const buildSq = (rowOf(to) + Math.floor(code / 3) - 1) * 5 + (colOf(to) + (code % 3) - 1);
  const build2 = map[buildSq];
  const code2 = (rowOf(build2) - rowOf(to2) + 1) * 3 + (colOf(build2) - colOf(to2) + 1);
  return to2 * 9 + code2;
}

/**
 * Prior probability per legal turn: softmax of each turn's action logit
 * (unencodable turns enter at logit 0, a neutral prior). Turns sharing an
 * action index each get that action's full share — the visit budget the
 * priors steer simply splits between them.
 */
export function policyPriors(turns: Turn[], logits: ArrayLike<number>): Float64Array {
  const priors = new Float64Array(turns.length);
  let max = 0; // logit 0 participates whenever a turn is unencodable
  for (let i = 0; i < turns.length; i++) {
    const a = turnAction(turns[i]);
    const logit = a === null ? 0 : logits[a];
    priors[i] = logit;
    if (logit > max) max = logit;
  }
  let sum = 0;
  for (let i = 0; i < priors.length; i++) {
    priors[i] = Math.exp(priors[i] - max);
    sum += priors[i];
  }
  for (let i = 0; i < priors.length; i++) priors[i] /= sum;
  return priors;
}

/**
 * Turn priors for a position, or null when the position takes no priors
 * (placement). What MCTS consumes; the pv checkpoint supplies one.
 */
export type PolicyFn = (state: GameState, turns: Turn[]) => Float64Array | null;

/**
 * Expand policy-labeled samples with the 8 board symmetries (original
 * first) — features and action indices transform together. The pv
 * counterpart of augmentSamples.
 */
export function augmentPvSamples(samples: PvSample[]): PvSample[] {
  const out: PvSample[] = [];
  for (const { x, y, actions, targets } of samples) {
    out.push({ x, y, actions, targets });
    for (let s = 1; s < SYMMETRY_MAPS.length; s++) {
      out.push({
        x: transformFeatures(x, s),
        y,
        actions: actions.map((a) => transformAction(a, s)),
        targets,
      });
    }
  }
  return out;
}
