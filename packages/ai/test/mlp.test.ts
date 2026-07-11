import { parseSquareName } from '@santorini/engine';
import { describe, expect, it } from 'vitest';
import { FEATURE_COUNT, encodeFeatures } from '../src/features.ts';
import { Mlp, type Sample } from '../src/mlp.ts';
import { mulberry32 } from '../src/rng.ts';
import { pos } from './helpers.ts';

describe('features', () => {
  it('encodes one height bit per square and one bit per worker', () => {
    const state = pos({ heights: { b2: 1, c3: 3 }, p0: ['b2', 'd4'], p1: ['a5', 'e5'] });
    const x = encodeFeatures(state);
    expect(x.length).toBe(FEATURE_COUNT);
    const heightBits = x.slice(0, 125).reduce((n, v) => n + v, 0);
    expect(heightBits).toBe(25);
    expect(x[1 * 25 + parseSquareName('b2')]).toBe(1);
    expect(x[0 * 25 + parseSquareName('b2')]).toBe(0);
    expect(x[3 * 25 + parseSquareName('c3')]).toBe(1);
    expect(x.slice(125, 150).reduce((n, v) => n + v, 0)).toBe(2);
    expect(x.slice(150, 175).reduce((n, v) => n + v, 0)).toBe(2);
  });

  it('is mover-relative: swapping the player to move swaps worker planes', () => {
    const spec = { p0: ['b2', 'd4'] as [string, string], p1: ['a5', 'e5'] as [string, string] };
    const x0 = encodeFeatures(pos({ ...spec, player: 0 }));
    const x1 = encodeFeatures(pos({ ...spec, player: 1 }));
    expect([...x0.slice(125, 150)]).toEqual([...x1.slice(150, 175)]);
    expect([...x0.slice(150, 175)]).toEqual([...x1.slice(125, 150)]);
    expect([...x0.slice(0, 125)]).toEqual([...x1.slice(0, 125)]);
  });
});

describe('mlp', () => {
  it('init is deterministic per seed and round-trips through params', () => {
    expect(Mlp.init(8, 4, 42).toParams()).toEqual(Mlp.init(8, 4, 42).toParams());
    expect(Mlp.init(8, 4, 42).toParams()).not.toEqual(Mlp.init(8, 4, 43).toParams());

    const net = Mlp.init(8, 4, 42);
    const copy = new Mlp(net.toParams());
    const x = new Float32Array([1, 0, 1, 0, 0, 1, 0, 1]);
    expect(copy.forward(x)).toBeCloseTo(net.forward(x), 4);
  });

  it('rejects inconsistent param shapes', () => {
    const params = Mlp.init(8, 4, 1).toParams();
    expect(() => new Mlp({ ...params, w2: [1, 2] })).toThrow(/shape/);
  });

  it('learns XOR (gradient flows through the hidden layer)', () => {
    const rand = mulberry32(9);
    const samples: Sample[] = Array.from({ length: 256 }, () => {
      const a = rand() < 0.5 ? 1 : 0;
      const b = rand() < 0.5 ? 1 : 0;
      return { x: new Float32Array([a, b]), y: a ^ b };
    });
    const net = Mlp.init(2, 8, 3);
    const losses = net.train(samples, { epochs: 300, batchSize: 32, lr: 0.5, seed: 4 });
    expect(losses[losses.length - 1]).toBeLessThan(0.1);
    expect(losses[losses.length - 1]).toBeLessThan(losses[0]);
    expect(net.predict(new Float32Array([1, 0]))).toBeGreaterThan(0.9);
    expect(net.predict(new Float32Array([1, 1]))).toBeLessThan(0.1);
    expect(net.predict(new Float32Array([0, 0]))).toBeLessThan(0.1);
  });
});
