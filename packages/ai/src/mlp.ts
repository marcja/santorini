import { mulberry32 } from './rng.ts';

// Minimal 1-hidden-layer value net (input → ReLU hidden → scalar logit),
// pure TS. Small enough to train on CPU and to ship as JSON in a checkpoint;
// port to WebGPU/ONNX only if this becomes the bottleneck (see PLAN.md).

/** JSON-serializable net parameters — what an `mlp@1` checkpoint stores. */
export interface MlpParams {
  inputSize: number;
  hiddenSize: number;
  /** hiddenSize × inputSize, row-major. */
  w1: number[];
  b1: number[];
  w2: number[];
  b2: number;
}

/** One training example: features + outcome for the encoded perspective. */
export interface Sample {
  x: Float32Array;
  /** 1 = the encoded player won, 0 = lost, 0.5 = draw (capped game). */
  y: number;
}

export interface TrainOptions {
  epochs?: number;
  batchSize?: number;
  /** SGD learning rate. */
  lr?: number;
  /** Shuffle seed. */
  seed?: number;
}

export class Mlp {
  readonly inputSize: number;
  readonly hiddenSize: number;
  private readonly w1: Float64Array;
  private readonly b1: Float64Array;
  private readonly w2: Float64Array;
  private b2: number;
  /** Hidden activations of the last forward() — reused by backprop. */
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: read via destructuring in forward()/train(), not a `this.h` access.
  private readonly h: Float64Array;

  constructor(params: MlpParams) {
    const { inputSize, hiddenSize } = params;
    if (
      params.w1.length !== hiddenSize * inputSize ||
      params.b1.length !== hiddenSize ||
      params.w2.length !== hiddenSize
    ) {
      throw new Error('MlpParams shape mismatch');
    }
    this.inputSize = inputSize;
    this.hiddenSize = hiddenSize;
    this.w1 = Float64Array.from(params.w1);
    this.b1 = Float64Array.from(params.b1);
    this.w2 = Float64Array.from(params.w2);
    this.b2 = params.b2;
    this.h = new Float64Array(hiddenSize);
  }

  /** He-initialized net; output weights scaled down so initial logits ≈ 0. */
  static init(inputSize: number, hiddenSize: number, seed: number): Mlp {
    const rand = mulberry32(seed);
    // Box-Muller; 1 - rand() keeps log() away from 0.
    const gauss = (): number =>
      Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
    const s1 = Math.sqrt(2 / inputSize);
    const s2 = 0.1 / Math.sqrt(hiddenSize);
    return new Mlp({
      inputSize,
      hiddenSize,
      w1: Array.from({ length: hiddenSize * inputSize }, () => gauss() * s1),
      b1: new Array(hiddenSize).fill(0),
      w2: Array.from({ length: hiddenSize }, () => gauss() * s2),
      b2: 0,
    });
  }

  /** Raw logit; sigmoid(logit) = predicted win probability for the encoded player. */
  forward(x: Float32Array): number {
    const { w1, b1, w2, h, inputSize, hiddenSize } = this;
    let logit = this.b2;
    for (let j = 0; j < hiddenSize; j++) {
      let z = b1[j];
      const row = j * inputSize;
      for (let i = 0; i < inputSize; i++) z += w1[row + i] * x[i];
      h[j] = z > 0 ? z : 0;
      logit += w2[j] * h[j];
    }
    return logit;
  }

  predict(x: Float32Array): number {
    return 1 / (1 + Math.exp(-this.forward(x)));
  }

  /**
   * Mini-batch SGD on binary cross-entropy. Returns the mean loss per epoch
   * (computed on the fly as each batch is seen, before its update).
   */
  train(samples: Sample[], opts: TrainOptions = {}): number[] {
    const epochs = opts.epochs ?? 4;
    const batchSize = opts.batchSize ?? 64;
    const lr = opts.lr ?? 0.05;
    const rand = mulberry32(opts.seed ?? 1);
    const { w1, b1, w2, h, inputSize, hiddenSize } = this;

    const gw1 = new Float64Array(w1.length);
    const gb1 = new Float64Array(hiddenSize);
    const gw2 = new Float64Array(hiddenSize);
    const order = samples.map((_, i) => i);
    const losses: number[] = [];

    for (let e = 0; e < epochs; e++) {
      // Fisher–Yates reshuffle each epoch.
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      let lossSum = 0;
      for (let start = 0; start < order.length; start += batchSize) {
        const end = Math.min(start + batchSize, order.length);
        gw1.fill(0);
        gb1.fill(0);
        gw2.fill(0);
        let gb2 = 0;
        for (let k = start; k < end; k++) {
          const { x, y } = samples[order[k]];
          const logit = this.forward(x);
          const p = 1 / (1 + Math.exp(-logit));
          lossSum +=
            y * Math.log(Math.max(p, 1e-12)) +
            (1 - y) * Math.log(Math.max(1 - p, 1e-12));
          const dLogit = p - y;
          gb2 += dLogit;
          for (let j = 0; j < hiddenSize; j++) {
            if (h[j] <= 0) continue;
            gw2[j] += dLogit * h[j];
            const dh = dLogit * w2[j];
            const row = j * inputSize;
            for (let i = 0; i < inputSize; i++) gw1[row + i] += dh * x[i];
            gb1[j] += dh;
          }
        }
        const step = lr / (end - start);
        for (let i = 0; i < w1.length; i++) w1[i] -= step * gw1[i];
        for (let j = 0; j < hiddenSize; j++) {
          b1[j] -= step * gb1[j];
          w2[j] -= step * gw2[j];
        }
        this.b2 -= step * gb2;
      }
      losses.push(-lossSum / order.length);
    }
    return losses;
  }

  /** Plain-array params for JSON, rounded to 6 decimals to keep files small. */
  toParams(): MlpParams {
    const round = (v: number): number => Math.round(v * 1e6) / 1e6;
    return {
      inputSize: this.inputSize,
      hiddenSize: this.hiddenSize,
      w1: Array.from(this.w1, round),
      b1: Array.from(this.b1, round),
      w2: Array.from(this.w2, round),
      b2: round(this.b2),
    };
  }
}
