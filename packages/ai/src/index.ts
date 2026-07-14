export {
  CHECKPOINT_FORMAT,
  type Checkpoint,
  type CheckpointEval,
  type CheckpointInit,
  type CheckpointPlayerOptions,
  checkpointEvalFn,
  checkpointPolicyFn,
  createCheckpoint,
  DEFAULT_SEARCH,
  type EloRating,
  type OpponentRecord,
  playerFromCheckpoint,
  type SearchConfig,
  validateCheckpoint,
} from './checkpoint.ts';
export {
  type CoachHint,
  type CoachOptions,
  coachHint,
  describeTurn,
  forcedLoss,
  reviewLines,
  reviewTurn,
  type TurnReview,
  threatSquares,
  winningTurns,
} from './coach.ts';
export {
  ACTION_HEADS_V2,
  FEATURE_COUNT_V2,
  GOD_ONE_HOT_COUNT,
  GOD_STATE_FLAG_COUNT,
  godOneHotIndex,
  MAX_GOD_INDEX,
  MOVER_FLAGS_OFFSET,
  MOVER_GOD_OFFSET,
  OPPONENT_FLAGS_OFFSET,
  OPPONENT_GOD_OFFSET,
  POLICY_LOGITS_V2,
  V1_FEATURE_COUNT,
} from './encoding.ts';
export {
  DEFAULT_EVAL_WEIGHTS,
  EVAL_SCALE,
  type EvalFn,
  type EvalWeights,
  evaluate,
} from './eval.ts';
export {
  augmentSamples,
  encodeFeatures,
  encodeFeaturesV2,
  FEATURE_COUNT,
  SYMMETRY_MAPS,
  transformFeatures,
} from './features.ts';
export { GreedyPlayer } from './greedy.ts';
export {
  checkExercise,
  type Exercise,
  type ExerciseGoal,
  type ExerciseResult,
  LESSONS,
  type Lesson,
  type LessonLevel,
  type LessonPosition,
  lessonState,
} from './lessons.ts';
export {
  type GameConfig,
  type GameResult,
  type MatchResult,
  playGame,
  playMatch,
} from './match.ts';
export {
  type MctsOptions,
  MctsPlayer,
  type SearchResult,
  type TurnStat,
} from './mcts.ts';
export { Mlp, type MlpParams, type Sample, type TrainOptions } from './mlp.ts';
export { type AiPlayer, resolveTurn } from './player.ts';
export {
  ACTION_COUNT,
  augmentPvSamples,
  type PolicyFn,
  policyPriors,
  transformAction,
  turnAction,
} from './policy.ts';
export {
  PolicyValueNet,
  type PvEpochLoss,
  type PvNetParams,
  type PvSample,
  type PvTrainOptions,
} from './pvnet.ts';
export { RandomPlayer } from './random.ts';
export { mulberry32, pick, type Rng } from './rng.ts';
export {
  type SelfPlayConfig,
  type SelfPlayGame,
  type SelfPlayResult,
  selfPlay,
} from './selfplay.ts';
export {
  type PlayerSpec,
  parsePlayerSpec,
  playerFromSpec,
  specName,
} from './spec.ts';
