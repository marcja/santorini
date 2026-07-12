import { describe, expect, it } from 'vitest';
import { legalTurns } from '@santorini/engine';
import {
  CHECKPOINT_FORMAT,
  checkpointEvalFn,
  checkpointPolicyFn,
  createCheckpoint,
  playerFromCheckpoint,
  validateCheckpoint,
  type CheckpointEval,
} from '../src/checkpoint.ts';
import { DEFAULT_EVAL_WEIGHTS, EVAL_SCALE } from '../src/eval.ts';
import { FEATURE_COUNT } from '../src/features.ts';
import { Mlp } from '../src/mlp.ts';
import { ACTION_COUNT } from '../src/policy.ts';
import { PolicyValueNet } from '../src/pvnet.ts';
import { pos } from './helpers.ts';

function mlpEval(hiddenSize = 4): CheckpointEval {
  return { type: 'mlp@1', params: Mlp.init(FEATURE_COUNT, hiddenSize, 7).toParams() };
}

function pvEval(hiddenSize = 4): CheckpointEval {
  return {
    type: 'pv@1',
    params: PolicyValueNet.init(FEATURE_COUNT, hiddenSize, ACTION_COUNT, 7).toParams(),
  };
}

describe('checkpoint', () => {
  it('creates a valid gen-0 that round-trips through JSON', () => {
    const ckpt = createCheckpoint('2026-07-11T00:00:00Z', { notes: 'initial hand eval' });
    expect(ckpt.format).toBe(CHECKPOINT_FORMAT);
    expect(ckpt.generation).toBe(0);
    expect(ckpt.parent).toBeNull();
    expect(ckpt.elo).toBeNull();
    expect(ckpt.eval).toEqual({ type: 'static@1', weights: DEFAULT_EVAL_WEIGHTS });
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

  it('round-trips an mlp@1 checkpoint through JSON', () => {
    const ckpt = createCheckpoint('2026-07-11T00:00:00Z', {
      generation: 1,
      parent: 'models/gen-000.json',
      eval: mlpEval(),
    });
    expect(validateCheckpoint(JSON.parse(JSON.stringify(ckpt)))).toEqual(ckpt);
  });

  it('rejects malformed mlp@1 params', () => {
    const good = () =>
      JSON.parse(JSON.stringify(createCheckpoint('2026-07-11T00:00:00Z', { eval: mlpEval() })));
    const badInput = good();
    badInput.eval.params.inputSize = 10;
    expect(() => validateCheckpoint(badInput)).toThrow(/inputSize/);
    const badShape = good();
    badShape.eval.params.w1.pop();
    expect(() => validateCheckpoint(badShape)).toThrow(/shapes/);
    const badHidden = good();
    badHidden.eval.params.hiddenSize = 0;
    expect(() => validateCheckpoint(badHidden)).toThrow(/shapes/);
  });

  it('mlp eval negates cleanly across perspectives and scales to EVAL_SCALE', () => {
    const evalFn = checkpointEvalFn(mlpEval());
    const state = pos({ heights: { b2: 1 }, p0: ['b2', 'd4'], p1: ['a5', 'e5'] });
    const forMover = evalFn(state, 0); // player 0 to move
    const forOther = evalFn(state, 1);
    expect(forOther).toBeCloseTo(-forMover, 10);
    // Fresh nets start near logit 0 → |score| well inside one EVAL_SCALE unit.
    expect(Math.abs(forMover)).toBeLessThan(EVAL_SCALE);
  });

  it('builds a player from an mlp@1 checkpoint that takes an immediate win', () => {
    const ckpt = createCheckpoint('2026-07-11T00:00:00Z', { generation: 1, eval: mlpEval() });
    const player = playerFromCheckpoint(ckpt, { seed: 1, iterations: 50 });
    expect(player.name).toBe('gen-1');
    const state = pos({
      heights: { b2: 2, b1: 3 },
      p0: ['b2', 'd4'],
      p1: ['a5', 'e5'],
    });
    const turn = player.chooseTurn(state);
    expect(turn.kind).toBe('move');
    if (turn.kind === 'move') expect(turn.win).toBe(true);
  });

  it('round-trips a pv@1 checkpoint and rejects malformed params', () => {
    const ckpt = createCheckpoint('2026-07-12T00:00:00Z', {
      generation: 6,
      parent: 'models/gen-005.json',
      eval: pvEval(),
    });
    expect(validateCheckpoint(JSON.parse(JSON.stringify(ckpt)))).toEqual(ckpt);

    const good = () => JSON.parse(JSON.stringify(ckpt));
    const badActions = good();
    badActions.eval.params.actionCount = 128;
    expect(() => validateCheckpoint(badActions)).toThrow(/actionCount/);
    const badShape = good();
    badShape.eval.params.wp.pop();
    expect(() => validateCheckpoint(badShape)).toThrow(/shapes/);
    const badInput = good();
    badInput.eval.params.inputSize = 10;
    expect(() => validateCheckpoint(badInput)).toThrow(/inputSize/);
  });

  it('pv eval negates across perspectives; policy fn yields priors in play only', () => {
    const ev = pvEval();
    const evalFn = checkpointEvalFn(ev);
    const state = pos({ heights: { b2: 1 }, p0: ['b2', 'd4'], p1: ['a5', 'e5'] });
    expect(evalFn(state, 1)).toBeCloseTo(-evalFn(state, 0), 10);

    const policyFn = checkpointPolicyFn(ev)!;
    expect(checkpointPolicyFn(mlpEval())).toBeNull();
    const turns = legalTurns(state);
    const priors = policyFn(state, turns)!;
    expect(priors).toHaveLength(turns.length);
    expect(priors.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    const setup = pos({ p0: ['a1', 'a2'], p1: ['a3', 'a4'] });
    setup.phase = 'setup';
    setup.workers.fill(-1);
    expect(policyFn(setup, legalTurns(setup))).toBeNull();
  });

  it('builds a PUCT player from a pv@1 checkpoint that takes an immediate win', () => {
    const ckpt = createCheckpoint('2026-07-12T00:00:00Z', { generation: 6, eval: pvEval() });
    const player = playerFromCheckpoint(ckpt, { seed: 1, iterations: 50 });
    const state = pos({
      heights: { b2: 2, b1: 3 },
      p0: ['b2', 'd4'],
      p1: ['a5', 'e5'],
    });
    const turn = player.chooseTurn(state);
    expect(turn.kind).toBe('move');
    if (turn.kind === 'move') expect(turn.win).toBe(true);
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
