import { z } from 'zod';
import { badRequest, notFound, tooLarge } from '../core/errors';
import { LIMITS } from '../core/limits';
import { newId } from '../core/ids';
import type {
  EditorKind,
  Id,
  JourneyRow,
  JourneyRunRow,
  JourneyStepResult,
  JourneyStepRow,
  Store,
} from '../db';
import { RT, getBus, projectChannel } from '../realtime/bus';
import { logEvent } from './events';

/**
 * Journeys: record a path through the app once, replay it on demand.
 *
 * Recording and replay both happen in the browser — the studio is the only place
 * that can drive the phones — while the server owns the canonical step list and
 * the run report. That split is what makes `run_journey` over MCP meaningful: the
 * tool asks for a run, an open studio tab executes it, and the report lands back
 * here for Claude to read.
 */

export const journeyStepSchema = z.object({
  kind: z.enum(['open', 'navigate', 'tap', 'input', 'wait', 'event', 'notification', 'assert', 'note']),
  deviceId: z.string().min(1).nullable().optional(),
  deviceRole: z.string().min(1).max(40).nullable().optional(),
  label: z.string().trim().max(200).default(''),
  payload: z.record(z.string(), z.unknown()).default({}),
  waitMs: z.number().int().min(0).max(60_000).default(0),
});

export const journeyInputSchema = z.object({
  name: z.string().trim().min(1, 'Name the journey.').max(120),
  description: z.string().trim().max(600).default(''),
  steps: z.array(journeyStepSchema).max(LIMITS.maxJourneySteps),
});

export type JourneyInput = z.infer<typeof journeyInputSchema>;

export interface JourneyWithSteps extends JourneyRow {
  steps: JourneyStepRow[];
}

export async function listJourneys(store: Store, projectId: Id): Promise<JourneyRow[]> {
  return store.select('journeys', {
    match: { projectId },
    orderBy: [{ col: 'createdAt', dir: 'desc' }],
  });
}

export async function getJourney(
  store: Store,
  projectId: Id,
  journeyId: Id,
): Promise<JourneyWithSteps> {
  const journey = await store.find('journeys', { match: { id: journeyId, projectId } });
  if (!journey) throw notFound('Journey not found.');
  const steps = await store.select('journeySteps', {
    match: { journeyId },
    orderBy: [{ col: 'index' }],
  });
  return { ...journey, steps };
}

export async function createJourney(
  store: Store,
  projectId: Id,
  input: JourneyInput,
  authorKind: EditorKind,
  createdBy: Id | null,
): Promise<JourneyWithSteps> {
  const parsed = journeyInputSchema.parse(input);
  if (parsed.steps.length === 0) {
    throw badRequest('A journey needs at least one step. Record something first.');
  }

  const now = new Date().toISOString();
  const journey: JourneyRow = {
    id: newId('jny'),
    projectId,
    name: parsed.name,
    description: parsed.description,
    createdBy,
    authorKind,
    stepCount: parsed.steps.length,
    createdAt: now,
    updatedAt: now,
  };

  const steps: JourneyStepRow[] = parsed.steps.map((step, index) => ({
    id: newId('jst'),
    journeyId: journey.id,
    projectId,
    index,
    kind: step.kind,
    deviceId: step.deviceId ?? null,
    deviceRole: step.deviceRole ?? null,
    label: step.label,
    payload: step.payload,
    waitMs: step.waitMs,
    createdAt: now,
  }));

  await store.transaction(async (tx) => {
    await tx.insert('journeys', journey);
    await tx.insertMany('journeySteps', steps);
  });

  getBus().publish(projectChannel(projectId), RT.journeyChanged, {
    journeyId: journey.id,
    name: journey.name,
    stepCount: journey.stepCount,
  });
  await logEvent(store, projectId, {
    kind: 'journey',
    name: `Journey saved: ${journey.name}`,
    payload: { journeyId: journey.id, steps: steps.length },
  });

  return { ...journey, steps };
}

export async function updateJourney(
  store: Store,
  projectId: Id,
  journeyId: Id,
  input: Partial<JourneyInput>,
): Promise<JourneyWithSteps> {
  const existing = await getJourney(store, projectId, journeyId);
  const now = new Date().toISOString();

  if (input.steps) {
    if (input.steps.length > LIMITS.maxJourneySteps) {
      throw tooLarge(`Journeys are limited to ${LIMITS.maxJourneySteps} steps.`);
    }
    const parsedSteps = z.array(journeyStepSchema).parse(input.steps);
    await store.transaction(async (tx) => {
      await tx.removeWhere('journeySteps', { match: { journeyId } });
      await tx.insertMany(
        'journeySteps',
        parsedSteps.map((step, index) => ({
          id: newId('jst'),
          journeyId,
          projectId,
          index,
          kind: step.kind,
          deviceId: step.deviceId ?? null,
          deviceRole: step.deviceRole ?? null,
          label: step.label,
          payload: step.payload,
          waitMs: step.waitMs,
          createdAt: now,
        })),
      );
    });
  }

  await store.update('journeys', journeyId, {
    ...(input.name !== undefined ? { name: input.name.slice(0, 120) } : {}),
    ...(input.description !== undefined ? { description: input.description.slice(0, 600) } : {}),
    ...(input.steps ? { stepCount: input.steps.length } : {}),
    updatedAt: now,
  });

  getBus().publish(projectChannel(projectId), RT.journeyChanged, { journeyId, updated: true });
  return getJourney(store, projectId, existing.id);
}

export async function deleteJourney(store: Store, projectId: Id, journeyId: Id): Promise<void> {
  await getJourney(store, projectId, journeyId);
  await store.transaction(async (tx) => {
    await tx.removeWhere('journeySteps', { match: { journeyId } });
    await tx.removeWhere('journeyRuns', { match: { journeyId } });
    await tx.remove('journeys', journeyId);
  });
  getBus().publish(projectChannel(projectId), RT.journeyChanged, { journeyId, deleted: true });
}

/* -------------------------------------------------------------------------- */
/* Runs                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Registers a run and asks any connected studio to execute it.
 *
 * The returned run starts as `running` with `currentStep: -1`. A studio client
 * picks up the realtime request, drives the devices, and posts progress back.
 */
export async function requestRun(
  store: Store,
  projectId: Id,
  journeyId: Id,
  speed: number,
): Promise<JourneyRunRow> {
  const journey = await getJourney(store, projectId, journeyId);

  const run: JourneyRunRow = {
    id: newId('jrn'),
    journeyId,
    projectId,
    status: 'running',
    currentStep: -1,
    speed: clampSpeed(speed),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    report: [],
    error: null,
  };
  await store.insert('journeyRuns', run);

  getBus().publish(projectChannel(projectId), RT.journeyProgress, {
    action: 'run-requested',
    runId: run.id,
    journeyId,
    speed: run.speed,
    stepCount: journey.stepCount,
  });
  await logEvent(store, projectId, {
    kind: 'journey',
    name: `Journey run started: ${journey.name}`,
    payload: { runId: run.id, journeyId },
  });

  return run;
}

export async function getRun(store: Store, runId: Id): Promise<JourneyRunRow> {
  const run = await store.find('journeyRuns', { match: { id: runId } });
  if (!run) throw notFound('Journey run not found.');
  return run;
}

export async function reportProgress(
  store: Store,
  runId: Id,
  update: {
    currentStep?: number;
    status?: JourneyRunRow['status'];
    result?: JourneyStepResult;
    error?: string | null;
  },
): Promise<JourneyRunRow> {
  const run = await getRun(store, runId);
  const report = update.result ? [...run.report, update.result] : run.report;
  const terminal =
    update.status === 'completed' || update.status === 'failed' || update.status === 'stopped';

  const updated = await store.update('journeyRuns', runId, {
    ...(update.currentStep !== undefined ? { currentStep: update.currentStep } : {}),
    ...(update.status ? { status: update.status } : {}),
    ...(update.error !== undefined ? { error: update.error } : {}),
    report,
    ...(terminal ? { finishedAt: new Date().toISOString() } : {}),
  });

  getBus().publish(projectChannel(run.projectId), RT.journeyProgress, {
    action: 'progress',
    runId,
    currentStep: updated.currentStep,
    status: updated.status,
    lastResult: update.result ?? null,
  });

  if (terminal) {
    await logEvent(store, run.projectId, {
      kind: 'journey',
      level: updated.status === 'failed' ? 'error' : 'info',
      name: `Journey run ${updated.status}`,
      payload: {
        runId,
        steps: report.length,
        failures: report.filter((entry) => entry.status === 'error').length,
      },
    });
  }
  return updated;
}

export async function setRunStatus(
  store: Store,
  projectId: Id,
  runId: Id,
  status: JourneyRunRow['status'],
): Promise<JourneyRunRow> {
  const run = await getRun(store, runId);
  if (run.projectId !== projectId) throw notFound('Journey run not found.');
  const updated = await reportProgress(store, runId, { status });
  getBus().publish(projectChannel(projectId), RT.journeyProgress, {
    action: status === 'paused' ? 'pause' : status === 'running' ? 'resume' : 'stop',
    runId,
    status,
  });
  return updated;
}

export async function listRuns(
  store: Store,
  projectId: Id,
  journeyId?: Id,
): Promise<JourneyRunRow[]> {
  return store.select('journeyRuns', {
    match: journeyId ? { projectId, journeyId } : { projectId },
    orderBy: [{ col: 'startedAt', dir: 'desc' }],
    limit: 30,
  });
}

/**
 * Waits for a run to reach a terminal state.
 *
 * Used by the MCP `run_journey` tool so Claude gets a report rather than a
 * promise. If nothing picks the run up (no studio open), it returns the run as-is
 * and the tool says so plainly.
 */
export async function waitForRun(
  store: Store,
  runId: Id,
  timeoutMs: number,
): Promise<{ run: JourneyRunRow; timedOut: boolean }> {
  const deadline = Date.now() + timeoutMs;
  let run = await getRun(store, runId);
  while (Date.now() < deadline) {
    if (run.status !== 'running' && run.status !== 'paused') return { run, timedOut: false };
    await new Promise((resolve) => setTimeout(resolve, 350));
    run = await getRun(store, runId);
  }
  return { run, timedOut: run.status === 'running' || run.status === 'paused' };
}

export function summariseRun(run: JourneyRunRow): {
  status: JourneyRunRow['status'];
  stepsCompleted: number;
  failures: JourneyStepResult[];
  durationMs: number | null;
} {
  return {
    status: run.status,
    stepsCompleted: run.report.length,
    failures: run.report.filter((entry) => entry.status === 'error'),
    durationMs: run.finishedAt
      ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
      : null,
  };
}

function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1;
  return Math.min(Math.max(speed, 0.25), 4);
}
