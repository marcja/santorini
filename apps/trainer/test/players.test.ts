import { describe, expect, it } from 'vitest';
import { parsePlayerSpec, playerFromSpec, type Checkpoint } from '@santorini/ai';
import { runMatch } from '../src/run.ts';

// Spec-grammar tests live with the shared parser in @santorini/ai
// (packages/ai/test/spec.test.ts); this file covers the trainer's match runner.

const noCkpt = (path: string): Checkpoint => {
  throw new Error(`unexpected checkpoint load: ${path}`);
};

describe('runMatch', () => {
  it('is deterministic for a fixed seed and alternates seats', () => {
    const spec = parsePlayerSpec('random');
    const play = () =>
      runMatch(
        (s) => playerFromSpec(spec, s, noCkpt),
        (s) => playerFromSpec(spec, s, noCkpt),
        { games: 4, seed: 42 },
      );
    const first = play();
    const second = play();
    expect(second).toEqual(first);
    expect(first.games.map((g) => g.aSeat)).toEqual([0, 1, 0, 1]);
    expect(first.winsA + first.winsB + first.draws).toBe(4);
    for (const g of first.games) expect(g.sgn.length).toBeGreaterThanOrEqual(3);
  });
});
