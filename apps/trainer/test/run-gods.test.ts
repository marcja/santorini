import { describe, expect, it } from 'vitest';
import { parsePlayerSpec, playerFromSpec, type Checkpoint } from '@santorini/ai';
import { Game } from '@santorini/engine';
import { gameToSgn, runMatch } from '../src/run.ts';

// Covers issue #21 / T2: --gods CLI plumbing through runMatch/gameToSgn.
// Spec-grammar tests live in packages/ai/test/spec.test.ts; run.test.ts (via
// players.test.ts) covers the base-game runner. This file adds the god
// dimension: seat/god attachment, SGN God headers, and replay-verification.

const noCkpt = (path: string): Checkpoint => {
  throw new Error(`unexpected checkpoint load: ${path}`);
};

describe('runMatch with gods', () => {
  it('attaches gods to seats, not to A/B, across seat alternation', () => {
    const spec = parsePlayerSpec('random');
    const result = runMatch(
      (s) => playerFromSpec(spec, s, noCkpt),
      (s) => playerFromSpec(spec, s, noCkpt),
      { games: 4, seed: 7, gods: ['pan', 'athena'] },
    );
    expect(result.games).toHaveLength(4);
    // Every game's board seat 0 plays Pan and seat 1 plays Athena,
    // regardless of which of A/B (tracked via aSeat) sits in that seat.
    for (const game of result.games) {
      expect(game.gods).toEqual(['pan', 'athena']);
    }
    expect(result.games.map((g) => g.aSeat)).toEqual([0, 1, 0, 1]);
  });

  it('defaults to the base game (no gods) when --gods is omitted', () => {
    const spec = parsePlayerSpec('random');
    const result = runMatch(
      (s) => playerFromSpec(spec, s, noCkpt),
      (s) => playerFromSpec(spec, s, noCkpt),
      { games: 2, seed: 1 },
    );
    for (const game of result.games) expect(game.gods).toEqual(['none', 'none']);
  });
});

describe('gameToSgn with gods', () => {
  it('emits God1/God2 headers that replay-verify via Game.fromSGN', () => {
    const spec = parsePlayerSpec('random');
    const result = runMatch(
      (s) => playerFromSpec(spec, s, noCkpt),
      (s) => playerFromSpec(spec, s, noCkpt),
      { games: 6, seed: 99, gods: ['pan', 'pan'] },
    );
    // Sanity: this seeded sample actually produces decisive games, so the
    // replay-verify below exercises real win states, not just draws.
    expect(result.games.some((g) => g.winner !== null)).toBe(true);
    for (const game of result.games) {
      const doc = gameToSgn(game, 'A', 'B', 'test event');
      expect(doc).toContain('[God1 "Pan"]');
      expect(doc).toContain('[God2 "Pan"]');

      const replayed = Game.fromSGN(doc);
      expect(replayed.turnStrings).toEqual(game.sgn);
      expect(replayed.winner).toBe(game.winner);
      expect(replayed.state.gods).toEqual(['pan', 'pan']);
    }
  });

  it('omits God headers entirely for the base game', () => {
    const spec = parsePlayerSpec('random');
    const result = runMatch(
      (s) => playerFromSpec(spec, s, noCkpt),
      (s) => playerFromSpec(spec, s, noCkpt),
      { games: 1, seed: 5 },
    );
    const doc = gameToSgn(result.games[0], 'A', 'B', 'test event');
    expect(doc).not.toContain('God1');
    expect(doc).not.toContain('God2');
    const replayed = Game.fromSGN(doc);
    expect(replayed.state.gods).toEqual(['none', 'none']);
  });
});
