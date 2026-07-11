# Progress

_Last updated: 2026-07-11 (session 1)_

## Done

- Extracted official rulebook + detailed god cards to `docs/reference/*.txt`.
- Plan (`docs/PLAN.md`), notation spec (`docs/NOTATION.md`), CLAUDE.md.

## In flight

- Deliverable 1: engine (base rules → notation → gods).

## Next

1. Engine: base rules + tests.
2. SGN notation implementation + round-trip tests.
3. God framework + simple gods (Apollo, Artemis, Athena, Atlas, Demeter,
   Hephaestus, Minotaur, Pan, Prometheus; Hermes deferred — combinatorial
   both-workers movement needs its own design pass).
4. Web slice 1: pass-and-play UI, verified by playing in browser.
5. Then: AI baselines (random/greedy), MCTS, training harness.

## Decisions / notes

- TS monorepo, engine pure, full-turn atomic actions (see PLAN.md).
- Node v25, npm 11 on this machine.
