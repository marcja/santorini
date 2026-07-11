# SGN — Santorini Game Notation

A chess-inspired plain-text notation to document, annotate, and replay games.

## Squares

Columns `a`–`e` (left→right), rows `1`–`5` (near→far, from Player 1's seat).
`a1` is Player 1's near-left corner; `e5` the far-right.

## Game record

PGN-style header tags, then numbered rounds. Each round number is followed by
Player 1's turn then Player 2's turn.

```
[Event "casual"]
[Player1 "Marc"]
[Player2 "AI gen-12"]
[God1 "Artemis"]
[God2 "Pan"]
[Result "1-0"]

1. b2,c3 c4,d2 2. c3-c2^c1 d2-d3^c3 3. ...
```

`[Result]` is `1-0`, `0-1`, or `*` (unfinished). `[God1]`/`[God2]` omitted or
`None` for the base game.

## Turns

**Placement turn** (first turn for each player): the two squares, comma-joined,
in the order placed — worker index 0 first: `b2,c3`.

**Normal turn**: movement segment, then build segment(s).

- Movement: `from-to`, e.g. `c3-c2`. Multi-step moves (Artemis, Triton, …)
  chain: `c3-c2-d1`.
- Build: `^` + square, e.g. `^c1`. Extra builds (Demeter, Hephaestus, …)
  append: `^c1^d1`. Hephaestus's double block on one square is written twice:
  `^c1^c1`.
- Explicit dome (Atlas, when the build is *not* on level 3): suffix `D`,
  e.g. `^c1D`. Domes completed normally on level 3 need no marker.
- Pre-move builds (Prometheus) come *before* the movement segment: `^b3c3-c2^c1`.
- Winning move: suffix `#` on the whole turn: `c2-c3#`. A winning turn has no
  build segment (the game ends instantly).
- A turn where the mover has no legal move (loss) is recorded by the Result;
  there is no token for it.

Which worker moved is implied by the `from` square (workers are uniquely
positioned). Forced relocations of *opponent* workers (Apollo swap, Minotaur
push) are implied by the rules + god context and are not written; replayers
must apply them.

## Annotations

- `{...}` comments may follow any turn.
- `!`, `?`, `!!`, `??`, `!?`, `?!` may suffix a turn before any comment
  (strong, weak, brilliant, blunder, interesting, dubious).

## Examples

Base game, Player 1 wins:

```
[Result "1-0"]
1. b2,d2 b4,d4 2. b2-b3^b2 b4-c4^c5 3. d2-c2^b2 {threatens the b2 tower}
   c4-c3^b3? 4. b3-b2^a2! c3-d3^d2 5. b2-b3#
```

Atlas dome and Artemis double move:

```
[God1 "Atlas"] [God2 "Artemis"]
2. b2-b3^c3D c4-c3-d3^d4
```
