import { GODS, type GodId } from '@santorini/engine';

/**
 * Shared layout constants for feature encoding v2 (issue #18) and policy
 * action encoding v2 (issue #19), frozen in
 * `docs/milestones/god-ai-encoding-v2.md`. Both branches import from here so
 * they cannot drift; this module holds counts/offsets only, no encode/decode
 * logic (that lives in `features.ts` and, for policy v2, `policy.ts`).
 *
 * Do not edit the numeric values below without a recorded amendment to the
 * frozen spec — they are pinned the same way `FEATURE_COUNT`/`ACTION_COUNT`
 * (v1) are pinned.
 */

// ---------------------------------------------------------------------------
// Feature encoding v2 (§ "Feature encoding v2" in the manifest)
// ---------------------------------------------------------------------------

/**
 * Length of the v1-identical spatial prefix carried into v2 unchanged: 5×25
 * height one-hot planes + mover worker plane + opponent worker plane. Equal
 * to v1's `FEATURE_COUNT` (features.ts re-exports that constant from here).
 */
export const V1_FEATURE_COUNT = 175;

/** Highest rulebook power index the god one-hots are sized for (1–55). */
export const MAX_GOD_INDEX = 55;

/** God one-hot width: slot 0 = 'none', slots 1..MAX_GOD_INDEX = rulebook index. */
export const GOD_ONE_HOT_COUNT = MAX_GOD_INDEX + 1;

/** Persistent-state flag slots per side; flag 0 = Athena, 1–3 reserved (zero). */
export const GOD_STATE_FLAG_COUNT = 4;

/** Feature index 175: start of the mover's god one-hot (56 wide). */
export const MOVER_GOD_OFFSET = V1_FEATURE_COUNT;
/** Feature index 231: start of the opponent's god one-hot (56 wide). */
export const OPPONENT_GOD_OFFSET = MOVER_GOD_OFFSET + GOD_ONE_HOT_COUNT;
/** Feature index 287: start of the mover's persistent-state flags (4 wide). */
export const MOVER_FLAGS_OFFSET = OPPONENT_GOD_OFFSET + GOD_ONE_HOT_COUNT;
/** Feature index 291: start of the opponent's persistent-state flags (4 wide). */
export const OPPONENT_FLAGS_OFFSET = MOVER_FLAGS_OFFSET + GOD_STATE_FLAG_COUNT;

/** Total feature width for encoding v2. */
export const FEATURE_COUNT_V2 = OPPONENT_FLAGS_OFFSET + GOD_STATE_FLAG_COUNT; // 295

/**
 * God one-hot slot for `id`: 0 for 'none', otherwise its rulebook power index
 * (`GodConfig.index`, 1..MAX_GOD_INDEX).
 */
export function godOneHotIndex(id: GodId): number {
  const index = GODS[id].index;
  return index === undefined ? 0 : index;
}

// ---------------------------------------------------------------------------
// Policy action encoding v2 (§ "Policy action encoding v2" in the manifest,
// issue #19 / T7). Defined here now — per the manifest, "whichever of #18/#19
// lands first" creates this module — so T7 implements against fixed counts
// rather than choosing them itself. No decode/transform logic here; that is
// T7's job in policy.ts/pvnet.ts.
// ---------------------------------------------------------------------------

/** Per-head logit counts for the v2 factorized policy heads. */
export const ACTION_HEADS_V2 = {
  /** H1: moved worker's final square. */
  destination: 25,
  /** H2: 3×3 delta of first build relative to destination (9) + "none" (1). */
  build1: 10,
  /** H3: Atlas dome-at-any-level flag (masked to 0 unless mover is Atlas). */
  build1Dome: 2,
  /** H4: 3×3 delta of second build relative to destination (9) + "none" (1). */
  build2: 10,
  /** H5: 3×3 delta of Prometheus pre-build relative to the start square (9) + "none" (1). */
  preBuild: 10,
  /** H6: Hermes otherPath endpoint (25) + "none" (1). */
  otherWorkerDestination: 26,
} as const;

/** Total policy logits across all v2 heads (25+10+2+10+10+26). */
export const POLICY_LOGITS_V2 = Object.values(ACTION_HEADS_V2).reduce(
  (sum, n) => sum + n,
  0,
);
