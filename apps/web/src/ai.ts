import {
  parsePlayerSpec,
  playerFromSpec,
  specName,
  validateCheckpoint,
  type AiPlayer,
  type Checkpoint,
} from '@santorini/ai';
import gen005 from '../../../models/gen-005.json';
import ladderJson from '../../../models/ladder.json';

// The frozen difficulty ladder (models/ladder.json) drives the opponent
// picker. Checkpoints referenced by its specs must be bundled here — Vite
// inlines the JSON at build time; validateCheckpoint guards against schema
// drift the moment the module loads, not mid-game.

const CHECKPOINTS: Record<string, unknown> = {
  'models/gen-005.json': gen005,
};

function loadCheckpoint(path: string): Checkpoint {
  const data = CHECKPOINTS[path];
  if (data === undefined) throw new Error(`checkpoint not bundled with the web app: ${path}`);
  return validateCheckpoint(data);
}

export interface AiLevel {
  /** Ladder rung name: Beginner / Easy / Medium / Hard. */
  name: string;
  /** Underlying player + calibrated Elo, e.g. "gen-5, Elo 841". */
  detail: string;
  /** Fresh player per game — players carry RNG state. */
  make(seed: number): AiPlayer;
}

export const AI_LEVELS: AiLevel[] = ladderJson.levels.map((level) => {
  const spec = parsePlayerSpec(level.spec);
  const label = specName(spec, spec.kind === 'ckpt' ? loadCheckpoint(spec.path) : undefined);
  return {
    name: level.name,
    detail: `${label}, Elo ${level.rating}`,
    make: (seed: number) => playerFromSpec(spec, seed, loadCheckpoint),
  };
});
