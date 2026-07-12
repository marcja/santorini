import { describe, expect, it } from 'vitest';
import { legalTurns, parseSquareName, type GameState, type Turn } from '@santorini/engine';
import { SYMMETRY_MAPS, encodeFeatures } from '../src/features.ts';
import {
  ACTION_COUNT,
  augmentPvSamples,
  policyPriors,
  transformAction,
  turnAction,
} from '../src/policy.ts';
import { pos } from './helpers.ts';

const sq = parseSquareName;

const asymmetric = () =>
  pos({
    heights: { a1: 1, b1: 2, c3: 1, d4: 1, e5: 3 },
    p0: ['b2', 'c1'],
    p1: ['d5', 'e2'],
  });

/** The same position with squares permuted by symmetry map s. */
function mirrored(state: GameState, s: number): GameState {
  const map = SYMMETRY_MAPS[s];
  const m = pos({ p0: ['a1', 'a2'], p1: ['a3', 'a4'], player: state.player });
  m.heights.fill(0);
  for (let i = 0; i < 25; i++) m.heights[map[i]] = state.heights[i];
  for (let i = 0; i < 4; i++) m.workers[i] = map[state.workers[i]];
  return m;
}

describe('turnAction', () => {
  it('encodes destination and build direction', () => {
    const turn: Turn = {
      kind: 'move',
      worker: 0,
      path: [sq('b2'), sq('c3')],
      builds: [{ at: sq('b3'), dome: false }],
      win: false,
    };
    // to = c3 = 12; build delta (dc=-1, dr=0) → code 3.
    expect(turnAction(turn)).toBe(12 * 9 + 3);
  });

  it('encodes a winning move with the no-build code', () => {
    const turn: Turn = { kind: 'move', worker: 1, path: [sq('b2'), sq('c3')], builds: [], win: true };
    expect(turnAction(turn)).toBe(12 * 9 + 4);
  });

  it('uses the final square of a multi-step path (Artemis)', () => {
    const turn: Turn = {
      kind: 'move',
      worker: 0,
      path: [sq('a1'), sq('b2'), sq('c3')],
      builds: [{ at: sq('c4'), dome: false }],
      win: false,
    };
    // to = c3 = 12; build c4 is straight up (dc=0, dr=1) → code 7.
    expect(turnAction(turn)).toBe(12 * 9 + 7);
  });

  it('returns null for placements', () => {
    expect(turnAction({ kind: 'place', squares: [sq('b2'), sq('c3')] })).toBeNull();
  });

  it('maps every legal play turn into range, colliding only on shared (to, build)', () => {
    const turns = legalTurns(asymmetric());
    const actions = turns.map(turnAction);
    for (const a of actions) {
      expect(a).not.toBeNull();
      expect(a!).toBeGreaterThanOrEqual(0);
      expect(a!).toBeLessThan(ACTION_COUNT);
    }
    // Two turns share an action iff they share destination + build square
    // (either worker reaching the same summary counts as one action).
    const keys = turns.map((t) => {
      if (t.kind !== 'move') throw new Error('play phase');
      return `${t.path[t.path.length - 1]}|${t.win ? 'win' : t.builds[0].at}`;
    });
    expect(new Set(actions).size).toBe(new Set(keys).size);
  });
});

describe('transformAction', () => {
  it('is the identity for s=0', () => {
    for (const t of legalTurns(asymmetric())) {
      const a = turnAction(t)!;
      expect(transformAction(a, 0)).toBe(a);
    }
  });

  it('matches encoding the legal turns of the mirrored state', () => {
    const state = asymmetric();
    const actions = legalTurns(state).map((t) => turnAction(t)!);
    for (let s = 0; s < 8; s++) {
      const mirroredActions = new Set(legalTurns(mirrored(state, s)).map((t) => turnAction(t)!));
      expect(new Set(actions.map((a) => transformAction(a, s)))).toEqual(mirroredActions);
    }
  });
});

describe('policyPriors', () => {
  it('is a probability distribution favoring higher logits', () => {
    const turns = legalTurns(asymmetric());
    const logits = new Float64Array(ACTION_COUNT);
    const boosted = turnAction(turns[3])!;
    logits[boosted] = 2;
    const priors = policyPriors(turns, logits);
    expect(priors.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    for (let i = 0; i < turns.length; i++) {
      if (i === 3) continue;
      expect(priors[3]).toBeGreaterThan(priors[i]);
    }
  });

  it('is uniform for all-zero logits', () => {
    const turns = legalTurns(asymmetric());
    const priors = policyPriors(turns, new Float64Array(ACTION_COUNT));
    for (const p of priors) expect(p).toBeCloseTo(1 / turns.length, 10);
  });
});

describe('augmentPvSamples', () => {
  it('transforms features and actions together, preserving targets', () => {
    const state = asymmetric();
    const turns = legalTurns(state);
    const actions = [turnAction(turns[0])!, turnAction(turns[5])!];
    const out = augmentPvSamples([
      { x: encodeFeatures(state), y: 1, actions, targets: [0.75, 0.25] },
    ]);
    expect(out).toHaveLength(8);
    expect(out[0].actions).toEqual(actions);
    for (let s = 0; s < 8; s++) {
      expect(out[s].y).toBe(1);
      expect(out[s].targets).toEqual([0.75, 0.25]);
      expect(out[s].actions).toEqual(actions.map((a) => transformAction(a, s)));
      expect([...out[s].x]).toEqual([...encodeFeatures(mirrored(state, s))]);
    }
  });
});
