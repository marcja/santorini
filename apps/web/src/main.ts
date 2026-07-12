import {
  GODS,
  GOD_IDS,
  Game,
  colOf,
  rowOf,
  squareName,
  workerAt,
  ownerOf,
  type BuildAction,
  type GameState,
  type GodId,
  type MoveTurn,
  type Square,
} from '@santorini/engine';
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
        <div id="choice"></div>
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

document.querySelector('#new')!.addEventListener('click', () => {
  draft = { stage: 'challenger' };
  renderSetup();
});
undoEl.addEventListener('click', () => {
  game.undo();
  resetSelection();
  render();
});
finishEl.addEventListener('click', () => {
  const { finish } = uiOptions();
  if (finish) {
    game.play(finish);
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
  sgnMsgEl.textContent = '';
  resetSelection();
  renderSetup();
  render();
}

setupEl.addEventListener('click', (e) => {
  const btn = (e.target as Element).closest<HTMLButtonElement>('button[data-act]');
  if (!btn || !draft) return;
  const act = btn.dataset.act!;
  if (act === 'cancel') {
    draft = null;
  } else if (act === 'challenger') {
    draft = { stage: 'pick', challenger: Number(btn.dataset.c), picks: [] };
  } else if (act === 'base') {
    return startGame(['none', 'none'], 0);
  } else if (act === 'free') {
    const g0 = setupEl.querySelector<HTMLSelectElement>('#free-god0')!.value as GodId;
    const g1 = setupEl.querySelector<HTMLSelectElement>('#free-god1')!.value as GodId;
    const start = Number(setupEl.querySelector<HTMLSelectElement>('#free-start')!.value);
    return startGame([g0, g1], start);
  } else if (act === 'toggle' && draft.stage === 'pick') {
    const id = btn.dataset.god as GodId;
    const i = draft.picks.indexOf(id);
    if (i >= 0) draft.picks.splice(i, 1);
    else if (draft.picks.length < 2) draft.picks.push(id);
  } else if (act === 'offer' && draft.stage === 'pick' && draft.picks.length === 2) {
    draft = { stage: 'steal', challenger: draft.challenger, offered: [draft.picks[0], draft.picks[1]] };
  } else if (act === 'steal' && draft.stage === 'steal') {
    const taken = btn.dataset.god as GodId; // the opponent's choice
    const other = draft.offered[0] === taken ? draft.offered[1] : draft.offered[0];
    const godOf: [GodId, GodId] =
      draft.challenger === 0 ? [other, taken] : [taken, other];
    draft = { stage: 'start', challenger: draft.challenger, godOf };
  } else if (act === 'start' && draft.stage === 'start') {
    return startGame(draft.godOf, Number(btn.dataset.c));
  }
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
const viewState = (): GameState => (view === null ? game.state : game.stateAt(view));

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
    draft = null;
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

const buildEq = (a: BuildAction, b: BuildAction): boolean => a.at === b.at && a.dome === b.dome;

/**
 * Builds of `all` not yet used by `used` (order-insensitive: Demeter's two
 * builds commute, and movegen emits them in one canonical order), or null if
 * `used` is not a sub-multiset of `all`.
 */
function buildsRemaining(all: BuildAction[], used: BuildAction[]): BuildAction[] | null {
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
  for (let i = 0; i < pre.length; i++) if (!buildEq(pre[i], tPre[i])) return false;
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
  if (view !== null || game.state.phase !== 'play' || path.length === 0) return { steps, finish };
  for (const t of moveCandidates()) {
    if (!compatible(t)) continue;
    const ss = stepsFor(t);
    if (ss.length === 0) finish ??= t;
    for (const s of ss) {
      if (!steps.some((o) => o.kind === s.kind && o.sq === s.sq && o.dome === s.dome)) steps.push(s);
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
    game.play(finish);
    resetSelection();
  }
}

function onCellClick(sq: Square): void {
  if (view !== null) return; // replay is view-only
  const s = game.state;
  if (s.phase === 'over') return;
  choice = null;

  if (s.phase === 'setup') {
    const occupied = workerAt(s, sq) >= 0;
    if (sq === pendingPlace) {
      pendingPlace = null;
    } else if (!occupied && pendingPlace === null) {
      pendingPlace = sq;
    } else if (!occupied && pendingPlace !== null) {
      game.play({ kind: 'place', squares: [pendingPlace, sq] });
      pendingPlace = null;
    }
    render();
    return;
  }

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
  if (h === 4) out += `<circle cx="${cx(sq)}" cy="${cy(sq)}" r="17" fill="#3b6ea5" stroke="#2b4d7a" stroke-width="2"/>`;
  return out;
}

function workerCircle(sq: Square, player: number, ghost = false): string {
  const fill = colorOf(player) === 0 ? 'var(--p1)' : 'var(--p2)';
  const stroke = colorOf(player) === 0 ? 'var(--p1-dark)' : 'var(--p2-dark)';
  return `<circle cx="${cx(sq)}" cy="${cy(sq)}" r="15" fill="${fill}" stroke="${stroke}"
    stroke-width="3" ${ghost ? 'opacity="0.45"' : ''} pointer-events="none"/>`;
}

function render(): void {
  const s = viewState();
  const { steps, finish } = uiOptions();
  const partialBuilds = [...pre, ...blds];

  // Heights as they'll look after this turn's builds so far.
  const disp = s.heights.slice();
  for (const b of partialBuilds) disp[b.at] = b.dome ? 4 : disp[b.at] + 1;

  const workerPos = path.length > 0 ? path[path.length - 1] : null;
  let svg = '';
  for (let sq = 0; sq < 25; sq++) {
    svg += `<g class="cell" data-sq="${sq}" role="button" tabindex="0" aria-label="${squareName(sq)}">`;
    svg += `<rect class="tile" x="${cx(sq) - 46}" y="${cy(sq) - 46}" width="92" height="92" rx="12" fill="var(--sand)"/>`;
    svg += levelRects(sq, disp[sq]);
    // faint coordinate label
    svg += `<text x="${cx(sq) - 40}" y="${cy(sq) + 41}" font-size="10" fill="#8a8371" pointer-events="none">${squareName(sq)}</text>`;

    const w = workerAt(s, sq);
    if (w >= 0) {
      const movedAway = path.length > 1 && sq === path[0];
      svg += workerCircle(sq, ownerOf(w), movedAway);
    }
    if (sq === pendingPlace) svg += workerCircle(sq, s.player, true);
    if (path.length > 1 && sq === workerPos) svg += workerCircle(sq, s.player, true);

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
    svg += '</g>';
  }
  boardEl.innerHTML = svg;

  finishEl.hidden = finish === null;
  cancelEl.hidden = path.length === 0 && pendingPlace === null;
  undoEl.disabled = view !== null;
  revStartEl.disabled = revBackEl.disabled = viewPos() === 0;
  revFwdEl.disabled = revEndEl.disabled = view === null;
  replayPosEl.textContent = `${viewPos()}/${game.turns.length}`;
  choiceEl.innerHTML = choiceHtml();
  godsEl.innerHTML = godsHtml();
  statusEl.innerHTML = view === null ? statusText(steps, finish) : replayStatus(s);
  recordEl.innerHTML = recordHtml();
}

function stepLabel(st: Step): string {
  const at = squareName(st.sq);
  if (st.kind === 'move') return `Move to ${at}`;
  const what = st.dome ? 'dome' : 'block';
  return st.kind === 'pre' ? `Build ${what} at ${at} before moving` : `Build ${what} at ${at}`;
}

function choiceHtml(): string {
  if (!choice) return '';
  const buttons = choice.steps
    .map((st, i) => `<button data-i="${i}">${stepLabel(st)}</button>`)
    .join('');
  return `<div class="choice-title">${squareName(choice.sq)}:</div>${buttons}`;
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

function statusText(steps: Step[], finish: MoveTurn | null): string {
  const s = game.state;
  const chip = `<span class="chip p${colorOf(s.player) + 1}"></span>`;
  if (s.phase === 'over') {
    const w = s.winner!;
    return `<span class="chip p${colorOf(w) + 1}"></span> <strong>${playerLabel(w)} wins!</strong>`;
  }
  if (s.phase === 'setup') {
    const n = pendingPlace === null ? 1 : 2;
    return `${chip} ${playerLabel(s.player)}: place worker ${n} of 2`;
  }
  if (path.length === 0) return `${chip} ${playerLabel(s.player)} to move — select a worker`;
  const kinds = new Set(steps.map((st) => st.kind));
  const parts: string[] = [];
  if (kinds.has('move')) parts.push(path.length > 1 ? 'move again' : 'move');
  if (kinds.has('pre')) parts.push('build before moving');
  if (kinds.has('build')) parts.push(blds.length > 0 ? 'build again' : 'build');
  if (finish) parts.push('finish the turn');
  if (parts.length === 0) return `${chip} ${playerLabel(s.player)} — no moves for this worker`;
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
