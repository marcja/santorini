// Board geometry for the 5x5 Santorini island.
// Squares are indices 0..24; a1 = 0 (col a, row 1), e5 = 24.

export const SIZE = 5;
export const CELLS = 25;

/** Board square index, 0..24. */
export type Square = number;

export const colOf = (sq: Square): number => sq % SIZE;
export const rowOf = (sq: Square): number => Math.floor(sq / SIZE);
export const square = (col: number, row: number): Square => row * SIZE + col;

/** Precomputed 8-neighborhoods. */
export const NEIGHBORS: readonly (readonly Square[])[] = (() => {
  const out: Square[][] = [];
  for (let sq = 0; sq < CELLS; sq++) {
    const c = colOf(sq);
    const r = rowOf(sq);
    const n: Square[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc === 0 && dr === 0) continue;
        const cc = c + dc;
        const rr = r + dr;
        if (cc >= 0 && cc < SIZE && rr >= 0 && rr < SIZE)
          n.push(square(cc, rr));
      }
    }
    out.push(n);
  }
  return out;
})();

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
