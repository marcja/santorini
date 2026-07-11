# Progress

_Last updated: 2026-07-11 (session 2)_

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

## Next

1. `apps/trainer` CLI: self-play match runner, Elo vs baselines, versioned
   checkpoint format (JSON weights + metadata) in `models/`.
2. Learned evaluation (small policy/value net, pure TS) to replace the
   hand-rolled `evaluate()`; trained by self-play, plugged into MCTS.
3. Web slice 2: god-power selection UI (engine supports it; UI is base-only),
   generic multi-step turn input (Artemis paths, Demeter double builds,
   Prometheus pre-build) — UI currently assumes path len 2 / 1 build.
4. Web slice 3: vs-AI play — engine+ai are pure TS, so `MctsPlayer` runs
   in-browser as-is; AI-vs-AI at controllable rate; then coach layer.

## Decisions / notes

- Harness: a PostToolUse hook (`.claude/settings.json`) fires on every edit to
  this file and reminds to reconcile `docs/PLAN.md` checkboxes (sync rule at
  the top of PLAN.md). Keep both files consistent in the same commit.

- TS monorepo, engine pure, full-turn atomic actions (see PLAN.md).
- Node v25, npm 11. Dev server: browser preview tool, launch config `web`
  (port 5173).
- UI interaction model is worth keeping: all click affordances derive from
  `legalTurns()` filtering, so god-power UI can reuse the same pattern.
- MCTS lessons (session 2): full-length uniform playouts carry almost no
  signal — MCTS was only at parity with greedy even at 4k iterations. What
  mattered, in order: (1) one-ply solver — mark a node "proven" when its
  player has an immediate win (free: legal turns already generated), else
  low-budget search hangs win-in-1s; (2) short playouts (depth 8) scored by
  `evaluate()` through a sigmoid beat long random ones and run 2× faster;
  (3) c≈1.0. Take immediate wins at the root without searching — under
  win-aware playouts every child of a won position evaluates to ~1.0, so
  visit counts can't rank the instant win first.
