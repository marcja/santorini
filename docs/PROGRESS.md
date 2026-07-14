# Progress

_Last updated: 2026-07-14 (session 14)_

## Done

- **(issue #5) Reformatted the extracted rulebook into readable Markdown,
  then consolidated to a single canonical doc.** `docs/reference/rulebook.md`
  is now the ground-truth rules reference (see CLAUDE.md) — headings/lists,
  a full 1–55 god/hero power index, source/copyright header. Two page-
  transition label swaps found while cross-checking the detailed-god-power-
  cards PDF extraction (Eros/Hera, Persephone/Morpheus) were corrected along
  the way. Per PR review, the original `rulebook.txt`/`god-powers-detailed.
  {txt,md}` extractions and their source PDFs (`references/Santorini_-_
  Rulebook...pdf`, `references/Santorini_-_Detailed_God_Power_Cards_V2.pdf`)
  were removed as duplicative once `rulebook.md` was verified against them;
  `references/A Mathematical Analysis of the Game of Santorini.pdf` is
  unrelated and was kept.
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

- **Bounded AI goal complete (this session): gen-004 + gen-005 trained,
  ladder frozen, training stopped.** Same recipe (500 games @ mcts(600),
  seed = gen number, `--augment`; losses ~0.60). Neither cleared the early
  stop (gen-004 10–10, gen-005 8–12 vs mcts(1000)). Gauntlets *sagged*
  (903 → 878 → 841) while head-to-heads *rose* — gen-004 beat gen-003 15–9
  (+89), gen-005 beat gen-004 13–11, and the tiebreaker gen-005 vs gen-003
  went **17–7 (70.8%, +154 Elo)**: the lineage is genuinely improving and
  the gauntlet ordering at the top is noise (rungs are 100+ Elo apart or
  20-game samples). **`models/ladder.json` (`santorini-ladder@1`) freezes
  the difficulty ladder**: Beginner=random(0), Easy=mcts:200(657),
  Medium=greedy(808), Hard=ckpt:gen-005(841 gauntlet, strongest by
  head-to-head). Self-play SGN dumps for both gens are in the session
  scratchpad only (replayable; regenerate deterministically from seeds 4/5
  if needed). PUCT priors / more games per gen are deferred to the
  post-web return as planned.

- **Web slice 2 (this session): god-power selection UI + generic multi-step
  turn input.** `apps/web` only — no engine changes. God pickers (Blue/Amber)
  applied on New game, active god cards shown in the sidebar. Turn input
  rewritten to be god-generic: clicks accumulate a partial turn (pre-builds /
  move path / builds) that is prefix-matched against `legalTurns()` — no
  god-specific UI code. When one square admits several actions a chooser
  panel appears ("Move to c4" / "Build block at c4"); when the partial is
  already a complete legal turn but optional extras remain, a "Finish turn"
  button plays it; fully-determined turns auto-play. Demeter build clicks
  match order-insensitively (movegen emits one canonical order). Verified in
  the in-app browser via SGN record after every action: base-game regression,
  Artemis double move + win (`b4-a3#`, banner shows god), Demeter double
  build auto-play and single build via Finish, Prometheus pre-build with
  no-move-up visually enforced (`^a2b2-b3^a4`), Atlas dome chooser
  (`d4-d5^e5D`), undo mid-game. Board cells now have `role="button"` +
  aria-labels (the chooser/Finish buttons are click-targetable via the
  accessibility tree; SVG cells still need coordinates).
  **Known gap (issue #7):** god *selection* doesn't follow the rulebook's
  draft — the Challenger picks two unique gods, the opponent takes one, the
  Challenger gets the other and chooses the Start Player. Current free-pick
  dropdowns (same god allowed, Blue always starts) are a stand-in; in-game
  god behavior is unaffected.

- **Web slice 2b (this session): replay/analysis view.** `apps/web` only.
  A `view` index (null = live play) renders `game.stateAt(view)` read-only:
  stepper buttons ⏮◀▶⏭ with a position counter, clickable record moves
  (current one highlighted), ArrowLeft/ArrowRight keys, Undo disabled while
  viewing, stepping to the end resumes live play (you can keep playing —
  including from a loaded mid-game record). SGN panel: Export fills a
  textarea with `game.toSGN()`; Load runs `Game.fromSGN` (god dropdowns
  synced, errors surfaced inline, prior state kept on failure). Verified in
  the in-app browser: loaded a scratchpad-generated 49-turn Artemis/Atlas
  game and stepped/jumped through it, board clicks confirmed no-ops during
  replay, live game stepped back then resumed and continued, export → load
  round trip, invalid-SGN error path. No engine changes (`Game.fromSGN`/
  `stateAt`/`toSGN` already existed).

- **God draft per rulebook (this session, issue #7).** `apps/web` only. The
  free-pick dropdowns are replaced by a draft wizard in the sidebar (rulebook
  p.2 "God Power Setup"): pick the Challenger → the Challenger offers two
  *unique* gods (toggle grid, Offer disabled until exactly 2) → the opponent
  takes one (full god text shown), the Challenger gets the other → the
  Challenger chooses the Start Player. The Start Player takes engine seat 0;
  a `seatColor` map (seat → Blue/Amber) now drives every color-dependent
  render (workers, chips, names, god cards), since Blue is no longer always
  first. SGN export puts the seat-0 god in `God1`; SGN load resets colors to
  Blue-first (records carry no color info). "No gods (base game)" starts
  immediately; the old free pick (any gods, duplicates allowed, Start Player
  select) survives as a collapsed dev shortcut. Verified in the in-app
  browser: full draft with Amber as Challenger + Amber starting (amber
  workers placed first, `1. b2,c2 b4,c4`, Apollo turn `2. c2-c3^d3`, undo,
  export headers `God1 "Apollo"`), free-pick with Amber start, SGN load
  color reset, Cancel, base game. Mistake-log reminder held: coordinate
  clicks drifted (screenshot scale ≠ viewport), a11y-ref clicks didn't.

- **Web slice 3 (this session): vs-AI play + AI-vs-AI at a controllable
  rate.** Refactor first: player-spec parsing (`parsePlayerSpec` /
  `playerFromSpec` / `specName`, grammar unchanged) moved from `apps/trainer`
  into `@santorini/ai` (`src/spec.ts`; checkpoint loading stays injected —
  fs in the trainer, bundled JSON in the browser), spec tests moved with it.
  `apps/web`: a "Players" panel maps each color to Human or a
  `models/ladder.json` rung (Hard = gen-005 checkpoint, bundled by Vite and
  validated at module load); an AI driver re-arms a timeout after every
  render and re-checks state before acting, so any user intervention
  (undo, new game, SGN load, replay view, seat change) safely cancels it.
  Delay slider 0–2 s = the AI-vs-AI rate control, plus Pause/Resume. Undo
  vs an AI backs up to the human's previous decision point; in AI-vs-AI it
  undoes one turn and auto-pauses. Board clicks are ignored while an AI is
  to move; replay view halts the AI, stepping back to latest resumes it.
  Verified in the in-app browser: human-vs-Hard base game (AI placed and
  replied through the engine record), AI-aware undo, Medium-vs-Hard base
  game and Apollo-vs-Pan god game both ran unattended to the win banner
  (winning move `d2-c1#`), pause froze the run and resume continued it,
  ditto replay stepping. Hard (mcts 1000 + net eval) ≈200–300 ms/move
  in-browser on the main thread — no web worker needed at current budgets;
  revisit when search budgets grow (slice-4 coach / stronger rungs).

- **Web slice 4a (this session): coach v1 — threats, hints, move feedback.**
  `packages/ai/src/coach.ts` (the explainability channel made concrete):
  `winningTurns`/`threatSquares` (exact one-ply facts; threats = hand the
  unchanged position to the opponent, so Athena state carries over),
  `reviewTurn` (missed win / hang + avoidable-via-alternatives / block
  credit / created threat — no search), `coachHint` (seeded MCTS search →
  narrated suggestion, win probability, PV, candidates; placement hints
  use the centrality heuristic directly since ~600 placement pairs starve
  1000 iterations into visit noise), `reviewLines`/`describeTurn` narration.
  13 new tests (105 total green across the workspace). `apps/web`: Coach sidebar section
  (off by default) — win/threat squares ringed on the board with alert
  lines each turn; Hint button (mcts 1000 + bundled gen-005 eval, ~300 ms)
  shows narrated advice and rings the suggested squares; human plays are
  reviewed via `playHuman()` into a feedback box (AI moves never are);
  hints invalidate when the displayed position changes. Verified in the
  in-app browser via an engine-generated fixture (threat alert + dome-block
  hint b1-b2^c3, avoidable-hang and missed-win feedback, win banner,
  central placement hint); no console errors.
  **Remaining slice-4 scope:** beginner/intermediate/advanced lesson
  content (structured curriculum), richer plan narration beyond one-ply
  facts + PV.

- **Web slice 4b (this session): lesson curriculum + richer plan narration —
  slice 4 complete.** `packages/ai` coach upgrades: `forcedLoss()` (win-in-2
  solver: every defender turn leaves a win-in-1; one movegen per legal turn),
  `TurnReview.decisive` + "The win is forced" narration, climb annotations in
  `describeTurn` ("move c2→c3 (up to level 2)"), `coachHint` now narrates the
  PV in words ("The idea: you …; expect them to …"), flags unstoppable
  suggestions ("you win next turn"), and compares the top candidates ("is
  about as good" / "stands out"). New `packages/ai/src/lessons.ts`: 10-lesson
  beginner→advanced curriculum (win condition, placement, gifting builds,
  blocking, domes, tempo, double threat, racing, god powers, mobility), 9
  with interactive exercises — declarative `LessonPosition` →
  `lessonState()`, goals (`win`/`safe`/`threat`/`forced-win`/`place-central`)
  judged by `checkExercise()` over the coach's exact facts; finding a faster
  win never fails. Tests: every exercise solvable but non-trivial (some legal
  turn passes, some fails), targeted checks (only the e4 dome saves
  stop-the-threat; doming your own tower fails double-threat; Pan's descent
  wins). 129 tests green. `apps/web`: Learn panel — lesson picker (optgroups
  by level), prose, "Try it on the board" loads the position via
  `Game.fromState` as a two-human game; the student's turn is judged in
  `playHuman()`, verdict panel (✓ Solved praise / ✗ Not quite + review facts
  + hint) freezes the board until Retry/Replay; Undo = retry; Next lesson
  advances; new game / SGN load exits exercise mode. Verified in the in-app
  browser: win exercise pass (`1. b2-c3#` + banner) and fail (missed-win +
  threat facts + hint), frozen-board guard, placement exercise (`1. c3,d3`),
  double-threat exercise with decisive verdict, hint showing all four new
  narration forms, undo-retry, next-lesson nav; no console errors. Browser
  click coordinates drifted twice (scroll + reflow) — per mistake log, in-page
  `getBoundingClientRect` × (screenshot/viewport scale) re-measured before
  each click sequence was the reliable recipe.

- **AI return, part 1 (this session): PUCT policy priors — the plateau
  levers work.** `packages/ai` additions: `policy.ts` (action encoding v1:
  225 = destination square × 3×3 build-delta code, centre = winning move;
  god extras collapse onto their primary components and share a prior;
  placements take no priors), `pvnet.ts` (`pv@1`: two-headed net — shared
  ReLU hidden layer, value head with the `mlp@1` contract, policy head over
  the 225 actions; masked softmax CE over each sample's legal actions;
  decoupled L2 weight decay = the regularization lever; warm start from an
  `mlp@1` parent with a zero policy head = uniform priors). MCTS gains PUCT
  (Q + c·P·√N/(1+n), FPU 0.5, prior-ordered expansion) when a policy is
  supplied — the UCT path is untouched, so baselines/old rungs are
  unaffected. Self-play samples now carry root visit distributions as
  sparse policy targets (8-symmetry augmentation transforms action indices
  with the planes). Trainer: `--pv` (implied by a pv parent) and `--wd`.
  152 tests green (23 new); both new self-play dumps replay-verified.
- **gen-006 + gen-007 (committed): two +232-Elo jumps, gauntlet 903→1132.**
  gen-006 (500 games @ mcts(600) UCT self-play from gen-005, wd=1e-4):
  19–5 vs gen-005, gauntlet **1001** — first to clear mcts(1000) (14–6).
  Diagnosis (scratch probe): UCT visit targets are nearly uniform (top
  action ~7% mass, entropy 3.6 nats ≈ the CE floor), so its policy head is
  weak — the jump came from PUCT's visit concentration + the continued
  value head. gen-007 (800 games — the more-games lever — @ mcts(600)
  **PUCT** self-play from gen-006): policy loss finally moves (3.47→3.37),
  19–5 vs gen-006, 23–1 vs gen-005, gauntlet **1132** (17–3 vs mcts(1000)).
  Lineage: 841 → 903 → 878 → 841 → 1001 → 1132; no early-stop hit — the
  loop is still rising, continuing is one `trainer train` command per gen.
- **Ladder + web: Expert rung appended (gen-007), coach upgraded.**
  `models/ladder.json`: Expert = ckpt:gen-007 (1132); Hard stays gen-005
  (841) for rung spacing. `apps/web`: gen-007 bundled; coach hints now use
  gen-007's value head *and* policy head (PUCT — `CoachOptions extends
  MctsOptions`, so it's one option). Verified in the in-app browser:
  Expert appears in both seat pickers, human-vs-Expert placements and a
  full turn through the engine record (`2. c3-d3^c3 b4-a4^b5`), PUCT hint
  with all narration forms and the telltale visit concentration (208v top
  candidate vs 69/65/64), no console errors.

- **(issue #3, PR1/6) Biome added in warn mode.** `@biomejs/biome` devDep,
  root `biome.json` (recommended rules, scoped to `packages/*/src` +
  `apps/*/src`; cognitive-complexity intentionally deferred), `npm run
  lint`/`format` scripts, first-ever `.github/workflows/ci.yml` (Node 22,
  `continue-on-error` on both Biome steps — nothing blocks yet). No source
  files touched. Housekeeping only: `docs/PLAN.md` has no Biome/lint
  checkboxes since this isn't on the deliverable roadmap. Remaining PRs in
  the issue #3 sequence: PR2 mechanical cleanup, PR3 flips lint/format to
  blocking (CI gate + PostToolUse format hook + git pre-commit), PR4 enables
  `no-excessive-cognitive-complexity` in warn mode, PR5 fixes what it flags,
  PR6 flips complexity to blocking.
- **(issue #3, PR2/6) Biome format/lint cleanup — 0 warnings.** All findings
  from PR1 fixed: line-wrap formatting + import ordering across all four
  packages (mechanical, no behavior change — verified by diff review, full
  test suite, typecheck, and engine bench; web app also booted clean in the
  in-app browser with no console errors). Three rules disabled repo-wide as
  not fitting this codebase's idioms rather than rewritten away:
  `noNonNullAssertion` (used throughout deliberately), `noAssignInExpressions`
  (the `x ??= f()` memoization pattern), `useIterableCallbackReturn` (forEach
  used for side effects). Two `noUnusedPrivateClassMembers` findings in
  `mlp.ts`/`pvnet.ts` were false positives (Biome doesn't trace destructuring
  reads) — suppressed inline, not deleted. One CSS specificity warning in
  `style.css` suppressed inline (intentional, order-independent given
  specificity).
- **(issue #3, PR3/6) Biome lint/format enforcement is now blocking.**
  `.github/workflows/ci.yml` no longer has `continue-on-error` on the Biome
  steps. `.claude/settings.json` gained a second `PostToolUse` entry
  (appended, existing PROGRESS.md hook untouched): format-only, auto-fixes
  `.ts`/`.tsx` files after Write/Edit and reports via `additionalContext` —
  never blocks the edit itself, since a file mid-refactor may look
  "unfinished" to a lint rule without actually being wrong. Local commit
  enforcement is opt-in: `scripts/install-hooks.sh` points
  `core.hooksPath` at `.githooks/` (not copied into `.git/hooks/`, so
  clones that skip the install step rely on CI as the backstop — both
  paths tested with a deliberate violation). Cognitive-complexity remains
  deferred to PR4.
- **(issue #3, PR4/6) Cognitive-complexity enabled, warn-only.**
  `no-excessive-cognitive-complexity` at `warn`, max 15 repo-wide, `packages/
  engine` overridden to 10 (rules-critical code held to a tighter bar).
  23 current findings, by package: engine 8 (movegen.ts 4, notation.ts 2,
  apply.ts 1, board.ts 1), ai 7 (one each in checkpoint/coach/mcts/mlp/
  pvnet/selfplay/spec), web 5 (all in main.ts), trainer 3 (cli/elo/run.ts).
  Density looked reasonable everywhere (no package flooded), so no looser
  override for ai/trainer. Confirmed Biome's own warn-vs-error exit codes
  keep CI green at this stage — no need to split lint into two CI lanes.
  No source files touched. PR5 fixes these; PR6 flips to blocking.
- **(issue #3, PR5/6) All 23 cognitive-complexity findings fixed.** Refactor
  only — behavior preservation was verified per file, with the level of
  rigor scaled to risk:
  - `packages/engine` (apply/board/notation/movegen.ts, rules-critical):
    reviewed personally. `movegen.ts`'s move generator was restructured from
    closures into explicit-state top-level functions (`MoveCtx`); a
    differential fuzz harness replaying `legalTurns()` at every half-turn
    across all god pairings (~9.8k positions) caught a real bug mid-refactor
    (Artemis's extra-move step firing after an already-winning first step)
    before it could land — fixed, then reverified byte-identical against the
    pre-refactor baseline. `board.ts`'s neighbor precomputation needed a
    second pass (11 vs max 10) and an exact-order check against the original
    nested loop (differential test, not just eyeballing).
  - `packages/ai` search/training internals (mcts/mlp/pvnet/selfplay.ts,
    also reviewed personally): `mcts.ts`'s search loop split into per-policy
    (UCT/PUCT) step functions, verified byte-identical `SearchResult`s across
    20 seeded UCT+PUCT runs. `mlp.ts`/`pvnet.ts`'s training loops split into
    per-sample gradient-accumulation methods; verified trained weights
    (rounded to the 6-decimal precision actually persisted to checkpoints)
    are bit-identical across several seeded runs each — reported losses
    differ only at ~1e-15 relative (float64 summation-order noise from
    per-batch subtotaling, not a real difference).
  - `packages/ai` checkpoint/coach/spec.ts, `apps/web/src/main.ts`,
    `apps/trainer` (cli/elo/run.ts): delegated to parallel subagents (lower
    rules/training risk), each verified against the full test suite +
    typecheck; `main.ts`'s diff was reviewed by hand afterward (one type
    annotation bug found and fixed — `Uint8Array` vs `number[]`) and played
    through the in-app browser (setup placement, move+build, coach hints,
    status text all confirmed working).
  - Whole-repo result: `npx biome check .` 0 findings, typecheck clean,
    152/152 tests green, engine bench unchanged (~13-14k games/s). PR6 flips
    cognitive-complexity to blocking.
- **(issue #3, PR6/6) Cognitive-complexity is now blocking — issue #3 fully
  resolved.** `noExcessiveCognitiveComplexity` flipped `warn` → `error`
  (max 15 repo-wide, 10 for `packages/engine`) in `biome.json`. Repo was
  already clean from PR5, so this is a config-only change. Verified with a
  scratch over-threshold function (complexity 25) on a throwaway edit: both
  `npx biome check` and `.githooks/pre-commit` correctly reject it (exit 1);
  reverted before committing. Biome/lint/format enforcement across the
  monorepo — warn-mode rollout (PR1), mechanical cleanup (PR2), blocking
  lint/format + hooks (PR3), complexity visibility (PR4), complexity cleanup
  (PR5), complexity enforcement (PR6) — is complete end to end.

- **(this session) Hermes implemented — the engine now has all 10 simple
  gods.** Hermes ("Your Turn: If your Workers do not move up or down, they
  may each move any number of times (even zero), and then either builds")
  was deferred at Deliverable 1 because it needed a design pass: it's the
  first god whose turn can move the worker that *isn't* the one selected/
  built with, breaking the single-worker-path shape every other `MoveTurn`
  (and every consumer of it) assumed.
  - **Engine (`packages/engine`):** added `GodConfig.flatMoveBothWorkers`
    and `MoveTurn.otherPath` (present only when the non-building worker
    actually moved). `movegen.ts`'s `tryHermesTurns` computes every jointly-
    reachable pair of final squares via `hermesJointReachable`, a BFS over
    the joint `(worker0Square, worker1Square)` state space (bounded at
    25×25), deduping by resulting board state. `apply.ts` jumps each worker
    straight to its final square rather than stepping (Hermes never
    displaces anyone or changes height, and movegen may have explored the
    two workers' paths in an interleaved order, so replaying a fixed step
    order against the real board could see a transiently-occupied square —
    caught by the existing random-playout fuzz suite, which throws exactly
    this until fixed). `notation.ts` adds a `~`-prefixed SGN segment for the
    other worker's path (documented in `docs/NOTATION.md`); `turnKey`
    updated to include it.
  - **Correctness fix (same session, found by an adversarial rules-review
    subagent — see below):** the first implementation of the flat/bonus
    branch used a two-ordering heuristic ("worker A repositions fully, then
    worker B" and the reverse) instead of a true joint BFS, and was
    documented as only missing "an exotic mutual-swap." An adversarial
    review proved that framing wrong: on a fully open board with two Hermes
    workers two squares apart (an entirely ordinary mid-game shape, not a
    contrived edge case), `legalTurns()` returned ~4,835 turns and *none*
    of them was the full worker swap, even though it's reachable via 4
    legal micro-steps — neither ordering can ever have a worker step onto
    the other's *original* square while it's still occupied. Fixed by
    replacing the two-ordering heuristic with `hermesJointReachable`, which
    also came out ~60% faster (578 → 922 `legalTurns()` calls/s on an
    open-board benchmark) since it no longer reruns a fresh BFS per landing
    square. Verified independently (not just by the fixer's own report):
    read the full diff, reasoned through the joint-BFS logic by hand, and
    reproduced the swap scenario myself from scratch after the fix landed —
    confirmed present, and that it applies to the correct final positions.
  - **Correction (same session, caught by Marc):** the first pass
    misread "Your Turn: If your Workers do not move up or down, they may
    each move any number of times... and then either builds" as *replacing*
    the normal move entirely (flat-only, always). It's actually a
    conditional bonus — same "if...then" grammar as Prometheus's "If your
    Worker does not move up, it may build both before and after moving,"
    which was already correctly implemented as optional. Fixed: `moveTurns`
    now always generates the normal single-step move first (so a Hermes
    turn can still climb one level, descend any amount in one step, and
    win by reaching level 3 — none of that was reachable before the fix),
    then adds the flat/both-worker bonus turns on top, deduped by
    resulting board state against the normal turns (they overlap exactly
    when one worker takes a single flat step and the other stays put).
    This also surfaced a second bug in `apply.ts`: the "jump straight to
    final square" fast path was gated on the god flag (true for every
    Hermes turn), so a winning normal move would route through it and
    silently *not* end the game (no `t.win` check there) — fixed by gating
    on `MoveTurn.otherPath` presence instead, which is the only case that
    actually needs it. Reproduced the win-swallowing bug in isolation
    before landing the fix, to confirm the new regression test
    (`applyTurn` + phase/winner assertions, not just checking `t.win`)
    actually catches it.
  - **Tests:** `Hermes` describe block in `packages/engine/test/
    gods.test.ts`, 6 tests: normal up-move can still win (applies the turn
    and checks `phase`/`winner`, not just the `win` flag) and normal
    down-move is still legal; moving up/down forfeits the bonus (no
    chaining, no second-worker move) for that turn; chained flat moves
    incl. zero-move; either worker building including one that never
    moved; an exhaustively enumerated closed-corridor position (now
    includes the worker's normal down-moves alongside the flat bonus);
    full worker swap via interleaved repositioning (added after the
    joint-BFS fix, reproduces the adversarial review's scenario directly).
    `notation.test.ts` and `playout.test.ts` gained explicit Hermes/
    Hermes-vs-Hermes coverage too — SGN round-trip through `Game.toSGN`/
    `fromSGN` on a game that actually contains an `otherPath` (`~`) turn,
    and 10-seed random-playout invariants — after an adversarial quality
    review found the existing fuzz never exercised Hermes at the notation
    layer or same-god-vs-itself (the highest-complexity path through
    `tryHermesTurns`/`applyHermesMove`) at all. `playout.test.ts`'s
    existing fuzz (every god vs base, all god pairings) picks Hermes up
    automatically via `GOD_IDS` — this is what caught the apply-order bug
    above. 55/55 engine tests green, typecheck and lint (including the
    `packages/engine`-scoped cognitive-complexity=10 limit — `applyMove`/
    `parseMoveTurn`/`hermesJointReachable` all needed splitting into
    smaller helpers to stay under it) clean across the whole repo.
  - **Adversarial review workflow (this session):** ran a dynamic Workflow
    with two parallel adversarial subagent reviewers (rules-correctness
    against `docs/reference/rulebook.md`; implementation quality) followed
    by a fixer subagent. First attempt: 2 of 3 agents hit the account's
    monthly spend limit (rules reviewer and fixer both failed outright —
    an empty `rulesFindings` array from a failed agent is not the same as
    "found nothing," and was reported to Marc as such rather than as a
    clean bill of health). After the limit reset, resumed the same run
    (`Workflow` with `resumeFromRunId`, replaying the completed quality
    reviewer's result from cache) — all 3 agents completed. Quality
    reviewer found the Hermes swap-turn coverage gap (`notation.test.ts`/
    `playout.test.ts`, above) plus the `movegen.ts` performance concern and
    a duplicated build-key helper (fixed: extracted `buildsKey()`, used by
    both `turnResultKey` and `emitHermesBuildsFor`). Rules reviewer found
    the joint-BFS bug (above) — its most consequential finding across both
    runs. Independently re-verified the fixer's diff by hand afterward
    (read the full `movegen.ts` rewrite, reasoned through the BFS logic,
    reran typecheck/lint/`npm test`, and reproduced the swap scenario from
    scratch myself) rather than taking the fixer's summary at face value.
  - **`apps/web` gap (not fixed this session, scoped out on purpose):** the
    click-based turn-input UI (`compatible`/`stepsFor`/`uiOptions` in
    `main.ts`) is generic by prefix-matching clicks against `MoveTurn.path`/
    `builds` only — it has no way to input `otherPath`. Shipping Hermes
    there as-is would silently default the second worker to whatever
    `legalTurns()` happens to return first, ignoring player intent. Gated
    off via `SELECTABLE_GOD_IDS` (excludes `hermes` from both the free-pick
    dropdowns and the draft grid) rather than left broken; verified by
    playing a full base-game turn through the in-app browser and confirming
    Hermes is absent from both pickers with no console errors. Tried to file
    a tracking GitHub issue for this and for updating issue #26 (which cited
    "9 of 10 simple gods" as the engine's simple-god coverage, now stale) —
    blocked by the auto-mode permission classifier (unilateral external
    issue creation needs explicit user sign-off); flagged to the user
    instead. `packages/ai`/`apps/trainer` need no changes: neither
    references `GOD_IDS`, and the existing god-blindness issues (#17–#27)
    already generically cover "AI doesn't understand god X" — Hermes just
    joins that same tracked gap, nothing new or crash-prone (`coach.ts`/
    `policy.ts`'s `path[path.length - 1]` and `greedy.ts`/`mcts.ts`'s
    `t.win` checks are all safe on a length-1 path / always-false win).
  - Filed [#35](https://github.com/marcja/santorini/issues/35) for the
    apps/web Hermes gap; updated
    [#26](https://github.com/marcja/santorini/issues/26)'s stale "9 of 10"
    claim.
- **(this session) Investigated a suspected Pan bug — implementation
  confirmed correct, one new regression test added.** Marc recalled a
  possible incompleteness in Pan ("wins by moving down 2+ levels").
  Checked: rulebook text match, all 13 reachable from/to height-delta
  combinations (0–3, exhaustive probe script) against expected win/no-win,
  and cross-referenced the official BoardGameArena implementation doc
  (`"if your worker moves down two or more levels, you win"`, confirms
  level-3→level-1 wins) — all matched. The one interaction worth real
  scrutiny — "forced is not moved" (rulebook General Rules) applied to
  Pan specifically — was already handled correctly: Apollo's swap can
  geometrically never force a 2+ level descent (the swapper's own move
  legality caps the vacated square within 1 level of the target), and
  Minotaur's push (unrestricted "any level" landing, so it *can* force a
  2+ descent) correctly does not trigger Pan's win, since `isWinStep` is
  only ever evaluated for the mover's own step, never for a displaced
  worker. That specific interaction (Pan forced down 2+ by an opponent's
  Minotaur push) had zero test coverage before this session — added as a
  permanent regression test in `packages/engine/test/gods.test.ts` (now
  51/51 engine tests green) so a future refactor can't silently regress it.
  No code change to Pan itself was needed.

- **(this session) God-aware AI milestone: Phase 0 landed — configuration
  identity, guardrails, and the frozen encoding spec.** Plan reviewed and
  restructured into vertical slices (details + task DAG in
  `docs/milestones/god-ai.md`; the loop protocol there is the resumable
  driver for the whole milestone). Landed in one PR:
  - `GodConfig.tier` (`'simple' | 'advanced'`, advanced declared but
    unimplemented) + `.index` (rulebook 1–10) + `configTier(a, b)` →
    `'base' | 'simple' | 'advanced'` — the configuration identity ratings
    and training scope hang off (issue #26, scoped narrowly). 2 new engine
    tests (57 green).
  - `docs/TRAINING.md` § "When the rules surface grows" (issue #27):
    encoding bumps are checkpoint-format events; gen-007 pinned as the
    permanent base-game reference; god lineage restarts at
    `models/v2/gen-000` with eval types `mlp@2`/`pv@2`; ratings are
    configuration-scoped; ladder.json schema bump explicitly deferred to
    issue #22's follow-up; matchup-panel promotion rule; warm-start net
    surgery documented as the retrain-cost escape hatch.
  - `docs/milestones/god-ai-encoding-v2.md`: **frozen** v2 spec — features
    295 (v1's 175 + 2×56 god one-hot sized for the full 1–55 rulebook
    index + 2×4 state flags), policy = 6 factorized heads / 83 logits
    (incl. Hermes's other-worker head, so deferring Hermes is not a later
    format bump). Key analysis: Pan/Athena/Apollo/Minotaur/Artemis need
    **no** policy change (their turns are position-unambiguous under v1's
    225-way space), which is what makes the slice-1 "free five" trial
    possible before the policy work.
  - apps/web difficulty picker now labels Elo "(base game)" (issue #22's
    cheap half; verified in the in-app browser).
  - CLAUDE.md conventions: subagents may now implement rules/training-
    critical code inside driven loops, but only under three enforced
    guardrails (pre-written differential script, adversarial review
    Workflow for semantics changes, main-loop independent verification of
    diffs/tests); design decisions stay in the main loop.

## Next

**Sequencing decision (2026-07-11):** cap AI training at a bounded
intermediate goal, then switch to finishing the web game; return to
open-ended AI iteration (PUCT priors, more games/gen, better hardware)
afterward, informed by what slice 3 teaches us about in-browser constraints.
Rationale: nothing in web slices 2–4 depends on further AI strength — the
difficulty ladder wants *varied* strength and we already have calibrated
rungs (random 0 / mcts(200) 657 / greedy 808 / gen-003 903).

1. ~~TypeScript 7 upgrade~~ — done (PRs #1/#2, merged).
2. ~~Bounded AI goal~~ — done (gen-004/005 trained, `models/ladder.json`
   frozen; see Done above). PUCT priors / more games/gen / regularization
   remain deferred to the post-web return.
3. ~~Web slice 2: god-power selection UI + generic multi-step turn input~~ —
   done (see Done above). ~~Slice 2b: replay/analysis view~~ — done (see Done
   above). ~~God draft per rulebook (issue #7)~~ — done (see Done above);
   slice 2 is complete.
4. ~~Web slice 3: vs-AI play; AI-vs-AI at controllable rate~~ — done (see
   Done above).
5. ~~Web slice 4: coach layer~~ — done. ~~4a: threats/hints/move feedback~~
   (see Done above); ~~4b: lesson curriculum + richer plan narration~~ (see
   Done above). The web game teaching goal is feature-complete for now;
   polish (more lessons, god-specific exercises, richer god narration) can
   ride along future slices.
6. ~~Return to AI: PUCT priors (policy head over full-turn actions), more
   games/generation, regularization~~ — done (see Done above; all three
   levers landed and validated: gen-006/007, gauntlet 1001/1132).
7. ~~Keep the training loop turning~~ — superseded by the god-aware
   milestone below; base-game-lineage training is capped at gen-007
   (pinned as the permanent base-game reference, see TRAINING.md § "When
   the rules surface grows").
8. ~~File Hermes follow-ups~~ — done (#35 filed, #26 updated).
9. **Current milestone: god-aware AI retraining** (issues #17–#21, #26,
   #27, #35, #36). Phase 0 done (this session). The full task DAG, loop
   protocol, statuses, and frozen decisions live in
   **`docs/milestones/god-ai.md`** — that file (plus `gh pr list`) is the
   resumable state; start there. Next ready tasks: T1 (eval god-win fix),
   T2 (trainer `--gods` CLI), T3 (features v2), T10 (Hermes bench).
   Issues synced to the plan 2026-07-14: alignment comments on #17–#26 +
   #35/#36, #27 closed as delivered, god-draft AI filed as #39.
10. Follow-on milestone after that: ship the god-aware checkpoint to
    apps/web (coach repoint #24, ladder rungs, in-browser god-game
    verification, then #22 long-term/#23/#25).

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
