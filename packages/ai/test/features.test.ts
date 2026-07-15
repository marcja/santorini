import { describe, expect, it } from 'vitest';
import { GOD_IDS, GODS, type GodId } from '@santorini/engine';
import {
  FEATURE_COUNT_V2,
  GOD_ONE_HOT_COUNT,
  GOD_STATE_FLAG_COUNT,
  godOneHotIndex,
  MAX_GOD_INDEX,
  MOVER_FLAGS_OFFSET,
  MOVER_GOD_OFFSET,
  OPPONENT_FLAGS_OFFSET,
  OPPONENT_GOD_OFFSET,
  V1_FEATURE_COUNT,
} from '../src/encoding.ts';
import {
  FEATURE_COUNT,
  SYMMETRY_MAPS,
  augmentSamples,
  encodeFeatures,
  encodeFeaturesV2,
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

// --- Feature encoding v2 (issue #18) ---------------------------------------

const asymmetricGods = (gods: [GodId, GodId], athenaUp = false) =>
  pos({
    heights: { a1: 1, b1: 2, c3: 3, d4: 1, e5: 4 },
    p0: ['b2', 'c1'],
    p1: ['d5', 'e2'],
    player: 1,
    gods,
    athenaUp,
  });

describe('encoding.ts layout constants', () => {
  it('FEATURE_COUNT_V2 is 295, and offsets match the frozen manifest', () => {
    expect(V1_FEATURE_COUNT).toBe(175);
    expect(GOD_ONE_HOT_COUNT).toBe(56); // slot 0 = none + 55 rulebook indices
    expect(MAX_GOD_INDEX).toBe(55);
    expect(GOD_STATE_FLAG_COUNT).toBe(4);
    expect(MOVER_GOD_OFFSET).toBe(175);
    expect(OPPONENT_GOD_OFFSET).toBe(231);
    expect(MOVER_FLAGS_OFFSET).toBe(287);
    expect(OPPONENT_FLAGS_OFFSET).toBe(291);
    expect(FEATURE_COUNT_V2).toBe(295);
  });

  it('godOneHotIndex: none is slot 0, every other god is its rulebook index', () => {
    expect(godOneHotIndex('none')).toBe(0);
    for (const id of GOD_IDS) {
      if (id === 'none') continue;
      expect(godOneHotIndex(id)).toBe(GODS[id].index);
      expect(GODS[id].index).toBeGreaterThanOrEqual(1);
      expect(GODS[id].index).toBeLessThanOrEqual(MAX_GOD_INDEX);
    }
  });
});

describe('encodeFeaturesV2', () => {
  it('has the v1 prefix bit-identical to encodeFeatures, regardless of god assignment', () => {
    const godPairs: [GodId, GodId][] = [
      ['none', 'none'],
      ['pan', 'none'],
      ['athena', 'apollo'],
      ['demeter', 'hephaestus'],
    ];
    for (const gods of godPairs) {
      const state = asymmetricGods(gods);
      const v1 = encodeFeatures(state);
      const v2 = encodeFeaturesV2(state);
      expect(v2).toHaveLength(FEATURE_COUNT_V2);
      expect([...v2.slice(0, FEATURE_COUNT)]).toEqual([...v1]);
    }
  });

  it('encodes both sides god one-hots, mover then opponent', () => {
    const state = asymmetricGods(['pan', 'athena']); // player 1 to move: mover=athena, opponent=pan
    const x = encodeFeaturesV2(state);
    expect(x[MOVER_GOD_OFFSET + GODS.athena.index!]).toBe(1);
    expect(x[OPPONENT_GOD_OFFSET + GODS.pan.index!]).toBe(1);
    // Every other god one-hot slot on both sides is 0.
    for (let i = 0; i < GOD_ONE_HOT_COUNT; i++) {
      if (i !== GODS.athena.index) expect(x[MOVER_GOD_OFFSET + i]).toBe(0);
      if (i !== GODS.pan.index) expect(x[OPPONENT_GOD_OFFSET + i]).toBe(0);
    }
  });

  it('none/none one-hots both land on slot 0', () => {
    const x = encodeFeaturesV2(asymmetricGods(['none', 'none']));
    expect(x[MOVER_GOD_OFFSET + 0]).toBe(1);
    expect(x[OPPONENT_GOD_OFFSET + 0]).toBe(1);
  });

  it('Athena flag fires only for the side that holds Athena and only when athenaUp is set', () => {
    // player 1 to move; player 0 (opponent) holds Athena.
    const blocked = asymmetricGods(['athena', 'none'], true);
    const notBlocked = asymmetricGods(['athena', 'none'], false);
    expect(encodeFeaturesV2(blocked)[MOVER_FLAGS_OFFSET]).toBe(0);
    expect(encodeFeaturesV2(blocked)[OPPONENT_FLAGS_OFFSET]).toBe(1);
    expect(encodeFeaturesV2(notBlocked)[OPPONENT_FLAGS_OFFSET]).toBe(0);

    // player 1 to move; player 1 (mover) holds Athena instead.
    const moverHasAthena = asymmetricGods(['none', 'athena'], true);
    expect(encodeFeaturesV2(moverHasAthena)[MOVER_FLAGS_OFFSET]).toBe(1);
    expect(encodeFeaturesV2(moverHasAthena)[OPPONENT_FLAGS_OFFSET]).toBe(0);
  });

  // Both sides holding the same god is unreachable in a real game (each god
  // card is unique — rulebook §"choose a God Power"/place it — so no two
  // players can ever hold Athena simultaneously), but the encoder's type
  // signature does not forbid it and must not crash or silently misbehave.
  // `athenaFlag` is derived from a single engine-wide `state.athenaUp` bit
  // gated on "does this side hold Athena", so when BOTH sides hold Athena
  // that gate is true for both sides at once and the two flags necessarily
  // collapse to the same value — this test locks in that (documented,
  // spec-unaddressed) degenerate behavior rather than leaving it uncovered.
  it('both-Athena: mover and opponent flags necessarily collapse to the same value', () => {
    for (const athenaUp of [true, false]) {
      const state = asymmetricGods(['athena', 'athena'], athenaUp);
      const x = encodeFeaturesV2(state);
      expect(x[MOVER_FLAGS_OFFSET]).toBe(x[OPPONENT_FLAGS_OFFSET]);
      expect(x[MOVER_FLAGS_OFFSET]).toBe(athenaUp ? 1 : 0);
    }
  });

  it('reserved state flags (1-3) are always zero', () => {
    const x = encodeFeaturesV2(asymmetricGods(['athena', 'pan'], true));
    for (const k of [1, 2, 3]) {
      expect(x[MOVER_FLAGS_OFFSET + k]).toBe(0);
      expect(x[OPPONENT_FLAGS_OFFSET + k]).toBe(0);
    }
  });

  it('a pan-vs-none and a none-vs-none state with an IDENTICAL board encode differently', () => {
    const board = {
      heights: { b2: 1, c3: 2 },
      p0: ['b3', 'd3'] as [string, string],
      p1: ['a1', 'e5'] as [string, string],
      player: 0 as const,
    };
    const panVsNone = encodeFeaturesV2(pos({ ...board, gods: ['pan', 'none'] }));
    const noneVsNone = encodeFeaturesV2(pos({ ...board, gods: ['none', 'none'] }));
    expect([...panVsNone]).not.toEqual([...noneVsNone]);
    // The spatial prefix (board-derived) is identical; only the god suffix differs.
    expect([...panVsNone.slice(0, FEATURE_COUNT)]).toEqual([
      ...noneVsNone.slice(0, FEATURE_COUNT),
    ]);
  });
});

describe('transformFeatures (v2)', () => {
  it('permutes the spatial prefix and passes the god/state suffix through unchanged, for all 8 symmetries', () => {
    const state = asymmetricGods(['pan', 'athena'], true);
    const x = encodeFeaturesV2(state);
    const suffix = [...x.slice(FEATURE_COUNT)];
    for (let s = 0; s < 8; s++) {
      const map = SYMMETRY_MAPS[s];
      const mirrored = pos({
        p0: ['a1', 'a2'],
        p1: ['a3', 'a4'],
        player: state.player,
        gods: state.gods,
        athenaUp: state.athenaUp,
      });
      mirrored.heights.fill(0);
      for (let sq = 0; sq < 25; sq++) mirrored.heights[map[sq]] = state.heights[sq];
      for (let i = 0; i < 4; i++) mirrored.workers[i] = map[state.workers[i]];
      const transformed = transformFeatures(x, s);
      expect(transformed).toHaveLength(FEATURE_COUNT_V2);
      expect([...transformed]).toEqual([...encodeFeaturesV2(mirrored)]);
      // The suffix specifically never moves, independent of the mirrored check above.
      expect([...transformed.slice(FEATURE_COUNT)]).toEqual(suffix);
    }
  });

  it('is the identity for s=0 on a v2 vector', () => {
    const x = encodeFeaturesV2(asymmetricGods(['demeter', 'hephaestus']));
    expect([...transformFeatures(x, 0)]).toEqual([...x]);
  });
});

describe('augmentSamples (v2)', () => {
  it('emits 8 variants that all keep the same god/state suffix', () => {
    const x = encodeFeaturesV2(asymmetricGods(['pan', 'athena'], true));
    const suffix = [...x.slice(FEATURE_COUNT)];
    const out = augmentSamples([{ x, y: 1 }]);
    expect(out).toHaveLength(8);
    for (const sample of out) {
      expect(sample.x).toHaveLength(FEATURE_COUNT_V2);
      expect([...sample.x.slice(FEATURE_COUNT)]).toEqual(suffix);
    }
    // Spatial prefixes still vary across the 8 symmetries (asymmetric board).
    const prefixKeys = new Set(out.map((s) => s.x.slice(0, FEATURE_COUNT).join(',')));
    expect(prefixKeys.size).toBe(8);
  });
});
