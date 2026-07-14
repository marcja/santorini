import type { GodId } from '@santorini/engine';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EVAL_WEIGHTS, evaluate } from '../src/index.ts';
import { pos } from './helpers.ts';

// All positions below plant the worker under test on c3 (center) so the
// centrality term is identical across height-2 vs height-3 comparisons,
// and keep every other worker parked on a corner (not a neighbor of c3)
// so the climb-adjacency term stays at 0 too. That isolates the
// height-score term the fix for issue #20 targets.
const scoreAt = (level: number, gods: [GodId, GodId]) =>
  evaluate(
    pos({
      heights: { c3: level },
      p0: ['c3', 'a1'],
      p1: ['e5', 'e1'],
      gods,
    }),
    0,
    DEFAULT_EVAL_WEIGHTS,
  );

describe('evaluate — god-specific win-condition height terms (issue #20)', () => {
  describe('Pan (winOnDescend2)', () => {
    it('does not score level 3 below level 2 for the Pan player', () => {
      // Standing on level 3 keeps the descend-2-or-more win threat live
      // (a drop to level 1 or level 0 both qualify) — it must not be
      // scored worse than level 2, unlike the base-game heuristic.
      const l2 = scoreAt(2, ['pan', 'none']);
      const l3 = scoreAt(3, ['pan', 'none']);
      expect(l3).toBeGreaterThanOrEqual(l2);
    });

    it('leaves level 0/1/2 scoring untouched for the Pan player', () => {
      expect(scoreAt(0, ['pan', 'none'])).toBe(scoreAt(0, ['none', 'none']));
      expect(scoreAt(1, ['pan', 'none'])).toBe(scoreAt(1, ['none', 'none']));
      expect(scoreAt(2, ['pan', 'none'])).toBe(scoreAt(2, ['none', 'none']));
    });

    it('does not affect the opponent-side height term when the opponent has Pan', () => {
      // gods=[none, pan]: the worker under eval (p0, on c3) has no god;
      // only the *other* seat is Pan. Its own height term is unaffected.
      const l2 = scoreAt(2, ['none', 'pan']);
      const l3 = scoreAt(3, ['none', 'pan']);
      expect(l3).toBeLessThan(l2);
      expect(l2).toBe(scoreAt(2, ['none', 'none']));
      expect(l3).toBe(scoreAt(3, ['none', 'none']));
    });
  });

  describe('Athena (blocksOpponentUp)', () => {
    it('still scores level 3 below level 2 — win condition is still level-3-based', () => {
      const l2 = scoreAt(2, ['athena', 'none']);
      const l3 = scoreAt(3, ['athena', 'none']);
      expect(l3).toBeLessThan(l2);
    });

    it('is byte-identical to the base game (no eval change for Athena)', () => {
      for (const level of [0, 1, 2, 3]) {
        expect(scoreAt(level, ['athena', 'none'])).toBe(
          scoreAt(level, ['none', 'none']),
        );
      }
    });
  });

  describe('Atlas (domeAnyLevel)', () => {
    it('still scores level 3 below level 2 — win condition is still level-3-based', () => {
      const l2 = scoreAt(2, ['atlas', 'none']);
      const l3 = scoreAt(3, ['atlas', 'none']);
      expect(l3).toBeLessThan(l2);
    });

    it('is byte-identical to the base game (no eval change for Atlas)', () => {
      for (const level of [0, 1, 2, 3]) {
        expect(scoreAt(level, ['atlas', 'none'])).toBe(
          scoreAt(level, ['none', 'none']),
        );
      }
    });
  });
});
