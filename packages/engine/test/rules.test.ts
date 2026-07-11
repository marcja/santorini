import { describe, expect, it } from 'vitest';
import {
  Game,
  applyTurn,
  createInitialState,
  formatTurn,
  legalTurns,
  parseSquareName,
  type MoveTurn,
} from '../src/index.ts';
import { findTurn, pos, turnStrings } from './helpers.ts';

const sq = parseSquareName;

describe('setup phase', () => {
  it('offers all unordered pairs of empty squares', () => {
    const s = createInitialState();
    expect(legalTurns(s)).toHaveLength(300); // C(25,2)
    const after = applyTurn(s, { kind: 'place', squares: [sq('b2'), sq('c3')] });
    expect(after.player).toBe(1);
    expect(after.phase).toBe('setup');
    expect(legalTurns(after)).toHaveLength(253); // C(23,2)
    const playing = applyTurn(after, { kind: 'place', squares: [sq('d4'), sq('e5')] });
    expect(playing.phase).toBe('play');
    expect(playing.player).toBe(0);
  });
});

describe('base movement', () => {
  it('moves to the 8 neighboring squares when unobstructed', () => {
    const s = pos({ p0: ['c3', 'a1'], p1: ['e5', 'e4'] });
    const dests = new Set(
      legalTurns(s)
        .map((t) => t as MoveTurn)
        .filter((t) => t.path[0] === sq('c3'))
        .map((t) => t.path[1]),
    );
    expect(dests.size).toBe(8);
  });

  it('may climb exactly one level, not two', () => {
    const s = pos({ heights: { c4: 1, d4: 2 }, p0: ['c3', 'a1'], p1: ['e5', 'e4'] });
    expect(findTurn(s, 'c3-c4^c3')).toBeDefined(); // up 1
    expect(turnStrings(s).some((t) => t.startsWith('c3-d4'))).toBe(false); // up 2
  });

  it('may descend any number of levels', () => {
    const s = pos({ heights: { c3: 3 }, p0: ['c3', 'a1'], p1: ['e5', 'e4'] });
    expect(findTurn(s, 'c3-c4^c3')).toBeDefined(); // 3 -> 0, no win in base game
    const t = findTurn(s, 'c3-c4^c3') as MoveTurn;
    expect(t.win).toBe(false);
  });

  it('cannot move onto a dome or any worker', () => {
    const s = pos({ heights: { c4: 4 }, p0: ['c3', 'c2'], p1: ['d3', 'e5'] });
    const dests = turnStrings(s).filter((t) => t.startsWith('c3-'));
    expect(dests.some((t) => t.startsWith('c3-c4'))).toBe(false); // dome
    expect(dests.some((t) => t.startsWith('c3-c2'))).toBe(false); // own worker
    expect(dests.some((t) => t.startsWith('c3-d3'))).toBe(false); // opponent worker
  });
});

describe('base building', () => {
  it('builds on any unoccupied neighbor of the moved worker, including the vacated square', () => {
    const s = pos({ p0: ['a1', 'e1'], p1: ['e5', 'e4'] });
    expect(findTurn(s, 'a1-a2^a1')).toBeDefined(); // vacated square
    expect(findTurn(s, 'a1-a2^b2')).toBeDefined();
    // cannot build where a worker stands or beyond reach
    expect(findTurn(s, 'a1-a2^a2')).toBeUndefined();
    expect(findTurn(s, 'a1-a2^d4')).toBeUndefined();
  });

  it('build on level 3 places a dome automatically', () => {
    const s = pos({ heights: { b1: 3 }, p0: ['a1', 'e1'], p1: ['e5', 'e4'] });
    const t = findTurn(s, 'a1-a2^b1');
    expect(t).toBeDefined();
    const after = applyTurn(s, t!);
    expect(after.heights[sq('b1')]).toBe(4);
  });

  it('cannot build on a dome', () => {
    const s = pos({ heights: { b1: 4 }, p0: ['a1', 'e1'], p1: ['e5', 'e4'] });
    expect(findTurn(s, 'a1-a2^b1')).toBeUndefined();
  });
});

describe('winning and losing', () => {
  it('wins instantly by moving up from level 2 onto level 3 (no build)', () => {
    const s = pos({ heights: { c3: 2, c4: 3 }, p0: ['c3', 'a1'], p1: ['e5', 'e4'] });
    const t = findTurn(s, 'c3-c4#') as MoveTurn;
    expect(t).toBeDefined();
    expect(t.builds).toHaveLength(0);
    const after = applyTurn(s, t);
    expect(after.phase).toBe('over');
    expect(after.winner).toBe(0);
    expect(legalTurns(after)).toHaveLength(0);
  });

  it('moving from level 3 to level 3 does not win', () => {
    const s = pos({ heights: { c3: 3, c4: 3 }, p0: ['c3', 'a1'], p1: ['e5', 'e4'] });
    const moves = legalTurns(s).map((t) => t as MoveTurn);
    const t = moves.find((m) => m.path[1] === sq('c4'));
    expect(t).toBeDefined();
    expect(t!.win).toBe(false);
  });

  it('a player who cannot move loses (Game resolves it after the blocking turn)', () => {
    // P2 workers a1/b1 are walled in by domes except via c1 (level 1).
    // P1 plays d1-d2 and builds c1 to level 2, leaving P2 with no legal turn.
    const s = pos({
      heights: { a2: 4, b2: 4, c2: 4, c1: 1 },
      p0: ['d1', 'e5'],
      p1: ['a1', 'b1'],
    });
    const game = Game.fromState(s);
    expect(game.legalTurns().length).toBeGreaterThan(0);
    game.play('d1-d2^c1');
    expect(game.isOver).toBe(true);
    expect(game.winner).toBe(0);
  });
});

describe('turn application', () => {
  it('applyTurn is pure', () => {
    const s = pos({ p0: ['c3', 'a1'], p1: ['e5', 'e4'] });
    const before = JSON.stringify([...s.heights, ...s.workers, s.player]);
    const t = legalTurns(s)[0];
    applyTurn(s, t);
    expect(JSON.stringify([...s.heights, ...s.workers, s.player])).toBe(before);
  });

  it('Game.play rejects illegal turns', () => {
    const s = pos({ heights: { c4: 4, d4: 2 }, p0: ['c3', 'a1'], p1: ['e5', 'e4'] });
    const game = Game.fromState(s);
    expect(() => game.play('c3-c4^c3')).toThrow(/illegal/); // onto dome
    expect(() => game.play('c3-d4^c3')).toThrow(/illegal/); // climb 2
    expect(() => game.play('e5-d5^c5')).toThrow(/no worker/); // opponent's worker
    expect(() => game.play('c3-b3^b3')).toThrow(/illegal/); // build under self
  });

  it('alternates players and counts turns', () => {
    const game = new Game();
    game.play('b2,c3');
    game.play('d4,d2');
    expect(game.state.player).toBe(0);
    game.play('b2-b3^b2');
    expect(game.state.player).toBe(1);
    game.play('d4-d5^c5');
    expect(game.state.player).toBe(0);
    expect(game.state.turn).toBe(5);
  });
});
