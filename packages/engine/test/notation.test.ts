import { describe, expect, it } from 'vitest';
import {
  Game,
  formatTurn,
  legalTurns,
  parseSGN,
  parseTurn,
  turnKey,
  type GodId,
} from '../src/index.ts';
import { pos } from './helpers.ts';
import { randomGame } from './random.ts';

describe('turn notation round-trips', () => {
  it('round-trips every legal turn in random games (base + gods)', () => {
    const pairings: [GodId, GodId][] = [
      ['none', 'none'],
      ['apollo', 'pan'],
      ['artemis', 'athena'],
      ['atlas', 'demeter'],
      ['hephaestus', 'minotaur'],
      ['prometheus', 'artemis'],
      ['hermes', 'none'],
      ['hermes', 'hermes'],
    ];
    for (const gods of pairings) {
      const game = randomGame(gods, 0xc0ffee);
      for (let i = 0; i < game.turns.length; i++) {
        const state = game.stateAt(i);
        const str = formatTurn(state, game.turns[i]);
        const parsed = parseTurn(state, str);
        expect(turnKey(parsed)).toBe(turnKey(game.turns[i]));
      }
    }
  });

  it('every generated turn formats uniquely within a position', () => {
    const s = pos({
      heights: { c4: 1, b3: 2, c2: 3 },
      p0: ['c3', 'a1'],
      p1: ['e5', 'e4'],
      gods: ['atlas', 'none'],
    });
    const strs = legalTurns(s).map((t) => formatTurn(s, t));
    expect(new Set(strs).size).toBe(strs.length);
  });

  it('accepts annotations and win markers when parsing', () => {
    const s = pos({ heights: { c3: 2, c4: 3 }, p0: ['c3', 'a1'], p1: ['e5', 'e4'] });
    const t = parseTurn(s, 'c3-c4#!!');
    expect(turnKey(t)).toBe(turnKey(parseTurn(s, 'c3-c4')));
  });
});

describe('SGN documents', () => {
  it('serializes and replays a full game identically', () => {
    const game = randomGame(['apollo', 'atlas'], 42);
    expect(game.isOver).toBe(true);
    const sgn = game.toSGN({ Event: 'test', Player1: 'A', Player2: 'B' });
    const replayed = Game.fromSGN(sgn);
    expect(replayed.state.heights).toEqual(game.state.heights);
    expect(replayed.state.workers).toEqual(game.state.workers);
    expect(replayed.state.phase).toBe(game.state.phase);
    expect(replayed.winner).toBe(game.winner);
    expect(replayed.headers.Result).toBe(game.winner === 0 ? '1-0' : '0-1');
  });

  it('serializes and replays a full Hermes game (including otherPath turns) identically', () => {
    const game = randomGame(['hermes', 'hermes'], 0);
    expect(game.isOver).toBe(true);
    // Sanity: this game actually exercises the `~` otherPath segment.
    expect(game.turnStrings.some((s) => s.includes('~'))).toBe(true);
    const sgn = game.toSGN({ Event: 'test', Player1: 'A', Player2: 'B' });
    const replayed = Game.fromSGN(sgn);
    expect(replayed.state.heights).toEqual(game.state.heights);
    expect(replayed.state.workers).toEqual(game.state.workers);
    expect(replayed.state.phase).toBe(game.state.phase);
    expect(replayed.winner).toBe(game.winner);
  });

  it('parses headers, comments, round numbers and results', () => {
    const doc = parseSGN(
      '[Event "casual"]\n[God1 "Pan"]\n\n1. b2,c3 {solid} d4,e4 2. b2-b3^b2! d4-d5^c5 1-0\n',
    );
    expect(doc.headers.Event).toBe('casual');
    expect(doc.headers.God1).toBe('Pan');
    expect(doc.turns).toEqual(['b2,c3', 'd4,e4', 'b2-b3^b2!', 'd4-d5^c5']);
  });

  it('replays a hand-written game with gods from headers', () => {
    const sgn = `[God1 "Atlas"]\n[God2 "Pan"]\n1. b2,c3 d4,e4 2. b2-b3^b2D d4-d5^c5\n`;
    const game = Game.fromSGN(sgn);
    expect(game.state.heights[6 /* b2 */]).toBe(4); // Atlas dome on ground level
    expect(game.turnStrings[2]).toBe('b2-b3^b2D');
    expect(game.isOver).toBe(false);
  });
});
