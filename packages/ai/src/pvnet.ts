import type { MlpParams, Sample } from './mlp.ts';
import { mulberry32 } from './rng.ts';

// Two-headed net for PUCT: a shared ReLU hidden layer feeds a value head
// (win-probability logit, same contract as Mlp) and a policy head (one logit
// per action in the policy encoding — see policy.ts). Pure TS, JSON-portable,
// like Mlp. The heads are computed by separate methods so MCTS pays for the
// policy head only at node expansion, not at every playout horizon.

/** JSON-serializable parameters — what a `pv@1` checkpoint stores. */
export interface PvNetParams {
  inputSize: number;
  hiddenSize: number;
  actionCount: number;
  /** hiddenSize × inputSize, row-major. */
  w1: number[];
  b1: number[];
  /** Value head: hiddenSize weights + bias. */
  wv: number[];
  bv: number;
  /** Policy head: actionCount × hiddenSize, row-major, + per-action bias. */
  wp: number[];
  bp: number[];
}

/**
 * A value sample plus the search's visit distribution: `targets[i]` is the
 * probability mass on action `actions[i]` (parallel arrays over the legal
 * actions the search visited; empty when the position took no priors).
 */
export interface PvSample extends Sample {
  actions: number[];
  targets: number[];
}

export interface PvTrainOptions {
  epochs?: number;
  batchSize?: number;
  lr?: number;
  seed?: number;
  /** Decoupled L2 weight decay per batch (biases exempt). */
  weightDecay?: number;
  /** Policy CE weight relative to value BCE. */
  policyWeight?: number;
}

/** Mean losses per epoch. */
export interface PvEpochLoss {
  value: number;
  policy: number;
}

/** Per-batch gradient accumulators, reused across batches to avoid reallocation. */
interface PvGrads {
  gw1: Float64Array;
  gb1: Float64Array;
  gwv: Float64Array;
  gbv: number;
  /** Policy grads are sparse (legal actions only): per-row, keyed by action. Last slot of each row is the bias grad. */
  gwpRows: Map<number, Float64Array>;
  /** Scratch hidden-layer gradient, rebuilt per sample. */
  dh: Float64Array;
}

function resetGrads(g: PvGrads): void {
  g.gw1.fill(0);
  g.gb1.fill(0);
  g.gwv.fill(0);
  g.gbv = 0;
  g.gwpRows.clear();
}

function shuffleInPlace(order: number[], rand: () => number): void {
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
}

export class PolicyValueNet {
  readonly inputSize: number;
  readonly hiddenSize: number;
  readonly actionCount: number;
  private readonly w1: Float64Array;
  private readonly b1: Float64Array;
  private readonly wv: Float64Array;
  private bv: number;
  private readonly wp: Float64Array;
  private readonly bp: Float64Array;
  /** Hidden activations of the last hidden() — reused by heads and backprop. */
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: read via destructuring in hidden()/valueHead()/policyHead(), not a `this.h` access.
  private readonly h: Float64Array;

  constructor(params: PvNetParams) {
    const { inputSize, hiddenSize, actionCount } = params;
    if (
      params.w1.length !== hiddenSize * inputSize ||
      params.b1.length !== hiddenSize ||
      params.wv.length !== hiddenSize ||
      params.wp.length !== actionCount * hiddenSize ||
      params.bp.length !== actionCount
    ) {
      throw new Error('PvNetParams shape mismatch');
    }
    this.inputSize = inputSize;
    this.hiddenSize = hiddenSize;
    this.actionCount = actionCount;
    this.w1 = Float64Array.from(params.w1);
    this.b1 = Float64Array.from(params.b1);
    this.wv = Float64Array.from(params.wv);
    this.bv = params.bv;
    this.wp = Float64Array.from(params.wp);
    this.bp = Float64Array.from(params.bp);
    this.h = new Float64Array(hiddenSize);
  }

  /** He-initialized shared layer; zero policy head = uniform initial priors. */
  static init(
    inputSize: number,
    hiddenSize: number,
    actionCount: number,
    seed: number,
  ): PolicyValueNet {
    const rand = mulberry32(seed);
    const gauss = (): number =>
      Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
    const s1 = Math.sqrt(2 / inputSize);
    const sv = 0.1 / Math.sqrt(hiddenSize);
    return new PolicyValueNet({
      inputSize,
      hiddenSize,
      actionCount,
      w1: Array.from({ length: hiddenSize * inputSize }, () => gauss() * s1),
      b1: new Array(hiddenSize).fill(0),
      wv: Array.from({ length: hiddenSize }, () => gauss() * sv),
      bv: 0,
      wp: new Array(actionCount * hiddenSize).fill(0),
      bp: new Array(actionCount).fill(0),
    });
  }

  /**
   * Warm start from a trained value net: the shared layer and value head
   * continue the lineage; the zero policy head starts at uniform priors.
   */
  static fromMlp(params: MlpParams, actionCount: number): PolicyValueNet {
    return new PolicyValueNet({
      inputSize: params.inputSize,
      hiddenSize: params.hiddenSize,
      actionCount,
      w1: [...params.w1],
      b1: [...params.b1],
      wv: [...params.w2],
      bv: params.b2,
      wp: new Array(actionCount * params.hiddenSize).fill(0),
      bp: new Array(actionCount).fill(0),
    });
  }

  /** Fill this.h with the shared hidden activations. */
  private hidden(x: Float32Array): void {
    const { w1, b1, h, inputSize, hiddenSize } = this;
    for (let j = 0; j < hiddenSize; j++) {
      let z = b1[j];
      const row = j * inputSize;
      for (let i = 0; i < inputSize; i++) z += w1[row + i] * x[i];
      h[j] = z > 0 ? z : 0;
    }
  }

  /** Value logit; sigmoid(logit) = predicted win probability for the encoded player. */
  valueForward(x: Float32Array): number {
    this.hidden(x);
    const { wv, h, hiddenSize } = this;
    let logit = this.bv;
    for (let j = 0; j < hiddenSize; j++) logit += wv[j] * h[j];
    return logit;
  }

  /** All action logits (softmax them over the *legal* actions only). */
  policyForward(x: Float32Array, out?: Float64Array): Float64Array {
    this.hidden(x);
    const { wp, bp, h, hiddenSize, actionCount } = this;
    const logits = out ?? new Float64Array(actionCount);
    for (let a = 0; a < actionCount; a++) {
      let z = bp[a];
      const row = a * hiddenSize;
      for (let j = 0; j < hiddenSize; j++) z += wp[row + j] * h[j];
      logits[a] = z;
    }
    return logits;
  }

  /**
   * Mini-batch SGD on BCE(value) + policyWeight · CE(policy). The policy
   * softmax and its gradient touch only each sample's legal actions — both
   * the correct target distribution and what keeps pure-TS training fast.
   */
  train(samples: PvSample[], opts: PvTrainOptions = {}): PvEpochLoss[] {
    const epochs = opts.epochs ?? 4;
    const batchSize = opts.batchSize ?? 64;
    const lr = opts.lr ?? 0.05;
    const weightDecay = opts.weightDecay ?? 0;
    const policyWeight = opts.policyWeight ?? 1;
    const rand = mulberry32(opts.seed ?? 1);
    const order = samples.map((_, i) => i);
    const grads = this.newGrads();
    const losses: PvEpochLoss[] = [];

    for (let e = 0; e < epochs; e++) {
      shuffleInPlace(order, rand);
      let valueLossSum = 0;
      let policyLossSum = 0;
      let policySamples = 0;
      for (let start = 0; start < order.length; start += batchSize) {
        const end = Math.min(start + batchSize, order.length);
        const batch = this.trainBatch(
          samples,
          order,
          start,
          end,
          grads,
          lr,
          weightDecay,
          policyWeight,
        );
        valueLossSum += batch.valueLoss;
        policyLossSum += batch.policyLoss;
        policySamples += batch.policySamples;
      }
      losses.push({
        value: valueLossSum / order.length,
        policy: policySamples > 0 ? policyLossSum / policySamples : 0,
      });
    }
    return losses;
  }

  private newGrads(): PvGrads {
    return {
      gw1: new Float64Array(this.w1.length),
      gb1: new Float64Array(this.hiddenSize),
      gwv: new Float64Array(this.hiddenSize),
      gbv: 0,
      gwpRows: new Map<number, Float64Array>(),
      dh: new Float64Array(this.hiddenSize),
    };
  }

  /** One SGD step: accumulate every sample's gradient, then apply it. */
  private trainBatch(
    samples: PvSample[],
    order: number[],
    start: number,
    end: number,
    grads: PvGrads,
    lr: number,
    weightDecay: number,
    policyWeight: number,
  ): { valueLoss: number; policyLoss: number; policySamples: number } {
    resetGrads(grads);
    let valueLoss = 0;
    let policyLoss = 0;
    let policySamples = 0;
    for (let k = start; k < end; k++) {
      const sample = samples[order[k]];
      valueLoss += this.accumulateValueGrad(sample, grads);
      if (sample.actions.length > 0) {
        policyLoss += this.accumulatePolicyGrad(sample, grads, policyWeight);
        policySamples++;
      }
      this.accumulateHiddenGrad(sample.x, grads);
    }
    const step = lr / (end - start);
    this.applyGradStep(grads, step);
    if (weightDecay > 0) this.applyWeightDecay(1 - lr * weightDecay);
    return { valueLoss, policyLoss, policySamples };
  }

  /** Value branch: forward+backward for one sample. Fills `this.h`, resets `grads.dh`. Returns its BCE loss. */
  private accumulateValueGrad(sample: PvSample, grads: PvGrads): number {
    const { wv, h, hiddenSize } = this;
    const { x, y } = sample;
    const logit = this.valueForward(x); // fills this.h
    const p = 1 / (1 + Math.exp(-logit));
    const loss = -(
      y * Math.log(Math.max(p, 1e-12)) +
      (1 - y) * Math.log(Math.max(1 - p, 1e-12))
    );
    const dLogit = p - y;
    grads.gbv += dLogit;
    grads.dh.fill(0);
    for (let j = 0; j < hiddenSize; j++) {
      if (h[j] <= 0) continue;
      grads.gwv[j] += dLogit * h[j];
      grads.dh[j] = dLogit * wv[j];
    }
    return loss;
  }

  /** Policy branch: masked softmax + backward over one sample's legal actions. Adds into `grads.dh`. Returns its CE loss. */
  private accumulatePolicyGrad(
    sample: PvSample,
    grads: PvGrads,
    policyWeight: number,
  ): number {
    const { bp, wp, h, hiddenSize } = this;
    const { actions, targets } = sample;
    const zs = actions.map((a) => {
      let z = bp[a];
      const row = a * hiddenSize;
      for (let j = 0; j < hiddenSize; j++) z += wp[row + j] * h[j];
      return z;
    });
    const zMax = Math.max(...zs);
    const exps = zs.map((z) => Math.exp(z - zMax));
    const zSum = exps.reduce((s, v) => s + v, 0);
    let loss = 0;
    for (let m = 0; m < actions.length; m++) {
      const pa = exps[m] / zSum;
      const t = targets[m];
      if (t > 0) loss -= t * Math.log(Math.max(pa, 1e-12));
      const dz = policyWeight * (pa - t);
      const a = actions[m];
      let gRow = grads.gwpRows.get(a);
      if (gRow === undefined) {
        gRow = new Float64Array(hiddenSize + 1); // last slot = bias grad
        grads.gwpRows.set(a, gRow);
      }
      gRow[hiddenSize] += dz;
      const row = a * hiddenSize;
      for (let j = 0; j < hiddenSize; j++) {
        if (h[j] <= 0) continue;
        gRow[j] += dz * h[j];
        grads.dh[j] += dz * wp[row + j];
      }
    }
    return loss;
  }

  /** Backprop `grads.dh` into the shared layer's gradient. */
  private accumulateHiddenGrad(x: Float32Array, grads: PvGrads): void {
    const { h, inputSize, hiddenSize } = this;
    for (let j = 0; j < hiddenSize; j++) {
      if (h[j] <= 0 || grads.dh[j] === 0) continue;
      const row = j * inputSize;
      for (let i = 0; i < inputSize; i++)
        grads.gw1[row + i] += grads.dh[j] * x[i];
      grads.gb1[j] += grads.dh[j];
    }
  }

  private applyGradStep(grads: PvGrads, step: number): void {
    const { w1, b1, wv, wp, bp, hiddenSize } = this;
    for (let i = 0; i < w1.length; i++) w1[i] -= step * grads.gw1[i];
    for (let j = 0; j < hiddenSize; j++) {
      b1[j] -= step * grads.gb1[j];
      wv[j] -= step * grads.gwv[j];
    }
    this.bv -= step * grads.gbv;
    for (const [a, gRow] of grads.gwpRows) {
      const row = a * hiddenSize;
      for (let j = 0; j < hiddenSize; j++) wp[row + j] -= step * gRow[j];
      bp[a] -= step * gRow[hiddenSize];
    }
  }

  private applyWeightDecay(decay: number): void {
    const { w1, wv, wp } = this;
    for (let i = 0; i < w1.length; i++) w1[i] *= decay;
    for (let j = 0; j < wv.length; j++) wv[j] *= decay;
    for (let i = 0; i < wp.length; i++) wp[i] *= decay;
  }

  /** Plain-array params for JSON, rounded to 6 decimals to keep files small. */
  toParams(): PvNetParams {
    const round = (v: number): number => Math.round(v * 1e6) / 1e6;
    return {
      inputSize: this.inputSize,
      hiddenSize: this.hiddenSize,
      actionCount: this.actionCount,
      w1: Array.from(this.w1, round),
      b1: Array.from(this.b1, round),
      wv: Array.from(this.wv, round),
      bv: round(this.bv),
      wp: Array.from(this.wp, round),
      bp: Array.from(this.bp, round),
    };
  }
}
