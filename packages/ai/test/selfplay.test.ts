import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/eval.ts';
import { FEATURE_COUNT, FEATURE_COUNT_V2 } from '../src/features.ts';
import { ACTION_COUNT } from '../src/policy.ts';
import { selfPlay, type SelfPlayConfig } from '../src/selfplay.ts';

const CONFIG: SelfPlayConfig = {
  games: 2,
  seed: 5,
  search: { iterations: 16, c: 1.0, playoutDepth: 4 },
  evaluate,
  temperatureTurns: 4,
  maxHalfTurns: 80,
};

describe('selfPlay', () => {
  it('produces labeled samples for every play-phase position', () => {
    const { games, samples } = selfPlay(CONFIG);
    expect(games).toHaveLength(2);
    // Each game: 2 placement half-turns produce no samples; the rest do.
    const playHalfTurns = games.reduce((n, g) => n + g.sgn.length - 2, 0);
    expect(samples).toHaveLength(playHalfTurns);
    for (const s of samples) {
      expect(s.x.length).toBe(FEATURE_COUNT);
      expect([0, 0.5, 1]).toContain(s.y);
      // Policy targets: a normalized distribution over valid action indices.
      expect(s.actions.length).toBeGreaterThan(0);
      expect(s.actions.length).toBe(s.targets.length);
      expect(s.actions.length).toBe(new Set(s.actions).size);
      for (const a of s.actions) {
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThan(ACTION_COUNT);
      }
      expect(s.targets.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    }
    // Decided games label both perspectives, so wins and losses both appear.
    if (games.every((g) => g.winner !== null)) {
      expect(samples.some((s) => s.y === 1)).toBe(true);
      expect(samples.some((s) => s.y === 0)).toBe(true);
    }
  });

  it('is deterministic for a fixed seed and varies across seeds', () => {
    const a = selfPlay(CONFIG);
    const b = selfPlay(CONFIG);
    expect(a.games.map((g) => g.sgn)).toEqual(b.games.map((g) => g.sgn));
    expect(a.samples.map((s) => s.y)).toEqual(b.samples.map((s) => s.y));

    const c = selfPlay({ ...CONFIG, seed: 6 });
    expect(c.games.map((g) => g.sgn)).not.toEqual(a.games.map((g) => g.sgn));
  });
});

// T5 (issue #17 thin slice): gods threaded to createInitialState, and
// samples switch to feature encoding v2 only when explicitly requested
// (mirroring how a v2 parent checkpoint's eval type drives cli.ts's choice
// — see checkpoint.ts's mlp@2/pv@2 dispatch).
describe('selfPlay with gods', () => {
  it('defaults every game to the base game (no gods) when omitted', () => {
    const { games } = selfPlay(CONFIG);
    for (const g of games) expect(g.gods).toEqual(['none', 'none']);
  });

  it('threads a fixed god pair to every game and its samples', () => {
    const { games } = selfPlay({ ...CONFIG, gods: ['pan', 'athena'] });
    for (const g of games) expect(g.gods).toEqual(['pan', 'athena']);
  });

  it('stays v1-width (175) by default even under a god config — a v1 ' +
    'parent has no god-aware planes regardless of what gods are played', () => {
    const { samples } = selfPlay({
      ...CONFIG,
      gods: ['pan', 'athena'],
      games: 3,
    });
    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) expect(s.x.length).toBe(FEATURE_COUNT);
  });

  it('encodes 295-wide (v2) samples when featureEncoding is v2, independent of gods', () => {
    const { samples } = selfPlay({
      ...CONFIG,
      games: 3,
      featureEncoding: 'v2',
    });
    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) expect(s.x.length).toBe(FEATURE_COUNT_V2);
  });

  it('produces v2 samples for a god game too', () => {
    const { samples } = selfPlay({
      ...CONFIG,
      games: 3,
      gods: ['minotaur', 'apollo'],
      featureEncoding: 'v2',
    });
    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) expect(s.x.length).toBe(FEATURE_COUNT_V2);
  });
});
