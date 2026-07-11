import type { GameState, Turn } from '@santorini/engine';
import { applyTurn, hasLegalTurn } from '@santorini/engine';

/**
 * A synchronous move chooser. `state` must have at least one legal turn
 * (callers resolve the no-legal-turn loss before asking).
 */
export interface AiPlayer {
  readonly name: string;
  chooseTurn(state: GameState): Turn;
}

/**
 * Apply a turn and resolve the "next player cannot move+build" loss,
 * matching Game.play semantics (applyTurn alone skips that check).
 */
export function resolveTurn(state: GameState, turn: Turn): GameState {
  const next = applyTurn(state, turn);
  if (next.phase === 'play' && !hasLegalTurn(next)) {
    next.phase = 'over';
    next.winner = state.player;
  }
  return next;
}
