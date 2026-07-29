import type { ClaudeActivity } from '@/server/mcp/activity';

/**
 * Claude working, as a sequence you can watch.
 *
 * The raw stream is one `started` and one `finished` per tool call, plus the
 * build events the preview service already publishes. That is accurate and
 * unreadable: eleven `read_file` calls in a row are one thought, not eleven
 * events. This module folds the stream into the shape a person actually reads —
 *
 *     Reading the project…  →  Editing 3 files…  →  Compiling…  →  Preview updated
 *
 * — while keeping every claim traceable to something that really happened.
 *
 * ## The line this module will not cross
 *
 * There is no step for Claude thinking. We are on the far side of an MCP
 * connection; tool calls are the only thing observable from here. The gap between
 * one call finishing and the next starting is real — Claude is generating during
 * it — and it is labelled as waiting, which is what it is. Anything else would be
 * a progress bar with no progress behind it.
 *
 * Nor is there a percentage, an ETA, or a step count known in advance. We do not
 * know how many files Claude is about to edit until it has edited them, and a
 * sequence that pretends otherwise is inventing its own future.
 *
 * Pure and framework-free, so it can be tested against event sequences directly.
 */

export type StepKind = ClaudeActivity['kind'] | 'compiling' | 'updating' | 'waiting';

export type StepStatus = 'running' | 'done' | 'failed';

export interface SessionStep {
  /** Stable across the step's life, so a list can key on it without re-mounting. */
  id: string;
  kind: StepKind;
  status: StepStatus;
  /** What the step is, in one short phrase. Never a prediction. */
  label: string;
  /**
   * The specific things it touched, most recent last. For an editing step these
   * are file paths; for reading, the files read. Empty when the step names
   * nothing specific.
   */
  targets: string[];
  startedAt: number;
  endedAt: number | null;
  /** Set when `status` is 'failed'. */
  error: string | null;
}

export interface ClaudeSession {
  /** True while at least one step is running, or one finished very recently. */
  active: boolean;
  steps: SessionStep[];
  startedAt: number | null;
  /** The last moment anything at all happened. Drives the idle fade. */
  lastEventAt: number | null;
  /** Every distinct file this session has written, in the order first touched. */
  filesTouched: string[];
}

export const EMPTY_SESSION: ClaudeSession = {
  active: false,
  steps: [],
  startedAt: null,
  lastEventAt: null,
  filesTouched: [],
};

/**
 * How long after the last event a session still counts as live.
 *
 * Claude routinely pauses for several seconds between tool calls while it
 * generates the next one; ending the session in that gap would make the strip
 * flicker in and out of existence mid-task. Long enough to bridge a pause, short
 * enough that a finished session does not linger claiming to be live.
 */
export const SESSION_IDLE_MS = 45_000;

/** Steps older than this are dropped, so a long session cannot grow without end. */
const MAX_STEPS = 24;

/**
 * How close two calls of the same kind have to be to read as one step.
 *
 * Tool calls are strictly serial over one connection: reading eleven files is
 * `started`/`finished` eleven times, not one long call. Coalescing only while a
 * call is in flight would therefore never coalesce anything — every burst would
 * come out as eleven identical lines. The window is what turns "read, read, read"
 * into "Reading the project", and it is short enough that a pause for Claude to
 * think between two edits still starts a new step, which is the truthful reading:
 * those were two separate decisions.
 */
const COALESCE_MS = 4_000;

const KIND_LABELS: Record<StepKind, string> = {
  reading: 'Reading the project',
  editing: 'Editing files',
  building: 'Starting the preview',
  snapshotting: 'Saving a version',
  arranging: 'Arranging the canvas',
  sharing: 'Updating sharing',
  other: 'Working',
  compiling: 'Compiling',
  updating: 'Updating the preview',
  waiting: 'Waiting for Claude',
};

/** Consecutive calls of the same kind are one step; a change of kind starts one. */
function labelFor(kind: StepKind, targets: string[]): string {
  if (kind === 'editing') {
    if (targets.length === 0) return 'Editing files';
    if (targets.length === 1) return `Editing ${basename(targets[0] ?? '')}`;
    return `Editing ${targets.length} files`;
  }
  if (kind === 'reading' && targets.length === 1) {
    return `Reading ${basename(targets[0] ?? '')}`;
  }
  return KIND_LABELS[kind];
}

function basename(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? path : path.slice(cut + 1);
}

function trim(steps: SessionStep[]): SessionStep[] {
  return steps.length <= MAX_STEPS ? steps : steps.slice(steps.length - MAX_STEPS);
}

function lastStep(session: ClaudeSession): SessionStep | undefined {
  return session.steps[session.steps.length - 1];
}

/**
 * Whether a new call should extend the last step rather than open a new one.
 *
 * Same kind, and either still running or only just finished. A *failed* step is
 * never extended: a failure is a thing that happened and must keep its own line
 * rather than being absorbed into the work that followed it.
 */
function extendable(step: SessionStep | undefined, kind: StepKind, now: number): step is SessionStep {
  if (!step || step.kind !== kind || step.status === 'failed') return false;
  if (step.status === 'running') return true;
  return step.endedAt !== null && now - step.endedAt <= COALESCE_MS;
}

/** Closes every running step. A new kind of work proves the old one ended. */
function closeRunning(steps: readonly SessionStep[], now: number): SessionStep[] {
  return steps.map((step) =>
    step.status === 'running' ? { ...step, status: 'done' as const, endedAt: now } : step,
  );
}

/* -------------------------------------------------------------------------- */
/* Reducers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Folds one Claude tool-call event into the session.
 *
 * `started` opens or extends a step; `finished` closes it, or marks it failed.
 * A failure is never swallowed: a step that failed stays in the list saying so,
 * because "Claude tried to edit this file and could not" is exactly the thing a
 * silent UI would hide.
 */
export function applyActivity(
  session: ClaudeSession,
  event: ClaudeActivity,
  now: number,
): ClaudeSession {
  const kind: StepKind = event.kind;

  if (event.phase === 'started') {
    const current = lastStep(session);
    const targets = event.target ? [event.target] : [];
    const filesTouched =
      kind === 'editing' ? mergeTargets(session.filesTouched, targets) : session.filesTouched;

    if (extendable(current, kind, now)) {
      const mergedTargets = mergeTargets(current.targets, targets);
      const merged: SessionStep = {
        ...current,
        // Re-opened: the step is running again, and its `id` follows the call in
        // flight so the matching `finished` can find it.
        id: event.callId,
        status: 'running',
        endedAt: null,
        targets: mergedTargets,
        label: labelFor(kind, mergedTargets),
      };
      return {
        ...session,
        active: true,
        startedAt: session.startedAt ?? now,
        lastEventAt: now,
        steps: [...session.steps.slice(0, -1), merged],
        filesTouched,
      };
    }

    const step: SessionStep = {
      id: event.callId,
      kind,
      status: 'running',
      label: labelFor(kind, targets),
      targets,
      startedAt: now,
      endedAt: null,
      error: null,
    };
    return {
      active: true,
      steps: trim([...closeRunning(session.steps, now), step]),
      startedAt: session.startedAt ?? now,
      lastEventAt: now,
      filesTouched,
    };
  }

  // finished — closes the call that is actually in flight, by id. A `finished`
  // whose id matches nothing running is a late echo and changes nothing.
  const failed = event.ok === false;
  const steps = session.steps.map((step) => {
    if (step.id !== event.callId || step.status !== 'running') return step;
    return failed
      ? { ...step, status: 'failed' as const, endedAt: now, error: event.error ?? 'The tool failed.' }
      : { ...step, status: 'done' as const, endedAt: now };
  });

  return { ...session, steps, active: true, lastEventAt: now };
}

/**
 * The build's own events, which come from the preview service rather than from a
 * tool call — a build can be started by the studio, by a share link, or by
 * Claude, and the strip should show all three.
 */
export function applyBuild(
  session: ClaudeSession,
  event: { phase: 'started' | 'finished'; ok?: boolean; error?: string | null },
  now: number,
): ClaudeSession {
  if (event.phase === 'started') {
    const current = lastStep(session);
    if (current?.kind === 'compiling' && current.status === 'running') {
      return { ...session, lastEventAt: now, active: true };
    }

    return {
      ...session,
      active: true,
      startedAt: session.startedAt ?? now,
      lastEventAt: now,
      steps: trim([
        ...closeRunning(session.steps, now),
        {
          id: `build-${now}`,
          kind: 'compiling',
          status: 'running',
          label: KIND_LABELS.compiling,
          targets: [],
          startedAt: now,
          endedAt: null,
          error: null,
        },
      ]),
    };
  }

  const steps = session.steps.map((step) =>
    step.kind === 'compiling' && step.status === 'running'
      ? event.ok === false
        ? { ...step, status: 'failed' as const, endedAt: now, error: event.error ?? 'The build failed.' }
        : { ...step, status: 'done' as const, endedAt: now }
      : step,
  );
  return { ...session, steps, lastEventAt: now, active: true };
}

/**
 * The last link in the chain, and the one that makes the sequence true: a build
 * finishing is not the same as a phone showing the result. The frame reports back
 * when it has mounted; only then is the preview actually updated.
 */
export function applyPreviewMounted(session: ClaudeSession, now: number): ClaudeSession {
  const current = lastStep(session);
  if (!current || current.kind === 'updating') return session;
  // Only meaningful directly after a compile — a mount at any other time is a
  // device being added or reloaded, which is not this session's doing.
  if (current.kind !== 'compiling' || current.status !== 'done') return session;

  return {
    ...session,
    lastEventAt: now,
    steps: trim([
      ...closeRunning(session.steps, now),
      {
        id: `mount-${now}`,
        kind: 'updating',
        status: 'done',
        label: 'Preview updated',
        targets: [],
        startedAt: now,
        endedAt: now,
        error: null,
      },
    ]),
  };
}

/**
 * Recomputes liveness against the clock.
 *
 * `active` cannot be derived once and left alone: a session goes quiet by nothing
 * happening, which produces no event to react to. Callers tick this.
 */
export function settleSession(session: ClaudeSession, now: number): ClaudeSession {
  if (!session.active) return session;
  const anyRunning = session.steps.some((step) => step.status === 'running');
  if (anyRunning) return session;
  if (session.lastEventAt !== null && now - session.lastEventAt < SESSION_IDLE_MS) return session;
  return { ...session, active: false };
}

/**
 * What the strip says right now, in one line.
 *
 * Between two tool calls there is nothing running, and the honest word for that
 * is waiting — Claude is generating and we cannot see it. Never "thinking".
 */
export function currentLabel(session: ClaudeSession): string | null {
  if (!session.active) return null;
  const running = [...session.steps].reverse().find((step) => step.status === 'running');
  if (running) return running.label;
  const last = lastStep(session);
  if (last?.status === 'failed') return last.label;
  return KIND_LABELS.waiting;
}

/** Counts for a compact activity read-out. All observed, none estimated. */
export interface SessionTotals {
  filesTouched: number;
  steps: number;
  failures: number;
  elapsedMs: number | null;
}

export function sessionTotals(session: ClaudeSession, now: number): SessionTotals {
  return {
    filesTouched: session.filesTouched.length,
    steps: session.steps.length,
    failures: session.steps.filter((step) => step.status === 'failed').length,
    elapsedMs: session.startedAt === null ? null : Math.max(0, now - session.startedAt),
  };
}

function mergeTargets(existing: readonly string[], incoming: readonly string[]): string[] {
  const out = [...existing];
  for (const target of incoming) if (!out.includes(target)) out.push(target);
  return out;
}
