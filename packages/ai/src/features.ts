import type { GameState, Player } from '@santorini/engine';
import { GODS } from '@santorini/engine';
import {
  FEATURE_COUNT_V2,
  godOneHotIndex,
  MOVER_FLAGS_OFFSET,
  MOVER_GOD_OFFSET,
  OPPONENT_FLAGS_OFFSET,
  OPPONENT_GOD_OFFSET,
  V1_FEATURE_COUNT,
} from './encoding.ts';
import type { Sample } from './mlp.ts';

/**
 * Feature encoding v1 — the `mlp@1` checkpoint type pins this layout, so any
 * change here requires a new eval type. Per square (25): five one-hot height
 * planes (0–3 = block level, 4 = dome), mover's workers, opponent's workers.
 * Equal to `V1_FEATURE_COUNT` in `encoding.ts`, which v2 carries forward as
 * its spatial prefix.
 */
export const FEATURE_COUNT = V1_FEATURE_COUNT;

export { FEATURE_COUNT_V2 };

/** Write the v1 spatial planes (heights + worker positions) into `x[0..174]`. */
function encodeBoardPlanes(state: GameState, x: Float32Array): void {
  for (let sq = 0; sq < 25; sq++) x[state.heights[sq] * 25 + sq] = 1;
  for (let i = 0; i < 4; i++) {
    const sq = state.workers[i];
    if (sq < 0) continue;
    x[(i >> 1 === state.player ? 125 : 150) + sq] = 1;
  }
}

/**
 * Encode a position from the perspective of the player to move. Nets trained
 * on this encoding predict the mover's win probability; callers wanting the
 * other player's view negate the logit (Santorini has no drawn positions, so
 * P(opponent wins) = 1 - P(mover wins)).
 */
export function encodeFeatures(
  state: GameState,
  out?: Float32Array,
): Float32Array {
  const x = out ?? new Float32Array(FEATURE_COUNT);
  x.fill(0);
  encodeBoardPlanes(state, x);
  return x;
}

/**
 * True iff `side` currently carries a "just moved up with Athena" flag: side
 * holds the Athena god config and `state.athenaUp` is set. `state.athenaUp`
 * is a single engine-wide flag that apply.ts only updates when the mover who
 * just completed a turn has `blocksOpponentUp` (Athena) — so at any position
 * it accurately reflects whichever side actually owns Athena, independent of
 * whose turn it is now (see `packages/engine/src/apply.ts` and
 * `movegen.ts`'s own `oppCfg.blocksOpponentUp && state.athenaUp` check).
 */
function athenaFlag(state: GameState, side: Player): number {
  return GODS[state.gods[side]].blocksOpponentUp && state.athenaUp ? 1 : 0;
}

/**
 * Feature encoding v2 (issue #18): the v1 spatial prefix (bit-identical, see
 * `docs/milestones/god-ai-encoding-v2.md`) plus mover/opponent god one-hots
 * (by rulebook index) and mover/opponent persistent-state flags. Both sides'
 * gods are always encoded — Athena constrains the mover, Pan's threat changes
 * the defender's notion of "safe" — even though features stay from the
 * mover's perspective (v1 convention).
 */
export function encodeFeaturesV2(
  state: GameState,
  out?: Float32Array,
): Float32Array {
  const x = out ?? new Float32Array(FEATURE_COUNT_V2);
  x.fill(0);
  encodeBoardPlanes(state, x);
  const mover = state.player;
  const opponent = (1 - state.player) as Player;
  x[MOVER_GOD_OFFSET + godOneHotIndex(state.gods[mover])] = 1;
  x[OPPONENT_GOD_OFFSET + godOneHotIndex(state.gods[opponent])] = 1;
  x[MOVER_FLAGS_OFFSET] = athenaFlag(state, mover);
  x[OPPONENT_FLAGS_OFFSET] = athenaFlag(state, opponent);
  return x;
}

/**
 * The 8 symmetries of the board (4 rotations × optional column reflection) as
 * square permutations: SYMMETRY_MAPS[s][sq] is where sq lands under symmetry
 * s. Index 0 is the identity.
 */
export const SYMMETRY_MAPS: readonly Uint8Array[] = Array.from(
  { length: 8 },
  (_, s) => {
    const map = new Uint8Array(25);
    for (let sq = 0; sq < 25; sq++) {
      let c = sq % 5;
      let r = (sq - c) / 5;
      if (s & 4) c = 4 - c;
      for (let k = 0; k < (s & 3); k++) [c, r] = [4 - r, c];
      map[sq] = r * 5 + c;
    }
    return map;
  },
);

/**
 * Re-index an encoded feature vector under board symmetry s. Only the
 * spatial prefix (`x[0..FEATURE_COUNT-1]`, 25-square planes) is permuted;
 * anything beyond it — v2's god one-hots and state flags (§ encoding v2,
 * `x[175..294]`) — is global, not per-square, and passes through unchanged.
 * Works for both v1 vectors (length `FEATURE_COUNT`, no suffix to copy) and
 * v2 vectors (length `FEATURE_COUNT_V2`) without needing a separate v2
 * function.
 */
export function transformFeatures(x: Float32Array, s: number): Float32Array {
  const map = SYMMETRY_MAPS[s];
  const out = new Float32Array(x.length);
  for (let plane = 0; plane < FEATURE_COUNT; plane += 25) {
    for (let sq = 0; sq < 25; sq++) out[plane + map[sq]] = x[plane + sq];
  }
  for (let i = FEATURE_COUNT; i < x.length; i++) out[i] = x[i];
  return out;
}

/**
 * Expand samples with the 8 board symmetries (original first). The rules are
 * symmetric, so each variant is an equally real position with the same
 * outcome — 8× data that also teaches the net symmetry-invariance.
 *
 * Works unchanged for v2 (god-suffixed) samples: `transformFeatures` already
 * copies the non-plane suffix verbatim rather than permuting it, so each
 * augmented variant carries the same god one-hots/state flags as the
 * original — only the spatial planes rotate/reflect.
 */
export function augmentSamples(samples: Sample[]): Sample[] {
  const out: Sample[] = [];
  for (const { x, y } of samples) {
    out.push({ x, y });
    for (let s = 1; s < SYMMETRY_MAPS.length; s++)
      out.push({ x: transformFeatures(x, s), y });
  }
  return out;
}
