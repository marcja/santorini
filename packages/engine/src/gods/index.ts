import type { GodId } from '../types.ts';

/**
 * Capability flags consumed by movegen/apply. Gods are data here; the
 * semantics of each flag live in exactly one place in the engine.
 */
export interface GodConfig {
  id: GodId;
  name: string;
  /** Official card text (2017 rulebook). */
  text: string;
  /** Rulebook power index (1–55). Absent for 'none'. */
  index?: number;
  /**
   * Rulebook difficulty tier (simple = index 1–10, advanced = 11–30).
   * Absent for 'none' — the base game has no god, so no tier. The
   * 'advanced' member is declared now so ratings/UI code can switch on it,
   * but no advanced god is implemented yet (issue #26).
   */
  tier?: 'simple' | 'advanced';
  /** May move into an opponent worker's space: swap (Apollo) or push (Minotaur). */
  allowOpp?: 'swap' | 'push';
  /** May move one additional time, not back to the initial space (Artemis). */
  extraMoveStep?: boolean;
  /** Opponent workers cannot move up after this god's owner moved up (Athena). */
  blocksOpponentUp?: boolean;
  /** May build a dome at any level (Atlas). */
  domeAnyLevel?: boolean;
  /** May build one additional time: on a different space (Demeter) or the same space, not dome (Hephaestus). */
  extraBuild?: 'differentSquare' | 'sameSquare';
  /** If the worker does not move up, it may build before and after moving (Prometheus). */
  preBuild?: boolean;
  /** Also wins by moving down two or more levels (Pan). */
  winOnDescend2?: boolean;
  /**
   * Bonus on top of the normal one-step move (same "if...then" shape as
   * Prometheus's pre-build): if you forgo moving up or down at all this
   * turn, both workers may each reposition any number of times (even
   * zero, flat only), then either builds (Hermes). A normal single-step
   * up/down move — including winning by moving onto level 3 — is still a
   * legal Hermes turn; it just forgoes this bonus.
   */
  flatMoveBothWorkers?: boolean;
}

const god = (cfg: GodConfig): GodConfig => cfg;

export const GODS: Record<GodId, GodConfig> = {
  none: god({ id: 'none', name: 'None', text: 'Base game: no god power.' }),
  apollo: god({
    id: 'apollo',
    name: 'Apollo',
    text: "Your Move: Your Worker may move into an opponent Worker's space by forcing their Worker to the space yours just vacated.",
    index: 1,
    tier: 'simple',
    allowOpp: 'swap',
  }),
  artemis: god({
    id: 'artemis',
    name: 'Artemis',
    text: 'Your Move: Your Worker may move one additional time, but not back to its initial space.',
    index: 2,
    tier: 'simple',
    extraMoveStep: true,
  }),
  athena: god({
    id: 'athena',
    name: 'Athena',
    text: "Opponent's Turn: If one of your Workers moved up on your last turn, opponent Workers cannot move up this turn.",
    index: 3,
    tier: 'simple',
    blocksOpponentUp: true,
  }),
  atlas: god({
    id: 'atlas',
    name: 'Atlas',
    text: 'Your Build: Your Worker may build a dome at any level.',
    index: 4,
    tier: 'simple',
    domeAnyLevel: true,
  }),
  demeter: god({
    id: 'demeter',
    name: 'Demeter',
    text: 'Your Build: Your Worker may build one additional time, but not on the same space.',
    index: 5,
    tier: 'simple',
    extraBuild: 'differentSquare',
  }),
  hephaestus: god({
    id: 'hephaestus',
    name: 'Hephaestus',
    text: 'Your Build: Your Worker may build one additional block (not dome) on top of your first block.',
    index: 6,
    tier: 'simple',
    extraBuild: 'sameSquare',
  }),
  hermes: god({
    id: 'hermes',
    name: 'Hermes',
    text: 'Your Turn: If your Workers do not move up or down, they may each move any number of times (even zero), and then either builds.',
    index: 7,
    tier: 'simple',
    flatMoveBothWorkers: true,
  }),
  minotaur: god({
    id: 'minotaur',
    name: 'Minotaur',
    text: "Your Move: Your Worker may move into an opponent Worker's space, if their Worker can be forced one space straight backwards to an unoccupied space at any level.",
    index: 8,
    tier: 'simple',
    allowOpp: 'push',
  }),
  pan: god({
    id: 'pan',
    name: 'Pan',
    text: 'Win Condition: You also win if your Worker moves down two or more levels.',
    index: 9,
    tier: 'simple',
    winOnDescend2: true,
  }),
  prometheus: god({
    id: 'prometheus',
    name: 'Prometheus',
    text: 'Your Turn: If your Worker does not move up, it may build both before and after moving.',
    index: 10,
    tier: 'simple',
    preBuild: true,
  }),
};

/**
 * Configuration identity for training/rating scope: the highest god tier in
 * play, or 'base' when neither side has a god. Ratings, training data, and
 * calibrations are only comparable within one configuration tier (issues
 * #26/#27) — record this alongside any rating.
 */
export type ConfigTier = 'base' | 'simple' | 'advanced';

export function configTier(a: GodId, b: GodId): ConfigTier {
  const tiers = [GODS[a].tier, GODS[b].tier];
  if (tiers.includes('advanced')) return 'advanced';
  if (tiers.includes('simple')) return 'simple';
  return 'base';
}

export const GOD_IDS = Object.keys(GODS) as GodId[];

export function godIdByName(name: string): GodId {
  const key = name.trim().toLowerCase();
  if (key === '' || key === 'none') return 'none';
  if (key in GODS) return key as GodId;
  throw new Error(`unknown god: ${name}`);
}
