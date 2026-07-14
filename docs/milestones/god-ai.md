# Milestone: god-aware AI retraining — task DAG

State file for the `/loop`-driven milestone (issues #17–#21, #26, #27, #35,
#36). **All state lives here and in git** — any session (or subagent) must
be able to resume from this file + `gh pr list` alone, with zero
conversation context.

## Loop protocol (for the driving agent)

Each iteration: (1) read this file and `gh pr list --state all` to
reconcile task statuses; (2) pick the highest-priority `ready` task(s) — up
to 2 in parallel only if they touch disjoint files; (3) spawn one subagent
per task (worktree isolation) whose prompt is the task card **verbatim**
plus CLAUDE.md; the subagent implements, verifies, and opens a PR; (4) the
main loop independently verifies per the CLAUDE.md delegation guardrails
(reruns typecheck/lint/tests; personally reads the diff of any
`packages/engine` or `packages/ai` search/training file; never accepts a
subagent's summary as verification); (5) update statuses here, reconcile
PROGRESS.md + PLAN.md, merge approved PRs; (6) end the iteration when no
task is `ready` or all are `blocked`/awaiting a human.

Statuses: `ready` | `blocked(<tasks>)` | `in-progress(<branch/PR>)` |
`review` | `done(<PR#>)` | `human(<question>)`.

Long jobs (training runs, matrix generation) must be **resumable**: check
for the output artifact first; if absent, launch in background and end the
iteration; a later iteration (or session) picks up the artifact. Record
Workflow `runId`s here when adversarial reviews launch, so an interrupted
review is resumed with `resumeFromRunId`, not rerun.

Design decisions (encoding amendments, rule interpretations, promotion
criteria) are **not** delegated — if a task card is ambiguous, mark it
`human(...)` and stop rather than letting a subagent decide.

## Frozen references

- Encoding spec: `docs/milestones/god-ai-encoding-v2.md` (both #18 and #19
  implement against it; amendments are main-loop decisions recorded there).
- Rules-surface advisory: `docs/TRAINING.md` § "When the rules surface
  grows" (gen-007 pinned; `models/v2/` lineage; configuration-scoped
  ratings; ladder schema deferred).
- **Matchup panel** (promotion evaluation, frozen before the first v2
  run): `none/none`, `pan/pan`, `athena/athena`, `apollo/minotaur`,
  `demeter/prometheus` — 24 games each, seat-alternating, seed = gen×10+k
  for panel entry k. Promote when the aggregate clears ≥14–10-equivalent
  (≥70/120) with no single panel entry below 10–14.

## Phase 0 — configuration identity & guardrails

- **P0** `done` (this PR): `GodConfig.tier`/`.index` + `configTier()`
  (#26), TRAINING.md advisory (#27), "(base game)" Elo label (#22 cheap
  half), encoding-v2 manifest, this file, CLAUDE.md delegation guardrails.

## Slice 1 — prove the pipeline with the "free five" (Pan, Athena, Apollo, Minotaur, Artemis)

These five need **no** policy-encoding change (verified against
`policy.ts` `turnAction`: swap/push destinations are forced; Artemis paths
sharing an endpoint yield identical states), so features-v2 alone makes
them trainable. Slice-1 checkpoints are **disposable pipeline-validation
artifacts** — do not ship them.

### T1 — static eval god win-condition fix (issue #20) — `done(#42)`
- Goal: `packages/ai/src/eval.ts` must stop scoring god win conditions
  inversely. Pan first (descent-win term; level-3 no longer scored below
  level-2 for a Pan player); audit all 10 simple gods with scratchpad
  probes but **fix minimally** — deep god understanding is the net's job.
- Done when: seeded probe shows greedy-with-fix stops climbing away from
  Pan wins; a differential script proves **base-game scores are
  byte-identical** pre/post-fix (this keeps gen-007's 1132 valid — state
  it in the PR); unit tests for Pan/Athena/Atlas terms.
- Verify: `npm run typecheck && npm test -w @santorini/ai` + differential
  script output in PR description.
- Rigor: training-critical file → differential script mandatory; main loop
  reads the diff. Branch: `fix/eval-god-wins`.

### T2 — trainer CLI god matches (issue #21) — `ready`
- Goal: `--gods god1,god2` on `trainer match` (seat alternation swaps gods
  with seats) and a god dimension on `gauntlet`/`calibrate`;
  every rating record carries its configuration (`configTier()` from the
  engine). `match.ts` already supports `gods` — this is CLI plumbing in
  `apps/trainer/src/`.
- Done when: `trainer match greedy greedy --gods pan,pan --games 24 --seed 1`
  runs, SGN dumps carry God headers and replay-verify; ratings print with
  their configuration tier; net-player (`ckpt:`) specs under `--gods` are
  **explicitly rejected with a clear message until encoding v2 lands**
  (they'd be silently god-blind).
- Verify: `npm run typecheck && npm test -w @santorini/trainer` (or root),
  plus a replay-verified god-match SGN.
- Branch: `feat/trainer-god-matches`.

### T3 — feature encoding v2 (issue #18) — `in-progress(feat/features-v2)`
- Goal: implement `docs/milestones/god-ai-encoding-v2.md` § features:
  `FEATURE_COUNT_V2 = 295`, god one-hots by rulebook index, state flags,
  new eval types `mlp@2`/`pv@2`, shared `packages/ai/src/encoding.ts`
  constants module (create it — T7 consumes it). `transformFeatures`
  passes the global suffix through; `augmentSamples` handles the
  non-plane suffix. v1 checkpoints stay loadable.
- Done when: encode/transform/augment round-trip tests green for all 8
  symmetries with god suffixes; base-position-encoded-under-v1 features
  are bit-identical to the v2 prefix (differential script); a pan-vs-none
  and none-vs-none board-identical pair encode **differently** under v2.
- Rigor: training-critical → differential script before/after; T4 review
  before done; main loop reads the diff. Branch: `feat/features-v2`.

### T4 — adversarial review of T3 — `blocked(T3)`
- Dynamic Workflow: adversarial correctness reviewer (against the manifest
  + `docs/reference/rulebook.md` for the state-flag semantics, instructed
  to construct counterexamples) + implementation-quality reviewer + fixer;
  independently re-verify the fixer's output (CLAUDE.md guardrails).
  Record the Workflow runId here when launched.

### T5 — self-play god wiring (thin slice of issue #17) — `blocked(T3)`
- Goal: `gods?: [GodId, GodId]` on `SelfPlayConfig` threaded to
  `createInitialState`; `--gods a,b` **and** a pool-sampling mode
  (`--god-pool none,pan,athena,apollo,minotaur,artemis` → seeded matchup
  per game) on `trainer train`; samples encode with v2 when the parent is
  `@2`.
- Done when: a 10-game god self-play run produces SGN dumps that
  replay-verify with the right God headers, and samples have 295
  features. Branch: `feat/selfplay-gods`.

### T6 — slice-1 trial generation — `blocked(T1,T2,T5)`
- Goal: fresh `models/v2/gen-000` (from static parent, v2 encoding),
  small run (e.g. 200 games) over base + the free five via `--god-pool`;
  measure wall-clock multiplier vs the ~15–40 min baseline (TRAINING.md
  advisory item 7); rate it configuration-scoped with T2's CLI against
  greedy/mcts baselines on the matchup panel's slice-1 subset.
- Done when: PROGRESS.md records the multiplier + ratings; artifacts under
  `models/v2/`; explicit note that slice-1 checkpoints are disposable.
- Resumable: check for `models/v2/gen-000.json` before launching.

## Slice 2 — policy v2 and the real run

### T7 — policy encoding v2 (issue #19) — `blocked(T3)`
- Goal: implement the manifest's factorized heads (83 logits, 6 heads) in
  `policy.ts`/`pvnet.ts`/`selfplay.ts` targets; symmetry-consistent
  per-head transforms; per-head masked CE; priors = product over heads.
- Rigor: same as T3 (differential on base-game priors: v2 heads restricted
  to base turns must rank identically to v1 within tolerance is NOT
  required — but base-game self-play under pv@2 must be sane; adversarial
  review T8 mandatory). Branch: `feat/policy-v2`.

### T8 — adversarial review of T7 — `blocked(T7)` (same shape as T4)

### T9 — full god-aware training run + validation (issue #17 close) — `blocked(T6,T7,T8)`
- Goal: enable Demeter/Hephaestus/Prometheus/Atlas (pool = base + 9 gods,
  Hermes per T10); size the run from T6's measurement; train generations
  under the TRAINING.md recipe; promote by the frozen matchup panel;
  stamp configuration-scoped ratings; final adversarial rules +
  implementation review of the whole training path before calling the
  milestone done (mistake log: that's exactly where clean-looking bugs
  hide).
- Human checkpoints: compute budget sign-off after T6's numbers exist;
  Hermes pool decision (T10).

## Slice 3 — Hermes fast-follow

### T10 — Hermes throughput measurement (issue #36) — `ready`
- Standalone scratchpad bench (mirror `packages/engine/bench/playouts.ts`)
  + an MCTS-shaped probe (children per expansion at mcts:600). Output: a
  recommendation (include now / optimize first / defer) recorded here as
  `human(...)` for sign-off. A movegen fix, if attempted, is its own task
  with full adversarial review (CLAUDE.md).

### T11 — Hermes joins the pool — `blocked(T9,T10)` (encoding already reserves H6)
### T12 — Hermes two-worker web UI (issue #35) — `ready` (low priority, independent; in-browser verification required)

## Slice 4 — god-draft AI (issue #39)

### T13 — matchup matrix — `blocked(T1,T2)`
- `models/matchups.json`: 11×11 god pairings (incl. none), ≥20 seeded
  games/cell with the strongest available player (baselines now; v2
  checkpoint after T9), stamped with player spec + configuration tier.
  Resumable cell-by-cell.

### T14 — draft AI with temperature — `blocked(T13)`
- apps/web draft wizard gains AI participation: offering = minimax over
  the matrix; choosing = higher expected win rate vs the other; start-
  player pick likewise; choice sampled from softmax(score/τ) with seeded
  RNG, τ calibrated to matrix noise (±~100 Elo at 20-game cells), τ=0 =
  deterministic strongest. In-browser verification required.

## Follow-on milestone (not this one)

Ship-to-web: repoint `coachCkpt` (#24), god-aware ladder rungs, in-browser
god-game verification, #22 long-term per-configuration ratings, #23/#25
coach narration + lessons.
