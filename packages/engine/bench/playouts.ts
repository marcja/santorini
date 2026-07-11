// Random-playout throughput benchmark: the number that bounds MCTS strength.
// Run: npm run bench -w @santorini/engine
import { applyTurnInPlace, cloneState, createInitialState, legalTurns } from '../src/index.ts';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = rng(12345);
const start = createInitialState();
let games = 0;
let halfTurns = 0;
const t0 = performance.now();
while (performance.now() - t0 < 3000) {
  const s = cloneState(start);
  while (s.phase !== 'over') {
    const turns = legalTurns(s);
    if (turns.length === 0) {
      s.phase = 'over';
      s.winner = s.player === 0 ? 1 : 0;
      break;
    }
    applyTurnInPlace(s, turns[Math.floor(rand() * turns.length)]);
    halfTurns++;
  }
  games++;
}
const secs = (performance.now() - t0) / 1000;
console.log(
  `${games} games in ${secs.toFixed(2)}s — ${(games / secs).toFixed(0)} games/s, ` +
    `${(halfTurns / secs / 1000).toFixed(1)}k turns/s (movegen+apply)`,
);
