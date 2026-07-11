import { describe, expect, it } from 'vitest';
import {
  applyTurn,
  legalTurns,
  parseSquareName,
  workerAt,
  type MoveTurn,
} from '../src/index.ts';
import { findTurn, pos, turnStrings } from './helpers.ts';

const sq = parseSquareName;

describe('Apollo (swap with opponent worker)', () => {
  it('may move into an opponent space, forcing the worker to the vacated square', () => {
    const s = pos({ p0: ['b2', 'a1'], p1: ['b3', 'e5'], gods: ['apollo', 'none'] });
    const t = findTurn(s, 'b2-b3^b4');
    expect(t).toBeDefined();
    const after = applyTurn(s, t!);
    expect(workerAt(after, sq('b2'))).toBe(2); // p1 worker forced to b2
    expect(workerAt(after, sq('b3'))).toBe(0);
  });

  it('cannot swap with its own worker, and climb limits still apply', () => {
    const s = pos({
      heights: { b3: 2 },
      p0: ['b2', 'a1'],
      p1: ['b3', 'e5'],
      gods: ['apollo', 'none'],
    });
    expect(turnStrings(s).some((t) => t.startsWith('b2-a1'))).toBe(false);
    expect(turnStrings(s).some((t) => t.startsWith('b2-b3'))).toBe(false); // up 2
  });

  it('a forced worker does not win by landing on level 3', () => {
    // Apollo on level 3 swaps down with an opponent on level 2: the opponent
    // is forced up onto the vacated level-3 square but does not win.
    const s = pos({
      heights: { b2: 3, b3: 2 },
      p0: ['b2', 'a1'],
      p1: ['b3', 'e5'],
      gods: ['apollo', 'none'],
    });
    const t = findTurn(s, 'b2-b3^a3');
    expect(t).toBeDefined();
    const after = applyTurn(s, t!);
    expect(after.phase).toBe('play');
    expect(after.winner).toBeNull();
    expect(workerAt(after, sq('b2'))).toBe(2);
  });

  it('wins by swapping up onto level 3', () => {
    const s = pos({
      heights: { b2: 2, b3: 3 },
      p0: ['b2', 'a1'],
      p1: ['b3', 'e5'],
      gods: ['apollo', 'none'],
    });
    const t = findTurn(s, 'b2-b3#');
    expect(t).toBeDefined();
    expect(applyTurn(s, t!).winner).toBe(0);
  });
});

describe('Artemis (one additional move)', () => {
  it('may move twice but not back to the initial space', () => {
    const s = pos({ p0: ['c3', 'a1'], p1: ['e5', 'e4'], gods: ['artemis', 'none'] });
    expect(findTurn(s, 'c3-c4-c5^b5')).toBeDefined();
    expect(turnStrings(s).some((t) => t.startsWith('c3-c4-c3'))).toBe(false);
    expect(findTurn(s, 'c3-c4^c3')).toBeDefined(); // single move still fine
  });

  it('can win on the second step', () => {
    const s = pos({
      heights: { c3: 1, c4: 2, c5: 3 },
      p0: ['c3', 'a1'],
      p1: ['e5', 'e4'],
      gods: ['artemis', 'none'],
    });
    const t = findTurn(s, 'c3-c4-c5#') as MoveTurn;
    expect(t).toBeDefined();
    expect(applyTurn(s, t).winner).toBe(0);
  });

  it('winning on the first step ends the turn (no continuation)', () => {
    const s = pos({
      heights: { c3: 2, c4: 3 },
      p0: ['c3', 'a1'],
      p1: ['e5', 'e4'],
      gods: ['artemis', 'none'],
    });
    const winning = turnStrings(s).filter((t) => t.startsWith('c3-c4'));
    expect(winning).toEqual(['c3-c4#']);
  });
});

describe('Athena (blocks opponent up-moves after moving up)', () => {
  it('sets the flag when moving up and forbids opponent up-moves that turn', () => {
    const s = pos({
      heights: { b3: 1, d4: 1 },
      p0: ['b2', 'a1'],
      p1: ['d3', 'e5'],
      gods: ['athena', 'none'],
    });
    const after = applyTurn(s, findTurn(s, 'b2-b3^b2')!);
    expect(after.athenaUp).toBe(true);
    const oppTurns = legalTurns(after).map((t) => t as MoveTurn);
    for (const t of oppTurns) {
      for (let i = 0; i + 1 < t.path.length; i++) {
        expect(after.heights[t.path[i + 1]]).toBeLessThanOrEqual(after.heights[t.path[i]]);
      }
    }
    expect(oppTurns.some((t) => t.path[1] === sq('d4'))).toBe(false);
  });

  it('clears the flag after a turn without moving up', () => {
    const s = pos({
      p0: ['b2', 'a1'],
      p1: ['d3', 'e5'],
      gods: ['athena', 'none'],
      athenaUp: true,
    });
    const after = applyTurn(s, findTurn(s, 'b2-c2^b2')!);
    expect(after.athenaUp).toBe(false);
  });

  it('can block an opponent into having no legal turn', () => {
    // P2's only move anywhere is a1->a2 (up one level). With Athena's flag
    // set, that up-move is forbidden and P2 has no legal turn at all.
    const spec = {
      heights: { a2: 1, b1: 4, b2: 4, d1: 4, d2: 4, e2: 4 },
      p0: ['c4', 'c5'] as [string, string],
      p1: ['a1', 'e1'] as [string, string],
      gods: ['athena', 'none'] as ['athena', 'none'],
      player: 1 as const,
    };
    expect(legalTurns(pos({ ...spec, athenaUp: false })).length).toBeGreaterThan(0);
    expect(legalTurns(pos({ ...spec, athenaUp: true }))).toHaveLength(0);
  });
});

describe('Atlas (dome at any level)', () => {
  it('offers explicit dome builds below level 3', () => {
    const s = pos({ p0: ['c3', 'a1'], p1: ['e5', 'e4'], gods: ['atlas', 'none'] });
    const t = findTurn(s, 'c3-c4^c3D');
    expect(t).toBeDefined();
    const after = applyTurn(s, t!);
    expect(after.heights[sq('c3')]).toBe(4);
    expect(findTurn(s, 'c3-c4^c3')).toBeDefined(); // plain block still available
  });
});

describe('Demeter (one additional build, different space)', () => {
  it('offers single and double builds on distinct squares only', () => {
    const s = pos({ p0: ['c3', 'a1'], p1: ['e5', 'e4'], gods: ['demeter', 'none'] });
    expect(findTurn(s, 'c3-c4^c3^d4')).toBeDefined();
    expect(findTurn(s, 'c3-c4^c3')).toBeDefined();
    expect(turnStrings(s).some((t) => t.includes('^c3^c3'))).toBe(false);
    const t = findTurn(s, 'c3-c4^c3^d4')!;
    const after = applyTurn(s, t);
    expect(after.heights[sq('c3')]).toBe(1);
    expect(after.heights[sq('d4')]).toBe(1);
  });
});

describe('Hephaestus (one additional block on the same space)', () => {
  it('may build two blocks when the result stays below dome level', () => {
    const s = pos({
      heights: { c2: 1, d4: 2 },
      p0: ['c3', 'a1'],
      p1: ['e5', 'e4'],
      gods: ['hephaestus', 'none'],
    });
    const t = findTurn(s, 'c3-b3^c2^c2');
    expect(t).toBeDefined();
    expect(applyTurn(s, t!).heights[sq('c2')]).toBe(3);
    // double build on level 2 would need a dome as second block: not allowed
    expect(turnStrings(s).some((t2) => t2.includes('^d4^d4'))).toBe(false);
    // and any double build is always on one and the same square
    for (const mt of legalTurns(s).map((x) => x as MoveTurn)) {
      if (mt.builds.length === 2) expect(mt.builds[0].at).toBe(mt.builds[1].at);
    }
  });
});

describe('Minotaur (push opponent worker)', () => {
  it('pushes the opponent worker one space straight backwards', () => {
    const s = pos({ p0: ['b2', 'a1'], p1: ['b3', 'e5'], gods: ['minotaur', 'none'] });
    const t = findTurn(s, 'b2-b3^b2');
    expect(t).toBeDefined();
    const after = applyTurn(s, t!);
    expect(workerAt(after, sq('b4'))).toBe(2);
    expect(workerAt(after, sq('b3'))).toBe(0);
  });

  it('cannot push off the board, onto a dome, or onto another worker', () => {
    const off = pos({ p0: ['b4', 'a1'], p1: ['b5', 'e5'], gods: ['minotaur', 'none'] });
    expect(turnStrings(off).some((t) => t.startsWith('b4-b5'))).toBe(false);
    const blocked = pos({ p0: ['b2', 'a1'], p1: ['b3', 'b4'], gods: ['minotaur', 'none'] });
    expect(turnStrings(blocked).some((t) => t.startsWith('b2-b3'))).toBe(false);
    const domed = pos({
      heights: { b4: 4 },
      p0: ['b2', 'a1'],
      p1: ['b3', 'e5'],
      gods: ['minotaur', 'none'],
    });
    expect(turnStrings(domed).some((t) => t.startsWith('b2-b3'))).toBe(false);
  });

  it('may push a worker up onto level 3 without it winning', () => {
    const s = pos({
      heights: { b4: 3 },
      p0: ['b2', 'a1'],
      p1: ['b3', 'e5'],
      gods: ['minotaur', 'none'],
    });
    const t = findTurn(s, 'b2-b3^b2');
    expect(t).toBeDefined();
    const after = applyTurn(s, t!);
    expect(after.winner).toBeNull();
    expect(workerAt(after, sq('b4'))).toBe(2);
  });
});

describe('Pan (also wins by moving down 2+ levels)', () => {
  it('wins by descending two levels', () => {
    const s = pos({ heights: { c3: 2 }, p0: ['c3', 'a1'], p1: ['e5', 'e4'], gods: ['pan', 'none'] });
    const t = findTurn(s, 'c3-c4#');
    expect(t).toBeDefined();
    expect(applyTurn(s, t!).winner).toBe(0);
  });

  it('does not win descending one level, and still wins normally', () => {
    const s = pos({
      heights: { c3: 2, b3: 1, c4: 3 },
      p0: ['c3', 'a1'],
      p1: ['e5', 'e4'],
      gods: ['pan', 'none'],
    });
    const down1 = findTurn(s, 'c3-b3^c3') as MoveTurn;
    expect(down1).toBeDefined();
    expect(down1.win).toBe(false);
    expect(findTurn(s, 'c3-c4#')).toBeDefined();
  });
});

describe('Prometheus (build before and after when not moving up)', () => {
  it('offers pre-build turns that never move up', () => {
    const s = pos({
      heights: { c4: 1 },
      p0: ['c3', 'a1'],
      p1: ['e5', 'e4'],
      gods: ['prometheus', 'none'],
    });
    expect(findTurn(s, '^b3c3-c2^c3')).toBeDefined();
    const withPre = legalTurns(s)
      .map((t) => t as MoveTurn)
      .filter((t) => t.preBuilds && t.preBuilds.length > 0);
    expect(withPre.length).toBeGreaterThan(0);
    // "does not move up" accounts for the pre-build's height change
    for (const t of withPre) {
      const scratch = s.heights.slice();
      for (const b of t.preBuilds!) scratch[b.at] = b.dome ? 4 : scratch[b.at] + 1;
      expect(scratch[t.path[1]]).toBeLessThanOrEqual(scratch[t.path[0]]);
    }
    // without the pre-build, moving up is still allowed
    expect(findTurn(s, 'c3-c4^c3')).toBeDefined();
  });
});
