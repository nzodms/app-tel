import { z } from 'zod';
import { created, readJson, route } from '@/server/http/respond';
import { withProject } from '@/server/http/project-route';
import { getJourney, requestRun } from '@/server/services/journeys';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ projectId: string; journeyId: string }> };

const schema = z.object({ speed: z.number().min(0.25).max(4).default(1) });

/**
 * Registers a run and returns the executable plan.
 *
 * The browser performs the replay (it owns the phones); the server owns the run
 * record so `get_journey_report` over MCP reads real outcomes.
 */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const { store, projectId, params } = await withProject(ctx.params, 'execute');
  const input = await readJson(request, schema);
  const journey = await getJourney(store, projectId, params.journeyId);
  const run = await requestRun(store, projectId, params.journeyId, input.speed);

  return created({
    runId: run.id,
    journeyId: journey.id,
    steps: journey.steps.map((step) => ({
      index: step.index,
      kind: step.kind === 'open' || step.kind === 'wait' || step.kind === 'note' ? 'navigate' : step.kind,
      description: step.label,
      deviceId: step.deviceId,
      deviceRole: step.deviceRole,
      waitMs: step.waitMs,
      target: readString(step.payload, 'target'),
      label: readString(step.payload, 'label') ?? step.label,
      value: readString(step.payload, 'value'),
      route: readString(step.payload, 'route'),
      eventName: readString(step.payload, 'eventName'),
      payload: step.payload.payload ?? null,
    })),
  });
});

function readString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' ? value : undefined;
}
