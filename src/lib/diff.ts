/**
 * Line diffing for version comparison.
 *
 * Self-contained (no dependency) and shaped for what the UI needs: hunks with
 * context, plus counts. Common prefix/suffix are trimmed first, then an LCS table
 * runs over the differing middle only — which keeps realistic file edits cheap.
 * Beyond `MAX_LCS_CELLS` the middle is reported as a wholesale replacement rather
 * than spending seconds on a perfect alignment.
 */

export type DiffOpKind = 'equal' | 'insert' | 'delete';

export interface DiffLine {
  kind: DiffOpKind;
  /** 1-based line number in the "before" file, when present. */
  beforeLine: number | null;
  /** 1-based line number in the "after" file, when present. */
  afterLine: number | null;
  text: string;
}

export interface DiffHunk {
  beforeStart: number;
  beforeCount: number;
  afterStart: number;
  afterCount: number;
  lines: DiffLine[];
}

export interface FileDiff {
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  /** True when the middle was too large to align precisely. */
  approximate: boolean;
}

const MAX_LCS_CELLS = 4_000_000;

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);

  const out: DiffLine[] = [];
  for (let i = 0; i < prefix; i += 1) {
    out.push({ kind: 'equal', beforeLine: i + 1, afterLine: i + 1, text: a[i] ?? '' });
  }

  const middle =
    midA.length * midB.length > MAX_LCS_CELLS
      ? replaceWholesale(midA, midB, prefix)
      : alignLcs(midA, midB, prefix);
  out.push(...middle);

  for (let i = 0; i < suffix; i += 1) {
    const beforeLine = a.length - suffix + i + 1;
    const afterLine = b.length - suffix + i + 1;
    out.push({
      kind: 'equal',
      beforeLine,
      afterLine,
      text: a[a.length - suffix + i] ?? '',
    });
  }

  return out;
}

function replaceWholesale(midA: string[], midB: string[], offset: number): DiffLine[] {
  const out: DiffLine[] = [];
  midA.forEach((text, index) => {
    out.push({ kind: 'delete', beforeLine: offset + index + 1, afterLine: null, text });
  });
  midB.forEach((text, index) => {
    out.push({ kind: 'insert', beforeLine: null, afterLine: offset + index + 1, text });
  });
  return out;
}

function alignLcs(a: string[], b: string[], offset: number): DiffLine[] {
  const n = a.length;
  const m = b.length;
  // table[i][j] = LCS length of a[i:] and b[j:]
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const row = table[i] as number[];
      const nextRow = table[i + 1] as number[];
      row[j] =
        a[i] === b[j]
          ? (nextRow[j + 1] as number) + 1
          : Math.max(nextRow[j] as number, row[j + 1] as number);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({
        kind: 'equal',
        beforeLine: offset + i + 1,
        afterLine: offset + j + 1,
        text: a[i] ?? '',
      });
      i += 1;
      j += 1;
      continue;
    }
    const down = (table[i + 1] as number[])[j] as number;
    const right = (table[i] as number[])[j + 1] as number;
    if (down >= right) {
      out.push({ kind: 'delete', beforeLine: offset + i + 1, afterLine: null, text: a[i] ?? '' });
      i += 1;
    } else {
      out.push({ kind: 'insert', beforeLine: null, afterLine: offset + j + 1, text: b[j] ?? '' });
      j += 1;
    }
  }
  while (i < n) {
    out.push({ kind: 'delete', beforeLine: offset + i + 1, afterLine: null, text: a[i] ?? '' });
    i += 1;
  }
  while (j < m) {
    out.push({ kind: 'insert', beforeLine: null, afterLine: offset + j + 1, text: b[j] ?? '' });
    j += 1;
  }
  return out;
}

/** Groups a line diff into hunks with `context` equal lines around each change. */
export function toHunks(lines: readonly DiffLine[], context = 3): DiffHunk[] {
  const changed = lines
    .map((line, index) => (line.kind === 'equal' ? -1 : index))
    .filter((index) => index !== -1);
  if (changed.length === 0) return [];

  const ranges: [number, number][] = [];
  let start = Math.max(0, (changed[0] as number) - context);
  let end = Math.min(lines.length - 1, (changed[0] as number) + context);

  for (const index of changed.slice(1)) {
    if (index - context <= end + 1) {
      end = Math.min(lines.length - 1, index + context);
    } else {
      ranges.push([start, end]);
      start = Math.max(0, index - context);
      end = Math.min(lines.length - 1, index + context);
    }
  }
  ranges.push([start, end]);

  return ranges.map(([from, to]) => {
    const slice = lines.slice(from, to + 1);
    const beforeLines = slice.filter((line) => line.beforeLine !== null);
    const afterLines = slice.filter((line) => line.afterLine !== null);
    return {
      beforeStart: beforeLines[0]?.beforeLine ?? 0,
      beforeCount: beforeLines.length,
      afterStart: afterLines[0]?.afterLine ?? 0,
      afterCount: afterLines.length,
      lines: slice,
    };
  });
}

export function fileDiff(before: string, after: string, context = 3): FileDiff {
  const lines = diffLines(before, after);
  const additions = lines.filter((line) => line.kind === 'insert').length;
  const deletions = lines.filter((line) => line.kind === 'delete').length;
  const a = before.split('\n');
  const b = after.split('\n');
  return {
    additions,
    deletions,
    hunks: toHunks(lines, context),
    approximate: a.length * b.length > MAX_LCS_CELLS,
  };
}

/** Compact unified-diff text, for MCP responses and prompt copying. */
export function unifiedDiff(path: string, before: string, after: string, context = 3): string {
  const diff = fileDiff(before, after, context);
  if (diff.hunks.length === 0) return '';
  const out: string[] = [`--- a/${path}`, `+++ b/${path}`];
  for (const hunk of diff.hunks) {
    out.push(
      `@@ -${hunk.beforeStart},${hunk.beforeCount} +${hunk.afterStart},${hunk.afterCount} @@`,
    );
    for (const line of hunk.lines) {
      const marker = line.kind === 'insert' ? '+' : line.kind === 'delete' ? '-' : ' ';
      out.push(`${marker}${line.text}`);
    }
  }
  return out.join('\n');
}
