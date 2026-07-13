import {
  type AiPlayer,
  type CoachHint,
  checkExercise,
  coachHint,
  type ExerciseResult,
  LESSONS,
  type Lesson,
  type LessonLevel,
  lessonState,
  reviewLines,
  reviewTurn,
  threatSquares,
  winningTurns,
} from '@santorini/ai';
import {
  type BuildAction,
  colOf,
  Game,
  type GameState,
  GOD_IDS,
  GODS,
  type GodId,
  type MoveTurn,
  ownerOf,
  rowOf,
  type Square,
  squareName,
  type Turn,
  workerAt,
} from '@santorini/engine';
import { AI_LEVELS, COACH_EVAL, COACH_POLICY } from './ai.ts';
import './style.css';

// Pass-and-play with god powers. Engine player 0 always moves first; which
// COLOR (Blue/Amber) sits in seat 0 is decided by the draft's Start Player
// choice, tracked in `seatColor`.
//
// Turn input is generic: clicks accumulate a partial turn (pre-builds, move
// path, builds) that is prefix-matched against legalTurns(), so multi-step
// god turns — Artemis paths, Demeter/Hephaestus double builds, Prometheus
// pre-builds, Atlas domes — need no god-specific UI code. When one square
// admits several next actions a chooser appears; when the partial already
// forms a complete turn but optional extras remain, a "Finish turn" button
// plays it.
//
// Replay/analysis: step through the current game's history (buttons, arrow
// keys, or clicking a move in the record) or load a pasted SGN record.
//
// God selection follows the rulebook draft (rulebook p.2, "God Power Setup"):
// pick the Challenger → the Challenger offers two unique gods → the opponent
// takes one, the Challenger gets the other → the Challenger chooses the
// Start Player. A free-pick panel remains as a dev shortcut.

type StepKind = 'pre' | 'move' | 'build';
interface Step {
  kind: StepKind;
  sq: Square;
  dome: boolean;
}

// Color indices: 0 = Blue, 1 = Amber. `seatColor[engineSeat]` = color index;
// the draft's Start Player takes engine seat 0 (moves/places first).
const COLOR_NAME = ['Blue', 'Amber'];
let seatColor: [number, number] = [0, 1];
const colorOf = (seat: number): number => seatColor[seat];

// Seat control: who plays each COLOR — 'human' or an AI_LEVELS index
// (models/ladder.json rungs, Hard = the gen-005 checkpoint). Switchable at
// any time, including mid-game; two AI seats give AI-vs-AI at the rate set
// by `aiDelay`. AI instances are built lazily (they carry RNG state) and
// act from a timer so the board paints before the synchronous search runs.
type Controller = 'human' | number;
let controllers: [Controller, Controller] = ['human', 'human'];
let aiPlayers: [AiPlayer | null, AiPlayer | null] = [null, null];
let aiPaused = false;
let aiDelay = 500; // ms between AI turns — the AI-vs-AI rate control
let aiTimer: number | null = null;
const newSeed = (): number => Math.floor(Math.random() * 0x7fffffff);

// God-draft wizard state (null = no draft in progress). Colors, not seats:
// seats don't exist until the Start Player is chosen at the end.
type Draft =
  | { stage: 'challenger' }
  | { stage: 'pick'; challenger: number; picks: GodId[] }
  | { stage: 'steal'; challenger: number; offered: [GodId, GodId] }
  | { stage: 'start'; challenger: number; godOf: [GodId, GodId] };
let draft: Draft | null = null;

let game = new Game();
// Partial turn under construction. path[0] is the selected worker's square.
let pre: BuildAction[] = [];
let path: Square[] = [];
let blds: BuildAction[] = [];
let pendingPlace: Square | null = null; // first of the two setup squares
let choice: { sq: Square; steps: Step[] } | null = null;
// Replay: null = live play at the latest position; a number = viewing the
// position after that many turns (0 = initial board). Input is view-only
// while replaying.
let view: number | null = null;

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <main>
    <header>
      <h1>SANTORINI</h1>
      <div class="status" id="status"></div>
    </header>
    <div class="layout">
      <svg id="board" viewBox="0 0 540 540" aria-label="game board"></svg>
      <aside>
        <div class="setup" id="setup"></div>
        <div class="controls">
          <button id="new">New game</button>
          <button id="undo">Undo</button>
          <button id="finish" hidden>Finish turn</button>
          <button id="cancel" hidden>Cancel</button>
        </div>
        <h2>Players</h2>
        <div class="players">
          <label><span class="chip p1"></span> Blue <select id="ctl-0" aria-label="Blue player"></select></label>
          <label><span class="chip p2"></span> Amber <select id="ctl-1" aria-label="Amber player"></select></label>
          <div class="ai-row">
            <button id="ai-pause">Pause AI</button>
            <label class="ai-delay">Delay
              <input id="ai-delay" type="range" min="0" max="2000" step="100" value="500"
                aria-label="AI move delay">
              <span id="ai-delay-val">0.5s</span>
            </label>
          </div>
        </div>
        <div id="choice"></div>
        <h2>Coach</h2>
        <div class="coach">
          <label><input type="checkbox" id="coach-on"> Show threats and advice</label>
          <div id="coach-body" hidden></div>
        </div>
        <h2>Learn</h2>
        <div class="learn">
          <select id="lesson-sel" aria-label="Lesson"></select>
          <div id="lesson-body"></div>
        </div>
        <div id="gods"></div>
        <h2>Record</h2>
        <div class="replay">
          <button id="rev-start" aria-label="Jump to start" title="Jump to start">⏮</button>
          <button id="rev-back" aria-label="Step back" title="Step back">◀</button>
          <button id="rev-fwd" aria-label="Step forward" title="Step forward">▶</button>
          <button id="rev-end" aria-label="Jump to latest" title="Jump to latest">⏭</button>
          <span id="replay-pos"></span>
        </div>
        <pre id="record"></pre>
        <h2>SGN</h2>
        <textarea id="sgn" rows="4" aria-label="SGN text"
          placeholder="Paste an SGN record and Load to replay it…"></textarea>
        <div class="controls">
          <button id="sgn-load">Load</button>
          <button id="sgn-export">Export</button>
        </div>
        <div id="sgn-msg" role="status"></div>
      </aside>
    </div>
  </main>
`;

const boardEl = document.querySelector<SVGSVGElement>('#board')!;
const statusEl = document.querySelector<HTMLDivElement>('#status')!;
const recordEl = document.querySelector<HTMLPreElement>('#record')!;
const choiceEl = document.querySelector<HTMLDivElement>('#choice')!;
const godsEl = document.querySelector<HTMLDivElement>('#gods')!;
const finishEl = document.querySelector<HTMLButtonElement>('#finish')!;
const cancelEl = document.querySelector<HTMLButtonElement>('#cancel')!;
const setupEl = document.querySelector<HTMLDivElement>('#setup')!;
const undoEl = document.querySelector<HTMLButtonElement>('#undo')!;
const revStartEl = document.querySelector<HTMLButtonElement>('#rev-start')!;
const revBackEl = document.querySelector<HTMLButtonElement>('#rev-back')!;
const revFwdEl = document.querySelector<HTMLButtonElement>('#rev-fwd')!;
const revEndEl = document.querySelector<HTMLButtonElement>('#rev-end')!;
const replayPosEl = document.querySelector<HTMLSpanElement>('#replay-pos')!;
const sgnEl = document.querySelector<HTMLTextAreaElement>('#sgn')!;
const sgnMsgEl = document.querySelector<HTMLDivElement>('#sgn-msg')!;
const ctlEls = [0, 1].map(
  (c) => document.querySelector<HTMLSelectElement>(`#ctl-${c}`)!,
);
const coachOnEl = document.querySelector<HTMLInputElement>('#coach-on')!;
const coachBodyEl = document.querySelector<HTMLDivElement>('#coach-body')!;
const lessonSelEl = document.querySelector<HTMLSelectElement>('#lesson-sel')!;
const lessonBodyEl = document.querySelector<HTMLDivElement>('#lesson-body')!;
const aiPauseEl = document.querySelector<HTMLButtonElement>('#ai-pause')!;
const aiDelayEl = document.querySelector<HTMLInputElement>('#ai-delay')!;
const aiDelayValEl = document.querySelector<HTMLSpanElement>('#ai-delay-val')!;

// --- coach ---

// The coach analyzes the DISPLAYED position (live or replay). Cheap one-ply
// facts (win-in-1s, threat squares) render on every turn while enabled; the
// search-backed hint runs only on demand and is invalidated the moment the
// displayed position changes. Feedback reviews the human's just-played turn.
let coachOn = false;
let hint: CoachHint | null = null;
let hintKey = ''; // position fingerprint the hint was computed for
let feedback: string[] = [];

const coachKey = (): string =>
  `${game.state.gods.join()}|${viewPos()}|${game.turnStrings.join(' ')}`;

/** Play a turn for a human seat, capturing coach/exercise feedback first. */
function playHuman(t: Turn): void {
  feedback = coachOn ? reviewLines(reviewTurn(game.state, t)) : [];
  if (exercise && exercise.verdict === null) {
    exercise.verdict = checkExercise(exercise.lesson.exercise!, game.state, t);
  }
  game.play(t);
}

coachOnEl.addEventListener('change', () => {
  coachOn = coachOnEl.checked;
  render();
});
coachBodyEl.addEventListener('click', (e) => {
  if (!(e.target as Element).closest('#coach-hint')) return;
  const s = viewState();
  if (s.phase === 'over') return;
  hint = coachHint(s, {
    iterations: 1000,
    seed: viewPos() + 1,
    evaluate: COACH_EVAL,
    ...(COACH_POLICY ? { policy: COACH_POLICY } : {}),
  });
  hintKey = coachKey();
  render();
});

// --- lessons ---

// The Learn panel: pick a lesson to read it; lessons with an exercise load a
// hand-authored position onto the board ("Try it") and the student's next
// turn is judged against the exercise goal via playHuman(). While a verdict
// is showing the board is frozen — Retry reloads the position.
let lessonIdx: number | null = null;
let exercise: { lesson: Lesson; verdict: ExerciseResult | null } | null = null;

const LEVEL_LABEL: Record<LessonLevel, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

lessonSelEl.innerHTML =
  '<option value="">Pick a lesson…</option>' +
  (Object.keys(LEVEL_LABEL) as LessonLevel[])
    .map(
      (lvl) =>
        `<optgroup label="${LEVEL_LABEL[lvl]}">` +
        LESSONS.map((l, i) =>
          l.level === lvl ? `<option value="${i}">${l.title}</option>` : '',
        ).join('') +
        '</optgroup>',
    )
    .join('');

lessonSelEl.addEventListener('change', () => {
  lessonIdx = lessonSelEl.value === '' ? null : Number(lessonSelEl.value);
  exercise = null; // the board keeps its position; the check is off
  render();
});

/** Load the selected lesson's exercise position as a fresh two-human game. */
function startExercise(): void {
  const lesson = LESSONS[lessonIdx!];
  game = Game.fromState(lessonState(lesson.exercise!.position));
  exercise = { lesson, verdict: null };
  seatColor = [0, 1]; // the student is seat 0 = Blue
  controllers = ['human', 'human'];
  for (const sel of ctlEls) sel.value = 'human';
  aiPlayers = [null, null];
  aiPaused = false;
  draft = null;
  view = null;
  feedback = [];
  sgnMsgEl.textContent = '';
  resetSelection();
  renderSetup();
  render();
}

lessonBodyEl.addEventListener('click', (e) => {
  const btn = (e.target as Element).closest<HTMLButtonElement>(
    'button[data-act]',
  );
  if (!btn || lessonIdx === null) return;
  if (btn.dataset.act === 'try') {
    startExercise();
  } else if (btn.dataset.act === 'next') {
    lessonIdx++;
    lessonSelEl.value = String(lessonIdx);
    exercise = null;
    render();
  }
});

/** The exercise panel for a lesson (empty if the lesson has no exercise). */
function lessonExerciseHtml(lesson: Lesson, idx: number): string {
  const ex = lesson.exercise;
  if (!ex) return '';
  if (!exercise || exercise.lesson !== lesson) {
    return `<div class="lesson-ex"><p><strong>Exercise:</strong> ${ex.task}</p>
      <button data-act="try">Try it on the board</button></div>`;
  }
  if (exercise.verdict === null) {
    return `<div class="lesson-ex"><p><strong>Your move:</strong> ${ex.task}</p>
      <button data-act="try">Reset position</button></div>`;
  }
  const v = exercise.verdict;
  const nextBtn =
    v.passed && idx + 1 < LESSONS.length
      ? '<button data-act="next">Next lesson</button>'
      : '';
  return `<div class="lesson-ex ${v.passed ? 'lesson-pass' : 'lesson-fail'}">
    <p><strong>${v.passed ? '✓ Solved' : '✗ Not quite'}</strong></p>
    ${v.lines.map((l) => `<p>${l}</p>`).join('')}
    <div class="draft-row"><button data-act="try">${v.passed ? 'Replay' : 'Retry'}</button>${nextBtn}</div>
  </div>`;
}

function lessonHtml(): string {
  if (lessonIdx === null) return '';
  const lesson = LESSONS[lessonIdx];
  const parts = [
    `<div class="lesson-title">${lesson.title}
      <span class="lesson-level">${LEVEL_LABEL[lesson.level]}</span></div>`,
    ...lesson.body.map((p) => `<p>${p}</p>`),
    lessonExerciseHtml(lesson, lessonIdx),
  ];
  return parts.join('');
}

// --- AI seats ---

const anyAiSeat = (): boolean => controllers.some((c) => c !== 'human');
/** Controller of the color whose turn it is. */
const controllerToMove = (): Controller =>
  controllers[colorOf(game.state.player)];
/** True when the live game is waiting on an AI turn (paused or not). */
const aiToMove = (): boolean =>
  view === null &&
  game.state.phase !== 'over' &&
  controllerToMove() !== 'human';

function cancelAi(): void {
  if (aiTimer !== null) {
    clearTimeout(aiTimer);
    aiTimer = null;
  }
}

/**
 * (Re)arm the AI timer if the game is waiting on an AI turn. Runs after
 * every render, so any state change reschedules against fresh state; the
 * timer re-checks before acting in case the user intervened meanwhile.
 */
function scheduleAi(): void {
  cancelAi();
  if (aiPaused || !aiToMove()) return;
  aiTimer = window.setTimeout(
    () => {
      aiTimer = null;
      if (aiPaused || !aiToMove()) return;
      const color = colorOf(game.state.player);
      const level = controllers[color] as number;
      const player = (aiPlayers[color] ??= AI_LEVELS[level].make(newSeed()));
      game.play(player.chooseTurn(game.state));
      resetSelection();
      render();
    },
    Math.max(aiDelay, 30),
  ); // floor: let the board paint between AI turns
}

for (const [c, sel] of ctlEls.entries()) {
  sel.innerHTML =
    '<option value="human">Human</option>' +
    AI_LEVELS.map(
      (l, i) => `<option value="${i}">AI: ${l.name} (${l.detail})</option>`,
    ).join('');
  sel.addEventListener('change', () => {
    controllers[c] = sel.value === 'human' ? 'human' : Number(sel.value);
    aiPlayers[c] = null; // rebuild on next turn
    if (aiToMove()) resetSelection(); // drop any half-entered human turn
    render();
  });
}
aiPauseEl.addEventListener('click', () => {
  aiPaused = !aiPaused;
  render();
});
aiDelayEl.addEventListener('input', () => {
  aiDelay = Number(aiDelayEl.value);
  aiDelayValEl.textContent = `${aiDelay / 1000}s`;
});

document.querySelector('#new')!.addEventListener('click', () => {
  draft = { stage: 'challenger' };
  renderSetup();
});
undoEl.addEventListener('click', () => {
  // During an exercise, undo = retry: take the attempt back, drop the verdict.
  if (exercise) {
    game.undo();
    exercise.verdict = null;
    feedback = [];
    resetSelection();
    render();
    return;
  }
  // Vs an AI, undo backs up to the human's previous decision point; in
  // AI-vs-AI, undo one turn and pause so the position can be inspected.
  if (anyAiSeat() && !controllers.includes('human')) aiPaused = true;
  do {
    game.undo();
  } while (
    game.turns.length > 0 &&
    controllers.includes('human') &&
    controllerToMove() !== 'human'
  );
  feedback = []; // the reviewed move is gone
  resetSelection();
  render();
});
finishEl.addEventListener('click', () => {
  const { finish } = uiOptions();
  if (finish) {
    playHuman(finish);
    resetSelection();
    render();
  }
});
cancelEl.addEventListener('click', () => {
  resetSelection();
  render();
});
boardEl.addEventListener('click', (e) => {
  const cell = (e.target as Element).closest<SVGGElement>('.cell');
  if (!cell) return;
  onCellClick(Number(cell.dataset.sq));
});
choiceEl.addEventListener('click', (e) => {
  const btn = (e.target as Element).closest<HTMLButtonElement>('button');
  if (!btn || !choice) return;
  applyStep(choice.steps[Number(btn.dataset.i)]);
  render();
});

// --- god draft (rulebook God Power Setup) ---

/** Start a new game: `godOf` is indexed by COLOR; `startColor` takes seat 0. */
function startGame(godOf: [GodId, GodId], startColor: number): void {
  seatColor = startColor === 0 ? [0, 1] : [1, 0];
  game = new Game({ gods: [godOf[startColor], godOf[1 - startColor]] });
  draft = null;
  view = null;
  aiPlayers = [null, null]; // fresh AI seeds per game
  aiPaused = false;
  feedback = [];
  exercise = null;
  sgnMsgEl.textContent = '';
  resetSelection();
  renderSetup();
  render();
}

function actToggleGod(btn: HTMLButtonElement): void {
  if (draft?.stage !== 'pick') return;
  const id = btn.dataset.god as GodId;
  const i = draft.picks.indexOf(id);
  if (i >= 0) draft.picks.splice(i, 1);
  else if (draft.picks.length < 2) draft.picks.push(id);
}

function actOffer(): void {
  if (draft?.stage !== 'pick' || draft.picks.length !== 2) return;
  draft = {
    stage: 'steal',
    challenger: draft.challenger,
    offered: [draft.picks[0], draft.picks[1]],
  };
}

function actSteal(btn: HTMLButtonElement): void {
  if (draft?.stage !== 'steal') return;
  const taken = btn.dataset.god as GodId; // the opponent's choice
  const other =
    draft.offered[0] === taken ? draft.offered[1] : draft.offered[0];
  const godOf: [GodId, GodId] =
    draft.challenger === 0 ? [other, taken] : [taken, other];
  draft = { stage: 'start', challenger: draft.challenger, godOf };
}

/** Returns true if the click already started a new game (startGame self-renders). */
function handleSetupAct(act: string, btn: HTMLButtonElement): boolean {
  if (act === 'base') {
    startGame(['none', 'none'], 0);
    return true;
  }
  if (act === 'free') {
    const g0 = setupEl.querySelector<HTMLSelectElement>('#free-god0')!
      .value as GodId;
    const g1 = setupEl.querySelector<HTMLSelectElement>('#free-god1')!
      .value as GodId;
    const start = Number(
      setupEl.querySelector<HTMLSelectElement>('#free-start')!.value,
    );
    startGame([g0, g1], start);
    return true;
  }
  if (act === 'start' && draft && draft.stage === 'start') {
    startGame(draft.godOf, Number(btn.dataset.c));
    return true;
  }
  if (act === 'cancel') draft = null;
  else if (act === 'challenger')
    draft = { stage: 'pick', challenger: Number(btn.dataset.c), picks: [] };
  else if (act === 'toggle') actToggleGod(btn);
  else if (act === 'offer') actOffer();
  else if (act === 'steal') actSteal(btn);
  return false;
}

setupEl.addEventListener('click', (e) => {
  const btn = (e.target as Element).closest<HTMLButtonElement>(
    'button[data-act]',
  );
  if (!btn || !draft) return;
  if (handleSetupAct(btn.dataset.act!, btn)) return;
  renderSetup();
});

function setupHtml(): string {
  if (!draft) return '';
  const chip = (c: number) => `<span class="chip p${c + 1}"></span>`;
  const cancelBtn = '<button data-act="cancel">Cancel</button>';
  if (draft.stage === 'challenger') {
    const godOptions = GOD_IDS.filter((id) => id !== 'none')
      .map((id) => `<option value="${id}">${GODS[id].name}</option>`)
      .join('');
    return `
      <div class="draft-title">New game — who is the Challenger?</div>
      <div class="draft-row">
        <button data-act="challenger" data-c="0">${chip(0)} Blue</button>
        <button data-act="challenger" data-c="1">${chip(1)} Amber</button>
      </div>
      <div class="draft-row">
        <button data-act="base">No gods (base game)</button>
        ${cancelBtn}
      </div>
      <details class="free-pick">
        <summary>Free pick (dev shortcut)</summary>
        <label>Blue god <select id="free-god0" aria-label="Blue god"><option value="none">None</option>${godOptions}</select></label>
        <label>Amber god <select id="free-god1" aria-label="Amber god"><option value="none">None</option>${godOptions}</select></label>
        <label>Start Player <select id="free-start" aria-label="Start Player">
          <option value="0">Blue</option><option value="1">Amber</option>
        </select></label>
        <button data-act="free">Start (free pick)</button>
      </details>`;
  }
  if (draft.stage === 'pick') {
    const picks = draft.picks;
    const grid = GOD_IDS.filter((id) => id !== 'none')
      .map((id) => {
        const sel = picks.includes(id) ? ' class="selected"' : '';
        return `<button${sel} data-act="toggle" data-god="${id}">${GODS[id].name}</button>`;
      })
      .join('');
    return `
      <div class="draft-title">${chip(draft.challenger)} ${COLOR_NAME[draft.challenger]} (Challenger):
        choose two gods to offer (${picks.length}/2)</div>
      <div class="god-grid">${grid}</div>
      <div class="draft-row">
        <button data-act="offer" ${picks.length === 2 ? '' : 'disabled'}>Offer these gods</button>
        ${cancelBtn}
      </div>`;
  }
  if (draft.stage === 'steal') {
    const op = 1 - draft.challenger;
    const cards = draft.offered
      .map(
        (id) => `<button class="god-card" data-act="steal" data-god="${id}">
          <strong>${GODS[id].name}</strong><br>${GODS[id].text}</button>`,
      )
      .join('');
    return `
      <div class="draft-title">${chip(op)} ${COLOR_NAME[op]}: take one god —
        the Challenger gets the other</div>
      ${cards}
      <div class="draft-row">${cancelBtn}</div>`;
  }
  const { challenger, godOf } = draft;
  const startBtn = (c: number) =>
    `<button data-act="start" data-c="${c}">${chip(c)} ${COLOR_NAME[c]} (${GODS[godOf[c]].name})</button>`;
  return `
    <div class="draft-title">${chip(challenger)} ${COLOR_NAME[challenger]} (Challenger):
      choose the Start Player — they place workers and move first</div>
    <div class="draft-row">${startBtn(0)}${startBtn(1)}</div>
    <div class="draft-row">${cancelBtn}</div>`;
}

/** Setup panel renders only on draft-state changes so free-pick inputs keep their values. */
function renderSetup(): void {
  setupEl.innerHTML = setupHtml();
}

// --- replay / SGN ---

/** Position currently shown, as a turn count (0 = initial board). */
const viewPos = (): number => view ?? game.turns.length;
const viewState = (): GameState =>
  view === null ? game.state : game.stateAt(view);

function setView(k: number): void {
  const n = game.turns.length;
  const clamped = Math.max(0, Math.min(n, k));
  view = clamped >= n ? null : clamped; // stepping to the end resumes live play
  resetSelection();
  render();
}

revStartEl.addEventListener('click', () => setView(0));
revBackEl.addEventListener('click', () => setView(viewPos() - 1));
revFwdEl.addEventListener('click', () => setView(viewPos() + 1));
revEndEl.addEventListener('click', () => setView(game.turns.length));
recordEl.addEventListener('click', (e) => {
  const span = (e.target as Element).closest<HTMLElement>('.rec-move');
  if (span) setView(Number(span.dataset.t) + 1);
});
document.addEventListener('keydown', (e) => {
  if ((e.target as Element).closest('textarea, select, input')) return;
  if (e.key === 'ArrowLeft' && viewPos() > 0) {
    setView(viewPos() - 1);
    e.preventDefault();
  } else if (e.key === 'ArrowRight' && view !== null) {
    setView(viewPos() + 1);
    e.preventDefault();
  }
});

document.querySelector('#sgn-load')!.addEventListener('click', () => {
  try {
    const loaded = Game.fromSGN(sgnEl.value);
    game = loaded;
    seatColor = [0, 1]; // SGN has no color info: first mover shows as Blue
    feedback = [];
    draft = null;
    exercise = null;
    renderSetup();
    resetSelection();
    sgnMsgEl.textContent = `Loaded ${loaded.turns.length} turns — step through with ▶.`;
    setView(0);
  } catch (err) {
    sgnMsgEl.textContent = `Could not load SGN: ${(err as Error).message}`;
  }
});
document.querySelector('#sgn-export')!.addEventListener('click', () => {
  sgnEl.value = game.toSGN();
  sgnMsgEl.textContent = 'Current game exported below.';
});

function resetSelection(): void {
  pre = [];
  path = [];
  blds = [];
  pendingPlace = null;
  choice = null;
}

// --- partial-turn matching against legalTurns() ---

function moveCandidates(): MoveTurn[] {
  return game.legalTurns().filter((t): t is MoveTurn => t.kind === 'move');
}

const buildEq = (a: BuildAction, b: BuildAction): boolean =>
  a.at === b.at && a.dome === b.dome;

/**
 * Builds of `all` not yet used by `used` (order-insensitive: Demeter's two
 * builds commute, and movegen emits them in one canonical order), or null if
 * `used` is not a sub-multiset of `all`.
 */
function buildsRemaining(
  all: BuildAction[],
  used: BuildAction[],
): BuildAction[] | null {
  const left = all.slice();
  for (const u of used) {
    const i = left.findIndex((b) => buildEq(b, u));
    if (i < 0) return null;
    left.splice(i, 1);
  }
  return left;
}

/** Is the current partial turn a prefix of legal turn t? */
function compatible(t: MoveTurn): boolean {
  if (path.length === 0 || t.path[0] !== path[0]) return false;
  const tPre = t.preBuilds ?? [];
  if (pre.length > tPre.length) return false;
  for (let i = 0; i < pre.length; i++)
    if (!buildEq(pre[i], tPre[i])) return false;
  // Once the worker has moved, pre-building is over; once it has built,
  // moving is over (turn order: pre-builds, then path, then builds).
  if (path.length > 1 && tPre.length !== pre.length) return false;
  if (path.length > t.path.length) return false;
  for (let i = 1; i < path.length; i++) if (path[i] !== t.path[i]) return false;
  if (blds.length > 0 && path.length !== t.path.length) return false;
  return buildsRemaining(t.builds, blds) !== null;
}

/** Next single actions the partial can take toward t. Empty = t is complete. */
function stepsFor(t: MoveTurn): Step[] {
  const tPre = t.preBuilds ?? [];
  if (pre.length < tPre.length) {
    const b = tPre[pre.length];
    return [{ kind: 'pre', sq: b.at, dome: b.dome }];
  }
  const out: Step[] = [];
  if (blds.length === 0 && path.length < t.path.length) {
    out.push({ kind: 'move', sq: t.path[path.length], dome: false });
  }
  if (path.length === t.path.length) {
    for (const b of buildsRemaining(t.builds, blds) ?? []) {
      out.push({ kind: 'build', sq: b.at, dome: b.dome });
    }
  }
  return out;
}

/** All next actions across compatible turns, plus a playable-now turn if any. */
function uiOptions(): { steps: Step[]; finish: MoveTurn | null } {
  const steps: Step[] = [];
  let finish: MoveTurn | null = null;
  if (view !== null || game.state.phase !== 'play' || path.length === 0)
    return { steps, finish };
  for (const t of moveCandidates()) {
    if (!compatible(t)) continue;
    const ss = stepsFor(t);
    if (ss.length === 0) finish ??= t;
    for (const s of ss) {
      if (
        !steps.some(
          (o) => o.kind === s.kind && o.sq === s.sq && o.dome === s.dome,
        )
      )
        steps.push(s);
    }
  }
  return { steps, finish };
}

function applyStep(s: Step): void {
  choice = null;
  if (s.kind === 'pre') pre.push({ at: s.sq, dome: s.dome });
  else if (s.kind === 'move') path.push(s.sq);
  else blds.push({ at: s.sq, dome: s.dome });
  const { steps, finish } = uiOptions();
  // Nothing further is possible: the turn is fully determined — play it.
  if (finish && steps.length === 0) {
    playHuman(finish);
    resetSelection();
  }
}

/** Setup-phase click: place or unplace a worker (two clicks form a placement turn). */
function handleSetupCellClick(s: GameState, sq: Square): void {
  const occupied = workerAt(s, sq) >= 0;
  if (sq === pendingPlace) {
    pendingPlace = null;
  } else if (!occupied && pendingPlace === null) {
    pendingPlace = sq;
  } else if (!occupied && pendingPlace !== null) {
    playHuman({ kind: 'place', squares: [pendingPlace, sq] });
    pendingPlace = null;
  }
}

/** Play-phase click: apply a step, open a chooser, or (re)select a worker. */
function handlePlayCellClick(s: GameState, sq: Square): void {
  const here = uiOptions().steps.filter((st) => st.sq === sq);
  if (here.length === 1) {
    applyStep(here[0]);
  } else if (here.length > 1) {
    choice = { sq, steps: here };
  } else {
    // Not an action square: (re)select an own worker, or clear the partial.
    const w = workerAt(s, sq);
    const bareSame = path.length === 1 && path[0] === sq && pre.length === 0;
    resetSelection();
    if (w >= 0 && ownerOf(w) === s.player && !bareSame) path = [sq];
  }
}

function onCellClick(sq: Square): void {
  if (view !== null) return; // replay is view-only
  if (aiToMove()) return; // the AI seat's turn — humans can't move for it
  if (exercise?.verdict) return; // attempt judged — Retry/Replay resets the board
  const s = game.state;
  if (s.phase === 'over') return;
  choice = null;

  if (s.phase === 'setup') {
    handleSetupCellClick(s, sq);
    render();
    return;
  }

  handlePlayCellClick(s, sq);
  render();
}

// --- rendering ---

const CELL = 100;
const PAD = 20;
const cx = (sq: Square) => PAD + colOf(sq) * CELL + CELL / 2;
const cy = (sq: Square) => PAD + (4 - rowOf(sq)) * CELL + CELL / 2;

function levelRects(sq: Square, h: number): string {
  const sizes = [78, 62, 46];
  const fills = ['#f0ece2', '#f8f6f0', '#ffffff'];
  let out = '';
  for (let lvl = 0; lvl < Math.min(h, 3); lvl++) {
    const size = sizes[lvl];
    out += `<rect x="${cx(sq) - size / 2}" y="${cy(sq) - size / 2}" width="${size}" height="${size}"
      rx="${10 - lvl * 2}" fill="${fills[lvl]}" stroke="#c9c2b2" stroke-width="1.5"/>`;
  }
  if (h === 4)
    out += `<circle cx="${cx(sq)}" cy="${cy(sq)}" r="17" fill="#3b6ea5" stroke="#2b4d7a" stroke-width="2"/>`;
  return out;
}

function workerCircle(sq: Square, player: number, ghost = false): string {
  const fill = colorOf(player) === 0 ? 'var(--p1)' : 'var(--p2)';
  const stroke = colorOf(player) === 0 ? 'var(--p1-dark)' : 'var(--p2-dark)';
  return `<circle cx="${cx(sq)}" cy="${cy(sq)}" r="15" fill="${fill}" stroke="${stroke}"
    stroke-width="3" ${ghost ? 'opacity="0.45"' : ''} pointer-events="none"/>`;
}

/** Squares highlighted by the coach's last computed search-backed hint. */
function hintSquaresFor(h: CoachHint | null): Set<Square> {
  const out = new Set<Square>();
  if (!h) return out;
  if (h.turn.kind === 'place') {
    for (const q of h.turn.squares) out.add(q);
  } else {
    out.add(h.turn.path[0]);
    out.add(h.turn.path[h.turn.path.length - 1]);
    for (const b of [...(h.turn.preBuilds ?? []), ...h.turn.builds])
      out.add(b.at);
  }
  return out;
}

interface CellRenderCtx {
  state: GameState;
  disp: Uint8Array;
  workerPos: Square | null;
  partialBuilds: BuildAction[];
  steps: Step[];
  coachThreats: Set<Square>;
  coachWins: Set<Square>;
  hintSquares: Set<Square>;
}

function cellBaseSvg(sq: Square, disp: Uint8Array): string {
  let svg = `<g class="cell" data-sq="${sq}" role="button" tabindex="0" aria-label="${squareName(sq)}">`;
  svg += `<rect class="tile" x="${cx(sq) - 46}" y="${cy(sq) - 46}" width="92" height="92" rx="12" fill="var(--sand)"/>`;
  svg += levelRects(sq, disp[sq]);
  // faint coordinate label
  svg += `<text x="${cx(sq) - 40}" y="${cy(sq) + 41}" font-size="10" fill="#8a8371" pointer-events="none">${squareName(sq)}</text>`;
  return svg;
}

function cellWorkerSvg(
  s: GameState,
  sq: Square,
  workerPos: Square | null,
): string {
  let svg = '';
  const w = workerAt(s, sq);
  if (w >= 0) {
    const movedAway = path.length > 1 && sq === path[0];
    svg += workerCircle(sq, ownerOf(w), movedAway);
  }
  if (sq === pendingPlace) svg += workerCircle(sq, s.player, true);
  if (path.length > 1 && sq === workerPos)
    svg += workerCircle(sq, s.player, true);
  return svg;
}

/** Overlay rings/dots for selection, pending builds, legal steps, and coach info. */
function cellMarkersSvg(sq: Square, ctx: CellRenderCtx): string {
  const {
    workerPos,
    partialBuilds,
    steps,
    coachThreats,
    coachWins,
    hintSquares,
  } = ctx;
  let svg = '';
  if (workerPos === sq && blds.length === 0) {
    svg += `<circle cx="${cx(sq)}" cy="${cy(sq)}" r="21" fill="none" stroke="var(--accent)" stroke-width="3" pointer-events="none"/>`;
  }
  if (partialBuilds.some((b) => b.at === sq)) {
    svg += `<circle cx="${cx(sq)}" cy="${cy(sq)}" r="26" fill="none" stroke="var(--build)" stroke-width="3" opacity="0.8" pointer-events="none"/>`;
  }
  if (steps.some((st) => st.kind === 'move' && st.sq === sq)) {
    svg += `<circle cx="${cx(sq)}" cy="${cy(sq)}" r="9" fill="var(--accent)" opacity="0.9" pointer-events="none"/>`;
  }
  if (steps.some((st) => st.kind !== 'move' && st.sq === sq)) {
    svg += `<circle cx="${cx(sq)}" cy="${cy(sq)}" r="13" fill="none" stroke="var(--build)" stroke-width="4" stroke-dasharray="5 4" pointer-events="none"/>`;
  }
  if (coachThreats.has(sq)) {
    svg += `<circle cx="${cx(sq)}" cy="${cy(sq)}" r="35" fill="none" stroke="var(--danger)" stroke-width="3.5" stroke-dasharray="8 5" pointer-events="none"/>`;
  }
  if (coachWins.has(sq)) {
    svg += `<circle cx="${cx(sq)}" cy="${cy(sq)}" r="39" fill="none" stroke="var(--accent)" stroke-width="3.5" pointer-events="none"/>`;
  }
  if (hintSquares.has(sq)) {
    svg += `<circle cx="${cx(sq)}" cy="${cy(sq)}" r="43" fill="none" stroke="var(--coach)" stroke-width="3" stroke-dasharray="3 4" pointer-events="none"/>`;
  }
  return svg;
}

function cellSvg(sq: Square, ctx: CellRenderCtx): string {
  let svg = cellBaseSvg(sq, ctx.disp);
  svg += cellWorkerSvg(ctx.state, sq, ctx.workerPos);
  svg += cellMarkersSvg(sq, ctx);
  svg += '</g>';
  return svg;
}

function render(): void {
  const s = viewState();
  const { steps, finish } = uiOptions();
  const partialBuilds = [...pre, ...blds];

  // Coach: drop a hint the moment the displayed position changes; one-ply
  // facts (win/threat squares) are cheap enough to recompute every render.
  if (hint && hintKey !== coachKey()) hint = null;
  const coachThreats = new Set(
    coachOn && s.phase === 'play' ? threatSquares(s) : [],
  );
  const coachWins = new Set(
    coachOn && s.phase === 'play'
      ? winningTurns(s).map((t) => t.path[t.path.length - 1])
      : [],
  );
  const hintSquares = hintSquaresFor(hint);

  // Heights as they'll look after this turn's builds so far.
  const disp = s.heights.slice();
  for (const b of partialBuilds) disp[b.at] = b.dome ? 4 : disp[b.at] + 1;

  const workerPos = path.length > 0 ? path[path.length - 1] : null;
  const ctx: CellRenderCtx = {
    state: s,
    disp,
    workerPos,
    partialBuilds,
    steps,
    coachThreats,
    coachWins,
    hintSquares,
  };
  let svg = '';
  for (let sq = 0; sq < 25; sq++) svg += cellSvg(sq, ctx);
  boardEl.innerHTML = svg;

  finishEl.hidden = finish === null;
  cancelEl.hidden = path.length === 0 && pendingPlace === null;
  undoEl.disabled = view !== null;
  revStartEl.disabled = revBackEl.disabled = viewPos() === 0;
  revFwdEl.disabled = revEndEl.disabled = view === null;
  replayPosEl.textContent = `${viewPos()}/${game.turns.length}`;
  choiceEl.innerHTML = choiceHtml();
  coachBodyEl.hidden = !coachOn;
  coachBodyEl.innerHTML = coachOn ? coachHtml(s, coachWins, coachThreats) : '';
  lessonBodyEl.innerHTML = lessonHtml();
  godsEl.innerHTML = godsHtml();
  aiPauseEl.disabled = !anyAiSeat();
  aiPauseEl.textContent = aiPaused ? 'Resume AI' : 'Pause AI';
  statusEl.innerHTML =
    view === null ? statusText(steps, finish) : replayStatus(s);
  recordEl.innerHTML = recordHtml();
  scheduleAi();
}

function stepLabel(st: Step): string {
  const at = squareName(st.sq);
  if (st.kind === 'move') return `Move to ${at}`;
  const what = st.dome ? 'dome' : 'block';
  return st.kind === 'pre'
    ? `Build ${what} at ${at} before moving`
    : `Build ${what} at ${at}`;
}

function choiceHtml(): string {
  if (!choice) return '';
  const buttons = choice.steps
    .map((st, i) => `<button data-i="${i}">${stepLabel(st)}</button>`)
    .join('');
  return `<div class="choice-title">${squareName(choice.sq)}:</div>${buttons}`;
}

function coachHtml(
  s: GameState,
  wins: Set<Square>,
  threats: Set<Square>,
): string {
  const names = (set: Set<Square>): string =>
    [...set]
      .sort((a, b) => a - b)
      .map(squareName)
      .join(', ');
  const parts: string[] = [];
  if (feedback.length > 0) {
    parts.push(
      `<div class="coach-feedback">${feedback.map((l) => `<p>${l}</p>`).join('')}</div>`,
    );
  }
  if (s.phase === 'play') {
    if (wins.size > 0) {
      parts.push(
        `<p class="coach-alert coach-win">${playerLabel(s.player)} can win at ${names(wins)}.</p>`,
      );
    }
    if (threats.size > 0) {
      parts.push(
        `<p class="coach-alert coach-danger">${playerLabel(1 - s.player)} threatens to win at ${names(threats)}.</p>`,
      );
    }
  }
  if (s.phase !== 'over') parts.push('<button id="coach-hint">Hint</button>');
  if (hint) {
    parts.push(
      `<div class="coach-lines">${hint.lines.map((l) => `<p>${l}</p>`).join('')}</div>`,
    );
    if (hint.candidates.length > 1) {
      const alts = hint.candidates
        .map(
          (c) => `${c.notation} (${Math.round(c.value * 100)}%, ${c.visits}v)`,
        )
        .join(' · ');
      parts.push(`<p class="coach-cands">Candidates: ${alts}</p>`);
    }
  }
  return parts.join('');
}

function godsHtml(): string {
  const [g0, g1] = game.state.gods;
  if (g0 === 'none' && g1 === 'none') return '';
  const line = (p: number, g: GodId) =>
    g === 'none'
      ? ''
      : `<p><span class="chip p${colorOf(p) + 1}"></span> <strong>${GODS[g].name}</strong> — ${GODS[g].text}</p>`;
  return line(0, g0) + line(1, g1);
}

function playerLabel(p: number): string {
  const g = game.state.gods[p];
  const name = COLOR_NAME[colorOf(p)];
  return g === 'none' ? name : `${name} (${GODS[g].name})`;
}

/** Status line while it's an AI seat's turn. */
function aiStatusText(s: GameState, chip: string): string {
  const level = AI_LEVELS[controllerToMove() as number];
  const doing = s.phase === 'setup' ? 'placing workers' : 'thinking';
  return `${chip} ${playerLabel(s.player)} — ${level.name} AI ${aiPaused ? 'paused' : `${doing}…`}`;
}

/** Labels for the actions the partial turn under construction can still take. */
function turnStatusParts(steps: Step[], finish: MoveTurn | null): string[] {
  const kinds = new Set(steps.map((st) => st.kind));
  const parts: string[] = [];
  if (kinds.has('move')) parts.push(path.length > 1 ? 'move again' : 'move');
  if (kinds.has('pre')) parts.push('build before moving');
  if (kinds.has('build')) parts.push(blds.length > 0 ? 'build again' : 'build');
  if (finish) parts.push('finish the turn');
  return parts;
}

function statusText(steps: Step[], finish: MoveTurn | null): string {
  const s = game.state;
  const chip = `<span class="chip p${colorOf(s.player) + 1}"></span>`;
  if (s.phase === 'over') {
    const w = s.winner!;
    return `<span class="chip p${colorOf(w) + 1}"></span> <strong>${playerLabel(w)} wins!</strong>`;
  }
  if (controllerToMove() !== 'human') return aiStatusText(s, chip);
  if (s.phase === 'setup') {
    const n = pendingPlace === null ? 1 : 2;
    return `${chip} ${playerLabel(s.player)}: place worker ${n} of 2`;
  }
  if (path.length === 0)
    return `${chip} ${playerLabel(s.player)} to move — select a worker`;
  const parts = turnStatusParts(steps, finish);
  if (parts.length === 0)
    return `${chip} ${playerLabel(s.player)} — no moves for this worker`;
  return `${chip} ${playerLabel(s.player)} — ${parts.join(', or ')}`;
}

function replayStatus(s: GameState): string {
  const chip = `<span class="chip p${colorOf(s.player) + 1}"></span>`;
  const verb = s.phase === 'setup' ? 'to place' : 'to move';
  return `${chip} Replay ${viewPos()}/${game.turns.length} — ${playerLabel(s.player)} ${verb}`;
}

/** Numbered record with one clickable span per turn; the viewed turn is highlighted. */
function recordHtml(): string {
  const t = game.turnStrings;
  if (t.length === 0) return '(no moves yet)';
  const parts: string[] = [];
  for (let i = 0; i < t.length; i++) {
    if (i % 2 === 0) parts.push(`${i / 2 + 1}. `);
    const cur = view === i + 1 ? ' current' : '';
    parts.push(`<span class="rec-move${cur}" data-t="${i}">${t[i]}</span>`);
    parts.push(i % 2 === 0 ? ' ' : '\n');
  }
  return parts.join('').trimEnd();
}

render();
