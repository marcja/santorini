import { parseSquareName, squareName } from './board.ts';
import { workerAt } from './state.ts';
import type { BuildAction, GameState, MoveTurn, Turn } from './types.ts';

// SGN — Santorini Game Notation. Spec: docs/NOTATION.md.

/**
 * Format one turn. `state` is the position BEFORE the turn (needed to decide
 * when an explicit dome marker `D` is required).
 */
export function formatTurn(state: GameState, t: Turn): string {
  if (t.kind === 'place') return t.squares.map(squareName).join(',');
  const scratch = state.heights.slice();
  let out = '';
  for (const b of t.preBuilds ?? []) out += fmtBuild(scratch, b);
  out += t.path.map(squareName).join('-');
  for (const b of t.builds) out += fmtBuild(scratch, b);
  if (t.win) out += '#';
  return out;
}

function fmtBuild(scratch: Uint8Array, b: BuildAction): string {
  const explicitDome = b.dome && scratch[b.at] !== 3;
  const s = `^${squareName(b.at)}${explicitDome ? 'D' : ''}`;
  scratch[b.at] = b.dome ? 4 : scratch[b.at] + 1;
  return s;
}

/**
 * Parse one turn against the position BEFORE it. Resolves which worker moves
 * and whether each build is a dome. Trailing `#` and `!`/`?` annotations are
 * accepted. Legality is NOT fully checked here — Game.play matches the parsed
 * turn against legalTurns.
 */
export function parseTurn(state: GameState, str: string): Turn {
  const s = str.trim();
  if (state.phase === 'setup') {
    const parts = s.split(',');
    if (parts.length !== 2) throw new Error(`invalid placement turn: ${str}`);
    return {
      kind: 'place',
      squares: [
        parseSquareName(parts[0].trim()),
        parseSquareName(parts[1].trim()),
      ],
    };
  }

  let i = 0;
  const scratch = state.heights.slice();
  const readSquare = (): number => {
    const sq = parseSquareName(s.slice(i, i + 2));
    i += 2;
    return sq;
  };
  const readBuild = (): BuildAction => {
    i++; // '^'
    const at = readSquare();
    let dome = scratch[at] === 3;
    if (s[i] === 'D') {
      dome = true;
      i++;
    }
    scratch[at] = dome ? 4 : scratch[at] + 1;
    return { at, dome };
  };

  const preBuilds: BuildAction[] = [];
  while (s[i] === '^') preBuilds.push(readBuild());
  const path: number[] = [readSquare()];
  while (s[i] === '-') {
    i++;
    path.push(readSquare());
  }
  const builds: BuildAction[] = [];
  while (s[i] === '^') builds.push(readBuild());
  let win = false;
  if (s[i] === '#') {
    win = true;
    i++;
  }
  while (s[i] === '!' || s[i] === '?') i++;
  if (i !== s.length)
    throw new Error(`unexpected trailing characters in turn: ${str}`);

  const w = workerAt(state, path[0]);
  if (w < 0 || w >> 1 !== state.player) {
    throw new Error(
      `player ${state.player + 1} has no worker on ${squareName(path[0])}`,
    );
  }
  const turn: MoveTurn = {
    kind: 'move',
    worker: (w & 1) as 0 | 1,
    path,
    builds,
    win,
  };
  if (preBuilds.length > 0) turn.preBuilds = preBuilds;
  return turn;
}

/**
 * Canonical identity of a turn, for matching a user/parsed turn against
 * legalTurns. Build order is normalized (independent builds commute); the win
 * flag is excluded (derivable: a legal move turn wins iff it has no builds);
 * placement worker order is normalized (workers are interchangeable at setup).
 */
export function turnKey(t: Turn): string {
  if (t.kind === 'place') {
    return `P${[...t.squares].sort((a, b) => a - b).join(',')}`;
  }
  const key = (bs: BuildAction[]): string =>
    bs
      .map((b) => String(b.at).padStart(2, '0') + (b.dome ? 'D' : ''))
      .sort()
      .join(',');
  return `M${t.path.join('-')}|${key(t.preBuilds ?? [])}|${key(t.builds)}`;
}

// --- Game-level SGN ---

export interface SgnDocument {
  headers: Record<string, string>;
  /** Turn strings in play order (round numbers/comments/results stripped). */
  turns: string[];
}

const HEADER_RE = /\[(\w+)\s+"([^"]*)"\]/g;

export function parseSGN(text: string): SgnDocument {
  const headers: Record<string, string> = {};
  let body = text.replace(HEADER_RE, (_, k: string, v: string) => {
    headers[k] = v;
    return ' ';
  });
  body = body.replace(/\{[^}]*\}/g, ' ');
  const turns = body
    .split(/\s+/)
    .filter(Boolean)
    .filter(
      (tok) =>
        !/^\d+\.$/.test(tok) && tok !== '1-0' && tok !== '0-1' && tok !== '*',
    );
  return { headers, turns };
}

export function formatSGN(
  headers: Record<string, string>,
  turns: string[],
): string {
  const headerLines = Object.entries(headers).map(([k, v]) => `[${k} "${v}"]`);
  const tokens: string[] = [];
  for (let i = 0; i < turns.length; i += 2) {
    tokens.push(`${i / 2 + 1}.`, turns[i]);
    if (i + 1 < turns.length) tokens.push(turns[i + 1]);
  }
  const lines: string[] = [];
  let line = '';
  for (const tok of tokens) {
    if (line !== '' && line.length + tok.length + 1 > 80) {
      lines.push(line);
      line = tok;
    } else {
      line = line === '' ? tok : `${line} ${tok}`;
    }
  }
  if (line !== '') lines.push(line);
  return (
    headerLines.join('\n') +
    (headerLines.length ? '\n\n' : '') +
    lines.join('\n') +
    '\n'
  );
}
