import { describe, expect, it } from 'vitest';
import { Mlp } from '../src/mlp.ts';
import { PolicyValueNet, type PvSample } from '../src/pvnet.ts';
import { mulberry32 } from '../src/rng.ts';

const IN = 12;
const HIDDEN = 8;
const ACTIONS = 20;

/**
 * Toy task: feature 0 set → win and action 1 best; feature 0 clear → loss and
 * action 2 best. Legal set alternates to exercise the masked softmax.
 */
function toySamples(n: number, seed: number): PvSample[] {
  const rand = mulberry32(seed);
  const samples: PvSample[] = [];
  for (let i = 0; i < n; i++) {
    const hot = rand() < 0.5;
    const x = new Float32Array(IN);
    x[0] = hot ? 1 : 0;
    x[1 + Math.floor(rand() * (IN - 1))] = 1;
    const actions = hot ? [1, 3, 5] : [2, 3, 7];
    samples.push({
      x,
      y: hot ? 1 : 0,
      actions,
      targets: actions.map((a) => (a === (hot ? 1 : 2) ? 0.8 : 0.1)),
    });
  }
  return samples;
}

/** Softmax of the given logit indices. */
function softmax(logits: Float64Array, actions: number[]): number[] {
  const max = Math.max(...actions.map((a) => logits[a]));
  const exps = actions.map((a) => Math.exp(logits[a] - max));
  const sum = exps.reduce((s, v) => s + v, 0);
  return exps.map((v) => v / sum);
}

describe('PolicyValueNet', () => {
  it('warm-starts from an Mlp with an identical value head and uniform priors', () => {
    const mlp = Mlp.init(IN, HIDDEN, 3);
    const net = PolicyValueNet.fromMlp(mlp.toParams(), ACTIONS);
    const x = new Float32Array(IN);
    x[0] = 1;
    x[4] = 1;
    expect(net.valueForward(x)).toBeCloseTo(new Mlp(mlp.toParams()).forward(x), 10);
    const logits = net.policyForward(x);
    expect([...logits]).toEqual(new Array(ACTIONS).fill(0));
  });

  it('learns both heads on a toy task', () => {
    const net = PolicyValueNet.init(IN, HIDDEN, ACTIONS, 5);
    const samples = toySamples(400, 9);
    const losses = net.train(samples, { epochs: 30, lr: 0.5, seed: 2 });
    expect(losses[losses.length - 1].value).toBeLessThan(losses[0].value);
    expect(losses[losses.length - 1].policy).toBeLessThan(losses[0].policy);

    const hot = new Float32Array(IN);
    hot[0] = 1;
    hot[2] = 1;
    const cold = new Float32Array(IN);
    cold[5] = 1;
    // Value head separates the classes…
    expect(net.valueForward(hot)).toBeGreaterThan(0);
    expect(net.valueForward(cold)).toBeLessThan(0);
    // …and the policy head puts the most mass on the right action.
    const pHot = softmax(net.policyForward(hot), [1, 3, 5]);
    expect(pHot[0]).toBeGreaterThan(0.5);
    const pCold = softmax(net.policyForward(cold), [2, 3, 7]);
    expect(pCold[0]).toBeGreaterThan(0.5);
  });

  it('skips the policy loss for samples without actions', () => {
    const net = PolicyValueNet.init(IN, HIDDEN, ACTIONS, 5);
    const valueOnly: PvSample[] = toySamples(50, 3).map((s) => ({ ...s, actions: [], targets: [] }));
    const losses = net.train(valueOnly, { epochs: 2, lr: 0.1, seed: 1 });
    expect(losses[0].policy).toBe(0);
    expect(losses[1].value).toBeLessThan(losses[0].value);
  });

  it('weight decay shrinks weights relative to no decay', () => {
    const samples = toySamples(200, 7);
    const norm = (params: number[]): number => Math.hypot(...params);
    const plain = PolicyValueNet.init(IN, HIDDEN, ACTIONS, 5);
    plain.train(samples, { epochs: 10, lr: 0.3, seed: 2 });
    const decayed = PolicyValueNet.init(IN, HIDDEN, ACTIONS, 5);
    decayed.train(samples, { epochs: 10, lr: 0.3, seed: 2, weightDecay: 0.05 });
    expect(norm(decayed.toParams().w1)).toBeLessThan(norm(plain.toParams().w1));
    expect(norm(decayed.toParams().wp)).toBeLessThan(norm(plain.toParams().wp));
  });

  it('round-trips through toParams', () => {
    const net = PolicyValueNet.init(IN, HIDDEN, ACTIONS, 11);
    net.train(toySamples(60, 4), { epochs: 2, lr: 0.2, seed: 3 });
    const copy = new PolicyValueNet(net.toParams());
    const x = new Float32Array(IN);
    x[0] = 1;
    x[7] = 1;
    expect(copy.valueForward(x)).toBeCloseTo(net.valueForward(x), 5);
    expect([...copy.policyForward(x)].map((v) => v.toFixed(5))).toEqual(
      [...net.policyForward(x)].map((v) => v.toFixed(5)),
    );
  });

  it('rejects inconsistent parameter shapes', () => {
    const params = PolicyValueNet.init(IN, HIDDEN, ACTIONS, 1).toParams();
    params.wp.pop();
    expect(() => new PolicyValueNet(params)).toThrow(/shape/);
  });
});
