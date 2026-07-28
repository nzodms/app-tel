import { describe, expect, it } from 'vitest';
import { diffLines, fileDiff, toHunks, unifiedDiff } from '@/lib/diff';

describe('line diff', () => {
  it('reports no changes for identical text', () => {
    const result = fileDiff('a\nb\nc', 'a\nb\nc');
    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(0);
    expect(result.hunks).toEqual([]);
  });

  it('detects a single-line change with correct line numbers', () => {
    const lines = diffLines('one\ntwo\nthree', 'one\nTWO\nthree');
    const removed = lines.find((line) => line.kind === 'delete');
    const added = lines.find((line) => line.kind === 'insert');
    expect(removed?.text).toBe('two');
    expect(removed?.beforeLine).toBe(2);
    expect(added?.text).toBe('TWO');
    expect(added?.afterLine).toBe(2);
  });

  it('handles pure insertion at the end', () => {
    const result = fileDiff('a\nb', 'a\nb\nc');
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(0);
  });

  it('handles pure deletion at the start', () => {
    const result = fileDiff('a\nb\nc', 'b\nc');
    expect(result.deletions).toBe(1);
    expect(result.additions).toBe(0);
  });

  it('groups nearby changes into one hunk and distant ones into two', () => {
    const before = Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n');
    const afterLines = before.split('\n');
    afterLines[2] = 'changed early';
    afterLines[35] = 'changed late';
    const hunks = toHunks(diffLines(before, afterLines.join('\n')), 3);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]?.lines.some((line) => line.text === 'changed early')).toBe(true);
    expect(hunks[1]?.lines.some((line) => line.text === 'changed late')).toBe(true);
  });

  it('produces a unified diff with standard markers', () => {
    const patch = unifiedDiff('src/App.tsx', 'const a = 1;\n', 'const a = 2;\n');
    expect(patch).toContain('--- a/src/App.tsx');
    expect(patch).toContain('+++ b/src/App.tsx');
    expect(patch).toContain('-const a = 1;');
    expect(patch).toContain('+const a = 2;');
    expect(patch).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
  });

  it('keeps unchanged surroundings out of the counts', () => {
    const before = 'header\n\nbody one\nbody two\n\nfooter';
    const after = 'header\n\nbody one\nbody TWO\n\nfooter';
    const result = fileDiff(before, after);
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(1);
  });
});
