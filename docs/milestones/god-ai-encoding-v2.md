# Encoding v2 manifest — frozen spec (Phase 0, 2026-07-14)

The single shared definition of "v2" for the god-aware AI milestone
(`docs/milestones/god-ai.md`). The feature branch (issue #18) and the policy
branch (issue #19) both implement **against this file**; neither branch may
change it unilaterally. Amendments are a main-loop design decision recorded
here with a dated note, never an implementation-time improvisation.

New eval types: **`mlp@2`** (value only) and **`pv@2`** (value + policy).
`mlp@1`/`pv@1` continue to pin encoding v1 for the frozen base-game
checkpoints (gen-005, gen-007). The v2 lineage lives under `models/v2/`
with a fresh generation counter.

A shared constants module (`packages/ai/src/encoding.ts`, created by
whichever of #18/#19 lands first) exports every count/offset below so the
two implementations cannot drift.

## Feature encoding v2 (issue #18)

All features remain from the **player to move's perspective** (v1
convention; other perspective = negate the value logit). Indices:

| Range | Count | Content |
|---|---|---|
| 0–174 | 175 | **v1 planes, unchanged**: 5×25 height one-hot + mover worker plane + opponent worker plane |
| 175–230 | 56 | **Mover god one-hot** by rulebook index: slot 0 = `none`, slots 1–55 = rulebook power index (`GodConfig.index`). Sized for the full index now so adding advanced gods later never changes input shape. |
| 231–286 | 56 | **Opponent god one-hot**, same layout |
| 287–290 | 4 | **Mover persistent-state flags.** Flag 0 = Athena "moved up last turn". Flags 1–3 reserved (zero) for future god state. |
| 291–294 | 4 | **Opponent persistent-state flags**, same layout |

`FEATURE_COUNT_V2 = 295`.

- The suffix (175..294) is **global, not per-square**: `transformFeatures`
  passes it through untouched under all 8 symmetries.
- `augmentSamples` copies planes in 25-stride chunks in v1 — it must copy
  the non-plane suffix verbatim (issue #18's noted hazard).
- Both sides' gods are always encoded (Athena constrains the mover; Pan's
  threat changes the defender's notion of "safe" — issue #18).

## Policy action encoding v2 (issue #19)

v1's flat 225-way space (destination × first-build 3×3 delta) collapses
exactly the turn components that make Demeter / Hephaestus / Prometheus /
Atlas / Hermes decisions distinct within one position. (Pan, Athena,
Apollo, Minotaur, and Artemis turns are already unambiguous
position-by-position under v1 — swap/push destinations are forced, and
Artemis paths sharing an endpoint produce identical states.)

v2 is **factorized component heads** (the direction issue #19 suggests),
not a flat product space (which would explode to ~50k actions). One shared
hidden layer; one logit group per component; masked softmax per head over
the values realized by the position's legal turns; a turn's prior is the
**product of its component probabilities**, renormalized over legal turns.

| Head | Size | Values |
|---|---|---|
| H1 destination | 25 | Moved worker's final square (`path[path.length-1]`) |
| H2 build1 | 10 | 3×3 delta of first build relative to destination (9) + "none" (winning move) |
| H3 build1-dome | 2 | Atlas: first build is a dome at any level (1) vs normal block/forced dome (0). Masked to 0 unless the mover is Atlas and both variants are legal. |
| H4 build2 | 10 | 3×3 delta of second build relative to destination (9) + "none". Hephaestus double-block = same code as build1. |
| H5 pre-build | 10 | 3×3 delta of Prometheus pre-build relative to the worker's **starting** square (9) + "none" |
| H6 other-worker destination | 26 | Hermes `otherPath` endpoint (25) + "none" (other worker did not move). Present in the spec even if Hermes is deferred from the initial pool, so re-adding him is not a format bump. |

Total policy logits: 25+10+2+10+10+26 = **83** (`ACTION_HEADS_V2`,
`POLICY_LOGITS_V2 = 83`).

Constraints carried over from v1:

- **Symmetry**: every head must transform consistently under the 8 board
  symmetries (destinations/endpoints map through `SYMMETRY_MAPS`; delta
  codes re-derive as in v1 `transformAction`). Self-play policy targets
  aggregate per component tuple and transform with the planes.
- **Placement turns stay unencoded** (deliberate v1 decision — priors
  starve into visit noise over ~600 pairs).
- Turns with an unencodable component enter at a neutral prior, as in v1.
- Training loss = sum of per-head masked softmax CE (weight-decay lever
  unchanged).

Implementation latitude (allowed without amending this spec): head
ordering in the weight matrices, exact masking implementation, whether H3
is folded into H2 as 19 codes — **as long as the component vocabulary,
sizes, and turn↔tuple mapping above are preserved and exported from the
shared constants module**.

## What stays out of v2 (recorded so nobody "helpfully" adds it)

- Per-worker identity planes / worker-indexed actions (plateau lever 9's
  other half) — separate experiment, separate bump.
- Advanced-god turn components (worker removal, unmoved-worker builds,
  block removal, global win conditions) — will be a v3 event; the god
  one-hot width already accommodates the identities.
