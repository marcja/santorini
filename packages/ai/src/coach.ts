import type { GameState, MoveTurn, Player, Square, Turn } from '@santorini/engine';
import { cloneState, formatTurn, legalTurns, squareName } from '@santorini/engine';
import { MctsPlayer, type MctsOptions } from './mcts.ts';
import { resolveTurn } from './player.ts';

// Coach layer: turns engine facts (win-in-1s, threats) and search statistics
// (visits, values, PV) into structured analysis plus plain-language
// narration. Pure and synchronous like everything else in this package; the
// web app decides when to run it and how to render it. Narration speaks from
// the player to move's perspective ("you" / "the opponent") — color names
// are a UI concern.

/** Immediate winning turns for the player to move (empty outside `play`). */
export function winningTurns(state: GameState): MoveTurn[] {
  if (state.phase !== 'play') return [];
  return legalTurns(state).filter((t): t is MoveTurn => t.kind === 'move' && t.win);
}

const destination = (t: MoveTurn): Square => t.path[t.path.length - 1];

const uniqueSquares = (turns: MoveTurn[]): Square[] =>
  [...new Set(turns.map(destination))].sort((a, b) => a - b);

/**
 * Squares where the opponent could win *if it were their move* — the threats
 * this turn must beat, block, or accept. Computed by handing the position to
 * the opponent unchanged (god state such as Athena's block carries over).
 */
export function threatSquares(state: GameState): Square[] {
  if (state.phase !== 'play') return [];
  const flipped = cloneState(state);
  flipped.player = (1 - state.player) as Player;
  return uniqueSquares(winningTurns(flipped));
}

/** Post-move feedback: what a just-played turn achieved or gave away. */
export interface TurnReview {
  /** The mover won with this turn. */
  won: boolean;
  /** Squares where the mover could have won this turn but played elsewhere. */
  missedWins: Square[];
  /** Opponent win-in-1 squares left behind by this turn. */
  hangs: Square[];
  /** A non-hanging alternative existed (hangs with `avoidable` are blunders). */
  avoidable: boolean;
  /** Pre-existing opponent threats this turn defused. */
  blocked: Square[];
  /** Win-in-1 squares the mover now threatens for their next turn. */
  created: Square[];
}

/**
 * Review a turn about to be played from `state` (no search — exact one-ply
 * facts only). Cost: one movegen per legal alternative when the turn hangs.
 */
export function reviewTurn(state: GameState, turn: Turn): TurnReview {
  const review: TurnReview = {
    won: false,
    missedWins: [],
    hangs: [],
    avoidable: false,
    blocked: [],
    created: [],
  };
  if (state.phase !== 'play') return review;

  const winsBefore = uniqueSquares(winningTurns(state));
  const threatsBefore = threatSquares(state);
  const next = resolveTurn(state, turn);
  review.won = next.phase === 'over' && next.winner === state.player;
  if (review.won) return review;
  review.missedWins = winsBefore;
  if (next.phase === 'over') return review; // opponent left without a move

  review.hangs = uniqueSquares(winningTurns(next));
  review.blocked = threatsBefore.filter((sq) => !review.hangs.includes(sq));
  review.created = threatSquares(next);
  if (review.hangs.length > 0) {
    review.avoidable = legalTurns(state).some((t) => {
      const alt = resolveTurn(state, t);
      if (alt.phase === 'over') return alt.winner === state.player;
      return winningTurns(alt).length === 0;
    });
  }
  return review;
}

/** One step of a turn in words: "move b2→c3, then build at d3". */
export function describeTurn(state: GameState, turn: Turn): string {
  if (turn.kind === 'place') {
    return `place workers at ${turn.squares.map(squareName).join(' and ')}`;
  }
  const parts: string[] = [];
  const scratch = state.heights.slice();
  const build = (b: { at: Square; dome: boolean }): string => {
    const what = b.dome ? 'a dome' : scratch[b.at] === 2 ? 'to level 3' : 'a block';
    scratch[b.at] = b.dome ? 4 : scratch[b.at] + 1;
    return `build ${what} at ${squareName(b.at)}`;
  };
  for (const b of turn.preBuilds ?? []) parts.push(`${build(b)} before moving`);
  parts.push(`move ${turn.path.map(squareName).join('→')}`);
  for (const b of turn.builds) parts.push(build(b));
  const joined =
    parts.length <= 2
      ? parts.join(', then ')
      : `${parts.slice(0, -1).join(', ')}, then ${parts[parts.length - 1]}`;
  return turn.win ? `${joined}, winning the game` : joined;
}

/** Search-backed suggestion for the position, with narration. */
export interface CoachHint {
  /** Suggested turn plus its SGN string. */
  turn: Turn;
  notation: string;
  /** Win-probability estimate for the player to move (1 on an immediate win). */
  winProb: number;
  /** Immediate winning squares for the player to move. */
  wins: Square[];
  /** Opponent win-in-1 squares this turn must deal with. */
  threats: Square[];
  /** Expected continuation as SGN strings, suggestion first. */
  pv: string[];
  /** Root candidates by visits: SGN, visit share, value for the mover. */
  candidates: { notation: string; visits: number; value: number }[];
  /** Plain-language narration, most important line first. */
  lines: string[];
}

export interface CoachOptions extends MctsOptions {
  /** Root candidates to report (default 4). */
  topCandidates?: number;
  /** PV turns to report (default 5). */
  pvLength?: number;
}

/**
 * Analyze a position with a fresh (seeded) search and narrate the result.
 * `state` must have at least one legal turn — live `play`/`setup` states
 * always do (no-move losses resolve when the previous turn is played).
 */
export function coachHint(state: GameState, opts: CoachOptions = {}): CoachHint {
  const result = new MctsPlayer(opts).search(state);
  const wins = uniqueSquares(winningTurns(state));
  const threats = threatSquares(state);

  const pvStates: GameState[] = [state];
  const pv: string[] = [];
  for (const t of result.pv.slice(0, opts.pvLength ?? 5)) {
    const s = pvStates[pvStates.length - 1];
    pv.push(formatTurn(s, t));
    pvStates.push(resolveTurn(s, t));
  }
  const notation = formatTurn(state, result.turn);

  const lines: string[] = [];
  if (state.phase === 'setup') {
    lines.push(`Suggested: ${describeTurn(state, result.turn)}.`);
    lines.push('Central squares reach more of the board — corners cramp your options.');
  } else if (wins.length > 0) {
    lines.push(
      `You can win right now — ${describeTurn(state, result.turn)} (${notation}).`,
    );
  } else {
    if (threats.length > 0) {
      lines.push(
        `Danger: the opponent threatens to win at ${threats.map(squareName).join(', ')}. ` +
          'Your move must stop that (cap the tower, occupy or take the square, or block the approach) — or create a faster win.',
      );
    }
    lines.push(`Suggested: ${describeTurn(state, result.turn)} (${notation}).`);
    const after = resolveTurn(state, result.turn);
    if (after.phase === 'over' && after.winner === state.player) {
      lines.push('This leaves the opponent with no legal move — they lose immediately.');
    } else if (after.phase === 'play') {
      const hangsLeft = uniqueSquares(winningTurns(after));
      const madeThreats = threatSquares(after);
      if (threats.length > 0 && hangsLeft.length === 0) {
        lines.push('This deals with the immediate threat.');
      }
      if (madeThreats.length > 0) {
        lines.push(
          `It threatens a win at ${madeThreats.map(squareName).join(', ')} next turn — the opponent must respond.`,
        );
      }
    }
    lines.push(`Estimated winning chances after it: ${Math.round(result.value * 100)}%.`);
    if (pv.length > 1) lines.push(`Expected continuation: ${pv.join(' ')}`);
  }

  return {
    turn: result.turn,
    notation,
    winProb: result.value,
    wins,
    threats,
    pv,
    candidates: result.children.slice(0, opts.topCandidates ?? 4).map((ch) => ({
      notation: formatTurn(state, ch.turn),
      visits: ch.visits,
      value: ch.value,
    })),
    lines,
  };
}

/** Narrate a TurnReview (empty array = nothing noteworthy). */
export function reviewLines(review: TurnReview): string[] {
  const names = (sqs: Square[]): string => sqs.map(squareName).join(', ');
  const lines: string[] = [];
  if (review.won) return lines; // the banner says it all
  if (review.missedWins.length > 0) {
    lines.push(`You had a winning move onto ${names(review.missedWins)} and played something else.`);
  }
  if (review.hangs.length > 0) {
    lines.push(
      review.avoidable
        ? `This lets the opponent win at ${names(review.hangs)} — it was avoidable.`
        : `The opponent can now win at ${names(review.hangs)} — but every move allowed it.`,
    );
  } else if (review.blocked.length > 0) {
    lines.push(`Good: you defused the threat at ${names(review.blocked)}.`);
  }
  if (review.created.length > 0 && review.hangs.length === 0) {
    lines.push(`You now threaten to win at ${names(review.created)}.`);
  }
  return lines;
}
