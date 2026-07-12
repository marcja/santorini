import { describe, expect, it } from 'vitest';
import { createInitialState, parseTurn, squareName, parseSquareName } from '@santorini/engine';
import {
  coachHint,
  describeTurn,
  reviewLines,
  reviewTurn,
  threatSquares,
  winningTurns,
} from '../src/index.ts';
import { pos } from './helpers.ts';

const sq = parseSquareName;

/** Player 0 can win b2→c3 right now. */
const winInOne = () =>
  pos({ heights: { b2: 2, c3: 3 }, p0: ['b2', 'a1'], p1: ['d5', 'e5'] });

/** Player 1 threatens d4→e4; player 0 (to move) must deal with it. */
const mustBlock = () =>
  pos({ heights: { d4: 2, e4: 3 }, p0: ['e3', 'a1'], p1: ['d4', 'a5'] });

describe('winningTurns / threatSquares', () => {
  it('finds the win-in-1 and reports no phantom threats', () => {
    const s = winInOne();
    const wins = winningTurns(s);
    expect(wins.length).toBeGreaterThan(0);
    expect(wins.every((t) => t.win && t.path.at(-1) === sq('c3'))).toBe(true);
    expect(threatSquares(s)).toEqual([]); // opponent is on flat ground
  });

  it('sees the opponent threat square', () => {
    expect(threatSquares(mustBlock()).map(squareName)).toEqual(['e4']);
  });

  it('is empty outside the play phase', () => {
    const s = createInitialState();
    expect(winningTurns(s)).toEqual([]);
    expect(threatSquares(s)).toEqual([]);
  });
});

describe('reviewTurn', () => {
  it('flags a missed win', () => {
    const s = winInOne();
    const r = reviewTurn(s, parseTurn(s, 'a1-a2^a1'));
    expect(r.won).toBe(false);
    expect(r.missedWins.map(squareName)).toEqual(['c3']);
  });

  it('reports a win as won, with nothing else to say', () => {
    const s = winInOne();
    const r = reviewTurn(s, parseTurn(s, 'b2-c3#'));
    expect(r.won).toBe(true);
    expect(reviewLines(r)).toEqual([]);
  });

  it('flags an avoidable hang', () => {
    // Building d3 to level 3 hands c3's worker the win.
    const s = pos({ heights: { c3: 2, d3: 2 }, p0: ['e3', 'a1'], p1: ['c3', 'a5'] });
    const r = reviewTurn(s, parseTurn(s, 'e3-e2^d3'));
    expect(r.hangs.map(squareName)).toEqual(['d3']);
    expect(r.avoidable).toBe(true);
    expect(reviewLines(r)[0]).toContain('avoidable');
  });

  it('credits a block', () => {
    const s = mustBlock();
    const r = reviewTurn(s, parseTurn(s, 'e3-d3^e4')); // dome e4
    expect(r.hangs).toEqual([]);
    expect(r.blocked.map(squareName)).toEqual(['e4']);
    expect(reviewLines(r)[0]).toContain('defused');
  });

  it('reports a created threat', () => {
    // b2→b3 climbs to level 2 next to the level-3 tower at c3.
    const s = pos({ heights: { b2: 1, b3: 2, c3: 3 }, p0: ['b2', 'e1'], p1: ['d5', 'e5'] });
    const r = reviewTurn(s, parseTurn(s, 'b2-b3^a2'));
    expect(r.hangs).toEqual([]);
    expect(r.created.map(squareName)).toEqual(['c3']);
    expect(reviewLines(r).some((l) => l.includes('threaten to win at c3'))).toBe(true);
  });
});

describe('describeTurn', () => {
  it('narrates move and build', () => {
    const s = mustBlock();
    expect(describeTurn(s, parseTurn(s, 'e3-d3^e4'))).toBe(
      'move e3→d3, then build a dome at e4',
    );
  });

  it('narrates a winning move', () => {
    const s = winInOne();
    expect(describeTurn(s, parseTurn(s, 'b2-c3#'))).toBe('move b2→c3, winning the game');
  });
});

describe('coachHint', () => {
  it('takes an immediate win and says so', () => {
    const hint = coachHint(winInOne(), { iterations: 100, seed: 1 });
    expect(hint.winProb).toBe(1);
    expect(hint.notation.endsWith('#')).toBe(true);
    expect(hint.wins.map(squareName)).toEqual(['c3']);
    expect(hint.lines[0]).toContain('win right now');
  });

  it('warns about the threat and suggests a move that deals with it', { timeout: 15_000 }, () => {
    const s = mustBlock();
    const hint = coachHint(s, { iterations: 1000, seed: 42 });
    expect(hint.threats.map(squareName)).toEqual(['e4']);
    expect(hint.lines[0]).toContain('Danger');
    expect(hint.lines.some((l) => l.includes('deals with the immediate threat'))).toBe(true);
    expect(hint.pv[0]).toBe(hint.notation);
    expect(hint.candidates.length).toBeGreaterThan(0);
    expect(hint.candidates[0].notation).toBe(hint.notation);
  });

  it('suggests a placement during setup', () => {
    const hint = coachHint(createInitialState(), { iterations: 200, seed: 3 });
    expect(hint.turn.kind).toBe('place');
    expect(hint.lines[0]).toContain('place workers');
  });
});
