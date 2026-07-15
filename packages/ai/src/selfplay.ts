import type { GameState, GodId, Player } from '@santorini/engine';
import { createInitialState, formatTurn } from '@santorini/engine';
import type { SearchConfig } from './checkpoint.ts';
import type { EvalFn } from './eval.ts';
import { encodeFeatures, encodeFeaturesV2 } from './features.ts';
import { MctsPlayer, type SearchResult } from './mcts.ts';
import { resolveTurn } from './player.ts';
import { type PolicyFn, turnAction } from './policy.ts';
import type { PvSample } from './pvnet.ts';
import { mulberry32 } from './rng.ts';

const NO_GODS: [GodId, GodId] = ['none', 'none'];

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
  /**
   * Gods for board seats 0/1 (default: base game, no gods), threaded to
   * `createInitialState`. A fixed pair for the whole batch — per-game
   * matchup variety (e.g. `trainer train --god-pool`) is composed by callers
   * making repeated single/small-batch `selfPlay` calls with different
   * `gods`, not by this config (mirrors T2's `RunConfig.gods`).
   */
  gods?: [GodId, GodId];
  /**
   * Feature encoding samples are produced with (`x`'s width). Defaults to
   * v1 (`FEATURE_COUNT` = 175). Pass `'v2'` when the parent checkpoint's
   * eval type is `mlp@2`/`pv@2` (`FEATURE_COUNT_V2` = 295, god one-hots +
   * state flags — docs/milestones/god-ai-encoding-v2.md) — the same
   * distinction `checkpoint.ts`'s `checkpointEvalFn` uses to pick an
   * encoder. Independent of `gods`: a v1 parent playing a god config still
   * produces god-blind v1 samples (the static eval understands gods
   * directly; the v1 planes don't), while a v2 parent produces v2 samples
   * even in the base game.
   */
  featureEncoding?: 'v1' | 'v2';
}

export interface SelfPlayGame {
  /** null = draw (half-turn cap). */
  winner: Player | null;
  /** SGN turn strings in play order — dumpable for replay/debugging. */
  sgn: string[];
  /** Gods for board seats 0/1 this game was played under (see `RunConfig.gods` in apps/trainer/src/run.ts). */
  gods: [GodId, GodId];
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
  const gods = config.gods ?? NO_GODS;
  const encode =
    config.featureEncoding === 'v2' ? encodeFeaturesV2 : encodeFeatures;
  const rand = mulberry32(config.seed ^ 0x5e1f);
  const games: SelfPlayGame[] = [];
  const samples: PvSample[] = [];

  for (let g = 0; g < config.games; g++) {
    const players = makeSelfPlayPlayers(config, g);
    const played = playOneSelfPlayGame(
      players,
      rand,
      temperatureTurns,
      maxHalfTurns,
      gods,
      encode,
    );
    samples.push(...played.samples);
    games.push(played.game);
    onGame?.(played.game, g);
  }
  return { games, samples };
}

function makeSelfPlayPlayers(config: SelfPlayConfig, g: number): MctsPlayer[] {
  return [0, 1].map(
    (p) =>
      new MctsPlayer({
        ...config.search,
        evaluate: config.evaluate,
        policy: config.policy,
        seed: config.seed + 2 * g + p,
      }),
  );
}

/** A position seen mid-game, labeled once the game's winner is known. */
interface SeenPosition {
  x: Float32Array;
  mover: Player;
  actions: number[];
  targets: number[];
}

function playOneSelfPlayGame(
  players: MctsPlayer[],
  rand: () => number,
  temperatureTurns: number,
  maxHalfTurns: number,
  gods: [GodId, GodId],
  encode: (state: GameState) => Float32Array,
): { game: SelfPlayGame; samples: PvSample[] } {
  let state = createInitialState({ gods });
  const sgn: string[] = [];
  const seen: SeenPosition[] = [];
  while (state.phase !== 'over' && sgn.length < maxHalfTurns) {
    const result = players[state.player].search(state);
    if (state.phase === 'play') {
      seen.push({
        x: encode(state),
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
  const samples = seen.map(({ x, mover, actions, targets }) => ({
    x,
    y: winner === null ? 0.5 : winner === mover ? 1 : 0,
    actions,
    targets,
  }));
  return { game: { winner, sgn, gods }, samples };
}
