import { describe, expect, it } from 'vitest';
import { legalTurns, turnKey } from '@santorini/engine';
import { GreedyPlayer, RandomPlayer, playMatch, resolveTurn } from '../src/index.ts';
import { pos } from './helpers.ts';

// Player 0's b2 worker stands on level 2 next to a level-3 tower.
const winInOne = () =>
  pos({ heights: { b2: 2, c3: 3 }, p0: ['b2', 'a1'], p1: ['d5', 'e5'] });

// Player 1's d4 worker (level 2) threatens to win on e4 (level 3) next turn;
// player 0's only defense is to dome e4 (reachable from d3).
const mustBlock = () =>
  pos({ heights: { d4: 2, e4: 3 }, p0: ['e3', 'a1'], p1: ['d4', 'a5'] });

describe('resolveTurn', () => {
  it('awards the win when the opponent is left without a legal turn', () => {
    // Both p1 workers are walled in by domes; any p0 turn smothers them.
    const s = pos({
      heights: { a2: 4, b1: 4, b2: 4, a4: 4, b5: 4, b4: 4 },
      p0: ['d3', 'e3'],
      p1: ['a1', 'a5'],
    });
    const next = resolveTurn(s, legalTurns(s)[0]);
    expect(next.phase).toBe('over');
    expect(next.winner).toBe(0);
  });
});

describe('RandomPlayer', () => {
  it('is deterministic for a given seed and returns legal turns', () => {
    const s = winInOne();
    const legal = new Set(legalTurns(s).map(turnKey));
    const a = new RandomPlayer(7).chooseTurn(s);
    const b = new RandomPlayer(7).chooseTurn(s);
    expect(legal.has(turnKey(a))).toBe(true);
    expect(turnKey(a)).toBe(turnKey(b));
  });
});

describe('GreedyPlayer', () => {
  it('takes an immediate win', () => {
    const t = new GreedyPlayer().chooseTurn(winInOne());
    expect(t.kind === 'move' && t.win).toBe(true);
  });

  it('blocks the opponent’s immediate win', () => {
    const s = mustBlock();
    const next = resolveTurn(s, new GreedyPlayer().chooseTurn(s));
    const oppWins = legalTurns(next).filter((t) => t.kind === 'move' && t.win);
    expect(oppWins).toHaveLength(0);
  });

  it('convincingly beats random', () => {
    const result = playMatch(new GreedyPlayer(1), new RandomPlayer(2), 12);
    expect(result.wins[0]).toBeGreaterThanOrEqual(10);
  });
});
