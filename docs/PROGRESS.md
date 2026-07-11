# Progress

_Last updated: 2026-07-11 (session 1)_

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

## Next

1. **Deliverable 2 start**: `packages/ai` — random + greedy-heuristic players
   (immediate win/block, height eval), then MCTS over engine turns.
2. `apps/trainer` CLI: self-play match runner, Elo vs baselines, versioned
   checkpoint format (JSON weights + metadata) in `models/`.
3. Web slice 2: god-power selection UI (engine supports it; UI is base-only),
   generic multi-step turn input (Artemis paths, Demeter double builds,
   Prometheus pre-build) — UI currently assumes path len 2 / 1 build.
4. Web slice 3: vs-AI play (load persisted checkpoint), AI-vs-AI at
   controllable rate; then coach layer.

## Decisions / notes

- TS monorepo, engine pure, full-turn atomic actions (see PLAN.md).
- Node v25, npm 11. Dev server: browser preview tool, launch config `web`
  (port 5173).
- UI interaction model is worth keeping: all click affordances derive from
  `legalTurns()` filtering, so god-power UI can reuse the same pattern.
