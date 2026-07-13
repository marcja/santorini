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
    allowOpp: 'swap',
  }),
  artemis: god({
    id: 'artemis',
    name: 'Artemis',
    text: 'Your Move: Your Worker may move one additional time, but not back to its initial space.',
    extraMoveStep: true,
  }),
  athena: god({
    id: 'athena',
    name: 'Athena',
    text: "Opponent's Turn: If one of your Workers moved up on your last turn, opponent Workers cannot move up this turn.",
    blocksOpponentUp: true,
  }),
  atlas: god({
    id: 'atlas',
    name: 'Atlas',
    text: 'Your Build: Your Worker may build a dome at any level.',
    domeAnyLevel: true,
  }),
  demeter: god({
    id: 'demeter',
    name: 'Demeter',
    text: 'Your Build: Your Worker may build one additional time, but not on the same space.',
    extraBuild: 'differentSquare',
  }),
  hephaestus: god({
    id: 'hephaestus',
    name: 'Hephaestus',
    text: 'Your Build: Your Worker may build one additional block (not dome) on top of your first block.',
    extraBuild: 'sameSquare',
  }),
  hermes: god({
    id: 'hermes',
    name: 'Hermes',
    text: 'Your Turn: If your Workers do not move up or down, they may each move any number of times (even zero), and then either builds.',
    flatMoveBothWorkers: true,
  }),
  minotaur: god({
    id: 'minotaur',
    name: 'Minotaur',
    text: "Your Move: Your Worker may move into an opponent Worker's space, if their Worker can be forced one space straight backwards to an unoccupied space at any level.",
    allowOpp: 'push',
  }),
  pan: god({
    id: 'pan',
    name: 'Pan',
    text: 'Win Condition: You also win if your Worker moves down two or more levels.',
    winOnDescend2: true,
  }),
  prometheus: god({
    id: 'prometheus',
    name: 'Prometheus',
    text: 'Your Turn: If your Worker does not move up, it may build both before and after moving.',
    preBuild: true,
  }),
};

export const GOD_IDS = Object.keys(GODS) as GodId[];

export function godIdByName(name: string): GodId {
  const key = name.trim().toLowerCase();
  if (key === '' || key === 'none') return 'none';
  if (key in GODS) return key as GodId;
  throw new Error(`unknown god: ${name}`);
}
