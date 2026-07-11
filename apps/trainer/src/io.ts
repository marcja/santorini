import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { validateCheckpoint, type Checkpoint } from '@santorini/ai';
import type { PairResult } from './elo.ts';

export const BASELINES_FORMAT = 'santorini-baselines@1';

/** Calibrated baseline pool — the fixed ruler `gauntlet` measures against. */
export interface Baselines {
  format: typeof BASELINES_FORMAT;
  calibratedAt: string;
  seed: number;
  gamesPerPair: number;
  /** Rebuildable specs with fitted ratings (random anchored at 0). */
  players: { name: string; spec: string; rating: number }[];
  results: PairResult[];
}

export function readCheckpoint(path: string): Checkpoint {
  return validateCheckpoint(JSON.parse(readFileSync(path, 'utf8')));
}

export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

export function readBaselines(path: string): Baselines {
  const b = JSON.parse(readFileSync(path, 'utf8')) as Baselines;
  if (b?.format !== BASELINES_FORMAT) {
    throw new Error(`invalid baselines file ${path}: format ${JSON.stringify(b?.format)}`);
  }
  return b;
}
