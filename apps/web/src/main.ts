import {
  Game,
  colOf,
  rowOf,
  squareName,
  workerAt,
  ownerOf,
  type MoveTurn,
  type Square,
} from '@santorini/engine';
import './style.css';

// Pass-and-play, base game (no gods yet). Player 0 = Blue, player 1 = Amber.

let game = new Game();
let sel: Square | null = null; // selected worker's square
let moveTo: Square | null = null; // chosen destination, awaiting build
let pendingPlace: Square | null = null; // first of the two setup squares

const PLAYER_NAME = ['Blue', 'Amber'];

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
        <div class="controls">
          <button id="new">New game</button>
          <button id="undo">Undo</button>
        </div>
        <h2>Record</h2>
        <pre id="record"></pre>
      </aside>
    </div>
  </main>
`;

const boardEl = document.querySelector<SVGSVGElement>('#board')!;
const statusEl = document.querySelector<HTMLDivElement>('#status')!;
const recordEl = document.querySelector<HTMLPreElement>('#record')!;

document.querySelector('#new')!.addEventListener('click', () => {
  game = new Game();
  resetSelection();
  render();
});
document.querySelector('#undo')!.addEventListener('click', () => {
  game.undo();
  resetSelection();
  render();
});
boardEl.addEventListener('click', (e) => {
  const cell = (e.target as Element).closest<SVGGElement>('.cell');
  if (!cell) return;
  onCellClick(Number(cell.dataset.sq));
});

function resetSelection(): void {
  sel = null;
  moveTo = null;
  pendingPlace = null;
}

function moveCandidates(): MoveTurn[] {
  return game.legalTurns().filter((t): t is MoveTurn => t.kind === 'move');
}

function moveDests(from: Square): Square[] {
  return [...new Set(moveCandidates().filter((t) => t.path[0] === from).map((t) => t.path[1]))];
}

function buildTargets(from: Square, to: Square): Square[] {
  return [
    ...new Set(
      moveCandidates()
        .filter((t) => t.path[0] === from && t.path[1] === to && t.builds.length > 0)
        .map((t) => t.builds[0].at),
    ),
  ];
}

function onCellClick(sq: Square): void {
  const s = game.state;
  if (s.phase === 'over') return;

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

  const w = workerAt(s, sq);
  const isOwn = w >= 0 && ownerOf(w) === s.player;

  if (moveTo === null) {
    if (isOwn) {
      sel = sel === sq ? null : sq;
    } else if (sel !== null && moveDests(sel).includes(sq)) {
      const winTurn = moveCandidates().find((t) => t.path[0] === sel && t.path[1] === sq && t.win);
      if (winTurn) {
        game.play(winTurn);
        resetSelection();
      } else {
        moveTo = sq;
      }
    } else {
      sel = null;
    }
  } else {
    if (sel !== null && buildTargets(sel, moveTo).includes(sq)) {
      const turn = moveCandidates().find(
        (t) => t.path[0] === sel && t.path[1] === moveTo && t.builds[0]?.at === sq,
      )!;
      game.play(turn);
    }
    resetSelection();
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
  const fill = player === 0 ? 'var(--p1)' : 'var(--p2)';
  const stroke = player === 0 ? 'var(--p1-dark)' : 'var(--p2-dark)';
  return `<circle cx="${cx(sq)}" cy="${cy(sq)}" r="15" fill="${fill}" stroke="${stroke}"
    stroke-width="3" ${ghost ? 'opacity="0.45"' : ''} pointer-events="none"/>`;
}

function render(): void {
  const s = game.state;
  let svg = '';

  const dests = s.phase === 'play' && sel !== null && moveTo === null ? moveDests(sel) : [];
  const builds = s.phase === 'play' && sel !== null && moveTo !== null ? buildTargets(sel, moveTo) : [];

  for (let sq = 0; sq < 25; sq++) {
    svg += `<g class="cell" data-sq="${sq}">`;
    svg += `<rect class="tile" x="${cx(sq) - 46}" y="${cy(sq) - 46}" width="92" height="92" rx="12" fill="var(--sand)"/>`;
    svg += levelRects(sq, s.heights[sq]);
    // faint coordinate label
    svg += `<text x="${cx(sq) - 40}" y="${cy(sq) + 41}" font-size="10" fill="#8a8371" pointer-events="none">${squareName(sq)}</text>`;

    const w = workerAt(s, sq);
    if (w >= 0) {
      const ghost = moveTo !== null && sq === sel;
      svg += workerCircle(sq, ownerOf(w), ghost);
    }
    if (sq === pendingPlace) svg += workerCircle(sq, s.player, true);
    if (moveTo === sq && sel !== null) svg += workerCircle(sq, s.player, true);

    if (sel === sq && moveTo === null) {
      svg += `<circle cx="${cx(sq)}" cy="${cy(sq)}" r="21" fill="none" stroke="var(--accent)" stroke-width="3" pointer-events="none"/>`;
    }
    if (dests.includes(sq)) {
      svg += `<circle cx="${cx(sq)}" cy="${cy(sq)}" r="9" fill="var(--accent)" opacity="0.9" pointer-events="none"/>`;
    }
    if (builds.includes(sq)) {
      svg += `<circle cx="${cx(sq)}" cy="${cy(sq)}" r="13" fill="none" stroke="var(--build)" stroke-width="4" stroke-dasharray="5 4" pointer-events="none"/>`;
    }
    svg += '</g>';
  }
  boardEl.innerHTML = svg;

  statusEl.innerHTML = statusText();
  recordEl.textContent = recordText();
}

function statusText(): string {
  const s = game.state;
  const chip = `<span class="chip p${s.player + 1}"></span>`;
  if (s.phase === 'over') {
    const w = s.winner!;
    return `<span class="chip p${w + 1}"></span> <strong>${PLAYER_NAME[w]} wins!</strong>`;
  }
  if (s.phase === 'setup') {
    const n = pendingPlace === null ? 1 : 2;
    return `${chip} ${PLAYER_NAME[s.player]}: place worker ${n} of 2`;
  }
  if (sel === null) return `${chip} ${PLAYER_NAME[s.player]} to move — select a worker`;
  if (moveTo === null) return `${chip} ${PLAYER_NAME[s.player]} — choose a destination`;
  return `${chip} ${PLAYER_NAME[s.player]} — choose where to build`;
}

function recordText(): string {
  const t = game.turnStrings;
  if (t.length === 0) return '(no moves yet)';
  const rounds: string[] = [];
  for (let i = 0; i < t.length; i += 2) {
    rounds.push(`${i / 2 + 1}. ${t[i]}${i + 1 < t.length ? ' ' + t[i + 1] : ''}`);
  }
  return rounds.join('\n');
}

render();
