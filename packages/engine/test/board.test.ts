import { describe, expect, it } from 'vitest';
import { NEIGHBORS, parseSquareName, pushSquare, squareName } from '../src/index.ts';

const sq = parseSquareName;

describe('board geometry', () => {
  it('names squares a1..e5', () => {
    expect(squareName(0)).toBe('a1');
    expect(squareName(24)).toBe('e5');
    expect(sq('c3')).toBe(12);
    for (let i = 0; i < 25; i++) expect(sq(squareName(i))).toBe(i);
  });

  it('rejects invalid square names', () => {
    for (const bad of ['f1', 'a6', 'a0', 'c', 'c33', '']) {
      expect(() => sq(bad)).toThrow();
    }
  });

  it('computes 8-neighborhoods with board edges', () => {
    expect(NEIGHBORS[sq('a1')]).toHaveLength(3);
    expect(NEIGHBORS[sq('c1')]).toHaveLength(5);
    expect(NEIGHBORS[sq('c3')]).toHaveLength(8);
    expect([...NEIGHBORS[sq('a1')]].sort((a, b) => a - b)).toEqual(
      [sq('b1'), sq('a2'), sq('b2')].sort((a, b) => a - b),
    );
  });

  it('computes Minotaur push squares (straight backwards)', () => {
    expect(pushSquare(sq('b2'), sq('c3'))).toBe(sq('d4'));
    expect(pushSquare(sq('c4'), sq('c5'))).toBe(-1); // off the board
    expect(pushSquare(sq('b1'), sq('a1'))).toBe(-1);
    expect(pushSquare(sq('c3'), sq('c2'))).toBe(sq('c1'));
  });
});
