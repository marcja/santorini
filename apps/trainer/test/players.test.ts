import { describe, expect, it } from 'vitest';
import { createCheckpoint, type Checkpoint } from '@santorini/ai';
import { makePlayer, parsePlayerSpec, specName } from '../src/players.ts';
import { runMatch } from '../src/run.ts';

const noCkpt = (path: string): Checkpoint => {
  throw new Error(`unexpected checkpoint load: ${path}`);
};

describe('parsePlayerSpec', () => {
  it('parses the four kinds', () => {
    expect(parsePlayerSpec('random')).toEqual({ kind: 'random' });
    expect(parsePlayerSpec('greedy')).toEqual({ kind: 'greedy' });
    expect(parsePlayerSpec('mcts:500,c=1.4,depth=6')).toEqual({
      kind: 'mcts',
      iterations: 500,
      c: 1.4,
      playoutDepth: 6,
    });
    expect(parsePlayerSpec('ckpt:models/gen-000.json,iters=2000')).toEqual({
      kind: 'ckpt',
      path: 'models/gen-000.json',
      iterations: 2000,
    });
  });

  it('rejects malformed specs', () => {
    expect(() => parsePlayerSpec('mcts')).toThrow(/iterations/);
    expect(() => parsePlayerSpec('mcts:abc')).toThrow(/invalid/);
    expect(() => parsePlayerSpec('mcts:100,depth')).toThrow(/invalid player option/);
    expect(() => parsePlayerSpec('mcts:100,foo=1')).toThrow(/unknown option/);
    expect(() => parsePlayerSpec('alphazero')).toThrow(/unknown player kind/);
    expect(() => parsePlayerSpec('ckpt')).toThrow(/path/);
  });

  it('names players for reports', () => {
    expect(specName(parsePlayerSpec('mcts:500'))).toBe('mcts(500)');
    const ckpt = createCheckpoint('2026-07-11T00:00:00Z', { generation: 3 });
    expect(specName(parsePlayerSpec('ckpt:x.json'), ckpt)).toBe('gen-3');
  });
});

describe('makePlayer + runMatch', () => {
  it('builds a checkpoint player via the loader', () => {
    const ckpt = createCheckpoint('2026-07-11T00:00:00Z', { generation: 2 });
    const player = makePlayer(
      { kind: 'ckpt', path: 'models/gen-002.json', iterations: 10 },
      7,
      () => ckpt,
    );
    expect(player.name).toBe('gen-2');
  });

  it('is deterministic for a fixed seed and alternates seats', () => {
    const spec = parsePlayerSpec('random');
    const play = () =>
      runMatch(
        (s) => makePlayer(spec, s, noCkpt),
        (s) => makePlayer(spec, s, noCkpt),
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
