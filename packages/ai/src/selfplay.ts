import type { Player } from '@santorini/engine';
import { createInitialState, formatTurn } from '@santorini/engine';
import type { SearchConfig } from './checkpoint.ts';
import type { EvalFn } from './eval.ts';
import { encodeFeatures } from './features.ts';
import { MctsPlayer, type SearchResult } from './mcts.ts';
import { resolveTurn } from './player.ts';
import { type PolicyFn, turnAction } from './policy.ts';
import type { PvSample } from './pvnet.ts';
import { mulberry32 } from './rng.ts';

// Self-play data generation: the current checkpoint's searcher plays itself;
// every play-phase position becomes a training sample labeled with the final
// outcome from the mover's perspective, plus the search's root visit
// distribution as the policy target (what a pv net's policy head learns).

export interface SelfPlayConfig {
  games: number;
  seed: number;
  search: SearchConfig;
  /** Eval the self-play searcher uses (the parent checkpoint's). */
  evaluate: EvalFn;
  /** Turn priors for the searcher (a pv parent's policy head) — enables PUCT. */
  policy?: PolicyFn;
  /**
   * For the first N half-turns of each game, pick moves proportionally to
   * visit counts instead of argmax — without this every game repeats the
   * same deterministic opening and the net sees almost no position variety.
   */
  temperatureTurns?: number;
  /** Games longer than this are labeled 0.5 for both sides. */
  maxHalfTurns?: number;
}

export interface SelfPlayGame {
  /** null = draw (half-turn cap). */
  winner: Player | null;
  /** SGN turn strings in play order — dumpable for replay/debugging. */
  sgn: string[];
}

export interface SelfPlayResult {
  games: SelfPlayGame[];
  samples: PvSample[];
}

/** Sample a root child proportionally to visits (argmax when unvisited). */
function sampleTurn(
  result: SearchResult,
  rand: () => number,
): SearchResult['turn'] {
  const total = result.children.reduce((n, ch) => n + ch.visits, 0);
  if (total === 0) return result.turn;
  let r = rand() * total;
  for (const ch of result.children) {
    r -= ch.visits;
    if (r <= 0) return ch.turn;
  }
  return result.turn;
}

/**
 * The search's root visit distribution as a sparse policy target, aggregated
 * by action index (turns can share an encoding) and normalized over the
 * encodable turns. The instant-win shortcut searches nothing — its target is
 * all mass on the winning action.
 */
function policyTarget(result: SearchResult): {
  actions: number[];
  targets: number[];
} {
  const weights = new Map<number, number>();
  let sum = 0;
  const add = (action: number | null, w: number): void => {
    if (action === null || w <= 0) return;
    weights.set(action, (weights.get(action) ?? 0) + w);
    sum += w;
  };
  if (result.visits === 0) add(turnAction(result.turn), 1);
  else for (const ch of result.children) add(turnAction(ch.turn), ch.visits);
  const actions = [...weights.keys()];
  return { actions, targets: actions.map((a) => weights.get(a)! / sum) };
}

export function selfPlay(
  config: SelfPlayConfig,
  onGame?: (game: SelfPlayGame, index: number) => void,
): SelfPlayResult {
  const temperatureTurns = config.temperatureTurns ?? 8;
  const maxHalfTurns = config.maxHalfTurns ?? 400;
  const rand = mulberry32(config.seed ^ 0x5e1f);
  const games: SelfPlayGame[] = [];
  const samples: PvSample[] = [];

  for (let g = 0; g < config.games; g++) {
    const players = [0, 1].map(
      (p) =>
        new MctsPlayer({
          ...config.search,
          evaluate: config.evaluate,
          policy: config.policy,
          seed: config.seed + 2 * g + p,
        }),
    );

    let state = createInitialState();
    const sgn: string[] = [];
    // Positions seen this game, with who was to move; labeled once we know the winner.
    const seen: {
      x: Float32Array;
      mover: Player;
      actions: number[];
      targets: number[];
    }[] = [];
    while (state.phase !== 'over' && sgn.length < maxHalfTurns) {
      const result = players[state.player].search(state);
      if (state.phase === 'play') {
        seen.push({
          x: encodeFeatures(state),
          mover: state.player,
          ...policyTarget(result),
        });
      }
      const turn =
        sgn.length < temperatureTurns ? sampleTurn(result, rand) : result.turn;
      sgn.push(formatTurn(state, turn));
      state = resolveTurn(state, turn);
    }
    const winner = state.phase === 'over' ? state.winner : null;

    for (const { x, mover, actions, targets } of seen) {
      samples.push({
        x,
        y: winner === null ? 0.5 : winner === mover ? 1 : 0,
        actions,
        targets,
      });
    }
    const game: SelfPlayGame = { winner, sgn };
    games.push(game);
    onGame?.(game, g);
  }
  return { games, samples };
}
