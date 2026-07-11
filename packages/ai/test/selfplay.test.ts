import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/eval.ts';
import { FEATURE_COUNT } from '../src/features.ts';
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
