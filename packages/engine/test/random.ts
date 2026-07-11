import { Game, type GodId } from '../src/index.ts';

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Play a uniformly-random game to completion. */
export function randomGame(gods: [GodId, GodId], seed: number, maxHalfTurns = 400): Game {
  const rand = rng(seed);
  const game = new Game({ gods });
  let n = 0;
  while (!game.isOver) {
    if (++n > maxHalfTurns) throw new Error(`game did not terminate in ${maxHalfTurns} half-turns`);
    const turns = game.legalTurns();
    game.play(turns[Math.floor(rand() * turns.length)]);
  }
  return game;
}
