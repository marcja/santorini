import { describe, expect, it } from 'vitest';
import {
  FEATURE_COUNT,
  SYMMETRY_MAPS,
  augmentSamples,
  encodeFeatures,
  transformFeatures,
} from '../src/features.ts';
import { pos } from './helpers.ts';

// An asymmetric position: no symmetry other than the identity fixes it.
const asymmetric = () =>
  pos({
    heights: { a1: 1, b1: 2, c3: 3, d4: 1, e5: 4 },
    p0: ['b2', 'c1'],
    p1: ['d5', 'e2'],
    player: 1,
  });

describe('SYMMETRY_MAPS', () => {
  it('has 8 maps, each a permutation of 0..24, identity first', () => {
    expect(SYMMETRY_MAPS).toHaveLength(8);
    for (const map of SYMMETRY_MAPS) {
      expect([...map].sort((a, b) => a - b)).toEqual([...Array(25).keys()]);
    }
    expect([...SYMMETRY_MAPS[0]]).toEqual([...Array(25).keys()]);
  });

  it('maps 1-3 are the 90° rotation iterated; map 1 applied 4 times is the identity', () => {
    const rot = SYMMETRY_MAPS[1];
    let composed = [...Array(25).keys()];
    for (let k = 1; k <= 4; k++) {
      composed = composed.map((sq) => rot[sq]);
      if (k < 4) expect(composed).toEqual([...SYMMETRY_MAPS[k]]);
    }
    expect(composed).toEqual([...SYMMETRY_MAPS[0]]);
  });

  it('all 8 maps are distinct', () => {
    const keys = new Set(SYMMETRY_MAPS.map((m) => m.join(',')));
    expect(keys.size).toBe(8);
  });
});

describe('transformFeatures', () => {
  it('matches encoding the symmetric state directly', () => {
    const state = asymmetric();
    const x = encodeFeatures(state);
    for (let s = 0; s < 8; s++) {
      const map = SYMMETRY_MAPS[s];
      const mirrored = pos({ p0: ['a1', 'a2'], p1: ['a3', 'a4'], player: state.player });
      mirrored.heights.fill(0);
      for (let sq = 0; sq < 25; sq++) mirrored.heights[map[sq]] = state.heights[sq];
      for (let i = 0; i < 4; i++) mirrored.workers[i] = map[state.workers[i]];
      expect([...transformFeatures(x, s)]).toEqual([...encodeFeatures(mirrored)]);
    }
  });

  it('is the identity for s=0', () => {
    const x = encodeFeatures(asymmetric());
    expect([...transformFeatures(x, 0)]).toEqual([...x]);
  });
});

describe('augmentSamples', () => {
  it('emits 8 variants per sample, original first, labels preserved', () => {
    const x = encodeFeatures(asymmetric());
    const out = augmentSamples([{ x, y: 1 }, { x, y: 0.5 }]);
    expect(out).toHaveLength(16);
    expect([...out[0].x]).toEqual([...x]);
    expect(out.slice(0, 8).every((s) => s.y === 1)).toBe(true);
    expect(out.slice(8).every((s) => s.y === 0.5)).toBe(true);
    // Asymmetric position → all 8 variants distinct, each a valid encoding.
    const keys = new Set(out.slice(0, 8).map((s) => s.x.join(',')));
    expect(keys.size).toBe(8);
    for (const s of out) {
      expect(s.x).toHaveLength(FEATURE_COUNT);
      expect(s.x.reduce((n, v) => n + v, 0)).toBe(25 + 4); // 25 height one-hots + 4 workers
    }
  });
});
