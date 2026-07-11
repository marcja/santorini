import {
  createInitialState,
  formatTurn,
  legalTurns,
  parseSquareName,
  type GameState,
  type GodId,
  type Player,
  type Turn,
} from '../src/index.ts';

export interface Position {
  /** e.g. { b2: 1, c3: 3 } — unlisted squares are level 0. */
  heights?: Record<string, number>;
  /** Worker squares: p0 and p1 each get up to two square names. */
  p0: [string, string];
  p1: [string, string];
  player?: Player;
  gods?: [GodId, GodId];
  athenaUp?: boolean;
}

/** Build a mid-game state declaratively (phase = 'play'). */
export function pos(spec: Position): GameState {
  const s = createInitialState({ gods: spec.gods ?? ['none', 'none'] });
  s.phase = 'play';
  s.player = spec.player ?? 0;
  s.athenaUp = spec.athenaUp ?? false;
  for (const [name, level] of Object.entries(spec.heights ?? {})) {
    s.heights[parseSquareName(name)] = level;
  }
  const all = [...spec.p0, ...spec.p1];
  all.forEach((name, i) => {
    s.workers[i] = parseSquareName(name);
  });
  return s;
}

/** Legal turns rendered as SGN strings, sorted — convenient for assertions. */
export function turnStrings(state: GameState): string[] {
  return legalTurns(state)
    .map((t) => formatTurn(state, t))
    .sort();
}

export function findTurn(state: GameState, sgn: string): Turn | undefined {
  return legalTurns(state).find((t) => formatTurn(state, t) === sgn);
}
