// Elo math for the trainer: fit ratings to a round-robin (calibration) and
// rate one player against fixed-rated opponents (gauntlet). Pure functions.

/** Expected score of a player rated `ra` against one rated `rb`. */
export function expectedScore(ra: number, rb: number): number {
  return 1 / (1 + 10 ** ((rb - ra) / 400));
}

/** Aggregate head-to-head result between two named players. */
export interface PairResult {
  a: string;
  b: string;
  winsA: number;
  winsB: number;
  draws: number;
}

export interface FitOptions {
  /** Player whose rating is pinned (default: first player seen). */
  anchor?: string;
  anchorRating?: number;
  sweeps?: number;
}

/**
 * Fit Elo ratings to pairwise results by Bradley–Terry minorization–
 * maximization; draws score half a win each way. One virtual draw is added
 * per played pair so undefeated players get a finite rating.
 */
export function fitElo(
  results: PairResult[],
  opts: FitOptions = {},
): Record<string, number> {
  const names: string[] = [];
  const index = new Map<string, number>();
  const idx = (name: string): number => {
    if (!index.has(name)) {
      index.set(name, names.length);
      names.push(name);
    }
    return index.get(name)!;
  };
  for (const r of results) {
    idx(r.a);
    idx(r.b);
  }
  const n = names.length;
  if (n === 0) return {};

  // wins[i][j] = score of i against j (draws half, plus the virtual draw).
  const wins = Array.from({ length: n }, () => new Float64Array(n));
  for (const r of results) {
    const i = idx(r.a);
    const j = idx(r.b);
    wins[i][j] += r.winsA + r.draws / 2 + 0.5;
    wins[j][i] += r.winsB + r.draws / 2 + 0.5;
  }

  const gamma = new Float64Array(n).fill(1);
  const sweeps = opts.sweeps ?? 200;
  for (let sweep = 0; sweep < sweeps; sweep++) {
    for (let i = 0; i < n; i++) {
      let scored = 0;
      let denom = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const games = wins[i][j] + wins[j][i];
        if (games === 0) continue;
        scored += wins[i][j];
        denom += games / (gamma[i] + gamma[j]);
      }
      if (denom > 0) gamma[i] = scored / denom;
    }
  }

  const ratings: Record<string, number> = {};
  for (let i = 0; i < n; i++) ratings[names[i]] = 400 * Math.log10(gamma[i]);
  const anchor = opts.anchor ?? names[0];
  if (!(anchor in ratings))
    throw new Error(`anchor ${anchor} not among rated players`);
  const shift = (opts.anchorRating ?? 0) - ratings[anchor];
  for (const name of names) ratings[name] += shift;
  return ratings;
}

/** One gauntlet opponent: its fixed rating and the candidate's score vs it. */
export interface GauntletLine {
  opponent: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
}

/**
 * Maximum-likelihood performance rating against fixed-rated opponents,
 * found by bisection (total expected score is monotone in the rating).
 * One virtual draw per opponent keeps sweeps finite.
 */
export function performanceRating(lines: GauntletLine[]): number {
  if (lines.length === 0)
    throw new Error('performanceRating needs at least one opponent');
  let totalScore = 0;
  const games: { rating: number; n: number }[] = [];
  for (const l of lines) {
    totalScore += l.wins + l.draws / 2 + 0.5;
    games.push({ rating: l.rating, n: l.wins + l.losses + l.draws + 1 });
  }
  let lo = -4000;
  let hi = 4000;
  for (let step = 0; step < 100; step++) {
    const mid = (lo + hi) / 2;
    let expected = 0;
    for (const g of games) expected += g.n * expectedScore(mid, g.rating);
    if (expected < totalScore) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
