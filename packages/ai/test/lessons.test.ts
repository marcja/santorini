import { describe, expect, it } from 'vitest';
import { legalTurns, parseSquareName } from '@santorini/engine';
import { LESSONS, checkExercise, lessonState } from '../src/index.ts';

describe('lesson curriculum', () => {
  it('has unique ids and beginner→advanced ordering', () => {
    const ids = LESSONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    const rank = { beginner: 0, intermediate: 1, advanced: 2 };
    const seq = LESSONS.map((l) => rank[l.level]);
    expect(seq).toEqual([...seq].sort((a, b) => a - b));
  });

  // Every exercise position must be live, solvable, and non-trivial: at
  // least one legal turn passes the goal and at least one fails it.
  for (const lesson of LESSONS.filter((l) => l.exercise)) {
    const ex = lesson.exercise!;
    it(`${lesson.id}: exercise is solvable but not trivial`, () => {
      const s = lessonState(ex.position);
      const turns = legalTurns(s);
      expect(turns.length).toBeGreaterThan(0);
      const results = turns.map((t) => checkExercise(ex, s, t).passed);
      expect(results.some(Boolean)).toBe(true);
      expect(results.every(Boolean)).toBe(false);
    });
  }
});

describe('lessonState', () => {
  it('derives the phase from placed workers', () => {
    expect(lessonState({}).phase).toBe('setup');
    expect(lessonState({ student: ['a1', 'b1'], opponent: ['d5', 'e5'] }).phase).toBe('play');
  });

  it('applies heights and worker squares', () => {
    const s = lessonState({ heights: { c3: 2 }, student: ['b2', 'a1'], opponent: ['d5', 'e5'] });
    expect(s.heights[parseSquareName('c3')]).toBe(2);
    expect(s.workers[0]).toBe(parseSquareName('b2'));
    expect(s.workers[2]).toBe(parseSquareName('d5'));
    expect(s.player).toBe(0);
  });
});

describe('checkExercise', () => {
  const byId = (id: string) => LESSONS.find((l) => l.id === id)!.exercise!;

  it('passes a win and appends the hint on failure', () => {
    const ex = byId('how-you-win');
    const s = lessonState(ex.position);
    const win = legalTurns(s).find((t) => t.kind === 'move' && t.win)!;
    const good = checkExercise(ex, s, win);
    expect(good.passed).toBe(true);
    expect(good.lines[0]).toContain('won on the spot');
    const miss = legalTurns(s).find((t) => !(t.kind === 'move' && t.win))!;
    const bad = checkExercise(ex, s, miss);
    expect(bad.passed).toBe(false);
    expect(bad.lines.at(-1)).toBe(ex.hint);
  });

  it('stop-the-threat: only capping e4 survives', () => {
    const ex = byId('stop-the-threat');
    const s = lessonState(ex.position);
    const e4 = parseSquareName('e4');
    for (const t of legalTurns(s)) {
      const capsE4 = t.kind === 'move' && t.builds.some((b) => b.at === e4 && b.dome);
      expect(checkExercise(ex, s, t).passed).toBe(capsE4);
    }
  });

  it('double-threat: the climb wins unless the build domes a target', () => {
    const ex = byId('double-threat');
    const s = lessonState(ex.position);
    const c3 = parseSquareName('c3');
    const climbs = legalTurns(s).filter((t) => t.kind === 'move' && t.path.at(-1) === c3);
    expect(climbs.length).toBeGreaterThan(1);
    for (const t of climbs) {
      const domesOwnTarget = t.kind === 'move' && t.builds.some((b) => b.dome);
      expect(checkExercise(ex, s, t).passed).toBe(!domesOwnTarget);
    }
  });

  it('start-central: judges placement centrality', () => {
    const ex = byId('start-central');
    const s = lessonState(ex.position);
    const central = { kind: 'place' as const, squares: ['c3', 'b2'].map(parseSquareName) as [number, number] };
    expect(checkExercise(ex, s, central).passed).toBe(true);
    const rim = { kind: 'place' as const, squares: ['a1', 'c3'].map(parseSquareName) as [number, number] };
    const res = checkExercise(ex, s, rim);
    expect(res.passed).toBe(false);
    expect(res.lines[0]).toContain('rim');
  });

  it('god lesson: the Pan descent counts as the win', () => {
    const ex = byId('god-powers-bend-rules');
    const s = lessonState(ex.position);
    const wins = legalTurns(s).filter((t) => t.kind === 'move' && t.win);
    expect(wins.length).toBeGreaterThan(0);
    // Pan wins by moving DOWN: every winning move here descends from b2.
    for (const t of wins) {
      expect(t.kind === 'move' && t.path[0] === parseSquareName('b2')).toBe(true);
      expect(checkExercise(ex, s, t).passed).toBe(true);
    }
  });
});
