# Santorini — Project Plan

Ultimate goal: a web game that teaches human players beginner→advanced two-player
Santorini strategy and lets them compete against a self-trained (non-LLM) AI.

We build in vertical slices: race to something playable end-to-end, then iterate.

> **Sync rule (harness-enforced):** the checkboxes below must reflect
> `docs/PROGRESS.md`. Whenever PROGRESS.md changes, reconcile this file in the
> same commit. A PostToolUse hook (`.claude/settings.json`) reminds on every
> PROGRESS.md edit.

## Deliverable 1 — Game engine (`packages/engine`)

High-performance, headless, dependency-free TypeScript library.

- [x] Official rules grounded in `docs/reference/rulebook.txt` and
      `docs/reference/god-powers-detailed.txt` (extracted from PDFs in `references/`).
- [x] Base 2-player game: 5×5 board, place 2 workers each, move+build turns,
      win by moving up onto level 3, lose when unable to move+build.
- [x] Full-turn move generation (a "move" for engine consumers = complete turn),
      designed for fast search (typed arrays, in-place apply).
- [x] Notation system ("SGN" — Santorini Game Notation, see `docs/NOTATION.md`):
      document, annotate, and replay games; PGN-style headers.
- [x] God Powers framework (opt-in per game, per-player assignment) with 9 of
      the simple 10: Apollo, Artemis, Athena, Atlas, Demeter, Hephaestus,
      Minotaur, Pan, Prometheus.
- [ ] Hermes (needs a design pass for both-workers unlimited flat movement),
      then advanced/Golden Fleece/Hero powers as needed.
- [x] Test coverage of rules, gods, notation round-trips, and random-playout
      invariants (46 tests); bench ~5.5k games/s, ~308k turns/s.

## Deliverable 2 — Self-play AI + training harness (`packages/ai`, `apps/trainer`)

Separate offline app; the AI teaches itself via adversarial self-play.

- [x] Baseline opponents: random, greedy-heuristic (immediate wins/blocks, height).
- [x] Search player: MCTS over the engine's full-turn moves (UCT + one-ply
      win/loss solver + short eval-scored playouts; mcts(2000) ≈83% vs greedy).
- [ ] Learned evaluation: small policy/value network (pure TS/ndarray first;
      GPU/WebGPU or ONNX later), trained by self-play (AlphaZero-style).
- [ ] Resumable training: checkpoints are versioned artifacts (JSON/binary weights
      + metadata: generation, elo vs baselines, config) committed or stored in
      `models/`. Trainer loads latest checkpoint and continues.
- [ ] Explainability channel: the AI must not just pick moves — it exposes
      search statistics (visit counts, value estimates, principal variation,
      threats found) that the coach layer turns into human explanations.
      (Started: `search()` already returns visits/values/PV; threat
      extraction and narration pending.)
- [ ] Strength ladder: frozen checkpoints at increasing strength = difficulty levels.

## Deliverable 3 — Web game (`apps/web`)

- [x] Slice 1: pass-and-play PvP, minimalist flat 2D overhead board (SVG),
      click to place/move/build, win detection — verified by playing a full
      game through the in-app browser. Includes live SGN record and undo.
- [ ] Slice 2: replay/analysis view; god-power selection UI and generic
      multi-step turn input (Artemis paths, Demeter double builds,
      Prometheus pre-build).
- [ ] Slice 3: vs-AI using a persisted model artifact; AI-vs-AI at controllable rate.
- [ ] Slice 4: coach — explains goals/plans/threats/countermoves, not just best
      moves; beginner/intermediate/advanced lesson content.
- [ ] God power selection UI.

## Non-functional requirements

1. **Agentic harness**: CLAUDE.md + skills/hooks evolve as we learn; record
   mistakes and their fixes so they aren't repeated. Cheap-model subagents for
   mechanical work.
2. **Self-testing through the UI**: dev server + in-app browser; Claude plays
   the game via clicks and screenshots before declaring UI work done.
3. **Small, narrative commits; vertical slices.**
4. **Recoverable sessions**: `docs/PROGRESS.md` is the single source of truth
   for state + next steps; update it before ending any work session.
5. **Token economy**: delegate mechanical/parallelizable work to Sonnet subagents.

## Architecture decisions

- **TypeScript monorepo (npm workspaces)** — one language across engine,
  trainer, and web; engine runs headless in Node (training) and in-browser
  (game) with zero duplication. If training perf becomes the bottleneck, port
  the hot loop (movegen/apply) to Rust+WASM behind the same API — the notation
  and test suite make that a safe refactor.
- **Engine is pure and synchronous**: `GameState` in, legal turns out; no I/O,
  no UI coupling. Full turn (move+build(+extra)) is the atomic action — right
  granularity for search and for gods that entangle move/build.
- **Gods as generator plugins**, not flag soup: each god provides/wraps turn
  generation and apply; opponent-affecting gods (Athena) use small persistent
  state fields.
