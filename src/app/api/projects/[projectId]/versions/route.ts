import { z } from 'zod';
import { created, ok, readJson, route } from '@/server/http/respond';
import { withProject } from '@/server/http/project-route';
import { createSnapshot, listVersions } from '@/server/services/versions';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route(async (_request: Request, ctx: Ctx) => {
  const { store, projectId } = await withProject(ctx.params, 'read');
  return ok({ versions: await listVersions(store, projectId) });
});

const schema = z.object({
  label: z.string().trim().max(80).optional(),
  description: z.string().trim().max(600).optional(),
});

export const POST = route(async (request: Request, ctx: Ctx) => {
  const { store, actor, projectId } = await withProject(ctx.params, 'write');
  const input = await readJson(request, schema);
  const version = await createSnapshot(store, projectId, {
    authorKind: 'user',
    createdBy: actor.userId,
    ...(input.label ? { label: input.label } : {}),
    ...(input.description ? { description: input.description } : {}),
  });
  return created({ version });
});
