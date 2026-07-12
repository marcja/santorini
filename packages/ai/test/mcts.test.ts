import { describe, expect, it } from 'vitest';
import { legalTurns, turnKey } from '@santorini/engine';
import { GreedyPlayer, MctsPlayer, RandomPlayer, playMatch, resolveTurn } from '../src/index.ts';
import { turnAction, type PolicyFn } from '../src/policy.ts';
import { pos } from './helpers.ts';

const winInOne = () =>
  pos({ heights: { b2: 2, c3: 3 }, p0: ['b2', 'a1'], p1: ['d5', 'e5'] });

const mustBlock = () =>
  pos({ heights: { d4: 2, e4: 3 }, p0: ['e3', 'a1'], p1: ['d4', 'a5'] });

describe('MctsPlayer', () => {
  it('finds a win-in-1', () => {
    const t = new MctsPlayer({ iterations: 200, seed: 42 }).chooseTurn(winInOne());
    expect(t.kind === 'move' && t.win).toBe(true);
  });

  it('blocks the opponent’s immediate win', () => {
    const s = mustBlock();
    const t = new MctsPlayer({ iterations: 1000, seed: 42 }).chooseTurn(s);
    const next = resolveTurn(s, t);
    const oppWins = legalTurns(next).filter((ot) => ot.kind === 'move' && ot.win);
    expect(oppWins).toHaveLength(0);
  });

  it('exposes coherent search statistics', () => {
    const s = mustBlock();
    const result = new MctsPlayer({ iterations: 300, seed: 7 }).search(s);
    expect(result.visits).toBe(300);
    const childVisits = result.children.reduce((sum, ch) => sum + ch.visits, 0);
    expect(childVisits).toBe(300);
    // Sorted by visits, values are win rates, PV starts with the chosen turn.
    for (let i = 1; i < result.children.length; i++) {
      expect(result.children[i].visits).toBeLessThanOrEqual(result.children[i - 1].visits);
    }
    for (const ch of result.children) {
      expect(ch.value).toBeGreaterThanOrEqual(0);
      expect(ch.value).toBeLessThanOrEqual(1);
    }
    expect(turnKey(result.pv[0])).toBe(turnKey(result.turn));
  });

  it('is deterministic for a given seed', () => {
    const s = mustBlock();
    const a = new MctsPlayer({ iterations: 150, seed: 9 }).chooseTurn(s);
    const b = new MctsPlayer({ iterations: 150, seed: 9 }).chooseTurn(s);
    expect(turnKey(a)).toBe(turnKey(b));
  });

  it('beats random', { timeout: 30_000 }, () => {
    const result = playMatch(
      new MctsPlayer({ iterations: 150, seed: 3 }),
      new RandomPlayer(4),
      4,
    );
    expect(result.wins[0]).toBe(4);
  });

  it('beats greedy', { timeout: 120_000 }, () => {
    // Observed 10-2 at these seeds; the threshold leaves margin so eval
    // tweaks don't flip the test while still requiring clear superiority.
    const result = playMatch(
      new MctsPlayer({ iterations: 2000, seed: 5 }),
      new GreedyPlayer(6),
      12,
    );
    expect(result.wins[0]).toBeGreaterThanOrEqual(8);
  });
});

describe('MctsPlayer with policy priors (PUCT)', () => {
  const uniform: PolicyFn = (_state, turns) =>
    new Float64Array(turns.length).fill(1 / turns.length);

  it('steers visits toward high-prior turns', () => {
    const s = pos({ p0: ['b2', 'd2'], p1: ['b4', 'd4'] });
    const turns = legalTurns(s);
    const favorite = turnKey(turns[7]);
    // A flat evaluator: nothing but the prior differentiates the turns.
    const policy: PolicyFn = (_state, legal) => {
      const priors = new Float64Array(legal.length).fill(0.5 / (legal.length - 1));
      priors[legal.findIndex((t) => turnKey(t) === favorite)] = 0.5;
      return priors;
    };
    const result = new MctsPlayer({
      iterations: 400,
      seed: 3,
      policy,
      evaluate: () => 0,
    }).search(s);
    expect(turnKey(result.turn)).toBe(favorite);
    expect(result.children[0].visits).toBeGreaterThan(result.visits / 4);
  });

  it('still finds a win-in-1 and blocks a loss under misleading priors', () => {
    // Priors uniform (worst case: no tactical help) — the solver and values
    // must still get the tactics right.
    const t = new MctsPlayer({ iterations: 200, seed: 42, policy: uniform }).chooseTurn(winInOne());
    expect(t.kind === 'move' && t.win).toBe(true);

    const s = mustBlock();
    const block = new MctsPlayer({ iterations: 1000, seed: 42, policy: uniform }).chooseTurn(s);
    const oppWins = legalTurns(resolveTurn(s, block)).filter((ot) => ot.kind === 'move' && ot.win);
    expect(oppWins).toHaveLength(0);
  });

  it('handles positions the policy declines (placement) and stays deterministic', () => {
    const setup = pos({ p0: ['b2', 'd2'], p1: ['b4', 'd4'] });
    setup.phase = 'setup';
    setup.workers.fill(-1);
    const policy: PolicyFn = (state, turns) =>
      state.phase === 'play' ? new Float64Array(turns.length).fill(1 / turns.length) : null;
    const a = new MctsPlayer({ iterations: 60, seed: 9, policy }).chooseTurn(setup);
    const b = new MctsPlayer({ iterations: 60, seed: 9, policy }).chooseTurn(setup);
    expect(a.kind).toBe('place');
    expect(turnKey(a)).toBe(turnKey(b));
  });

  it('search statistics stay coherent under PUCT', () => {
    const s = mustBlock();
    const policy: PolicyFn = (_state, turns) => {
      // Skew priors by action index — arbitrary but deterministic and nonuniform.
      const raw = turns.map((t) => 1 + ((turnAction(t) ?? 0) % 5));
      const sum = raw.reduce((a, b) => a + b, 0);
      return Float64Array.from(raw, (v) => v / sum);
    };
    const result = new MctsPlayer({ iterations: 300, seed: 7, policy }).search(s);
    expect(result.visits).toBe(300);
    const childVisits = result.children.reduce((sum, ch) => sum + ch.visits, 0);
    expect(childVisits).toBeLessThanOrEqual(300);
    for (const ch of result.children) {
      expect(ch.value).toBeGreaterThanOrEqual(0);
      expect(ch.value).toBeLessThanOrEqual(1);
    }
    expect(turnKey(result.pv[0])).toBe(turnKey(result.turn));
  });
});
