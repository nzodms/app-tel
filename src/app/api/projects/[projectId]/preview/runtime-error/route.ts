import { z } from 'zod';
import { noContent, readJson, route } from '@/server/http/respond';
import { withProject } from '@/server/http/project-route';
import { recordRuntimeError } from '@/server/services/preview';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ projectId: string }> };

/** Exceptions reported by the preview bridge, so `get_runtime_errors` is real. */
const schema = z.object({
  deviceId: z.string().min(1).nullable(),
  message: z.string().max(2000),
  stack: z.string().max(8000).nullable(),
  phase: z.string().max(40),
  screen: z.string().max(200).nullable(),
});

export const POST = route(async (request: Request, ctx: Ctx) => {
  const { store, projectId } = await withProject(ctx.params, 'read');
  const input = await readJson(request, schema);
  await recordRuntimeError(store, projectId, input);
  return noContent();
});
