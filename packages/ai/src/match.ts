import type { GodId, Player, Turn } from '@santorini/engine';
import { createInitialState, legalTurns } from '@santorini/engine';
import { resolveTurn, type AiPlayer } from './player.ts';

export interface GameConfig {
  gods?: [GodId, GodId];
  /** Games longer than this are scored as draws. */
  maxHalfTurns?: number;
}

export interface GameResult {
  /** null = draw (hit the half-turn cap). */
  winner: Player | null;
  turns: Turn[];
}

/** Play one game between two players. Trusts players to return legal turns. */
export function playGame(players: [AiPlayer, AiPlayer], config: GameConfig = {}): GameResult {
  const maxHalfTurns = config.maxHalfTurns ?? 400;
  let state = createInitialState({ gods: config.gods });
  const turns: Turn[] = [];
  while (state.phase !== 'over') {
    if (turns.length >= maxHalfTurns) return { winner: null, turns };
    if (legalTurns(state).length === 0) {
      // Defensive: resolveTurn normally settles this before we get here.
      return { winner: (1 - state.player) as Player, turns };
    }
    const turn = players[state.player].chooseTurn(state);
    turns.push(turn);
    state = resolveTurn(state, turn);
  }
  return { winner: state.winner, turns };
}

export interface MatchResult {
  /** Wins for [a, b] regardless of seat. */
  wins: [number, number];
  draws: number;
}

/** Play `games` games between a and b, alternating who moves first. */
export function playMatch(
  a: AiPlayer,
  b: AiPlayer,
  games: number,
  config: GameConfig = {},
): MatchResult {
  const result: MatchResult = { wins: [0, 0], draws: 0 };
  for (let i = 0; i < games; i++) {
    const aSeat = (i % 2) as Player;
    const seats: [AiPlayer, AiPlayer] = aSeat === 0 ? [a, b] : [b, a];
    const { winner } = playGame(seats, config);
    if (winner === null) result.draws++;
    else if (winner === aSeat) result.wins[0]++;
    else result.wins[1]++;
  }
  return result;
}
