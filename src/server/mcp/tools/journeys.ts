import { z } from 'zod';
import { requireProjectAccess } from '../../services/access';
import {
  createJourney,
  getJourney,
  listJourneys,
  listRuns,
  requestRun,
  setRunStatus,
  summariseRun,
  updateJourney,
  waitForRun,
} from '../../services/journeys';
import { defineTool, outcome } from '../types';

const projectIdSchema = z.string().min(1).describe('PhoneLab project id.');

const stepSchema = z.object({
  kind: z
    .enum(['open', 'navigate', 'tap', 'input', 'wait', 'event', 'notification', 'assert', 'note'])
    .describe('What the step does.'),
  label: z.string().trim().max(200).describe('Human description; for tap/input it is also used to find the element by its visible text.'),
  deviceId: z.string().min(1).nullable().optional().describe('Target device. Prefer deviceRole for portability.'),
  deviceRole: z.string().min(1).max(40).nullable().optional().describe('Target the first device with this role.'),
  payload: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Step data: { target, value } for input, { route } for navigate, { eventName, payload } for event.'),
  waitMs: z.number().int().min(0).max(60_000).optional().describe('Pause before this step, in ms.'),
});

export const journeyTools = [
  defineTool({
    name: 'create_journey',
    title: 'Create journey',
    description:
      'Saves a replayable path through the app. Steps run in order against the phones on the canvas. Journeys are deterministic: the same steps produce the same run.',
    group: 'journeys',
    capability: 'write',
    annotations: { readOnlyHint: false, idempotentHint: false },
    input: z
      .object({
        projectId: projectIdSchema,
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(600).optional(),
        steps: z.array(stepSchema).min(1).max(200),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'write');
      const journey = await createJourney(
        store,
        input.projectId,
        {
          name: input.name,
          description: input.description ?? '',
          steps: input.steps.map((step) => ({
            kind: step.kind,
            label: step.label,
            deviceId: step.deviceId ?? null,
            deviceRole: step.deviceRole ?? null,
            payload: step.payload ?? {},
            waitMs: step.waitMs ?? 0,
          })),
        },
        'claude',
        actor.userId,
      );
      return outcome(`Saved "${journey.name}" (${journey.id}) with ${journey.stepCount} steps.`, {
        journeyId: journey.id,
        stepCount: journey.stepCount,
      });
    },
  }),

  defineTool({
    name: 'update_journey',
    title: 'Update journey',
    description: 'Renames a journey or replaces its steps.',
    group: 'journeys',
    capability: 'write',
    annotations: { readOnlyHint: false, idempotentHint: true },
    input: z
      .object({
        projectId: projectIdSchema,
        journeyId: z.string().min(1),
        name: z.string().trim().min(1).max(120).optional(),
        description: z.string().trim().max(600).optional(),
        steps: z.array(stepSchema).max(200).optional(),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'write');
      const journey = await updateJourney(store, input.projectId, input.journeyId, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.steps
          ? {
              steps: input.steps.map((step) => ({
                kind: step.kind,
                label: step.label,
                deviceId: step.deviceId ?? null,
                deviceRole: step.deviceRole ?? null,
                payload: step.payload ?? {},
                waitMs: step.waitMs ?? 0,
              })),
            }
          : {}),
      });
      return outcome(`Updated "${journey.name}" (${journey.stepCount} steps).`, {
        journeyId: journey.id,
        stepCount: journey.stepCount,
      });
    },
  }),

  defineTool({
    name: 'list_journeys',
    title: 'List journeys',
    description: 'Journeys saved on this project, with step counts and who recorded them.',
    group: 'journeys',
    capability: 'read',
    annotations: { readOnlyHint: true, idempotentHint: true },
    input: z.object({ projectId: projectIdSchema }).strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'read');
      const journeys = await listJourneys(store, input.projectId);
      const lines = journeys.map(
        (journey) => `- ${journey.name} (${journey.id}) · ${journey.stepCount} steps · by ${journey.authorKind}`,
      );
      return outcome(journeys.length === 0 ? 'No journeys saved.' : lines.join('\n'), { journeys });
    },
  }),

  defineTool({
    name: 'run_journey',
    title: 'Run journey',
    description:
      'Replays a journey on the canvas and waits for the report. Execution happens in an open PhoneLab studio tab — that is the only place the phones exist — so if none is open the run is registered and this reports that nothing picked it up.',
    group: 'journeys',
    capability: 'execute',
    annotations: { readOnlyHint: false, idempotentHint: false },
    input: z
      .object({
        projectId: projectIdSchema,
        journeyId: z.string().min(1),
        speed: z.number().min(0.25).max(4).optional().describe('Playback rate. 1 = as recorded.'),
        waitSeconds: z
          .number()
          .int()
          .min(1)
          .max(120)
          .optional()
          .describe('How long to wait for the report. Defaults to 45.'),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'execute');
      const journey = await getJourney(store, input.projectId, input.journeyId);
      const run = await requestRun(store, input.projectId, input.journeyId, input.speed ?? 1);

      const { run: finished, timedOut } = await waitForRun(
        store,
        run.id,
        (input.waitSeconds ?? 45) * 1000,
      );

      if (timedOut && finished.report.length === 0) {
        return {
          text:
            `Run ${run.id} was registered for "${journey.name}" but nothing executed it. ` +
            'Journeys replay inside an open PhoneLab studio tab; open the project in a browser and run it again, ' +
            'or read the report later with get_journey_report.',
          data: { runId: run.id, status: finished.status, executed: false },
          isError: true,
        };
      }

      const summary = summariseRun(finished);
      const failures = summary.failures.map(
        (failure) => `  step ${failure.index} (${failure.kind}) "${failure.label}": ${failure.message ?? 'failed'}`,
      );

      return outcome(
        [
          `Journey "${journey.name}" ${finished.status} — ${summary.stepsCompleted}/${journey.stepCount} steps` +
            `${summary.durationMs ? ` in ${(summary.durationMs / 1000).toFixed(1)}s` : ''}.`,
          ...(failures.length > 0 ? ['', 'Failures:', ...failures] : []),
        ].join('\n'),
        {
          runId: finished.id,
          status: finished.status,
          stepsCompleted: summary.stepsCompleted,
          totalSteps: journey.stepCount,
          failures: summary.failures,
          report: finished.report,
          timedOut,
        },
      );
    },
  }),

  defineTool({
    name: 'pause_journey',
    title: 'Pause journey run',
    description: 'Pauses an in-flight run. Resume by calling this again with status "running".',
    group: 'journeys',
    capability: 'execute',
    annotations: { readOnlyHint: false, idempotentHint: true },
    input: z
      .object({
        projectId: projectIdSchema,
        runId: z.string().min(1),
        status: z.enum(['paused', 'running']).default('paused'),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'execute');
      const run = await setRunStatus(store, input.projectId, input.runId, input.status);
      return outcome(`Run ${run.id} is now ${run.status}.`, { runId: run.id, status: run.status });
    },
  }),

  defineTool({
    name: 'stop_journey',
    title: 'Stop journey run',
    description: 'Stops an in-flight run. The partial report is kept.',
    group: 'journeys',
    capability: 'execute',
    annotations: { readOnlyHint: false, idempotentHint: true },
    input: z.object({ projectId: projectIdSchema, runId: z.string().min(1) }).strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'execute');
      const run = await setRunStatus(store, input.projectId, input.runId, 'stopped');
      return outcome(`Run ${run.id} stopped after ${run.report.length} step(s).`, {
        runId: run.id,
        status: run.status,
        report: run.report,
      });
    },
  }),

  defineTool({
    name: 'get_journey_report',
    title: 'Journey report',
    description: 'The step-by-step outcome of a run — or the most recent run of a journey.',
    group: 'journeys',
    capability: 'read',
    annotations: { readOnlyHint: true, idempotentHint: true },
    input: z
      .object({
        projectId: projectIdSchema,
        runId: z.string().min(1).optional(),
        journeyId: z.string().min(1).optional().describe('Use the latest run of this journey.'),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'read');
      const runs = await listRuns(store, input.projectId, input.journeyId);
      const run = input.runId ? runs.find((entry) => entry.id === input.runId) : runs[0];
      if (!run) {
        return { text: 'No matching journey run found.', isError: true };
      }
      const summary = summariseRun(run);
      const lines = run.report.map(
        (entry) => `${entry.index}. [${entry.status}] ${entry.kind} — ${entry.label}${entry.message ? ` (${entry.message})` : ''}`,
      );
      return outcome(
        [`Run ${run.id} · ${run.status} · ${summary.stepsCompleted} step(s)`, ...lines].join('\n'),
        { run, summary },
      );
    },
  }),

  defineTool({
    name: 'compare_journeys',
    title: 'Compare journey runs',
    description:
      'Compares two runs step by step — useful for checking whether a change fixed a failure or introduced one.',
    group: 'journeys',
    capability: 'read',
    annotations: { readOnlyHint: true, idempotentHint: true },
    input: z
      .object({
        projectId: projectIdSchema,
        runA: z.string().min(1),
        runB: z.string().min(1),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'read');
      const runs = await listRuns(store, input.projectId);
      const a = runs.find((run) => run.id === input.runA);
      const b = runs.find((run) => run.id === input.runB);
      if (!a || !b) return { text: 'One or both runs were not found in this project.', isError: true };

      const length = Math.max(a.report.length, b.report.length);
      const rows: { index: number; a: string; b: string; changed: boolean }[] = [];
      for (let index = 0; index < length; index += 1) {
        const left = a.report[index];
        const right = b.report[index];
        rows.push({
          index,
          a: left ? `${left.status}: ${left.label}` : '—',
          b: right ? `${right.status}: ${right.label}` : '—',
          changed: (left?.status ?? null) !== (right?.status ?? null),
        });
      }
      const differences = rows.filter((row) => row.changed);

      return outcome(
        [
          `Run A ${a.id} (${a.status}) vs run B ${b.id} (${b.status})`,
          differences.length === 0
            ? 'Every step had the same outcome.'
            : `${differences.length} step(s) differ:`,
          ...differences.map((row) => `  ${row.index}: A=${row.a} | B=${row.b}`),
        ].join('\n'),
        { runA: a.id, runB: b.id, rows, differences },
      );
    },
  }),
];
