import type { GameState } from '@santorini/engine';
import type { Sample } from './mlp.ts';

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

/**
 * The 8 symmetries of the board (4 rotations × optional column reflection) as
 * square permutations: SYMMETRY_MAPS[s][sq] is where sq lands under symmetry
 * s. Index 0 is the identity.
 */
export const SYMMETRY_MAPS: readonly Uint8Array[] = Array.from({ length: 8 }, (_, s) => {
  const map = new Uint8Array(25);
  for (let sq = 0; sq < 25; sq++) {
    let c = sq % 5;
    let r = (sq - c) / 5;
    if (s & 4) c = 4 - c;
    for (let k = 0; k < (s & 3); k++) [c, r] = [4 - r, c];
    map[sq] = r * 5 + c;
  }
  return map;
});

/** Re-index an encoded feature vector under board symmetry s. */
export function transformFeatures(x: Float32Array, s: number): Float32Array {
  const map = SYMMETRY_MAPS[s];
  const out = new Float32Array(FEATURE_COUNT);
  for (let plane = 0; plane < FEATURE_COUNT; plane += 25) {
    for (let sq = 0; sq < 25; sq++) out[plane + map[sq]] = x[plane + sq];
  }
  return out;
}

/**
 * Expand samples with the 8 board symmetries (original first). The rules are
 * symmetric, so each variant is an equally real position with the same
 * outcome — 8× data that also teaches the net symmetry-invariance.
 */
export function augmentSamples(samples: Sample[]): Sample[] {
  const out: Sample[] = [];
  for (const { x, y } of samples) {
    out.push({ x, y });
    for (let s = 1; s < SYMMETRY_MAPS.length; s++) out.push({ x: transformFeatures(x, s), y });
  }
  return out;
}
