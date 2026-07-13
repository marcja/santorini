import { pushSquare } from './board.ts';
import type { GodConfig } from './gods/index.ts';
import { GODS } from './gods/index.ts';
import { cloneState, workerAt } from './state.ts';
import type {
  BuildAction,
  GameState,
  MoveTurn,
  PlaceTurn,
  Player,
  Turn,
} from './types.ts';

/**
 * Apply a turn, mutating the state. Trusted fast path: the turn must come
 * from legalTurns (or be validated by the caller, e.g. Game.play).
 *
 * Note: this does NOT detect the "next player has no legal turn" loss —
 * callers decide when to pay for that check (Game.play does it).
 */
export function applyTurnInPlace(s: GameState, t: Turn): void {
  if (s.phase === 'over') throw new Error('game is over');
  if (t.kind === 'place') {
    applyPlacement(s, t);
    return;
  }
  applyMove(s, t);
}

function applyPlacement(s: GameState, t: PlaceTurn): void {
  if (s.phase !== 'setup')
    throw new Error('placement only allowed during setup');
  const base = s.player * 2;
  s.workers[base] = t.squares[0];
  s.workers[base + 1] = t.squares[1];
  if (s.player === 1) {
    s.phase = 'play';
    s.player = 0;
  } else {
    s.player = 1;
  }
  s.turn++;
}

function applyMove(s: GameState, t: MoveTurn): void {
  const p = s.player;
  const cfg = GODS[s.gods[p]];
  if (t.preBuilds) for (const b of t.preBuilds) build(s, b);

  // Hermes turns where the other worker also moved are the only case that
  // needs the direct-jump path below (see its doc comment) — a Hermes turn
  // where only the primary worker moved (including a normal up/down move,
  // which can win) replays fine through the ordinary step-by-step path.
  if (t.otherPath) {
    applyHermesMove(s, t);
    return;
  }

  const wi = p * 2 + t.worker;
  let movedUp = false;
  for (let i = 0; i + 1 < t.path.length; i++) {
    if (stepWorker(s, cfg, wi, t.path[i], t.path[i + 1])) movedUp = true;
  }

  if (t.win) {
    s.phase = 'over';
    s.winner = p;
    s.turn++;
    return;
  }

  for (const b of t.builds) build(s, b);
  if (cfg.blocksOpponentUp) s.athenaUp = movedUp;
  s.player = (1 - p) as Player;
  s.turn++;
}

/**
 * Hermes turns where the other worker also moved (MoveTurn.otherPath):
 * both workers reposition flat, never displacing anyone and never
 * changing height, so only the final square matters — jump straight there
 * instead of stepping. Necessary specifically here (not for a solo
 * multi-hop chain) because movegen may have explored the two workers'
 * paths in either order, so intermediate squares can be transiently
 * "occupied" by each other in an order this trusted fast path doesn't
 * replay. Never wins (flat moves never change height), so no win check.
 */
function applyHermesMove(s: GameState, t: MoveTurn): void {
  const p = s.player;
  const owi = p * 2 + ((1 - t.worker) as 0 | 1);
  s.workers[owi] = t.otherPath![t.otherPath!.length - 1];
  s.workers[p * 2 + t.worker] = t.path[t.path.length - 1];
  for (const b of t.builds) build(s, b);
  s.player = (1 - p) as Player;
  s.turn++;
}

/** Move the worker one step, resolving any opponent displacement. Returns whether it moved up. */
function stepWorker(
  s: GameState,
  cfg: GodConfig,
  wi: number,
  from: number,
  to: number,
): boolean {
  const occIdx = workerAt(s, to);
  if (occIdx >= 0) {
    if (cfg.allowOpp === 'swap') s.workers[occIdx] = from;
    else if (cfg.allowOpp === 'push') s.workers[occIdx] = pushSquare(from, to);
    else throw new Error('illegal move into an occupied square');
  }
  const movedUp = s.heights[to] > s.heights[from];
  s.workers[wi] = to;
  return movedUp;
}

function build(s: GameState, b: BuildAction): void {
  s.heights[b.at] = b.dome ? 4 : s.heights[b.at] + 1;
}

/** Pure variant of applyTurnInPlace. */
export function applyTurn(s: GameState, t: Turn): GameState {
  const next = cloneState(s);
  applyTurnInPlace(next, t);
  return next;
}
