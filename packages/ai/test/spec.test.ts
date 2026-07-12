import { describe, expect, it } from 'vitest';
import { createCheckpoint, parsePlayerSpec, playerFromSpec, specName, type Checkpoint } from '../src/index.ts';

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

describe('playerFromSpec', () => {
  it('builds a checkpoint player via the loader', () => {
    const ckpt = createCheckpoint('2026-07-11T00:00:00Z', { generation: 2 });
    const player = playerFromSpec(
      { kind: 'ckpt', path: 'models/gen-002.json', iterations: 10 },
      7,
      () => ckpt,
    );
    expect(player.name).toBe('gen-2');
  });

  it('never touches the loader for baseline kinds', () => {
    const noCkpt = (path: string): Checkpoint => {
      throw new Error(`unexpected checkpoint load: ${path}`);
    };
    expect(playerFromSpec({ kind: 'random' }, 1, noCkpt).name).toBe('random');
    expect(playerFromSpec({ kind: 'greedy' }, 1, noCkpt).name).toBe('greedy');
    expect(playerFromSpec({ kind: 'mcts', iterations: 50 }, 1, noCkpt).name).toBe('mcts(50)');
  });
});
