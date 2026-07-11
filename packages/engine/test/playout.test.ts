import { describe, expect, it } from 'vitest';
import { GOD_IDS, occupancy, type GodId } from '../src/index.ts';
import { randomGame } from './random.ts';

function checkInvariants(gods: [GodId, GodId], seed: number): void {
  const game = randomGame(gods, seed);
  // Games always terminate with a winner (every turn builds or wins).
  expect(game.isOver).toBe(true);
  expect(game.winner === 0 || game.winner === 1).toBe(true);
  for (let i = 0; i <= game.turns.length; i++) {
    const s = game.stateAt(i);
    for (let sq = 0; sq < 25; sq++) {
      expect(s.heights[sq]).toBeGreaterThanOrEqual(0);
      expect(s.heights[sq]).toBeLessThanOrEqual(4);
    }
    const placed = [...s.workers].filter((w) => w >= 0);
    expect(new Set(placed).size).toBe(placed.length); // workers never overlap
    for (const w of placed) {
      expect(s.heights[w]).toBeLessThan(4); // never standing on a dome
    }
    occupancy(s); // must not throw
  }
}

describe('random playout invariants', () => {
  it('base game terminates cleanly across many seeds', { timeout: 60_000 }, () => {
    for (let seed = 1; seed <= 25; seed++) checkInvariants(['none', 'none'], seed);
  });

  it('every god vs base game', { timeout: 60_000 }, () => {
    for (const god of GOD_IDS) {
      for (let seed = 1; seed <= 5; seed++) {
        checkInvariants([god, 'none'], seed);
        checkInvariants(['none', god], seed + 100);
      }
    }
  });

  it('all god pairings', { timeout: 60_000 }, () => {
    const gods = GOD_IDS.filter((g) => g !== 'none');
    for (const g1 of gods) {
      for (const g2 of gods) {
        if (g1 === g2) continue; // matching gods aren't used in real play
        checkInvariants([g1, g2], 7);
      }
    }
  });
});
