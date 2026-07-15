import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCheckpoint, FEATURE_COUNT_V2, Mlp } from '@santorini/ai';
import { describe, expect, it } from 'vitest';
import { writeJson } from '../src/io.ts';

// Covers T6 (docs/milestones/god-ai.md): assertNoCkptWithGods used to reject
// every ckpt: player spec under any non-base --gods, written before feature
// encoding v2 (T3/#44) existed. Now that mlp@2/pv@2 checkpoints carry
// god-aware planes, only v1 checkpoints (static@1/mlp@1/pv@1 — god-blind)
// should still be rejected; v2 checkpoints must be allowed through so
// `gauntlet`/`calibrate`/`match` can rate a v2 lineage under god configs.

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

function runCli(args: string[]): { status: number; stderr: string } {
  try {
    execFileSync('node', [CLI, ...args], { encoding: 'utf8' });
    return { status: 0, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stderr?: string };
    return { status: e.status ?? 1, stderr: e.stderr ?? '' };
  }
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'santorini-ckpt-gods-'));
}

describe('ckpt: player specs under --gods (T6)', () => {
  it('still rejects a v1 (static@1) checkpoint under a non-base --gods', () => {
    const dir = tempDir();
    const path = join(dir, 'v1.json');
    writeJson(
      path,
      createCheckpoint(new Date().toISOString(), {
        search: { iterations: 8, c: 1.0, playoutDepth: 2 },
      }),
    );
    const res = runCli([
      'match',
      `ckpt:${path}`,
      'random',
      '--games',
      '2',
      '--gods',
      'pan,pan',
    ]);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('feature encoding v1');
  });

  it('allows a v2 (mlp@2) checkpoint under a non-base --gods', () => {
    const dir = tempDir();
    const path = join(dir, 'v2.json');
    const net = Mlp.init(FEATURE_COUNT_V2, 4, 7);
    writeJson(
      path,
      createCheckpoint(new Date().toISOString(), {
        eval: { type: 'mlp@2', params: net.toParams() },
        search: { iterations: 8, c: 1.0, playoutDepth: 2 },
      }),
    );
    const res = runCli([
      'match',
      `ckpt:${path}`,
      'random',
      '--games',
      '2',
      '--gods',
      'pan,pan',
    ]);
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
  });
});
