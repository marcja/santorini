import type { GameState, Player, Turn } from '@santorini/engine';
import { applyTurnInPlace, cloneState, legalTurns } from '@santorini/engine';
import { evaluate } from './eval.ts';
import { resolveTurn, type AiPlayer } from './player.ts';
import { mulberry32, pick, type Rng } from './rng.ts';

export interface MctsOptions {
  /** Search iterations per move. */
  iterations?: number;
  /** UCT exploration constant. */
  c?: number;
  seed?: number;
  /**
   * Playout length before falling back to the static eval. Full random
   * playouts of Santorini carry almost no strategic signal; short win-aware
   * playouts scored by evaluate() are far stronger per iteration.
   */
  playoutDepth?: number;
}

/** Maps evaluate()'s scale onto (0,1) via a sigmoid. */
const EVAL_SCALE = 150;

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

/** UCT Monte-Carlo tree search over full engine turns, random playouts. */
export class MctsPlayer implements AiPlayer {
  readonly name: string;
  private readonly iterations: number;
  private readonly c: number;
  private readonly playoutDepth: number;
  private rand: Rng;

  constructor(opts: MctsOptions = {}) {
    this.iterations = opts.iterations ?? 1000;
    this.c = opts.c ?? 1.0;
    this.playoutDepth = opts.playoutDepth ?? 8;
    this.rand = mulberry32(opts.seed ?? 1);
    this.name = `mcts(${this.iterations})`;
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
      const path: Node[] = [root];
      let node = root;
      while (node.proven === null && node.untried.length === 0 && node.children.length > 0) {
        node = this.selectChild(node);
        path.push(node);
      }
      if (node.proven === null && node.untried.length > 0) {
        node = this.expand(node);
        path.push(node);
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

  private makeNode(turn: Turn | null, parent: Node | null, state: GameState): Node {
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
    return {
      turn,
      mover: parent ? parent.state.player : null,
      state,
      untried,
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

  private expand(node: Node): Node {
    // Swap-pop a random untried turn.
    const i = Math.floor(this.rand() * node.untried.length);
    const turn = node.untried[i];
    node.untried[i] = node.untried[node.untried.length - 1];
    node.untried.pop();
    const child = this.makeNode(turn, node, resolveTurn(node.state, turn));
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
    return 1 / (1 + Math.exp(-evaluate(s, 0) / EVAL_SCALE));
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
