import { describe, expect, it } from 'vitest';
import {
  CHECKPOINT_FORMAT,
  createCheckpoint,
  playerFromCheckpoint,
  validateCheckpoint,
} from '../src/checkpoint.ts';
import { DEFAULT_EVAL_WEIGHTS } from '../src/eval.ts';
import { pos } from './helpers.ts';

describe('checkpoint', () => {
  it('creates a valid gen-0 that round-trips through JSON', () => {
    const ckpt = createCheckpoint('2026-07-11T00:00:00Z', { notes: 'initial hand eval' });
    expect(ckpt.format).toBe(CHECKPOINT_FORMAT);
    expect(ckpt.generation).toBe(0);
    expect(ckpt.parent).toBeNull();
    expect(ckpt.elo).toBeNull();
    expect(ckpt.eval.weights).toEqual(DEFAULT_EVAL_WEIGHTS);
    expect(validateCheckpoint(JSON.parse(JSON.stringify(ckpt)))).toEqual(ckpt);
  });

  it('rejects structural corruption with specific messages', () => {
    const good = () => JSON.parse(JSON.stringify(createCheckpoint('2026-07-11T00:00:00Z')));
    expect(() => validateCheckpoint(null)).toThrow(/not an object/);
    expect(() => validateCheckpoint({ ...good(), format: 'santorini-checkpoint@0' })).toThrow(
      /format/,
    );
    expect(() => validateCheckpoint({ ...good(), generation: -1 })).toThrow(/generation/);
    const badEval = good();
    badEval.eval.type = 'net@1';
    expect(() => validateCheckpoint(badEval)).toThrow(/eval type/);
    const badWeights = good();
    badWeights.eval.weights.heightScore = [1, 2, 3];
    expect(() => validateCheckpoint(badWeights)).toThrow(/heightScore/);
    const badSearch = good();
    badSearch.search.iterations = 0;
    expect(() => validateCheckpoint(badSearch)).toThrow(/search/);
  });

  it('builds a player that takes an immediate win', () => {
    const ckpt = createCheckpoint('2026-07-11T00:00:00Z');
    const player = playerFromCheckpoint(ckpt, { seed: 1, iterations: 50 });
    expect(player.name).toBe('gen-0');
    // p0 worker on b2(2) next to b1(3): the winning climb must be chosen.
    const state = pos({
      heights: { b2: 2, b1: 3 },
      p0: ['b2', 'd4'],
      p1: ['a5', 'e5'],
    });
    const turn = player.chooseTurn(state);
    expect(turn.kind).toBe('move');
    if (turn.kind === 'move') expect(turn.win).toBe(true);
  });
});
