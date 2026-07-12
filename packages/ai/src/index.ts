export { resolveTurn, type AiPlayer } from './player.ts';
export { mulberry32, pick, type Rng } from './rng.ts';
export { evaluate, DEFAULT_EVAL_WEIGHTS, EVAL_SCALE, type EvalFn, type EvalWeights } from './eval.ts';
export { encodeFeatures, transformFeatures, augmentSamples, FEATURE_COUNT, SYMMETRY_MAPS } from './features.ts';
export { Mlp, type MlpParams, type Sample, type TrainOptions } from './mlp.ts';
export {
  CHECKPOINT_FORMAT,
  DEFAULT_SEARCH,
  checkpointEvalFn,
  createCheckpoint,
  validateCheckpoint,
  playerFromCheckpoint,
  type Checkpoint,
  type CheckpointEval,
  type CheckpointInit,
  type CheckpointPlayerOptions,
  type EloRating,
  type OpponentRecord,
  type SearchConfig,
} from './checkpoint.ts';
export { parsePlayerSpec, playerFromSpec, specName, type PlayerSpec } from './spec.ts';
export {
  coachHint,
  describeTurn,
  forcedLoss,
  reviewLines,
  reviewTurn,
  threatSquares,
  winningTurns,
  type CoachHint,
  type CoachOptions,
  type TurnReview,
} from './coach.ts';
export {
  LESSONS,
  checkExercise,
  lessonState,
  type Exercise,
  type ExerciseGoal,
  type ExerciseResult,
  type Lesson,
  type LessonLevel,
  type LessonPosition,
} from './lessons.ts';
export {
  selfPlay,
  type SelfPlayConfig,
  type SelfPlayGame,
  type SelfPlayResult,
} from './selfplay.ts';
export { RandomPlayer } from './random.ts';
export { GreedyPlayer } from './greedy.ts';
export { MctsPlayer, type MctsOptions, type SearchResult, type TurnStat } from './mcts.ts';
export { playGame, playMatch, type GameConfig, type GameResult, type MatchResult } from './match.ts';
