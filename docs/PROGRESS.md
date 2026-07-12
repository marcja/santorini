# Progress

_Last updated: 2026-07-12 (session 12)_

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
7. Keep the training loop turning (optional, cheap): **the full recipe,
   decision rules, app-shipping steps, and plateau levers are documented in
   `docs/TRAINING.md`** — one `trainer train` command per generation
   (~15 min + eval), stop after two consecutive failures to beat the
   parent. Watch in-browser Expert latency (PUCT pays a policy forward per
   expansion, roughly 2× per move — fine today); a web worker becomes
   worthwhile if budgets rise ~10×.

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
