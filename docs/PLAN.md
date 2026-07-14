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

- [x] Official rules grounded in `docs/reference/rulebook.md` (reformatted
      from the official rulebook PDF).
- [x] Base 2-player game: 5×5 board, place 2 workers each, move+build turns,
      win by moving up onto level 3, lose when unable to move+build.
- [x] Full-turn move generation (a "move" for engine consumers = complete turn),
      designed for fast search (typed arrays, in-place apply).
- [x] Notation system ("SGN" — Santorini Game Notation, see `docs/NOTATION.md`):
      document, annotate, and replay games; PGN-style headers.
- [x] God Powers framework (opt-in per game, per-player assignment) with all
      10 simple gods: Apollo, Artemis, Athena, Atlas, Demeter, Hephaestus,
      Hermes, Minotaur, Pan, Prometheus. Hermes ("if your Workers do not
      move up or down, they may each move any number of times... then
      either builds") is a bonus on top of the normal move — same
      "if...then" shape as Prometheus's pre-build — not a replacement: a
      normal single-step up/down move, including winning by climbing to
      level 3, is still a legal Hermes turn. Needed a turn-shape extension
      for the bonus branch — `MoveTurn.otherPath` plus an SGN `~` segment —
      since it's the first god where a turn can move the worker that
      *isn't* the one selected/built with; see `docs/NOTATION.md`.
- [x] God tier/configuration identity (issue #26, 2026-07-14):
      `GodConfig.tier` (`simple | advanced` — advanced declared, none
      implemented) + rulebook `index`, and `configTier(a, b)` →
      `base | simple | advanced`, the configuration scope that ratings and
      training data are recorded under.
- [ ] Advanced gods (index 11–30), then Golden Fleece/Hero powers as needed.
- [x] Test coverage of rules, gods, notation round-trips, and random-playout
      invariants (55 tests, incl. an adversarial-review-driven joint-BFS
      fix for Hermes worker-swap turns — see PROGRESS.md); bench ~5.5k
      games/s, ~308k turns/s (base game;
      unaffected by Hermes since the bench doesn't exercise gods).

## Deliverable 2 — Self-play AI + training harness (`packages/ai`, `apps/trainer`)

Separate offline app; the AI teaches itself via adversarial self-play.

- [x] Baseline opponents: random, greedy-heuristic (immediate wins/blocks, height).
- [x] Search player: MCTS over the engine's full-turn moves (UCT + one-ply
      win/loss solver + short eval-scored playouts; mcts(2000) ≈83% vs greedy).
- [x] Learned evaluation v1: pure-TS value net (175-plane encoding, 64
      ReLU hidden, SGD on self-play outcomes) as checkpoint eval `mlp@1`,
      plugged into MCTS via `EvalFn`; trainer `train` command runs the
      parent → self-play → train → child loop. gen-001 is at parity with
      the hand eval (gauntlet 793 vs 817; 15–9 head-to-head).
- [x] Learned evaluation v2: PUCT policy priors + more games/gen +
      regularization (2026-07-12). `pv@1` two-headed net (shared hidden,
      value + policy over a 225-way full-turn action encoding), PUCT
      search when a checkpoint has a policy head, self-play visit-
      distribution targets (8-symmetry aware), L2 weight decay, trainer
      `--pv`/`--wd`. gen-006 (UCT self-play data) gauntleted 1001;
      gen-007 (first PUCT self-play, 800 games) gauntleted 1132 and beat
      gen-005 23–1 — two consecutive +232-Elo head-to-head jumps. Loop
      still rising; further gens are one command each — recipe, decision
      rules, app-shipping steps, and plateau levers in `docs/TRAINING.md`.
      GPU/WebGPU/ONNX still unneeded (pure TS trains a gen in ~15 min).
- [x] Checkpoint format + rating harness: versioned JSON artifacts
      (`santorini-checkpoint@1`: generation, parent, eval weights, search
      config, Elo record) in `models/`; trainer CLI (`init`/`match`/
      `calibrate`/`gauntlet`/`train`) with Bradley–Terry-calibrated baselines
      (random=0, mcts(200)=657, greedy=808, mcts(1000)=923) and SGN game
      dumps (self-play dumps replay-verified).
- [x] Explainability channel: the AI must not just pick moves — it exposes
      search statistics (visit counts, value estimates, principal variation,
      threats found) that the coach layer turns into human explanations.
      (`search()` returns visits/values/PV; `coach.ts` adds threat
      extraction, post-move review, and narration — slice 4a, 2026-07-11.)
- [ ] **God-aware AI retraining milestone** (issues #17–#21, #26–#27;
      task DAG + loop protocol in `docs/milestones/god-ai.md`; frozen
      encoding spec in `docs/milestones/god-ai-encoding-v2.md`):
  - [x] Phase 0 (2026-07-14): tier/configuration identity (#26),
        TRAINING.md rules-surface advisory (#27, incl. gen-007 pinned +
        `models/v2/` lineage + matchup-panel promotion rule), "(base
        game)" Elo label (#22 cheap half), encoding-v2 manifest frozen,
        CLAUDE.md delegation guardrails.
  - [ ] Slice 1 — "free five" pipeline proof: eval god-win fix (#20),
        trainer `--gods` CLI (#21), features v2 (#18), self-play god
        wiring (thin #17), disposable trial generation + wall-clock
        measurement.
  - [ ] Slice 2 — policy v2 factorized heads (#19), full 9-god training
        run, matchup-panel validation, adversarial reviews (closes #17).
  - [ ] Slice 3 — Hermes fast-follow: throughput measurement/fix (#36),
        pool inclusion; web two-worker UI (#35) trails independently.
  - [ ] Slice 4 — god-draft AI: matchup matrix + minimax draft with
        seeded softmax temperature (issue #39).
- [x] Strength ladder: frozen checkpoints at increasing strength = difficulty
      levels. `models/ladder.json` (`santorini-ladder@1`): Beginner=random(0),
      Easy=mcts:200(657), Medium=greedy(808), Hard=ckpt:gen-005(841),
      Expert=ckpt:gen-007(1132; appended 2026-07-12 — pv@1, PUCT search,
      bundled into the web picker; the coach's hint search also upgraded
      to gen-007's value+policy heads).

## Deliverable 3 — Web game (`apps/web`)

- [x] Slice 1: pass-and-play PvP, minimalist flat 2D overhead board (SVG),
      click to place/move/build, win detection — verified by playing a full
      game through the in-app browser. Includes live SGN record and undo.
- [x] Slice 2a: god-power selection UI and generic multi-step turn input
      (Artemis paths, Demeter double builds, Prometheus pre-build, Atlas
      domes) — partial turns prefix-matched against `legalTurns()`, chooser
      for ambiguous squares, "Finish turn" for optional extras; verified by
      playing god games through the in-app browser (2026-07-11).
- [x] God draft per rulebook (issue #7): Challenger picks two unique gods,
      opponent takes one, Challenger gets the other and chooses the Start
      Player (who takes engine seat 0 — colors are mapped to seats via
      `seatColor`). Free pick kept as a collapsed dev shortcut; verified
      through the in-app browser (2026-07-11).
- [ ] Hermes support in the turn-input UI: `SELECTABLE_GOD_IDS` in
      `apps/web/src/main.ts` currently excludes Hermes from both pickers,
      since the click-based turn builder only knows how to construct
      `MoveTurn.path`/`builds`, not the second worker's `otherPath` a Hermes
      turn can carry (engine-side support is done — see Deliverable 1).
- [x] Slice 2b: replay/analysis view — step through the game history
      (stepper buttons / arrow keys / click a record move) with a read-only
      board, load a pasted SGN record, export the current game as SGN;
      verified by replaying a 49-turn Artemis/Atlas game and resuming live
      play through the in-app browser (2026-07-11).
- [x] Slice 3: vs-AI using a persisted model artifact; AI-vs-AI at
      controllable rate. Per-color Human/AI seat picker over the frozen
      `models/ladder.json` rungs (Hard = bundled gen-005 checkpoint), AI
      driver with delay slider + Pause/Resume, AI-aware undo, replay view
      halts the AI. Player-spec parsing lifted from the trainer into
      `@santorini/ai` and shared. Verified through the in-app browser
      (2026-07-11): human-vs-Hard, AI-vs-AI base and god games to the win
      banner; Hard ≈200–300 ms/move in-browser (no worker needed yet).
- [x] Slice 4a: coach v1 — win/threat squares ringed on the board each turn,
      on-demand narrated hint (search-backed suggestion, win chances, PV,
      candidates), post-move feedback on human plays (missed win, avoidable
      hang, block credit, created threat); verified through the in-app
      browser (2026-07-11).
- [x] Slice 4b: beginner/intermediate/advanced lesson content; richer plan
      narration beyond one-ply facts + PV. 10-lesson curriculum in
      `packages/ai/src/lessons.ts` (9 with interactive exercises judged by
      the coach's exact facts: win / stay safe / create a threat / forced
      win / central placement), Learn panel in `apps/web` (pick a lesson,
      try its position on the board, verdict + retry/next). Coach narration
      now detects forced wins (`forcedLoss` win-in-2 solver), annotates
      climbs, narrates the PV in words, and compares top candidates.
      Verified through the in-app browser (2026-07-12).

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
6. **Protected trunk** (since 2026-07-11): all development on branches/worktrees,
   merged to `main` via PRs; no direct commits to `main`. Toolchain: TypeScript 7
   (Go-native compiler) once issue #1 lands — typecheck-speed win only; runtime
   perf is unaffected.

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
