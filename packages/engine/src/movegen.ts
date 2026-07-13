import { CELLS, NEIGHBORS, pushSquare } from './board.ts';
import type { GodConfig } from './gods/index.ts';
import { GODS } from './gods/index.ts';
import { occupancy, ownerOf } from './state.ts';
import type {
  BuildAction,
  GameState,
  MoveTurn,
  PlaceTurn,
  Player,
  Turn,
} from './types.ts';

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

/** Scratch state shared by one legalTurns() move-phase call; mutated during exploration, never the real GameState. */
interface MoveCtx {
  readonly p: Player;
  readonly cfg: GodConfig;
  readonly upBlocked: boolean;
  readonly h: Uint8Array;
  readonly occ: Int8Array;
  readonly turns: MoveTurn[];
}

function moveTurns(state: GameState): MoveTurn[] {
  const p = state.player;
  const cfg = GODS[state.gods[p]];
  const oppCfg = GODS[state.gods[1 - p]];
  const ctx: MoveCtx = {
    p,
    cfg,
    upBlocked: !!oppCfg.blocksOpponentUp && state.athenaUp,
    h: state.heights.slice(),
    occ: occupancy(state),
    turns: [],
  };

  for (const worker of [0, 1] as const)
    tryMovesFrom(ctx, state, worker, undefined, false);
  if (cfg.preBuild) tryPreBuilds(ctx, state);

  return ctx.turns;
}

/** Prometheus: build before moving, then the move may not go up. */
function tryPreBuilds(ctx: MoveCtx, state: GameState): void {
  for (const worker of [0, 1] as const) {
    const from = state.workers[ctx.p * 2 + worker];
    for (const target of buildTargets(ctx, from)) {
      for (const pb of singleBuilds(ctx, target)) {
        const prev = ctx.h[target];
        ctx.h[target] = pb.dome ? 4 : prev + 1;
        tryMovesFrom(ctx, state, worker, [pb], true);
        ctx.h[target] = prev;
      }
    }
  }
}

function isWinStep(ctx: MoveCtx, from: number, to: number): boolean {
  const { h, cfg } = ctx;
  return (
    (h[from] < 3 && h[to] === 3) ||
    (!!cfg.winOnDescend2 && h[from] - h[to] >= 2)
  );
}

/**
 * Can the mover step from->to? Returns false if illegal; otherwise the
 * square the displaced opponent worker is forced to (NO_DISPLACE if none).
 */
function stepInto(ctx: MoveCtx, from: number, to: number): number | false {
  const { h, occ, upBlocked } = ctx;
  if (h[to] >= 4) return false;
  if (h[to] - h[from] > 1) return false;
  if (upBlocked && h[to] > h[from]) return false;
  const w = occ[to];
  if (w < 0) return NO_DISPLACE;
  return resolveDisplacement(ctx, from, to, w);
}

/** Where an occupying opponent worker on `to` ends up, or false if the step is illegal. */
function resolveDisplacement(
  ctx: MoveCtx,
  from: number,
  to: number,
  w: number,
): number | false {
  const { cfg, h, occ, p } = ctx;
  if (ownerOf(w) === p || !cfg.allowOpp) return false;
  if (cfg.allowOpp === 'swap') return from;
  const dest = pushSquare(from, to);
  return dest >= 0 && h[dest] < 4 && occ[dest] < 0 ? dest : false;
}

/** Build options on one target square (block, or dome on 3 / Atlas dome). */
function singleBuilds(ctx: MoveCtx, at: number): BuildAction[] {
  const { h, cfg } = ctx;
  if (h[at] === 3) return [{ at, dome: true }];
  const opts: BuildAction[] = [{ at, dome: false }];
  if (cfg.domeAnyLevel) opts.push({ at, dome: true });
  return opts;
}

function buildTargets(ctx: MoveCtx, around: number): number[] {
  const { occ, h } = ctx;
  return NEIGHBORS[around].filter((sq) => occ[sq] < 0 && h[sq] < 4);
}

/** All legal complete build sequences with the worker ending on `around`. */
function buildCombos(ctx: MoveCtx, around: number): BuildAction[][] {
  const targets = buildTargets(ctx, around);
  const combos = baseBuildCombos(ctx, targets);
  if (ctx.cfg.extraBuild === 'differentSquare')
    combos.push(...demeterCombos(ctx, targets));
  else if (ctx.cfg.extraBuild === 'sameSquare')
    combos.push(...hephaestusCombos(ctx, targets));
  return combos;
}

function baseBuildCombos(ctx: MoveCtx, targets: number[]): BuildAction[][] {
  const combos: BuildAction[][] = [];
  for (const t of targets)
    for (const b of singleBuilds(ctx, t)) combos.push([b]);
  return combos;
}

/** Demeter: optional second build on a different space. */
function demeterCombos(ctx: MoveCtx, targets: number[]): BuildAction[][] {
  const { h } = ctx;
  const combos: BuildAction[][] = [];
  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) {
      combos.push([
        { at: targets[i], dome: h[targets[i]] === 3 },
        { at: targets[j], dome: h[targets[j]] === 3 },
      ]);
    }
  }
  return combos;
}

/** Hephaestus: optional second block (not dome) on the first space. */
function hephaestusCombos(ctx: MoveCtx, targets: number[]): BuildAction[][] {
  const { h } = ctx;
  const combos: BuildAction[][] = [];
  for (const t of targets) {
    if (h[t] <= 1)
      combos.push([
        { at: t, dome: false },
        { at: t, dome: false },
      ]);
  }
  return combos;
}

function emit(
  ctx: MoveCtx,
  worker: 0 | 1,
  path: number[],
  builds: BuildAction[],
  win: boolean,
  preBuilds: BuildAction[] | undefined,
): void {
  const t: MoveTurn = { kind: 'move', worker, path, builds, win };
  if (preBuilds) t.preBuilds = preBuilds;
  ctx.turns.push(t);
}

/**
 * Emit the winning turn, or every build-combo turn, for a step that just
 * landed on `to`. Returns whether it won (callers must not explore further
 * steps after a win — the turn already ended).
 */
function emitLandedStep(
  ctx: MoveCtx,
  worker: 0 | 1,
  path: number[],
  from: number,
  to: number,
  preBuilds: BuildAction[] | undefined,
): boolean {
  if (isWinStep(ctx, from, to)) {
    emit(ctx, worker, path, [], true, preBuilds);
    return true;
  }
  for (const builds of buildCombos(ctx, to))
    emit(ctx, worker, path, builds, false, preBuilds);
  return false;
}

/** Explore all turns for one worker (optionally after Prometheus pre-builds). */
function tryMovesFrom(
  ctx: MoveCtx,
  state: GameState,
  worker: 0 | 1,
  preBuilds: BuildAction[] | undefined,
  noUp: boolean,
): void {
  const { p, h, occ } = ctx;
  const wi = p * 2 + worker;
  const from = state.workers[wi];
  for (const to of NEIGHBORS[from]) {
    const disp = stepInto(ctx, from, to);
    if (disp === false) continue;
    if (noUp && h[to] > h[from]) continue;
    const displaced = occ[to];
    // Apply the step to the scratch occupancy.
    occ[from] = -1;
    if (displaced >= 0) occ[disp] = displaced;
    occ[to] = wi;

    afterStep(ctx, worker, from, to, wi, preBuilds);

    // Revert the step.
    occ[to] = displaced;
    if (displaced >= 0) occ[disp] = -1;
    occ[from] = wi;
  }
}

/** Everything a landed step can still do: end the turn here, or (Artemis) step once more. */
function afterStep(
  ctx: MoveCtx,
  worker: 0 | 1,
  from: number,
  to: number,
  wi: number,
  preBuilds: BuildAction[] | undefined,
): void {
  const won = emitLandedStep(ctx, worker, [from, to], from, to, preBuilds);
  if (!won && ctx.cfg.extraMoveStep && !preBuilds)
    tryExtraMoveStep(ctx, worker, from, to, wi);
}

/** Artemis: one additional move, not back to the initial space. */
function tryExtraMoveStep(
  ctx: MoveCtx,
  worker: 0 | 1,
  from: number,
  to: number,
  wi: number,
): void {
  const { occ } = ctx;
  for (const to2 of NEIGHBORS[to]) {
    if (to2 === from) continue;
    if (stepInto(ctx, to, to2) === false) continue;
    occ[to] = -1;
    occ[to2] = wi;
    emitLandedStep(ctx, worker, [from, to, to2], to, to2, undefined);
    occ[to2] = -1;
    occ[to] = wi;
  }
}
