import { type Checkpoint, playerFromCheckpoint } from './checkpoint.ts';
import { GreedyPlayer } from './greedy.ts';
import { MctsPlayer } from './mcts.ts';
import type { AiPlayer } from './player.ts';
import { RandomPlayer } from './random.ts';

// Textual player specs — the shared grammar used by the trainer CLI, the
// frozen ladder (models/ladder.json), and the web app's opponent picker.
// Checkpoint I/O stays injected: callers resolve ckpt paths themselves
// (fs in the trainer, bundled JSON in the browser).

/**
 * Parsed player spec. Grammar:
 *   random | greedy
 *   mcts:ITERATIONS[,c=FLOAT][,depth=INT]
 *   ckpt:PATH[,iters=INT]
 */
export type PlayerSpec =
  | { kind: 'random' }
  | { kind: 'greedy' }
  | { kind: 'mcts'; iterations: number; c?: number; playoutDepth?: number }
  | { kind: 'ckpt'; path: string; iterations?: number };

/** Parse the `,key=value` suffixes shared by every player spec kind. */
function parseSpecOptions(rest: string[], spec: string): Map<string, string> {
  const options = new Map<string, string>();
  for (const part of rest) {
    const [k, v] = part.split('=', 2);
    if (v === undefined)
      throw new Error(
        `invalid player option ${JSON.stringify(part)} in ${spec}`,
      );
    options.set(k, v);
  }
  return options;
}

function parseSpecNumber(key: string, value: string, spec: string): number {
  const x = Number(value);
  if (!Number.isFinite(x))
    throw new Error(`invalid ${key} in player spec ${spec}`);
  return x;
}

function expectSpecOptions(
  options: Map<string, string>,
  allowed: string[],
  spec: string,
): void {
  for (const k of options.keys()) {
    if (!allowed.includes(k))
      throw new Error(`unknown option ${k} in player spec ${spec}`);
  }
}

function parseSimpleSpec(
  kind: 'random' | 'greedy',
  arg: string | undefined,
  options: Map<string, string>,
  spec: string,
): PlayerSpec {
  expectSpecOptions(options, [], spec);
  if (arg !== undefined)
    throw new Error(`${kind} takes no argument (got ${spec})`);
  return { kind };
}

function parseMctsSpec(
  arg: string | undefined,
  options: Map<string, string>,
  spec: string,
): PlayerSpec {
  expectSpecOptions(options, ['c', 'depth'], spec);
  if (arg === undefined)
    throw new Error(`mcts needs iterations, e.g. mcts:1000 (got ${spec})`);
  const parsed: PlayerSpec = {
    kind: 'mcts',
    iterations: parseSpecNumber('iterations', arg, spec),
  };
  if (options.has('c'))
    parsed.c = parseSpecNumber('c', options.get('c')!, spec);
  if (options.has('depth'))
    parsed.playoutDepth = parseSpecNumber('depth', options.get('depth')!, spec);
  return parsed;
}

function parseCkptSpec(
  arg: string | undefined,
  options: Map<string, string>,
  spec: string,
): PlayerSpec {
  expectSpecOptions(options, ['iters'], spec);
  if (arg === undefined)
    throw new Error(`ckpt needs a path, e.g. ckpt:models/gen-000.json`);
  const parsed: PlayerSpec = { kind: 'ckpt', path: arg };
  if (options.has('iters'))
    parsed.iterations = parseSpecNumber('iters', options.get('iters')!, spec);
  return parsed;
}

export function parsePlayerSpec(spec: string): PlayerSpec {
  const [head, ...rest] = spec.split(',');
  const [kind, arg] = head.split(':', 2);
  const options = parseSpecOptions(rest, spec);

  switch (kind) {
    case 'random':
    case 'greedy':
      return parseSimpleSpec(kind, arg, options, spec);
    case 'mcts':
      return parseMctsSpec(arg, options, spec);
    case 'ckpt':
      return parseCkptSpec(arg, options, spec);
    default:
      throw new Error(
        `unknown player kind ${JSON.stringify(kind)} (expected random|greedy|mcts|ckpt)`,
      );
  }
}

/** Display name for a spec — used in reports, baselines.json, SGN headers. */
export function specName(spec: PlayerSpec, ckpt?: Checkpoint): string {
  switch (spec.kind) {
    case 'random':
    case 'greedy':
      return spec.kind;
    case 'mcts':
      return `mcts(${spec.iterations})`;
    case 'ckpt':
      return ckpt ? `gen-${ckpt.generation}` : spec.path;
  }
}

/**
 * Build a fresh player for one game. Players carry RNG state, so callers
 * construct a new one per game with a per-game seed for reproducibility.
 * `loadCheckpoint` resolves ckpt specs (fs-backed in the trainer CLI,
 * bundled-JSON-backed in the web app).
 */
export function playerFromSpec(
  spec: PlayerSpec,
  seed: number,
  loadCheckpoint: (path: string) => Checkpoint,
): AiPlayer {
  switch (spec.kind) {
    case 'random':
      return new RandomPlayer(seed);
    case 'greedy':
      return new GreedyPlayer(seed);
    case 'mcts':
      return new MctsPlayer({
        iterations: spec.iterations,
        c: spec.c,
        playoutDepth: spec.playoutDepth,
        seed,
      });
    case 'ckpt': {
      const ckpt = loadCheckpoint(spec.path);
      const overrides: { seed: number; iterations?: number } = { seed };
      if (spec.iterations !== undefined) overrides.iterations = spec.iterations;
      return playerFromCheckpoint(ckpt, overrides);
    }
  }
}
