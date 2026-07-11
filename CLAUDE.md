# Santorini

Web game teaching two-player Santorini strategy + self-trained AI opponent.
TypeScript monorepo (npm workspaces): `packages/engine` (headless rules),
`packages/ai` + `apps/trainer` (self-play AI, offline), `apps/web` (game UI).

## Session recovery — read these first

- `docs/PROGRESS.md` — current state, what works, next steps. **Update it
  before ending a work session.**
- `docs/PLAN.md` — deliverable roadmap and architecture decisions.
- `docs/NOTATION.md` — SGN game notation spec (engine implements this).

## Ground truth for rules

`docs/reference/rulebook.txt` and `docs/reference/god-powers-detailed.txt`
(text extracted from official PDFs in `references/`). When a rule question
arises, grep these files — do not rely on memory. Key subtleties already
learned:

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
- UI changes are not done until played through the in-app browser
  (screenshot + clicks), not just typechecked.
- Delegate mechanical, well-specified work (bulk test writing, doc extraction,
  repetitive refactors) to Sonnet subagents; keep design and rules-critical
  code in the main loop.

## Mistake log (append when a lesson is learned)

- macOS here has no poppler/pdftotext; a pypdf venv lives in the scratchpad.
  PDF text is already extracted to `docs/reference/*.txt` — use those.
