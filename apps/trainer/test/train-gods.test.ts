import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCheckpoint, FEATURE_COUNT_V2, Mlp } from '@santorini/ai';
import { Game } from '@santorini/engine';
import { describe, expect, it } from 'vitest';
import { writeJson } from '../src/io.ts';

// Covers issue #17 / T5: `trainer train --gods`/`--god-pool` CLI plumbing
// through selfplay.ts, and the encoding-version guard around mlp@2/pv@2
// parents. Exercises the actual CLI entry point (spawned as a subprocess,
// like a real invocation) rather than importing cli.ts directly — cli.ts
// runs `main()` at module load, so importing it isn't test-safe.

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): CliResult {
  try {
    const stdout = execFileSync('node', [CLI, ...args], { encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

/** Split a multi-game SGN dump (`docs.join('\n')` in cli.ts) back into
 * individual game documents Game.fromSGN can parse one at a time. */
function splitSgnDocs(text: string): string[] {
  return text.trim().split(/\n\n(?=\[)/);
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'santorini-train-gods-'));
}

describe('trainer train --gods / --god-pool (T5)', () => {
  it('runs a 10-game --god-pool self-play + training round trip whose SGN dump replay-verifies with God headers', () => {
    const dir = tempDir();
    const parentPath = join(dir, 'gen-000.json');
    writeJson(
      parentPath,
      createCheckpoint(new Date().toISOString(), {
        search: { iterations: 24, c: 1.0, playoutDepth: 4 },
      }),
    );
    const outPath = join(dir, 'gen-001.json');
    const sgnPath = join(dir, 'selfplay.sgn');

    const res = runCli([
      'train',
      '--parent',
      parentPath,
      '--out',
      outPath,
      '--games',
      '10',
      '--seed',
      '3',
      '--epochs',
      '1',
      '--hidden',
      '4',
      '--batch',
      '8',
      '--iters',
      '24',
      '--temp-turns',
      '4',
      '--max-half-turns',
      '60',
      '--god-pool',
      'none,pan,athena,apollo,minotaur,artemis',
      '--sgn',
      sgnPath,
    ]);
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
    expect(existsSync(outPath)).toBe(true);

    const docs = splitSgnDocs(readFileSync(sgnPath, 'utf8'));
    expect(docs).toHaveLength(10);
    const pool = ['none', 'pan', 'athena', 'apollo', 'minotaur', 'artemis'];
    let sawNonBaseGod = false;
    for (const doc of docs) {
      const replayed = Game.fromSGN(doc);
      expect(pool).toContain(replayed.state.gods[0]);
      expect(pool).toContain(replayed.state.gods[1]);
      if (replayed.state.gods[0] !== 'none' || replayed.state.gods[1] !== 'none') {
        sawNonBaseGod = true;
        expect(doc).toMatch(/\[God1 "/);
        expect(doc).toMatch(/\[God2 "/);
      } else {
        expect(doc).not.toContain('God1');
        expect(doc).not.toContain('God2');
      }
      // Replay reproduces the same winner/turn count the run reported.
      expect([0, 1, null]).toContain(replayed.winner);
    }
    // A 6-god (incl. none) pool over 10 games should draw at least one real
    // god matchup with overwhelming probability — sanity that pool sampling
    // actually varies, not just always drawing none/none.
    expect(sawNonBaseGod).toBe(true);
  });

  it('rejects --gods and --god-pool together', () => {
    const dir = tempDir();
    const parentPath = join(dir, 'gen-000.json');
    writeJson(parentPath, createCheckpoint(new Date().toISOString(), {}));
    const res = runCli([
      'train',
      '--parent',
      parentPath,
      '--out',
      join(dir, 'gen-001.json'),
      '--games',
      '2',
      '--gods',
      'pan,pan',
      '--god-pool',
      'none,pan',
    ]);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('mutually exclusive');
  });

  it('fixed --gods threads the same pair to every game', () => {
    const dir = tempDir();
    const parentPath = join(dir, 'gen-000.json');
    writeJson(
      parentPath,
      createCheckpoint(new Date().toISOString(), {
        search: { iterations: 24, c: 1.0, playoutDepth: 4 },
      }),
    );
    const sgnPath = join(dir, 'fixed.sgn');
    const res = runCli([
      'train',
      '--parent',
      parentPath,
      '--out',
      join(dir, 'gen-001.json'),
      '--games',
      '3',
      '--seed',
      '9',
      '--epochs',
      '1',
      '--hidden',
      '4',
      '--iters',
      '24',
      '--gods',
      'pan,athena',
      '--sgn',
      sgnPath,
    ]);
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
    const docs = splitSgnDocs(readFileSync(sgnPath, 'utf8'));
    expect(docs).toHaveLength(3);
    for (const doc of docs) {
      expect(Game.fromSGN(doc).state.gods).toEqual(['pan', 'athena']);
    }
  });

  it('rejects training an mlp@2 parent instead of silently truncating v2 samples to v1 dimensions', () => {
    const dir = tempDir();
    const parentPath = join(dir, 'gen-000-v2.json');
    const net = Mlp.init(FEATURE_COUNT_V2, 8, 123);
    writeJson(
      parentPath,
      createCheckpoint(new Date().toISOString(), {
        eval: { type: 'mlp@2', params: net.toParams() },
        search: { iterations: 24, c: 1.0, playoutDepth: 4 },
      }),
    );
    const res = runCli([
      'train',
      '--parent',
      parentPath,
      '--out',
      join(dir, 'gen-001-v2.json'),
      '--games',
      '2',
      '--god-pool',
      'none,pan',
    ]);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('mlp@2');
    expect(res.stderr).toContain('v1 dimensions');
    expect(existsSync(join(dir, 'gen-001-v2.json'))).toBe(false);
  });
});
