import type { GameState, GodId, Player } from '@santorini/engine';
import { createInitialState, parseSquareName } from '@santorini/engine';

export interface Position {
  /** e.g. { b2: 1, c3: 3 } — unlisted squares are level 0. */
  heights?: Record<string, number>;
  p0: [string, string];
  p1: [string, string];
  player?: Player;
  gods?: [GodId, GodId];
}

/** Build a mid-game state declaratively (phase = 'play'). */
export function pos(spec: Position): GameState {
  const s = createInitialState({ gods: spec.gods ?? ['none', 'none'] });
  s.phase = 'play';
  s.player = spec.player ?? 0;
  for (const [name, level] of Object.entries(spec.heights ?? {})) {
    s.heights[parseSquareName(name)] = level;
  }
  [...spec.p0, ...spec.p1].forEach((name, i) => {
    s.workers[i] = parseSquareName(name);
  });
  return s;
}
