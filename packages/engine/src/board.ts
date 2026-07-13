// Board geometry for the 5x5 Santorini island.
// Squares are indices 0..24; a1 = 0 (col a, row 1), e5 = 24.

export const SIZE = 5;
export const CELLS = 25;

/** Board square index, 0..24. */
export type Square = number;

export const colOf = (sq: Square): number => sq % SIZE;
export const rowOf = (sq: Square): number => Math.floor(sq / SIZE);
export const square = (col: number, row: number): Square => row * SIZE + col;

/** The 8 compass offsets, excluding (0, 0), in the original row-major scan order. */
const DELTAS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

function neighborsOf(sq: Square): Square[] {
  const c = colOf(sq);
  const r = rowOf(sq);
  const n: Square[] = [];
  for (const [dc, dr] of DELTAS) {
    const cc = c + dc;
    const rr = r + dr;
    if (cc >= 0 && cc < SIZE && rr >= 0 && rr < SIZE) n.push(square(cc, rr));
  }
  return n;
}

/** Precomputed 8-neighborhoods. */
export const NEIGHBORS: readonly (readonly Square[])[] = Array.from(
  { length: CELLS },
  (_, sq) => neighborsOf(sq),
);

/**
 * The space "one space straight backwards" when a worker on `to` is pushed
 * away from `from` (Minotaur). Returns -1 if off the board.
 */
export function pushSquare(from: Square, to: Square): Square {
  const c = 2 * colOf(to) - colOf(from);
  const r = 2 * rowOf(to) - rowOf(from);
  return c >= 0 && c < SIZE && r >= 0 && r < SIZE ? square(c, r) : -1;
}

const FILES = 'abcde';

export const squareName = (sq: Square): string =>
  FILES[colOf(sq)] + String(rowOf(sq) + 1);

export function parseSquareName(s: string): Square {
  const col = FILES.indexOf(s[0]);
  const row = s.charCodeAt(1) - 49; // '1'
  if (s.length !== 2 || col < 0 || row < 0 || row >= SIZE) {
    throw new Error(`invalid square: ${JSON.stringify(s)}`);
  }
  return square(col, row);
}
