import { z } from 'zod';
import { ok, readJson, route } from '@/server/http/respond';
import { withProject } from '@/server/http/project-route';
import { getRun, reportProgress } from '@/server/services/journeys';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ projectId: string; runId: string }> };

const schema = z.object({
  currentStep: z.number().int().min(-1).optional(),
  status: z.enum(['running', 'paused', 'completed', 'failed', 'stopped']).optional(),
  error: z.string().max(600).nullable().optional(),
  result: z
    .object({
      index: z.number().int().min(0),
      kind: z.enum([
        'open',
        'navigate',
        'tap',
        'input',
        'wait',
        'event',
        'notification',
        'assert',
        'note',
      ]),
      label: z.string().max(200),
      status: z.enum(['ok', 'error', 'skipped']),
      message: z.string().max(600).nullable(),
      at: z.string(),
      durationMs: z.number().int().min(0),
    })
    .optional(),
});

export const GET = route(async (_request: Request, ctx: Ctx) => {
  const { projectId, params, store } = await withProject(ctx.params, 'read');
  const run = await getRun(store, params.runId);
  if (run.projectId !== projectId) return ok({ run: null });
  return ok({ run });
});

/** Progress reports from the studio as it drives the replay. */
export const PATCH = route(async (request: Request, ctx: Ctx) => {
  const { store, params } = await withProject(ctx.params, 'execute');
  const input = await readJson(request, schema);
  const run = await reportProgress(store, params.runId, input);
  return ok({ run });
});
