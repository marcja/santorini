# Progress

_Last updated: 2026-07-11 (session 5)_

## Done

- Extracted official rulebook + detailed god cards to `docs/reference/*.txt`.
- Plan (`docs/PLAN.md`), notation spec (`docs/NOTATION.md`), CLAUDE.md.
- **Deliverable 1 (engine): complete for base game + 9 simple gods.**
  `packages/engine`: board/state/movegen/apply, SGN notation (format/parse/
  replay/headers), Game wrapper (validation, no-move loss, undo, SGN I/O).
  46 tests green; bench ~5.5k random games/s, ~308k turns/s.
  Hermes deferred (both-workers any-number-of-moves needs its own design pass).
- **Web slice 1 (pass-and-play) working and verified.** `apps/web`: Vite +
  vanilla TS, flat SVG board, click place/move/build, live SGN record, undo,
  win banner. Played a full game through the in-app browser to a "Blue wins!"
  (record: `... 7. d1-d2#`), verified undo rolls back the win.

- **Deliverable 2 started: `packages/ai` baselines + search player.**
  `RandomPlayer`; `GreedyPlayer` (take win / never hang a win-in-1 / static
  eval); `MctsPlayer` (UCT over full engine turns, one-ply win/loss solver,
  short win-aware playouts scored by the static eval, root win shortcut);
  `evaluate()` (heights/centrality/climbs); `resolveTurn` (no-move loss);
  `playGame`/`playMatch` runner. `search()` returns visit counts, value
  estimates, and PV — the explainability channel for the coach layer.
  11 tests green. Ladder at fixed seeds: greedy 10+/12 vs random;
  mcts(1000) ≈65% vs greedy; mcts(2000) 10–2 (~7s). All players seeded
  and deterministic.

- **`apps/trainer` CLI + checkpoint format (this session).**
  `packages/ai` additions: `evaluate()` takes `EvalWeights`; `MctsPlayer`
  accepts an injected `EvalFn` (the seam the learned eval will plug into);
  `checkpoint.ts` — versioned JSON artifact (`santorini-checkpoint@1`:
  generation, parent, eval weights, search config, Elo record) with
  create/validate/`playerFromCheckpoint`. Trainer commands:
  `init` (gen-0 checkpoint), `match a b [--sgn file]` (seeded, seat-
  alternating, fresh players per game; SGN dumps verified to replay through
  the engine), `calibrate` (baseline round-robin → Bradley–Terry Elo fit →
  `models/baselines.json`), `gauntlet ckpt:... --update` (MLE performance
  rating vs calibrated pool, stamped into the checkpoint). 28 new tests
  (74 total green). Player specs: `random | greedy | mcts:N[,c=,depth=] |
  ckpt:PATH[,iters=]`.
- **First calibration + rating in `models/`** (committed): 40 games/pair,
  seed 1 — random=0, mcts(200)=657, greedy=808, mcts(1000)=923 (yes,
  mcts(200) < greedy). `gen-000.json` (default weights, mcts 1000) gauntlet
  at 20 games/opponent → 817; vs the pool's 923 for the identical config,
  i.e. ±~100 Elo noise at these sample sizes — don't read strength deltas
  below that from a single gauntlet.

- **Learned evaluation v1 (this session): value net + self-play training
  pipeline, first net generation at parity with the hand eval.**
  `packages/ai`: `features.ts` (encoding v1: 175 binary planes — 5×25 height
  one-hot + mover/opponent worker planes, always from the player to move's
  perspective; other perspective = negate the logit); `mlp.ts` (1-hidden-layer
  ReLU net, seeded He init, mini-batch SGD on BCE, JSON params);
  `selfplay.ts` (seeded self-play with visit-proportional sampling for the
  first N half-turns — without it every game repeats the same opening);
  checkpoint eval type `mlp@1` alongside `static@1` (`checkpointEvalFn`
  returns logit×`EVAL_SCALE`, so MCTS's sigmoid recovers the net's win
  probability exactly). Trainer `train` command: parent checkpoint →
  self-play → train → child checkpoint (continues training a net parent;
  fresh net from a static parent). 96 tests green; self-play SGN dumps
  verified to replay through the engine with matching results.
- **`models/gen-001.json` (committed): first `mlp@1` checkpoint.** Trained
  from gen-000's static eval: 500 self-play games @ mcts(600), 15.3k samples,
  lr=0.2 × 10 epochs. Gauntlet 793 (gen-000: 817 — parity within the ±100
  noise); head-to-head 15–9 over gen-000 at full settings (62.5%, ≈+89 Elo).

- **Gen-002 plateaued; 8-symmetry augmentation broke the plateau (this
  session).** `gen-002.json` (net-driven self-play, same recipe) gauntleted
  781 and went 12–12 vs gen-001 — flat. First plateau lever: `augmentSamples`
  in `packages/ai/src/features.ts` (8 dihedral permutations of the 25-square
  planes; verified against encoding transformed states), trainer `--augment`
  flag. Controlled experiment — identical self-play games (deterministic
  seed), augmentation the only difference: `gen-002-aug.json` beat gen-002
  15–9 (+89 Elo), beat gen-001 **19–5 (+232 Elo)**, gauntlet **841** (lineage
  best; 10–10 vs mcts(1000)). Augmented training loss 0.62 vs 0.58 — the 8×
  data regularizes, staying in the mild-fit zone. `--augment` is now the
  default recipe; gen-003+ trains from gen-002-aug.
- **`models/gen-003.json` (committed): trend confirmed rising under the
  augmented recipe.** Trained from gen-002-aug (500 games @ mcts(600), seed 3,
  augment). Gauntlet **903** — lineage: 817 → 793 → 781 → 841 → 903, flat
  until augmentation, rising since (18–2 vs mcts(200), 10–10 vs mcts(1000)).
  Head-to-head vs parent even at 12–12/24 though — per-generation gains are
  modest; expect to need the next levers (PUCT priors, more games) soon.

## Next

**Sequencing decision (2026-07-11):** cap AI training at a bounded
intermediate goal, then switch to finishing the web game; return to
open-ended AI iteration (PUCT priors, more games/gen, better hardware)
afterward, informed by what slice 3 teaches us about in-browser constraints.
Rationale: nothing in web slices 2–4 depends on further AI strength — the
difficulty ladder wants *varied* strength and we already have calibrated
rungs (random 0 / mcts(200) 657 / greedy 808 / gen-003 903).

1. Chore: TypeScript 5.8 → 6 → 7 upgrade (GitHub issue #1). TS 6.0 GA'd
   2026-03, TS 7.0 (Go-native compiler) GA'd 2026-07-08. Our tsconfig uses
   none of the 6.0 deprecations (no baseUrl, ES2022 target, bundler
   resolution), so expect a clean two-step bump; park at 6 if 7 misbehaves
   (GA is days old). Note: TS7 speeds *typecheck/editor only* — training
   runtime is unaffected. First PR under the new branch/PR workflow.
2. Bounded AI goal: gen-004 and gen-005 with the existing augmented recipe
   (`train --parent ... --augment`) — pure compute, no new AI code. Stop
   early if a checkpoint clears mcts(1000) at ≥65% over ≥20 games. Then
   freeze 3–4 ladder checkpoints as difficulty levels and stop training.
   PUCT priors / more games/gen / regularization are explicitly deferred
   to the post-web return.
3. Web slice 2: god-power selection UI (engine supports it; UI is base-only),
   generic multi-step turn input (Artemis paths, Demeter double builds,
   Prometheus pre-build) — UI currently assumes path len 2 / 1 build.
4. Web slice 3: vs-AI play — engine+ai are pure TS, so `MctsPlayer` runs
   in-browser as-is (load `models/gen-XXX.json` via `playerFromCheckpoint`);
   AI-vs-AI at controllable rate; then coach layer.
5. Return to AI: PUCT priors (policy head over full-turn actions), more
   games/generation, regularization — sized against slice-3 realities
   (per-move time budget, worker-thread search).

## Decisions / notes

- Harness: a PostToolUse hook (`.claude/settings.json`) fires on every edit to
  this file and reminds to reconcile `docs/PLAN.md` checkboxes (sync rule at
  the top of PLAN.md). Keep both files consistent in the same commit.
- Workflow (2026-07-11): development moves to branches/worktrees + PRs; main
  is protected from direct commits (branch protection enabled by Marc in
  GitHub settings — Claude must not modify repo access controls).

- TS monorepo, engine pure, full-turn atomic actions (see PLAN.md).
- Node v25, npm 11. Dev server: browser preview tool, launch config `web`
  (port 5173).
- UI interaction model is worth keeping: all click affordances derive from
  `legalTurns()` filtering, so god-power UI can reuse the same pattern.
- Net-training lessons (session 4): **mild fitting beats heavy fitting in
  play.** Nets trained to low train-loss (lr 0.5, 20–40 epochs, loss →
  0.08–0.36) *lost* to lightly-trained ones (lr 0.2, 10 epochs, loss ~0.62)
  despite better test accuracy — overconfident logits saturate the playout
  values MCTS averages. Sweep hyperparameters offline by regenerating samples
  from the self-play SGN dump (replay is ~instant; self-play is the slow
  part). Self-play is fully deterministic per seed: same config → identical
  games and samples. ~0.6 s/game at mcts(600); 500 games ≈ 5–10 min.
- MCTS lessons (session 2): full-length uniform playouts carry almost no
  signal — MCTS was only at parity with greedy even at 4k iterations. What
  mattered, in order: (1) one-ply solver — mark a node "proven" when its
  player has an immediate win (free: legal turns already generated), else
  low-budget search hangs win-in-1s; (2) short playouts (depth 8) scored by
  `evaluate()` through a sigmoid beat long random ones and run 2× faster;
  (3) c≈1.0. Take immediate wins at the root without searching — under
  win-aware playouts every child of a won position evaluates to ~1.0, so
  visit counts can't rank the instant win first.
