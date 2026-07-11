import { describe, expect, it } from 'vitest';
import { expectedScore, fitElo, performanceRating } from '../src/elo.ts';

describe('expectedScore', () => {
  it('is 0.5 at equal ratings and symmetric', () => {
    expect(expectedScore(1200, 1200)).toBeCloseTo(0.5);
    expect(expectedScore(1400, 1200) + expectedScore(1200, 1400)).toBeCloseTo(1);
  });

  it('gives ~0.909 at +400', () => {
    expect(expectedScore(400, 0)).toBeCloseTo(10 / 11, 3);
  });
});

describe('fitElo', () => {
  it('anchors and orders a transitive round-robin', () => {
    const ratings = fitElo(
      [
        { a: 'weak', b: 'mid', winsA: 10, winsB: 30, draws: 0 },
        { a: 'mid', b: 'strong', winsA: 10, winsB: 30, draws: 0 },
        { a: 'weak', b: 'strong', winsA: 3, winsB: 37, draws: 0 },
      ],
      { anchor: 'weak', anchorRating: 0 },
    );
    expect(ratings.weak).toBe(0);
    expect(ratings.mid).toBeGreaterThan(ratings.weak + 100);
    expect(ratings.strong).toBeGreaterThan(ratings.mid + 100);
  });

  it('recovers the Elo gap implied by a 75% score', () => {
    // 75% score ⇒ ~191 Elo; the virtual draw shrinks it slightly.
    const ratings = fitElo([{ a: 'a', b: 'b', winsA: 300, winsB: 100, draws: 0 }], {
      anchor: 'a',
    });
    expect(ratings.b).toBeLessThan(-150);
    expect(ratings.b).toBeGreaterThan(-230);
  });

  it('keeps an undefeated player finite', () => {
    const ratings = fitElo([{ a: 'a', b: 'b', winsA: 40, winsB: 0, draws: 0 }], { anchor: 'b' });
    expect(Number.isFinite(ratings.a)).toBe(true);
    expect(ratings.a).toBeGreaterThan(400);
  });

  it('scores draws as half wins', () => {
    const ratings = fitElo([{ a: 'a', b: 'b', winsA: 10, winsB: 10, draws: 20 }], { anchor: 'a' });
    expect(ratings.b).toBeCloseTo(0, 5);
  });
});

describe('performanceRating', () => {
  it('matches the opponent rating at a 50% score', () => {
    const r = performanceRating([{ opponent: 'x', rating: 1000, wins: 10, losses: 10, draws: 0 }]);
    expect(r).toBeCloseTo(1000, 0);
  });

  it('rates above a beaten pool and stays finite when unbeaten', () => {
    const swept = performanceRating([
      { opponent: 'x', rating: 0, wins: 20, losses: 0, draws: 0 },
      { opponent: 'y', rating: 300, wins: 20, losses: 0, draws: 0 },
    ]);
    expect(Number.isFinite(swept)).toBe(true);
    expect(swept).toBeGreaterThan(700);
  });

  it('weights opponents by games played', () => {
    const r = performanceRating([
      { opponent: 'x', rating: 0, wins: 1, losses: 1, draws: 0 },
      { opponent: 'y', rating: 800, wins: 50, losses: 50, draws: 0 },
    ]);
    expect(r).toBeGreaterThan(600);
  });
});
