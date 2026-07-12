import type { GameState, GodId, Turn } from '@santorini/engine';
import { createInitialState, parseSquareName, square } from '@santorini/engine';
import { reviewLines, reviewTurn } from './coach.ts';

// Lesson curriculum: structured beginner→advanced strategy content. Each
// lesson is prose, optionally backed by an interactive exercise — a
// hand-authored position plus a goal the student's next turn is checked
// against with the coach's exact one-ply/two-ply facts. Pure data and pure
// checkers, like the rest of the package; the web app renders and drives
// them. Narration says "the opponent" — colors are a UI concern.

/** Declarative position: unlisted squares are level 0, workers by name. */
export interface LessonPosition {
  heights?: Record<string, number>;
  /** Seat-0 (student) worker squares. Fewer than 2 = still placing. */
  student?: string[];
  /** Seat-1 (opponent) worker squares. */
  opponent?: string[];
  gods?: [GodId, GodId];
}

/** Materialize a LessonPosition (student to move; phase derived). */
export function lessonState(spec: LessonPosition): GameState {
  const s = createInitialState({ gods: spec.gods ?? ['none', 'none'] });
  for (const [name, level] of Object.entries(spec.heights ?? {})) {
    s.heights[parseSquareName(name)] = level;
  }
  const student = spec.student ?? [];
  const opponent = spec.opponent ?? [];
  student.forEach((n, i) => (s.workers[i] = parseSquareName(n)));
  opponent.forEach((n, i) => (s.workers[2 + i] = parseSquareName(n)));
  s.phase = student.length === 2 && opponent.length === 2 ? 'play' : 'setup';
  return s;
}

/**
 * What the student's turn must achieve. All play-phase goals also accept an
 * outright win — finding a faster win than the intended answer never fails.
 */
export type ExerciseGoal =
  | 'win'
  | 'safe'
  | 'threat'
  | 'forced-win'
  | 'place-central';

export interface Exercise {
  /** The task, e.g. "Find the winning move." (color-agnostic). */
  task: string;
  position: LessonPosition;
  goal: ExerciseGoal;
  /** Nudge shown when the attempt fails, after the factual review lines. */
  hint: string;
}

export type LessonLevel = 'beginner' | 'intermediate' | 'advanced';

export interface Lesson {
  id: string;
  level: LessonLevel;
  title: string;
  /** Prose paragraphs (plain text). */
  body: string[];
  exercise?: Exercise;
}

export interface ExerciseResult {
  passed: boolean;
  /** Verdict + factual review lines (+ the hint when failed). */
  lines: string[];
}

/** The middle nine squares (b2..d4). */
const CENTER = new Set<number>();
for (let c = 1; c <= 3; c++)
  for (let r = 1; r <= 3; r++) CENTER.add(square(c, r));

const PRAISE: Record<Exclude<ExerciseGoal, 'place-central'>, string> = {
  win: "That's it — you moved up onto level 3 and won on the spot.",
  safe: 'Well played — the opponent is left with no winning move anywhere.',
  threat: "That's tempo — the opponent must spend their turn answering you.",
  'forced-win':
    'Perfect — more threats than one turn can answer. The game is decided.',
};

/** Judge the student's turn from `state` against the exercise goal. */
export function checkExercise(
  ex: Exercise,
  state: GameState,
  turn: Turn,
): ExerciseResult {
  if (ex.goal === 'place-central') {
    if (turn.kind !== 'place') return { passed: false, lines: [ex.hint] };
    const central = turn.squares.filter((q) => CENTER.has(q)).length;
    return central === 2
      ? {
          passed: true,
          lines: [
            'Both workers in the middle nine squares — they reach most of the board.',
          ],
        }
      : {
          passed: false,
          lines: [
            central === 1
              ? 'One of your workers starts on the rim, where it sees fewer squares.'
              : 'Both workers start on the rim, where they see fewer squares.',
            ex.hint,
          ],
        };
  }

  const review = reviewTurn(state, turn);
  const facts = reviewLines(review);
  const passed =
    review.won ||
    (ex.goal === 'safe' && review.hangs.length === 0) ||
    (ex.goal === 'threat' &&
      review.hangs.length === 0 &&
      review.created.length > 0) ||
    (ex.goal === 'forced-win' && review.decisive);
  return passed
    ? {
        passed,
        lines: [review.won ? PRAISE.win : PRAISE[ex.goal as 'safe'], ...facts],
      }
    : { passed, lines: [...facts, ex.hint] };
}

export const LESSONS: Lesson[] = [
  {
    id: 'how-you-win',
    level: 'beginner',
    title: 'How you win',
    body: [
      'You win Santorini by moving up onto a level-3 tower — stepping from ' +
        'level 2 to level 3 with either worker. Nothing else wins: finishing ' +
        'the tower is not enough, and a worker forced onto level 3 by a god ' +
        'power does not win either.',
      'Every turn is move-then-build: move one worker one space (climbing at ' +
        'most one level), then build one block next to where it landed. If ' +
        'you cannot complete both, you lose immediately — a winning move is ' +
        'the one exception, ending the game with no build.',
      'So the whole game is engineering one moment: your worker on level 2, ' +
        'a level-3 square beside it, and your opponent unable to stop the step up.',
    ],
    exercise: {
      task: 'Win the game right now.',
      position: {
        heights: { b2: 2, c3: 3 },
        student: ['b2', 'a1'],
        opponent: ['d5', 'e5'],
      },
      goal: 'win',
      hint: 'Find your worker on level 2 with a level-3 tower next to it — then step up.',
    },
  },
  {
    id: 'start-central',
    level: 'beginner',
    title: 'Start in the centre',
    body: [
      'A worker in the middle nine squares touches eight neighbours; on an ' +
        'edge it touches five, and in a corner only three. More neighbours ' +
        'means more moves, more places to build, and more escape routes when ' +
        'you are chased.',
      'Placement is your first real decision: claim the centre, and spread ' +
        'your workers enough that together they cover the board rather than ' +
        'crowding one corner of it.',
    ],
    exercise: {
      task: 'Place both of your workers (click two squares).',
      position: {},
      goal: 'place-central',
      hint: 'Try the middle nine squares — anywhere from b2 to d4.',
    },
  },
  {
    id: 'builds-are-offers',
    level: 'beginner',
    title: 'Every build is an offer',
    body: [
      'You build next to your own worker — but anyone may use the stairs. ' +
        'Before you build, look at every enemy worker touching that square: a ' +
        'block that raises it to one level above them is a free climb, and a ' +
        'block that completes a level-3 tower beside an enemy worker on level ' +
        '2 loses you the game on the spot.',
      'Prefer builds your workers can use and your opponent cannot reach — ' +
        'or at least cannot use yet.',
    ],
    exercise: {
      task: 'Make any move — but do not hand the opponent the game.',
      position: {
        heights: { c3: 2, d3: 2 },
        student: ['e3', 'a1'],
        opponent: ['c3', 'a5'],
      },
      goal: 'safe',
      hint:
        "The opponent's worker on c3 stands on level 2. If d3 becomes a " +
        'level-3 tower they step up and win — build anywhere else.',
    },
  },
  {
    id: 'stop-the-threat',
    level: 'beginner',
    title: 'See the threat, stop the threat',
    body: [
      'Before every move, ask: if it were my opponent’s turn, could they win ' +
        'right now? A level-3 square beside one of their level-2 workers is a ' +
        'threat, and it outranks whatever plan you had.',
      'To defuse one: build on the level-3 square (a build on level 3 is ' +
        'always a dome, sealing it forever), occupy it with your own worker ' +
        'if you can legally reach it, or beat it by winning first. Ignoring ' +
        'a threat for one turn is losing.',
    ],
    exercise: {
      task: 'The opponent threatens to win — stop it.',
      position: {
        heights: { d4: 2, e4: 3 },
        student: ['e3', 'a1'],
        opponent: ['d4', 'a5'],
      },
      goal: 'safe',
      hint: 'e4 is a finished tower. Move somewhere that still touches e4, then cap it with a dome.',
    },
  },
  {
    id: 'domes-are-weapons',
    level: 'intermediate',
    title: 'Domes are weapons',
    body: [
      'A dome permanently deletes a square — no one may ever move onto it or ' +
        'build on it again. In the base game you can only dome a completed ' +
        'level-3 tower, so every dome is a deliberate choice to remove part ' +
        'of the board.',
      'Cap the towers your opponent would win from — but notice the price: a ' +
        'domed tower can never win for you either. When a tower could still ' +
        'be yours, taking it or out-racing them may beat sealing it.',
    ],
    exercise: {
      task: 'Two enemy workers eye the tower at e4 — shut it down for good.',
      position: {
        heights: { e4: 3, d4: 2, e5: 2 },
        student: ['d3', 'a1'],
        opponent: ['d4', 'e5'],
      },
      goal: 'safe',
      hint: 'You cannot guard two doors with one worker — dome e4 itself.',
    },
  },
  {
    id: 'threats-gain-tempo',
    level: 'intermediate',
    title: 'Threaten to gain tempo',
    body: [
      'A threat forces an answer. When your worker climbs to level 2 beside ' +
        'a level-3 tower, your opponent must spend their whole turn on it — ' +
        'dome it or lose — while your next turn is free again. That is ' +
        'tempo: you develop, they react.',
      'Strong positions keep a threat standing at all times. Every turn your ' +
        'opponent spends answering you is a turn they are not building their ' +
        'own tower.',
    ],
    exercise: {
      task: 'Create a threat the opponent must answer.',
      position: {
        heights: { b2: 1, b3: 2, c3: 3 },
        student: ['b2', 'e1'],
        opponent: ['d5', 'e5'],
      },
      goal: 'threat',
      hint:
        'Climb: get a worker onto level 2 touching the level-3 tower at c3 — ' +
        'and be careful where you build afterwards.',
    },
  },
  {
    id: 'double-threat',
    level: 'intermediate',
    title: 'The double threat',
    body: [
      'One threat can be answered; two at once usually cannot — a single ' +
        'turn caps one tower, not two. Creating two winning squares with one ' +
        'move is the cleanest forced win in Santorini.',
      'Look for the geometry: a level-2 square adjacent to two level-3 ' +
        'towers. Land a worker there and both towers become winning squares ' +
        'at once. Mind the build, though — building on either tower would ' +
        'dome your own win.',
    ],
    exercise: {
      task: 'Find the move the opponent cannot answer.',
      position: {
        heights: { b3: 3, d3: 3, c3: 2, c2: 1 },
        student: ['c2', 'a1'],
        opponent: ['d5', 'e5'],
      },
      goal: 'forced-win',
      hint: 'c3 touches both towers. Climb onto it — and build somewhere harmless.',
    },
  },
  {
    id: 'count-the-race',
    level: 'advanced',
    title: 'Count the race',
    body: [
      'When both sides threaten to win, tempo decides: whoever is to move ' +
        'wins the race. Do not reflexively defend — count first. If you can ' +
        'win this turn, their threat never happens; if you both need one ' +
        'more turn, the player to move gets there first.',
      '“Always answer threats” is a beginner’s rule. The expert asks: who ' +
        'wins if nobody blocks?',
    ],
    exercise: {
      task: 'The opponent threatens e4 — but look closer before you defend.',
      position: {
        heights: { b2: 2, c3: 3, d4: 2, e4: 3 },
        student: ['b2', 'e3'],
        opponent: ['d4', 'a5'],
      },
      goal: 'win',
      hint: 'You never need to stop a race you can win first — step up to c3.',
    },
  },
  {
    id: 'god-powers-bend-rules',
    level: 'advanced',
    title: 'God powers bend every rule',
    body: [
      'Each god rewrites one rule, and strategy follows. Pan also wins by ' +
        'moving DOWN two or more levels, so under Pan height is ammunition, ' +
        'not just progress. Athena punishes climbing: if she moved up on her ' +
        'last turn, your workers cannot move up this turn — her climbs steal ' +
        'tempo. Atlas may dome at any level, so no square is ever truly safe.',
      'Read your opponent’s card before your first placement and ask: which ' +
        'of my instincts does this god break? Threats, blocks and races all ' +
        'change shape.',
    ],
    exercise: {
      task: 'You have Pan. Win this turn.',
      position: {
        gods: ['pan', 'none'],
        heights: { b2: 2 },
        student: ['b2', 'd1'],
        opponent: ['d5', 'e5'],
      },
      goal: 'win',
      hint: 'Pan also wins by moving down two or more levels — step off the tower.',
    },
  },
  {
    id: 'mobility-and-height',
    level: 'advanced',
    title: 'Height is initiative, mobility is life',
    body: [
      'The player whose workers stand higher dictates play: a worker on ' +
        'level 2 radiates threats every turn, and level-1 workers climb ' +
        'faster than grounded ones. Climb whenever it is safe — but remember ' +
        'every step you build for yourself is a step your opponent might use.',
      'Watch mobility too. A worker on level 0 hemmed in by rising towers is ' +
        'drowning: if your turn ever starts with no legal move-and-build, you ' +
        'lose on the spot. Walling in an enemy worker with builds it cannot ' +
        'follow is as good as a tower win — and domes make the wall permanent.',
      'Put it together and the endgame is a counting exercise: threats force ' +
        'answers, answers cost tempo, and the player who banked more height ' +
        'and mobility converts first.',
    ],
  },
];
