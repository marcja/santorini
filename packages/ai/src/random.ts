import type { GameState, Turn } from '@santorini/engine';
import { legalTurns } from '@santorini/engine';
import type { AiPlayer } from './player.ts';
import { mulberry32, pick, type Rng } from './rng.ts';

/** Uniform random over legal turns — the floor of the strength ladder. */
export class RandomPlayer implements AiPlayer {
  readonly name = 'random';
  private rand: Rng;

  constructor(seed = 1) {
    this.rand = mulberry32(seed);
  }

  chooseTurn(state: GameState): Turn {
    const turns = legalTurns(state);
    if (turns.length === 0) throw new Error('no legal turns');
    return pick(this.rand, turns);
  }
}
