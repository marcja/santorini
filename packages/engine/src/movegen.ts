import { CELLS, NEIGHBORS, pushSquare } from './board.ts';
import { GODS } from './gods/index.ts';
import { occupancy, ownerOf } from './state.ts';
import type { BuildAction, GameState, MoveTurn, PlaceTurn, Turn } from './types.ts';

/**
 * All legal complete turns for the player to move. A "turn" is atomic:
 * placement of both workers (setup), or move+build(+god extras), or an
 * instantly-winning move.
 */
export function legalTurns(state: GameState): Turn[] {
  if (state.phase === 'over') return [];
  if (state.phase === 'setup') return placementTurns(state);
  return moveTurns(state);
}

export function hasLegalTurn(state: GameState): boolean {
  return legalTurns(state).length > 0;
}

function placementTurns(state: GameState): PlaceTurn[] {
  const occ = occupancy(state);
  const empty: number[] = [];
  for (let sq = 0; sq < CELLS; sq++) if (occ[sq] < 0) empty.push(sq);
  const out: PlaceTurn[] = [];
  for (let i = 0; i < empty.length; i++) {
    for (let j = i + 1; j < empty.length; j++) {
      out.push({ kind: 'place', squares: [empty[i], empty[j]] });
    }
  }
  return out;
}

/** Sentinel from stepInto: the target square is empty (no displaced worker). */
const NO_DISPLACE = -2;

function moveTurns(state: GameState): MoveTurn[] {
  const p = state.player;
  const cfg = GODS[state.gods[p]];
  const oppCfg = GODS[state.gods[1 - p]];
  const upBlocked = !!oppCfg.blocksOpponentUp && state.athenaUp;
  // Scratch copies: mutated during candidate exploration, never the real state.
  const h = state.heights.slice();
  const occ = occupancy(state);
  const turns: MoveTurn[] = [];

  const isWinStep = (from: number, to: number): boolean =>
    (h[from] < 3 && h[to] === 3) || (!!cfg.winOnDescend2 && h[from] - h[to] >= 2);

  /**
   * Can the mover step from->to? Returns false if illegal; otherwise the
   * square the displaced opponent worker is forced to (NO_DISPLACE if none).
   */
  const stepInto = (from: number, to: number): number | false => {
    if (h[to] >= 4) return false;
    if (h[to] - h[from] > 1) return false;
    if (upBlocked && h[to] > h[from]) return false;
    const w = occ[to];
    if (w < 0) return NO_DISPLACE;
    if (ownerOf(w) === p || !cfg.allowOpp) return false;
    if (cfg.allowOpp === 'swap') return from;
    const dest = pushSquare(from, to);
    return dest >= 0 && h[dest] < 4 && occ[dest] < 0 ? dest : false;
  };

  /** Build options on one target square (block, or dome on 3 / Atlas dome). */
  const singleBuilds = (at: number): BuildAction[] => {
    if (h[at] === 3) return [{ at, dome: true }];
    const opts: BuildAction[] = [{ at, dome: false }];
    if (cfg.domeAnyLevel) opts.push({ at, dome: true });
    return opts;
  };

  const buildTargets = (around: number): number[] =>
    NEIGHBORS[around].filter((sq) => occ[sq] < 0 && h[sq] < 4);

  /** All legal complete build sequences with the worker ending on `around`. */
  const buildCombos = (around: number): BuildAction[][] => {
    const targets = buildTargets(around);
    const combos: BuildAction[][] = [];
    for (const t of targets) for (const b of singleBuilds(t)) combos.push([b]);
    if (cfg.extraBuild === 'differentSquare') {
      // Demeter: optional second build on a different space.
      for (let i = 0; i < targets.length; i++) {
        for (let j = i + 1; j < targets.length; j++) {
          combos.push([
            { at: targets[i], dome: h[targets[i]] === 3 },
            { at: targets[j], dome: h[targets[j]] === 3 },
          ]);
        }
      }
    } else if (cfg.extraBuild === 'sameSquare') {
      // Hephaestus: optional second block (not dome) on the first space.
      for (const t of targets) {
        if (h[t] <= 1) combos.push([{ at: t, dome: false }, { at: t, dome: false }]);
      }
    }
    return combos;
  };

  const emit = (
    worker: 0 | 1,
    path: number[],
    builds: BuildAction[],
    win: boolean,
    preBuilds: BuildAction[] | undefined,
  ) => {
    const t: MoveTurn = { kind: 'move', worker, path, builds, win };
    if (preBuilds) t.preBuilds = preBuilds;
    turns.push(t);
  };

  /** Explore all turns for one worker (optionally after Prometheus pre-builds). */
  const tryMovesFrom = (worker: 0 | 1, preBuilds: BuildAction[] | undefined, noUp: boolean) => {
    const wi = p * 2 + worker;
    const from = state.workers[wi];
    for (const to of NEIGHBORS[from]) {
      const disp = stepInto(from, to);
      if (disp === false) continue;
      if (noUp && h[to] > h[from]) continue;
      const displaced = occ[to];
      // Apply the step to the scratch occupancy.
      occ[from] = -1;
      if (displaced >= 0) occ[disp] = displaced;
      occ[to] = wi;

      if (isWinStep(from, to)) {
        emit(worker, [from, to], [], true, preBuilds);
      } else {
        for (const builds of buildCombos(to)) emit(worker, [from, to], builds, false, preBuilds);
        if (cfg.extraMoveStep && !preBuilds) {
          // Artemis: one additional move, not back to the initial space.
          for (const to2 of NEIGHBORS[to]) {
            if (to2 === from) continue;
            if (stepInto(to, to2) === false) continue;
            occ[to] = -1;
            occ[to2] = wi;
            if (isWinStep(to, to2)) {
              emit(worker, [from, to, to2], [], true, undefined);
            } else {
              for (const builds of buildCombos(to2)) emit(worker, [from, to, to2], builds, false, undefined);
            }
            occ[to2] = -1;
            occ[to] = wi;
          }
        }
      }

      // Revert the step.
      occ[to] = displaced;
      if (displaced >= 0) occ[disp] = -1;
      occ[from] = wi;
    }
  };

  for (const worker of [0, 1] as const) tryMovesFrom(worker, undefined, false);

  if (cfg.preBuild) {
    // Prometheus: build before moving, then the move may not go up.
    for (const worker of [0, 1] as const) {
      const from = state.workers[p * 2 + worker];
      for (const target of buildTargets(from)) {
        for (const pb of singleBuilds(target)) {
          const prev = h[target];
          h[target] = pb.dome ? 4 : prev + 1;
          tryMovesFrom(worker, [pb], true);
          h[target] = prev;
        }
      }
    }
  }

  return turns;
}
