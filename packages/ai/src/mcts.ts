import type { GameState, Player, Turn } from '@santorini/engine';
import { applyTurnInPlace, cloneState, legalTurns } from '@santorini/engine';
import { EVAL_SCALE, evaluate, type EvalFn } from './eval.ts';
import type { PolicyFn } from './policy.ts';
import { resolveTurn, type AiPlayer } from './player.ts';
import { mulberry32, pick, type Rng } from './rng.ts';

export interface MctsOptions {
  /** Search iterations per move. */
  iterations?: number;
  /** Exploration constant (UCT; also PUCT's c_puct when `policy` is set). */
  c?: number;
  seed?: number;
  /**
   * Playout length before falling back to the static eval. Full random
   * playouts of Santorini carry almost no strategic signal; short win-aware
   * playouts scored by evaluate() are far stronger per iteration.
   */
  playoutDepth?: number;
  /** Horizon evaluator (default: the static eval) — where a learned eval plugs in. */
  evaluate?: EvalFn;
  /**
   * Turn priors (a trained policy head). When set, selection/expansion use
   * PUCT — prior-guided, highest-prior turns explored first — instead of
   * UCT with uniform random expansion.
   */
  policy?: PolicyFn;
  /** Display name (default `mcts(<iterations>)`). */
  name?: string;
}

export interface TurnStat {
  turn: Turn;
  visits: number;
  /** Win-rate estimate from the searching player's perspective. */
  value: number;
}

/** Search statistics — the explainability channel the coach layer consumes. */
export interface SearchResult {
  turn: Turn;
  /** Total iterations spent at the root. */
  visits: number;
  /** Value estimate of the chosen turn. */
  value: number;
  /** Root children sorted by visits, descending. */
  children: TurnStat[];
  /** Principal variation: most-visited line from the root. */
  pv: Turn[];
}

interface Node {
  /** Turn that led here (null at root) and who played it. */
  turn: Turn | null;
  mover: Player | null;
  state: GameState;
  untried: Turn[];
  /** Prior of each untried turn (PUCT only), aligned with `untried`, which is
   * kept sorted ascending by prior so pop() expands the most promising next. */
  untriedPriors: Float64Array | null;
  /** Prior of the turn that led here (1 under plain UCT). */
  prior: number;
  children: Node[];
  visits: number;
  /** Accumulated playout value from `mover`'s perspective. */
  value: number;
  /**
   * Exact winner when known: the game is over here, or the player to move
   * has an immediate win (one-ply MCTS-Solver — without it, low-budget
   * search hangs win-in-1s whenever the refuting grandchild goes unexpanded).
   */
  proven: Player | null;
}

/** First-play urgency: assumed value of a never-visited turn under PUCT. */
const FPU = 0.5;

/**
 * Monte-Carlo tree search over full engine turns: UCT with uniform random
 * expansion, or PUCT when a policy supplies turn priors.
 */
export class MctsPlayer implements AiPlayer {
  readonly name: string;
  private readonly iterations: number;
  private readonly c: number;
  private readonly playoutDepth: number;
  private readonly evalFn: EvalFn;
  private readonly policy: PolicyFn | null;
  private rand: Rng;

  constructor(opts: MctsOptions = {}) {
    this.iterations = opts.iterations ?? 1000;
    this.c = opts.c ?? 1.0;
    this.playoutDepth = opts.playoutDepth ?? 8;
    this.evalFn = opts.evaluate ?? evaluate;
    this.policy = opts.policy ?? null;
    this.rand = mulberry32(opts.seed ?? 1);
    this.name = opts.name ?? `mcts(${this.iterations})`;
  }

  chooseTurn(state: GameState): Turn {
    return this.search(state).turn;
  }

  search(state: GameState): SearchResult {
    const legal = legalTurns(state);
    if (legal.length === 0) throw new Error('no legal turns');

    // Never search when an immediate win exists (searching can't rank it
    // above alternatives that also win eventually under win-aware playouts).
    const winTurn = legal.find((t) => t.kind === 'move' && t.win);
    if (winTurn) {
      const stat = { turn: winTurn, visits: 0, value: 1 };
      return { turn: winTurn, visits: 0, value: 1, children: [stat], pv: [winTurn] };
    }

    const root = this.makeNode(null, null, state);

    for (let i = 0; i < this.iterations; i++) {
      // Select down to a leaf, expand one child, evaluate, backpropagate.
      // UCT expands as soon as a node has untried turns; PUCT weighs the best
      // untried prior against the expanded children every step.
      const path: Node[] = [root];
      let node = root;
      while (node.proven === null) {
        if (this.policy !== null) {
          if (node.untried.length === 0 && node.children.length === 0) break;
          const pick = this.selectPuct(node);
          node = pick ?? this.expand(node);
          path.push(node);
          if (pick === null) break;
        } else {
          if (node.untried.length > 0) {
            node = this.expand(node);
            path.push(node);
            break;
          }
          if (node.children.length === 0) break;
          node = this.selectChild(node);
          path.push(node);
        }
      }
      const v0 = node.proven !== null ? (node.proven === 0 ? 1 : 0) : this.playout(node.state);
      for (const n of path) {
        n.visits++;
        if (n.mover !== null) n.value += n.mover === 0 ? v0 : 1 - v0;
      }
    }

    const children = [...root.children].sort((a, b) => b.visits - a.visits);
    const bestChild = children[0];
    return {
      turn: bestChild.turn!,
      visits: root.visits,
      value: bestChild.visits > 0 ? bestChild.value / bestChild.visits : 0.5,
      children: children.map((ch) => ({
        turn: ch.turn!,
        visits: ch.visits,
        value: ch.visits > 0 ? ch.value / ch.visits : 0.5,
      })),
      pv: principalVariation(root),
    };
  }

  private makeNode(turn: Turn | null, parent: Node | null, state: GameState, prior = 1): Node {
    let proven: Player | null = null;
    let untried: Turn[] = [];
    if (state.phase === 'over') {
      proven = state.winner;
    } else {
      untried = legalTurns(state);
      if (untried.some((t) => t.kind === 'move' && t.win)) {
        proven = state.player;
        untried = []; // decided — never expand below a proven node
      }
    }
    let untriedPriors: Float64Array | null = null;
    if (this.policy !== null && untried.length > 0) {
      // Positions the policy declines (placement) get uniform priors.
      const priors = this.policy(state, untried) ?? new Float64Array(untried.length).fill(1 / untried.length);
      // Sort turns ascending by prior so expand() pops the best remaining.
      const order = untried.map((_, i) => i).sort((a, b) => priors[a] - priors[b]);
      untried = order.map((i) => untried[i]);
      untriedPriors = Float64Array.from(order, (i) => priors[i]);
    }
    return {
      turn,
      mover: parent ? parent.state.player : null,
      state,
      untried,
      untriedPriors,
      prior,
      children: [],
      visits: 0,
      value: 0,
      proven,
    };
  }

  private selectChild(node: Node): Node {
    const logN = Math.log(node.visits);
    let best = node.children[0];
    let bestUct = -Infinity;
    for (const ch of node.children) {
      const uct = ch.value / ch.visits + this.c * Math.sqrt(logN / ch.visits);
      if (uct > bestUct) {
        bestUct = uct;
        best = ch;
      }
    }
    return best;
  }

  /**
   * PUCT step: Q + c·P·√N/(1+n) over expanded children, versus the best
   * untried turn at first-play urgency. Returns the child to descend into,
   * or null to expand the top untried turn.
   */
  private selectPuct(node: Node): Node | null {
    const sqrtN = Math.sqrt(node.visits);
    let best: Node | null = null;
    let bestScore = -Infinity;
    if (node.untried.length > 0) {
      const p = node.untriedPriors![node.untried.length - 1];
      bestScore = FPU + this.c * p * sqrtN;
    }
    for (const ch of node.children) {
      const score = ch.value / ch.visits + (this.c * ch.prior * sqrtN) / (1 + ch.visits);
      if (score > bestScore) {
        bestScore = score;
        best = ch;
      }
    }
    return best;
  }

  private expand(node: Node): Node {
    let turn: Turn;
    let prior = 1;
    if (this.policy === null) {
      // UCT: swap-pop a random untried turn.
      const i = Math.floor(this.rand() * node.untried.length);
      turn = node.untried[i];
      node.untried[i] = node.untried[node.untried.length - 1];
      node.untried.pop();
    } else {
      // PUCT: pop the highest remaining prior (untried is sorted ascending).
      turn = node.untried.pop()!;
      prior = node.untriedPriors![node.untried.length];
    }
    const child = this.makeNode(turn, node, resolveTurn(node.state, turn), prior);
    node.children.push(child);
    return child;
  }

  /**
   * Short random playout (immediate wins always taken — uniform playouts
   * barely punish hanging a win-in-1), scored by the static eval at the
   * horizon. Returns player 0's win probability.
   */
  private playout(state: GameState): number {
    const s = cloneState(state);
    for (let n = 0; n < this.playoutDepth && s.phase !== 'over'; n++) {
      const turns = legalTurns(s);
      if (turns.length === 0) return s.player === 0 ? 0 : 1;
      const winning = turns.find((t) => t.kind === 'move' && t.win);
      applyTurnInPlace(s, winning ?? pick(this.rand, turns));
    }
    if (s.phase === 'over') return s.winner === 0 ? 1 : 0;
    return 1 / (1 + Math.exp(-this.evalFn(s, 0) / EVAL_SCALE));
  }
}

function principalVariation(root: Node): Turn[] {
  const pv: Turn[] = [];
  let node = root;
  while (node.children.length > 0) {
    let best = node.children[0];
    for (const ch of node.children) if (ch.visits > best.visits) best = ch;
    if (best.visits === 0) break;
    pv.push(best.turn!);
    node = best;
  }
  return pv;
}
