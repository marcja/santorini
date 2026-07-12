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
    const { w1, b1, wv, wp, bp, h, inputSize, hiddenSize } = this;

    const gw1 = new Float64Array(w1.length);
    const gb1 = new Float64Array(hiddenSize);
    const gwv = new Float64Array(hiddenSize);
    const dh = new Float64Array(hiddenSize);
    // Policy grads are sparse (legal actions only) — accumulate per-row and
    // remember which rows were touched this batch.
    const gwpRows = new Map<number, Float64Array>();
    const order = samples.map((_, i) => i);
    const losses: PvEpochLoss[] = [];

    for (let e = 0; e < epochs; e++) {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      let valueLossSum = 0;
      let policyLossSum = 0;
      let policySamples = 0;
      for (let start = 0; start < order.length; start += batchSize) {
        const end = Math.min(start + batchSize, order.length);
        gw1.fill(0);
        gb1.fill(0);
        gwv.fill(0);
        let gbv = 0;
        gwpRows.clear();
        for (let k = start; k < end; k++) {
          const { x, y, actions, targets } = samples[order[k]];
          const logit = this.valueForward(x); // fills this.h
          const p = 1 / (1 + Math.exp(-logit));
          valueLossSum -=
            y * Math.log(Math.max(p, 1e-12)) +
            (1 - y) * Math.log(Math.max(1 - p, 1e-12));
          const dLogit = p - y;
          gbv += dLogit;
          dh.fill(0);
          for (let j = 0; j < hiddenSize; j++) {
            if (h[j] <= 0) continue;
            gwv[j] += dLogit * h[j];
            dh[j] = dLogit * wv[j];
          }

          if (actions.length > 0) {
            policySamples++;
            // Masked softmax over this sample's legal actions.
            const zs = actions.map((a) => {
              let z = bp[a];
              const row = a * hiddenSize;
              for (let j = 0; j < hiddenSize; j++) z += wp[row + j] * h[j];
              return z;
            });
            const zMax = Math.max(...zs);
            const exps = zs.map((z) => Math.exp(z - zMax));
            const zSum = exps.reduce((s, v) => s + v, 0);
            for (let m = 0; m < actions.length; m++) {
              const pa = exps[m] / zSum;
              const t = targets[m];
              if (t > 0) policyLossSum -= t * Math.log(Math.max(pa, 1e-12));
              const dz = policyWeight * (pa - t);
              const a = actions[m];
              let gRow = gwpRows.get(a);
              if (gRow === undefined) {
                gRow = new Float64Array(hiddenSize + 1); // last slot = bias grad
                gwpRows.set(a, gRow);
              }
              gRow[hiddenSize] += dz;
              const row = a * hiddenSize;
              for (let j = 0; j < hiddenSize; j++) {
                if (h[j] <= 0) continue;
                gRow[j] += dz * h[j];
                dh[j] += dz * wp[row + j];
              }
            }
          }

          for (let j = 0; j < hiddenSize; j++) {
            if (h[j] <= 0 || dh[j] === 0) continue;
            const row = j * inputSize;
            for (let i = 0; i < inputSize; i++) gw1[row + i] += dh[j] * x[i];
            gb1[j] += dh[j];
          }
        }

        const step = lr / (end - start);
        for (let i = 0; i < w1.length; i++) w1[i] -= step * gw1[i];
        for (let j = 0; j < hiddenSize; j++) {
          b1[j] -= step * gb1[j];
          wv[j] -= step * gwv[j];
        }
        this.bv -= step * gbv;
        for (const [a, gRow] of gwpRows) {
          const row = a * hiddenSize;
          for (let j = 0; j < hiddenSize; j++) wp[row + j] -= step * gRow[j];
          bp[a] -= step * gRow[hiddenSize];
        }
        if (weightDecay > 0) {
          const decay = 1 - lr * weightDecay;
          for (let i = 0; i < w1.length; i++) w1[i] *= decay;
          for (let j = 0; j < hiddenSize; j++) wv[j] *= decay;
          for (let i = 0; i < wp.length; i++) wp[i] *= decay;
        }
      }
      losses.push({
        value: valueLossSum / order.length,
        policy: policySamples > 0 ? policyLossSum / policySamples : 0,
      });
    }
    return losses;
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
