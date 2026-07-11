import { describe, expect, it } from 'vitest';
import { legalTurns, turnKey } from '@santorini/engine';
import { GreedyPlayer, MctsPlayer, RandomPlayer, playMatch, resolveTurn } from '../src/index.ts';
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

  it('beats random', () => {
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
