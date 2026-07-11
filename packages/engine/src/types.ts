import type { Square } from './board.ts';

export type Player = 0 | 1;

export type GodId =
  | 'none'
  | 'apollo'
  | 'artemis'
  | 'athena'
  | 'atlas'
  | 'demeter'
  | 'hephaestus'
  | 'minotaur'
  | 'pan'
  | 'prometheus';

export type Phase = 'setup' | 'play' | 'over';

export interface GameState {
  /** 25 cells, 0..3 = block level, 4 = dome. */
  heights: Uint8Array;
  /** [p0w0, p0w1, p1w0, p1w1]; square index or -1 if unplaced. */
  workers: Int8Array;
  /** Player to move. */
  player: Player;
  phase: Phase;
  winner: Player | null;
  /** Half-turn counter (each player's completed turn increments it). */
  turn: number;
  gods: [GodId, GodId];
  /** True if the Athena owner moved up on their last turn. */
  athenaUp: boolean;
}

export interface BuildAction {
  at: Square;
  /** True when this build places a dome (normal on level 3; Atlas at any level). */
  dome: boolean;
}

export interface PlaceTurn {
  kind: 'place';
  /** Squares for the mover's workers 0 and 1, in placement order. */
  squares: [Square, Square];
}

export interface MoveTurn {
  kind: 'move';
  /** Which of the mover's two workers (0 or 1). */
  worker: 0 | 1;
  /** Squares visited, starting square first. Length >= 2. */
  path: Square[];
  /** Builds after moving. Empty iff `win`. */
  builds: BuildAction[];
  /** Builds before moving (Prometheus). */
  preBuilds?: BuildAction[];
  /** True when this turn wins instantly (no builds follow). */
  win: boolean;
}

export type Turn = PlaceTurn | MoveTurn;
