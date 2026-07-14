import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type Checkpoint, validateCheckpoint } from '@santorini/ai';
import type { ConfigTier, GodId } from '@santorini/engine';
import type { PairResult } from './elo.ts';

export const BASELINES_FORMAT = 'santorini-baselines@1';

/** Calibrated baseline pool — the fixed ruler `gauntlet` measures against. */
export interface Baselines {
  format: typeof BASELINES_FORMAT;
  calibratedAt: string;
  seed: number;
  gamesPerPair: number;
  /**
   * Gods every pair was calibrated under (['none', 'none'] for the base
   * game) and the resulting configuration tier (issues #22/#26/#27):
   * ratings from different tiers are not comparable. Optional so
   * pre-existing base-game baselines files (format @1, no god dimension
   * yet) still load — absence means base/['none', 'none'].
   */
  gods?: [GodId, GodId];
  configTier?: ConfigTier;
  /** Rebuildable specs with fitted ratings (random anchored at 0). */
  players: { name: string; spec: string; rating: number }[];
  results: PairResult[];
}

export function readCheckpoint(path: string): Checkpoint {
  return validateCheckpoint(JSON.parse(readFileSync(path, 'utf8')));
}

export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

export function readBaselines(path: string): Baselines {
  const b = JSON.parse(readFileSync(path, 'utf8')) as Baselines;
  if (b?.format !== BASELINES_FORMAT) {
    throw new Error(
      `invalid baselines file ${path}: format ${JSON.stringify(b?.format)}`,
    );
  }
  return b;
}
