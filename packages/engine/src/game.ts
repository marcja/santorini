import { applyTurn } from './apply.ts';
import { GODS, godIdByName } from './gods/index.ts';
import { legalTurns } from './movegen.ts';
import {
  formatSGN,
  formatTurn,
  parseSGN,
  parseTurn,
  turnKey,
} from './notation.ts';
import { createInitialState, type GameOptions } from './state.ts';
import type { GameState, GodId, Player, Turn } from './types.ts';

/**
 * Stateful convenience wrapper over the pure engine: validates turns,
 * resolves the no-legal-turn loss, records history and SGN.
 * Search code should use legalTurns/applyTurn directly.
 */
export class Game {
  private states: GameState[];
  readonly turns: Turn[] = [];
  readonly turnStrings: string[] = [];
  headers: Record<string, string> = {};

  constructor(opts: GameOptions = {}) {
    this.states = [createInitialState(opts)];
  }

  /** Start a game from an arbitrary position (testing, puzzles, analysis). */
  static fromState(state: GameState): Game {
    const game = new Game();
    game.states = [state];
    return game;
  }

  get state(): GameState {
    return this.states[this.states.length - 1];
  }

  /** Position before turn index i (0-based); stateAt(0) is the initial state. */
  stateAt(i: number): GameState {
    return this.states[i];
  }

  legalTurns(): Turn[] {
    return legalTurns(this.state);
  }

  /** Play a turn (object or SGN string). Throws if illegal. */
  play(turn: Turn | string): Turn {
    const state = this.state;
    const t = typeof turn === 'string' ? parseTurn(state, turn) : turn;
    const key = turnKey(t);
    const match = legalTurns(state).find((lt) => turnKey(lt) === key);
    if (!match)
      throw new Error(
        `illegal turn: ${typeof turn === 'string' ? turn : formatTurn(state, t)}`,
      );
    const next = applyTurn(state, match);
    // "You must always perform a move then build on your turn. If you are
    // unable to, you lose."
    if (next.phase === 'play' && legalTurns(next).length === 0) {
      next.phase = 'over';
      next.winner = state.player;
    }
    this.turnStrings.push(formatTurn(state, match));
    this.turns.push(match);
    this.states.push(next);
    return match;
  }

  undo(): boolean {
    if (this.turns.length === 0) return false;
    this.states.pop();
    this.turns.pop();
    this.turnStrings.pop();
    return true;
  }

  get isOver(): boolean {
    return this.state.phase === 'over';
  }

  get winner(): Player | null {
    return this.state.winner;
  }

  toSGN(extraHeaders: Record<string, string> = {}): string {
    const headers: Record<string, string> = {
      ...this.headers,
      ...extraHeaders,
    };
    const [g0, g1] = this.states[0].gods;
    if (g0 !== 'none' || g1 !== 'none') {
      headers.God1 = GODS[g0].name;
      headers.God2 = GODS[g1].name;
    }
    headers.Result =
      this.winner === 0 ? '1-0' : this.winner === 1 ? '0-1' : '*';
    return formatSGN(headers, this.turnStrings);
  }

  static fromSGN(text: string): Game {
    const { headers, turns } = parseSGN(text);
    const gods: [GodId, GodId] = [
      godIdByName(headers.God1 ?? 'none'),
      godIdByName(headers.God2 ?? 'none'),
    ];
    const game = new Game({ gods });
    game.headers = headers;
    for (const t of turns) game.play(t);
    return game;
  }
}
