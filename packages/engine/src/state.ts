import { CELLS } from './board.ts';
import type { GameState, GodId, Player } from './types.ts';

export interface GameOptions {
  gods?: [GodId, GodId];
}

export function createInitialState(opts: GameOptions = {}): GameState {
  return {
    heights: new Uint8Array(CELLS),
    workers: new Int8Array([-1, -1, -1, -1]),
    player: 0,
    phase: 'setup',
    winner: null,
    turn: 1,
    gods: opts.gods ?? ['none', 'none'],
    athenaUp: false,
  };
}

export function cloneState(s: GameState): GameState {
  return {
    heights: s.heights.slice(),
    workers: s.workers.slice(),
    player: s.player,
    phase: s.phase,
    winner: s.winner,
    turn: s.turn,
    gods: s.gods,
    athenaUp: s.athenaUp,
  };
}

/** Occupancy map: worker index 0..3 per square, or -1. */
export function occupancy(s: GameState): Int8Array {
  const occ = new Int8Array(CELLS).fill(-1);
  for (let i = 0; i < 4; i++) {
    const sq = s.workers[i];
    if (sq >= 0) occ[sq] = i;
  }
  return occ;
}

/** Worker index 0..3 at a square, or -1. */
export function workerAt(s: GameState, sq: number): number {
  for (let i = 0; i < 4; i++) if (s.workers[i] === sq) return i;
  return -1;
}

export const ownerOf = (workerIndex: number): Player => (workerIndex >> 1) as Player;
