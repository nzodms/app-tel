import { z } from 'zod';
import { created, ok, route, readJson } from '@/server/http/respond';
import { withProject } from '@/server/http/project-route';
import { clearEvents, listEvents, logEvent } from '@/server/services/events';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ projectId: string }> };

const schema = z.object({
  kind: z.enum([
    'system',
    'build',
    'runtime',
    'navigation',
    'interaction',
    'device-event',
    'notification',
    'error',
    'mcp',
    'journey',
    'comment',
  ]),
  name: z.string().min(1).max(200),
  level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  deviceId: z.string().min(1).nullable().optional(),
  targetDeviceId: z.string().min(1).nullable().optional(),
  screen: z.string().max(200).nullable().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const GET = route(async (request: Request, ctx: Ctx) => {
  const { store, projectId } = await withProject(ctx.params, 'read');
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit') ?? '300');
  const events = await listEvents(store, projectId, {
    limit: Number.isFinite(limit) ? limit : 300,
  });
  return ok({ events });
});

export const POST = route(async (request: Request, ctx: Ctx) => {
  const { store, projectId } = await withProject(ctx.params, 'read');
  const input = await readJson(request, schema);
  const event = await logEvent(store, projectId, input);
  return created({ event });
});

export const DELETE = route(async (_request: Request, ctx: Ctx) => {
  const { store, projectId } = await withProject(ctx.params, 'write');
  const removed = await clearEvents(store, projectId);
  return ok({ removed });
});
