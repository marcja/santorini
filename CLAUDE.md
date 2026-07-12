# Santorini

Web game teaching two-player Santorini strategy + self-trained AI opponent.
TypeScript monorepo (npm workspaces): `packages/engine` (headless rules),
`packages/ai` + `apps/trainer` (self-play AI, offline), `apps/web` (game UI).

## Session recovery — read these first

- `docs/PROGRESS.md` — current state, what works, next steps. **Update it
  before ending a work session.**
- `docs/PLAN.md` — deliverable roadmap and architecture decisions. **Its
  checkboxes must stay in sync with PROGRESS.md — reconcile them in the same
  commit whenever PROGRESS.md changes.** A PostToolUse hook in
  `.claude/settings.json` reminds you on every PROGRESS.md edit.
- `docs/NOTATION.md` — SGN game notation spec (engine implements this).

## Ground truth for rules

`docs/reference/rulebook.md` (reformatted from the official rulebook PDF;
covers base rules plus the full 1–55 god/hero power index). When a rule
question arises, grep this file — do not rely on memory. Key subtleties
already learned:

- Win = your worker **moves up** onto level 3 (from 2). A worker *forced*
  onto level 3 (Apollo/Minotaur/etc.) does NOT win; L3→L3 moves do NOT win.
- You must complete move-then-build; if you can't, you lose. A winning move
  ends the game instantly with no build.
- Domes are not blocks. God text saying "block" excludes domes.
- Athena's block applies only if she actually moved up on her *last* turn.

## Commands

- `npm test` — all workspace tests (vitest). `npm test -w @santorini/engine` for one package.
- `npm run typecheck` — tsc over all packages.
- Web dev server: use `.claude/launch.json` name `web` via the browser
  preview tools (never `npm run dev` in raw Bash — it blocks).

## Conventions

- Engine is pure & synchronous; the atomic action is a **complete turn**
  (move+build+extras), not a single step. No I/O in `packages/engine`.
- Gods are generator plugins in `packages/engine/src/gods/`; base rules
  never special-case a god by name outside that directory.
- Small, narrative commits. Vertical slices over horizontal layers.
- Work on branches/worktrees and merge via PRs — never commit directly to
  `main` (protected). Branch names: `chore/…`, `feat/…`, `fix/…`.
- UI changes are not done until played through the in-app browser
  (screenshot + clicks), not just typechecked.
- Delegate mechanical, well-specified work (bulk test writing, doc extraction,
  repetitive refactors) to Sonnet subagents; keep design and rules-critical
  code in the main loop.

## Mistake log (append when a lesson is learned)

- macOS here has no poppler/pdftotext; a pypdf venv lives in the scratchpad.
  PDF text is already extracted to `docs/reference/*.txt` — use those.
- The in-app browser viewport can reflow between screenshots (layout
  breakpoint change), silently shifting click coordinates. Before a long
  scripted click sequence, take a fresh screenshot and recalibrate; verify
  state (page text or screenshot) every few actions, and prefer reading the
  on-page SGN record to confirm the engine received the intended moves.
- Shell cwd persists across Bash calls in a session; don't assume repo root —
  use absolute paths for git/npm commands.
- Running `npm test` while heavy trainer jobs run in the background can flake
  search-heavy tests past vitest's 5s default timeout. Rerun quietly (or wait
  for the jobs) before believing a failure; give multi-game tests explicit
  `{ timeout: ... }` headroom.
- Don't judge AI-player strength on 6-game matches: during MCTS tuning,
  6-game samples flipped the mcts-vs-greedy conclusion twice. Use ≥20 seeded
  games (scratchpad probe scripts) before believing a strength delta, and
  set test thresholds well below the observed win rate.
