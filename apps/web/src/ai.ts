import {
  type AiPlayer,
  type Checkpoint,
  checkpointEvalFn,
  checkpointPolicyFn,
  type EvalFn,
  type PolicyFn,
  parsePlayerSpec,
  playerFromSpec,
  specName,
  validateCheckpoint,
} from '@santorini/ai';
import gen005 from '../../../models/gen-005.json';
import gen007 from '../../../models/gen-007.json';
import ladderJson from '../../../models/ladder.json';

// The frozen difficulty ladder (models/ladder.json) drives the opponent
// picker. Checkpoints referenced by its specs must be bundled here — Vite
// inlines the JSON at build time; validateCheckpoint guards against schema
// drift the moment the module loads, not mid-game.

const CHECKPOINTS: Record<string, unknown> = {
  'models/gen-005.json': gen005,
  'models/gen-007.json': gen007,
};

function loadCheckpoint(path: string): Checkpoint {
  const data = CHECKPOINTS[path];
  if (data === undefined)
    throw new Error(`checkpoint not bundled with the web app: ${path}`);
  return validateCheckpoint(data);
}

export interface AiLevel {
  /** Ladder rung name: Beginner / Easy / Medium / Hard / Expert. */
  name: string;
  /**
   * Underlying player + calibrated Elo, e.g. "gen-5, Elo 841 (base game)".
   * Qualified "(base game)" because every ladder rating was measured in
   * base-game play only — it does not transfer to god games (issue #22).
   */
  detail: string;
  /** Fresh player per game — players carry RNG state. */
  make(seed: number): AiPlayer;
}

// Strongest bundled checkpoint (gen-007, pv@1) powers the coach's hint
// search: its value head evaluates, its policy head steers the search (PUCT).
const coachCkpt = validateCheckpoint(gen007);
export const COACH_EVAL: EvalFn = checkpointEvalFn(coachCkpt.eval);
export const COACH_POLICY: PolicyFn | null = checkpointPolicyFn(coachCkpt.eval);

export const AI_LEVELS: AiLevel[] = ladderJson.levels.map((level) => {
  const spec = parsePlayerSpec(level.spec);
  const label = specName(
    spec,
    spec.kind === 'ckpt' ? loadCheckpoint(spec.path) : undefined,
  );
  return {
    name: level.name,
    detail: `${label}, Elo ${level.rating} (base game)`,
    make: (seed: number) => playerFromSpec(spec, seed, loadCheckpoint),
  };
});
