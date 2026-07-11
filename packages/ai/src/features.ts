import type { GameState } from '@santorini/engine';

/**
 * Feature encoding v1 — the `mlp@1` checkpoint type pins this layout, so any
 * change here requires a new eval type. Per square (25): five one-hot height
 * planes (0–3 = block level, 4 = dome), mover's workers, opponent's workers.
 */
export const FEATURE_COUNT = 175;

/**
 * Encode a position from the perspective of the player to move. Nets trained
 * on this encoding predict the mover's win probability; callers wanting the
 * other player's view negate the logit (Santorini has no drawn positions, so
 * P(opponent wins) = 1 - P(mover wins)).
 */
export function encodeFeatures(state: GameState, out?: Float32Array): Float32Array {
  const x = out ?? new Float32Array(FEATURE_COUNT);
  x.fill(0);
  for (let sq = 0; sq < 25; sq++) x[state.heights[sq] * 25 + sq] = 1;
  for (let i = 0; i < 4; i++) {
    const sq = state.workers[i];
    if (sq < 0) continue;
    x[((i >> 1) === state.player ? 125 : 150) + sq] = 1;
  }
  return x;
}
