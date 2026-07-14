# AI Training Guide

How to train the next generation, decide whether it's better, and ship it to
the web app. Written for two readers: **a human** running a quick generation
by hand, and **Claude Code** continuing training autonomously in a future
session. Current state as of 2026-07-12 (session 12): the strongest
checkpoint is `models/gen-007.json` (`pv@1`, PUCT search, gauntlet 1132) and
the loop was still rising when we stopped — no generation has failed to beat
its parent since the pv/PUCT levers landed.

## How the loop works (30-second recap)

One generation = **self-play → train → evaluate → commit**:

1. The parent checkpoint plays itself (seeded, deterministic). Every
   play-phase position becomes a sample: features + final outcome (value
   target) + the search's root visit distribution (policy target).
2. A two-headed net (`pv@1`: shared hidden layer → value logit + 225 action
   logits) trains on those samples. A `pv@1` parent's net is trained
   further; an `mlp@1` parent warm-starts the shared layer/value head with a
   zero (= uniform-prior) policy head.
3. The child checkpoint searches with **PUCT** (priors steer MCTS). A pv
   parent also *self-plays* with PUCT, which concentrates visits and makes
   the next generation's policy targets sharp — this is why the loop
   compounds.

All of it is pure TS, seeded end-to-end: the same command reproduces the
same checkpoint bit-for-bit.

## Training the next generation (human or Claude)

From the repo root (Node ≥ 22 runs `.ts` directly):

```sh
# 1. Train (≈ 15–20 min: ~13 min self-play + ~5 min SGD)
node apps/trainer/src/cli.ts train \
  --parent models/gen-007.json \
  --games 800 --seed 8 --iters 600 --augment --wd 1e-4 \
  --sgn /tmp/gen-008-selfplay.sgn

# 2. Head-to-head vs the parent (the decision that matters, ~5 min)
node apps/trainer/src/cli.ts match ckpt:models/gen-008.json ckpt:models/gen-007.json --games 24 --seed 81

# 3. Gauntlet rating, stamped into the checkpoint (~10 min)
node apps/trainer/src/cli.ts gauntlet ckpt:models/gen-008.json --games 20 --seed 81 --update
```

Recipe conventions (keep these unless deliberately experimenting):

- `--seed` = generation number; eval seeds = gen number × 10 + 1. Never
  reuse a seed across generations — identical seeds mean identical
  self-play games.
- `--games 800`, `--iters 600`, `--augment`, `--wd 1e-4`, defaults for
  epochs/lr/batch (10 / 0.2 / 64). The **mild-fit rule** applies: value
  loss should land near ~0.60 — much lower means overconfident logits that
  play *worse* (see the session-4 lesson in PROGRESS.md).
- `--out` defaults to `models/gen-NNN.json`; `--pv` is implied by a pv
  parent (a lineage never silently drops its policy head).

**Decision rule:** commit the child if it beats its parent in the 24-game
head-to-head at **≥ 14–10**; anything closer is inside noise — rerun with a
different seed before believing either direction, and treat two consecutive
failures to clear the bar as the plateau signal (see below). Gauntlet
ratings are ±~100 Elo at these sample sizes and the baseline pool tops out
at mcts(1000)=923, so above ~1100 the head-to-head is the only trustworthy
signal. Never judge on fewer than 20 games (mistake log: 6-game matches
flipped a conclusion twice).

## Shipping a new model to the app

Decide first whether the new checkpoint **replaces Expert** or **appends a
rung**. Replace when it's the same product idea, just stronger (typical);
append only if the ladder's spacing wants an extra step (~150+ Elo gap).

1. `models/ladder.json` — update the Expert level's `spec` and `rating` (or
   append a level). Keep lower rungs frozen; they're calibrated.
2. `apps/web/src/ai.ts` — import the new checkpoint JSON and add it to the
   `CHECKPOINTS` map (Vite bundles it; a `pv@1` checkpoint is ~450 KB).
   Remove a replaced checkpoint's import only if no ladder level references
   it anymore. If the new model is the strongest bundled, also point
   `coachCkpt` at it — the coach's hint search uses its value *and* policy
   heads automatically.
3. Nothing else: `playerFromCheckpoint` wires PUCT from the checkpoint type,
   and the picker renders from `ladder.json`.
4. **Verify in the in-app browser** (repo rule — a UI change isn't done
   until played): launch config `web`, pick the new rung for a seat, play
   through placement + at least one full turn, confirm the move appears in
   the SGN record, click a coach Hint, check the console for errors. Watch
   move latency: PUCT pays a policy forward per node expansion (~2× a
   value-only move; gen-007 is comfortably interactive at 1000 iters). If a
   future rung feels sluggish, that's the cue for a web worker, not a
   weaker model.

## Instructions for Claude Code running this autonomously

- **Session protocol**: work on a `chore/…` or `feat/…` branch or worktree
  (main is protected), read PROGRESS.md first, and update PROGRESS.md +
  PLAN.md (sync rule) before ending the session. Small narrative commits:
  checkpoint commits separate from code commits, ratings stamped before
  committing a model.
- Run training/eval as **background Bash jobs** and poll their logs; a
  generation is ~30–40 min wall-clock including eval. Don't run `npm test`
  while heavy jobs are running (search-heavy tests flake past vitest's 5s
  timeout).
- **Replay-verify** every self-play SGN dump through the engine before
  trusting a run (a scratch script doing `parseSGN` → `parseTurn` →
  `resolveTurn` → compare `Result`; see session 12). Dumps live in the
  session scratchpad — they're regenerable from seeds, don't commit them.
- Loop autonomously: train → evaluate → if the decision rule passes, commit
  the model and continue with the next generation; if it fails twice,
  stop and write up the plateau in PROGRESS.md with the losses/ratings
  observed, then either stop or pick **one** lever from the list below
  (change one variable per generation, controlled-experiment style — the
  augmentation lesson came from exactly this discipline).
- Ship-to-app changes (ladder/web) need the in-browser verification pass;
  a11y refs beat coordinates for clicks, and re-read the page after every
  render (refs go stale; the viewport reflows).

## When the rules surface grows (gods, expansions) — read before touching encodings

Adding gods (or, later, Golden Fleece / Heroes) to training is a
**checkpoint-format event, not a recipe tweak**. This section is written
generically: it applies again at every rules-surface expansion (advanced
gods, heroes), not just the simple-god milestone (issues #17–#21, #26,
#27; milestone plan in `docs/milestones/god-ai.md`).

1. **Checkpoint compatibility is pinned to encodings.** `mlp@1`/`pv@1` pin
   feature encoding v1 (175 planes, no god info) and action encoding v1
   (225 actions). God-aware training requires new eval types (`mlp@2`/
   `pv@2` — spec frozen in `docs/milestones/god-ai-encoding-v2.md`). Old
   checkpoints cannot be fine-tuned onto a new encoding by loading them —
   a new-encoding lineage either starts from scratch or uses **warm-start
   net surgery**: when a bump only *adds* input features or action logits,
   graft the old weights and zero-init the new rows/columns (the same idea
   as the existing `mlp@1`→`pv@1` zero-policy-head warm start). Document
   whichever you do in the checkpoint's notes.
2. **gen-007 is pinned as the permanent base-game reference lineage**
   (decision 2026-07-14). It is never fine-tuned onto a new encoding. The
   god-aware lineage lives under `models/v2/` with a fresh counter
   (`models/v2/gen-000.json`, eval types `mlp@2`/`pv@2`). Keep gen-005 and
   gen-007 (shipped ladder rungs and frozen rating anchors); older gens
   are disposable.
3. **Ratings are configuration-scoped.** Every number in
   `models/baselines.json`, every gauntlet rating stamped in a checkpoint,
   and every Elo in `models/ladder.json` was measured in **base-game**
   play. They do not transfer to god games, and mixing configurations in
   one Elo pool produces meaningless numbers. Record the configuration
   tier (`configTier()` in the engine: base / simple / advanced) alongside
   any rating; recalibrate per configuration; never compare across
   configurations — a v2 net's simple-tier rating is not on the same
   footing as gen-007's 1132.
4. **`models/ladder.json` schema stays at `santorini-ladder@1` for this
   milestone** (decision 2026-07-14): per-configuration ladder ratings are
   deferred to issue #22's long-term follow-up, once the trainer CLI
   (issue #21) produces configuration-scoped numbers worth storing. Until
   then the web app labels ladder Elo "(base game)".
5. **The decision rule needs a configuration story.** "Beats its parent
   ≥14–10 over 24 games" applies **per configuration**. Since all-pairings
   coverage is unaffordable per generation, evaluate on a fixed seeded
   **matchup panel** — e.g. base mirror, Pan mirror, Athena mirror, and
   two mixed pairs, 24 games each — and promote only if the aggregate
   clears the bar with no panel configuration regressing badly. Freeze the
   exact panel in `docs/milestones/god-ai.md` before the first v2 run and
   keep it stable across generations. The ≥20-game floor (mistake log)
   multiplies across the panel; budget eval time accordingly.
6. **Shipping checklist addition.** When bundling a god-aware model,
   `coachCkpt` and ladder rungs may need to differ per configuration, and
   the in-browser verification pass must include at least one god game.
7. **Before the first god-aware run**, timebox a small trial generation to
   measure the wall-clock multiplier vs the ~15–40 min/gen base-game
   baseline, and size the real run from that measurement. Hermes is
   excluded from the initial pool until his ~180x `legalTurns()` cost
   (issue #36) is measured/fixed — MCTS expands every legal turn as a
   child node.

## If training plateaus again — ordered levers

Cheapest and most likely first. Change one at a time; 24-game head-to-head
with the same-recipe control before believing anything.

1. **Sharper policy targets (visit temperature).** Targets are raw visit
   proportions; at 600 iterations they're still soft. Exponentiate:
   `p ∝ N^(1/τ)` with τ ≈ 0.5–0.7 in `selfplay.ts`'s `policyTarget`. The
   probe technique in session 12 (target entropy vs CE floor) tells you if
   targets are the bottleneck before you spend a training run.
2. **More self-play search** (`--iters 1200`): better value labels *and*
   sharper targets, at 2× self-play cost. Pairs well with fewer games if
   wall-clock is fixed.
3. **Dirichlet root noise** in self-play (AlphaZero: η ~ Dir(α≈0.3), mixed
   ~25% at the root only). Right now opening diversity comes solely from
   temperature sampling in the first 8 half-turns; noise diversifies
   mid-game too. New code in `mcts.ts` (root-only, self-play flag).
4. **c / FPU sweep for PUCT.** Both inherited UCT-era defaults (c=1.0,
   FPU=0.5) untuned. Probe with 20+ game matches between the same
   checkpoint at different `c` (the checkpoint's `search.c` is just data —
   copy the JSON, edit, match them). Typical PUCT c is 1.5–2.5.
5. **Value targets from search values.** Label samples with a blend of the
   game outcome and the root's search value (e.g. 0.5/0.5) to cut label
   variance from long games. Change in `selfplay.ts`.
6. **Capacity: hidden 64 → 128** (or two hidden layers). JSON roughly
   doubles (~1 MB — still bundleable); training stays minutes. Watch the
   mild-fit rule — more capacity overfits sooner; weight decay may need to
   rise.
7. **Refresh the rating infrastructure** (not strength, but measurement):
   the gauntlet pool tops at 923, so strong gens win ~everything and the
   MLE extrapolates. Recalibrate with frozen strong checkpoints in the pool
   (`trainer calibrate --players "random greedy mcts:1000 ckpt:models/gen-005.json ckpt:models/gen-007.json"`)
   — new baselines file, don't touch the ladder's frozen ratings.
8. **Drop playouts at the leaf** (full AlphaZero): back up the value head
   directly instead of depth-8 playouts. Big behavioral change — treat as
   its own experiment with the one-ply solver kept (it carries real tactical
   weight; see the session-2 MCTS lessons).
9. **Encoding v2**: add feature planes the net currently can't see —
   per-worker identity planes (would also unlock a worker-indexed action
   encoding), adjacency-to-climb counts, god flags once gods enter
   training. Requires a new eval type (`mlp@1`/`pv@1` pin encoding v1) —
   see "When the rules surface grows" above and the frozen v2 spec in
   `docs/milestones/god-ai-encoding-v2.md` before touching this.

Known-good lessons to keep honoring: 8-symmetry augmentation on (it broke
the first plateau), mild fitting over low loss, deterministic seeds,
≥20-game samples, and the one-ply win/loss solver stays in the search.
