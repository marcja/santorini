import type { GameState, Turn } from '@santorini/engine';
import { legalTurns } from '@santorini/engine';
import { evaluate } from './eval.ts';
import { resolveTurn, type AiPlayer } from './player.ts';
import { mulberry32, pick, type Rng } from './rng.ts';

const LOSS_PENALTY = 1e6;
const DECIDED = 1e9;

/**
 * One-ply greedy baseline: take an immediate win, never hand the opponent
 * an immediate win when avoidable, otherwise maximize the static eval.
 * Ties break uniformly at random (seeded).
 */
export class GreedyPlayer implements AiPlayer {
  readonly name = 'greedy';
  private rand: Rng;

  constructor(seed = 1) {
    this.rand = mulberry32(seed);
  }

  chooseTurn(state: GameState): Turn {
    const turns = legalTurns(state);
    if (turns.length === 0) throw new Error('no legal turns');
    const wins = turns.filter((t) => t.kind === 'move' && t.win);
    if (wins.length > 0) return pick(this.rand, wins);

    let bestScore = -Infinity;
    let best: Turn[] = [];
    for (const t of turns) {
      const next = resolveTurn(state, t);
      let score: number;
      if (next.phase === 'over') {
        // Only reachable as a win here (immediate wins were taken above,
        // so this is the opponent left with no move+build).
        score = next.winner === state.player ? DECIDED : -DECIDED;
      } else {
        score = evaluate(next, state.player);
        // Placements can't be won into; skip the opponent-win probe in setup.
        if (next.phase === 'play' && legalTurns(next).some((ot) => ot.kind === 'move' && ot.win)) {
          score -= LOSS_PENALTY;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = [t];
      } else if (score === bestScore) {
        best.push(t);
      }
    }
    return pick(this.rand, best);
  }
}
