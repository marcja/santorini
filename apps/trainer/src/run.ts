import { type AiPlayer, resolveTurn } from '@santorini/ai';
import type { Player } from '@santorini/engine';
import {
  createInitialState,
  formatSGN,
  formatTurn,
  legalTurns,
} from '@santorini/engine';

export interface RunConfig {
  games: number;
  /** Base seed; game i hands seed+2i to A and seed+2i+1 to B. */
  seed: number;
  /** Games longer than this are scored as draws. */
  maxHalfTurns?: number;
}

export interface GameLog {
  /** null = draw (half-turn cap). */
  winner: Player | null;
  /** Seat player A occupied this game. */
  aSeat: Player;
  /** SGN turn strings in play order. */
  sgn: string[];
}

export interface RunResult {
  winsA: number;
  winsB: number;
  draws: number;
  games: GameLog[];
}

/**
 * Play one game to completion (or the half-turn cap) with fresh players
 * (players carry RNG state; reconstructing keeps every game independently
 * reproducible).
 */
function playOneGame(
  makeA: (seed: number) => AiPlayer,
  makeB: (seed: number) => AiPlayer,
  seed: number,
  aSeat: Player,
  maxHalfTurns: number,
): GameLog {
  const a = makeA(seed);
  const b = makeB(seed + 1);
  const seats: [AiPlayer, AiPlayer] = aSeat === 0 ? [a, b] : [b, a];

  let state = createInitialState();
  const sgn: string[] = [];
  let winner: Player | null = null;
  while (state.phase !== 'over' && sgn.length < maxHalfTurns) {
    if (legalTurns(state).length === 0) {
      // Defensive: resolveTurn normally settles this before we get here.
      winner = (1 - state.player) as Player;
      break;
    }
    const turn = seats[state.player].chooseTurn(state);
    sgn.push(formatTurn(state, turn));
    state = resolveTurn(state, turn);
  }
  if (state.phase === 'over') winner = state.winner;
  return { winner, aSeat, sgn };
}

/**
 * Play a seeded match, alternating seats. Records each game in SGN for
 * later replay/training.
 */
export function runMatch(
  makeA: (seed: number) => AiPlayer,
  makeB: (seed: number) => AiPlayer,
  config: RunConfig,
  onGame?: (game: GameLog, index: number) => void,
): RunResult {
  const maxHalfTurns = config.maxHalfTurns ?? 400;
  const result: RunResult = { winsA: 0, winsB: 0, draws: 0, games: [] };
  for (let i = 0; i < config.games; i++) {
    const aSeat = (i % 2) as Player;
    const game = playOneGame(
      makeA,
      makeB,
      config.seed + 2 * i,
      aSeat,
      maxHalfTurns,
    );
    result.games.push(game);
    if (game.winner === null) result.draws++;
    else if (game.winner === aSeat) result.winsA++;
    else result.winsB++;
    onGame?.(game, i);
  }
  return result;
}

/** Format one logged game as an SGN document. */
export function gameToSgn(
  game: GameLog,
  nameA: string,
  nameB: string,
  event: string,
): string {
  const players: [string, string] =
    game.aSeat === 0 ? [nameA, nameB] : [nameB, nameA];
  const result = game.winner === null ? '*' : game.winner === 0 ? '1-0' : '0-1';
  return formatSGN(
    { Event: event, Player1: players[0], Player2: players[1], Result: result },
    game.sgn,
  );
}
