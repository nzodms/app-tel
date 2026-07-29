import { describe, expect, it } from 'vitest';
import {
  EMPTY_SESSION,
  SESSION_IDLE_MS,
  applyActivity,
  applyBuild,
  applyPreviewMounted,
  currentLabel,
  sessionTotals,
  settleSession,
  type ClaudeSession,
} from '@/components/studio/claude-session';
import type { ClaudeActivity } from '@/server/mcp/activity';

/**
 * The sequence a person watches while Claude works.
 *
 * Every assertion here is really about one question: does the strip only ever say
 * things that happened? The failure mode this guards is not a crash — it is a
 * smooth, plausible narration of work that did not occur.
 */

let clock = 1_000;
const at = () => (clock += 100);

function started(kind: ClaudeActivity['kind'], target: string | null, callId = `c${clock}`): ClaudeActivity {
  return {
    callId,
    phase: 'started',
    kind,
    tool: 't',
    title: 'T',
    target,
    at: new Date(clock).toISOString(),
  };
}

function finished(callId: string, kind: ClaudeActivity['kind'], ok = true, error: string | null = null): ClaudeActivity {
  return {
    callId,
    phase: 'finished',
    kind,
    tool: 't',
    title: 'T',
    target: null,
    at: new Date(clock).toISOString(),
    ok,
    durationMs: 12,
    ...(error ? { error } : {}),
  };
}

/** Runs a whole burst so the tests read like the thing they describe. */
function run(steps: ((session: ClaudeSession) => ClaudeSession)[]): ClaudeSession {
  return steps.reduce((session, step) => step(session), EMPTY_SESSION);
}

describe('the session a user watches', () => {
  it('reads, edits, compiles and updates — in that order, from real events', () => {
    const session = run([
      (s) => applyActivity(s, started('reading', 'src/App.tsx', 'r1'), at()),
      (s) => applyActivity(s, finished('r1', 'reading'), at()),
      (s) => applyActivity(s, started('editing', 'src/Schedule.tsx', 'e1'), at()),
      (s) => applyActivity(s, finished('e1', 'editing'), at()),
      (s) => applyBuild(s, { phase: 'started' }, at()),
      (s) => applyBuild(s, { phase: 'finished', ok: true }, at()),
      (s) => applyPreviewMounted(s, at()),
    ]);

    expect(session.steps.map((step) => step.kind)).toEqual([
      'reading',
      'editing',
      'compiling',
      'updating',
    ]);
    expect(session.steps.every((step) => step.status === 'done')).toBe(true);
    expect(session.steps.at(-1)?.label).toBe('Preview updated');
  });

  it('collapses a run of the same work into one step and counts it', () => {
    let session = applyActivity(EMPTY_SESSION, started('editing', 'a.tsx', 'e1'), at());
    session = applyActivity(session, started('editing', 'b.tsx', 'e1'), at());
    session = applyActivity(session, started('editing', 'c.tsx', 'e1'), at());

    expect(session.steps).toHaveLength(1);
    expect(session.steps[0]?.label).toBe('Editing 3 files');
    expect(session.filesTouched).toEqual(['a.tsx', 'b.tsx', 'c.tsx']);
  });

  it('names a single file rather than counting to one', () => {
    const session = applyActivity(EMPTY_SESSION, started('editing', 'src/deep/Schedule.tsx', 'e1'), at());
    expect(session.steps[0]?.label).toBe('Editing Schedule.tsx');
  });

  it('starts a new step when the work is separated by a real pause', () => {
    // Two edits four seconds apart are two decisions, not one burst.
    let session = applyActivity(EMPTY_SESSION, started('editing', 'a.tsx', 'e1'), 1_000);
    session = applyActivity(session, finished('e1', 'editing'), 1_050);
    session = applyActivity(session, started('editing', 'b.tsx', 'e2'), 1_050 + 4_001);

    expect(session.steps).toHaveLength(2);
    expect(session.steps[0]?.targets).toEqual(['a.tsx']);
    expect(session.steps[1]?.targets).toEqual(['b.tsx']);
  });

  it('coalesces a serial burst, which is the only shape a burst comes in', () => {
    // Tool calls are strictly serial: started/finished, started/finished. If the
    // window only merged calls that overlapped, nothing would ever merge.
    let session = applyActivity(EMPTY_SESSION, started('reading', 'a.tsx', 'r1'), 1_000);
    session = applyActivity(session, finished('r1', 'reading'), 1_020);
    session = applyActivity(session, started('reading', 'b.tsx', 'r2'), 1_040);
    session = applyActivity(session, finished('r2', 'reading'), 1_060);
    session = applyActivity(session, started('reading', 'c.tsx', 'r3'), 1_080);
    session = applyActivity(session, finished('r3', 'reading'), 1_100);

    expect(session.steps).toHaveLength(1);
    expect(session.steps[0]?.targets).toEqual(['a.tsx', 'b.tsx', 'c.tsx']);
    expect(session.steps[0]?.status).toBe('done');
  });

  it('never absorbs a failure into the work that followed it', () => {
    let session = applyActivity(EMPTY_SESSION, started('editing', 'a.tsx', 'e1'), 1_000);
    session = applyActivity(session, finished('e1', 'editing', false, 'nope'), 1_020);
    session = applyActivity(session, started('editing', 'b.tsx', 'e2'), 1_040);

    expect(session.steps).toHaveLength(2);
    expect(session.steps[0]?.status).toBe('failed');
    expect(session.steps[0]?.targets).toEqual(['a.tsx']);
  });

  it('keeps a failure visible instead of quietly moving on', () => {
    let session = applyActivity(EMPTY_SESSION, started('editing', 'a.tsx', 'e1'), at());
    session = applyActivity(session, finished('e1', 'editing', false, 'File is read-only.'), at());

    expect(session.steps[0]?.status).toBe('failed');
    expect(session.steps[0]?.error).toBe('File is read-only.');
    expect(currentLabel(session)).toBe('Editing a.tsx');
  });

  it('reports a failed build as failed', () => {
    let session = applyBuild(EMPTY_SESSION, { phase: 'started' }, at());
    session = applyBuild(session, { phase: 'finished', ok: false, error: 'Unexpected token' }, at());
    expect(session.steps[0]?.status).toBe('failed');
    expect(session.steps[0]?.error).toBe('Unexpected token');
  });

  it('says it is waiting between calls, and never that Claude is thinking', () => {
    let session = applyActivity(EMPTY_SESSION, started('reading', null, 'r1'), at());
    expect(currentLabel(session)).toBe('Reading the project');

    session = applyActivity(session, finished('r1', 'reading'), at());
    const label = currentLabel(session);
    expect(label).toBe('Waiting for Claude');
    expect(label?.toLowerCase()).not.toContain('think');
  });

  it('only calls the preview updated when a compile actually preceded it', () => {
    // A device being added mounts a frame too; that is not this session's doing.
    const bare = applyPreviewMounted(EMPTY_SESSION, at());
    expect(bare.steps).toHaveLength(0);

    let session = applyActivity(EMPTY_SESSION, started('reading', null, 'r1'), at());
    session = applyActivity(session, finished('r1', 'reading'), at());
    session = applyPreviewMounted(session, at());
    expect(session.steps.map((s) => s.kind)).toEqual(['reading']);
  });

  it('does not claim the preview updated while the build is still running', () => {
    let session = applyBuild(EMPTY_SESSION, { phase: 'started' }, at());
    session = applyPreviewMounted(session, at());
    expect(session.steps.map((s) => s.kind)).toEqual(['compiling']);
  });

  it('goes quiet on its own, because nothing happening produces no event', () => {
    let session = applyActivity(EMPTY_SESSION, started('reading', null, 'r1'), 1_000);
    session = applyActivity(session, finished('r1', 'reading'), 1_100);
    expect(session.active).toBe(true);

    expect(settleSession(session, 1_100 + SESSION_IDLE_MS - 1).active).toBe(true);
    expect(settleSession(session, 1_100 + SESSION_IDLE_MS + 1).active).toBe(false);
  });

  it('stays live as long as something is genuinely running, however long it takes', () => {
    const session = applyActivity(EMPTY_SESSION, started('building', null, 'b1'), 1_000);
    expect(settleSession(session, 1_000 + SESSION_IDLE_MS * 10).active).toBe(true);
  });

  it('counts only what it observed', () => {
    let session = applyActivity(EMPTY_SESSION, started('editing', 'a.tsx', 'e1'), 1_000);
    session = applyActivity(session, started('editing', 'b.tsx', 'e1'), 1_100);
    session = applyActivity(session, finished('e1', 'editing', false, 'boom'), 1_200);

    const totals = sessionTotals(session, 2_000);
    expect(totals.filesTouched).toBe(2);
    expect(totals.failures).toBe(1);
    expect(totals.elapsedMs).toBe(1_000);
  });

  it('bounds itself over a long session', () => {
    let session = EMPTY_SESSION;
    for (let index = 0; index < 100; index += 1) {
      const kind = index % 2 === 0 ? 'reading' : 'editing';
      session = applyActivity(session, started(kind, `f${index}.tsx`, `c${index}`), 1_000 + index);
      session = applyActivity(session, finished(`c${index}`, kind), 1_000 + index);
    }
    expect(session.steps.length).toBeLessThanOrEqual(24);
    // The most recent work is what survives, not the oldest.
    expect(session.steps.at(-1)?.targets).toEqual(['f99.tsx']);
  });

  it('has nothing to say before anything happens', () => {
    expect(currentLabel(EMPTY_SESSION)).toBeNull();
    expect(sessionTotals(EMPTY_SESSION, 1_000).elapsedMs).toBeNull();
  });
});
