import { z } from 'zod';
import { badRequest } from '@/server/core/errors';
import { LIMITS } from '@/server/core/limits';
import { ok, readJson, route } from '@/server/http/respond';
import { withProject } from '@/server/http/project-route';
import { getFile, toSummary, writeFile } from '@/server/services/files';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route(async (request: Request, ctx: Ctx) => {
  const { store, projectId } = await withProject(ctx.params, 'read');
  const path = new URL(request.url).searchParams.get('path');
  if (!path) throw badRequest('path is required.');
  const file = await getFile(store, projectId, path);
  return ok({
    path: file.path,
    content: file.content,
    language: file.language,
    updatedAt: file.updatedAt,
    lastEditedBy: file.lastEditedBy,
    size: file.size,
  });
});

const saveSchema = z.object({
  path: z.string().min(1).max(LIMITS.maxPathLength),
  content: z.string().max(LIMITS.maxFileBytes),
  /** Optimistic concurrency: rejects the save if Claude changed the file meanwhile. */
  expectedUpdatedAt: z.string().nullable().optional(),
});

export const PUT = route(async (request: Request, ctx: Ctx) => {
  const { store, projectId } = await withProject(ctx.params, 'write');
  const input = await readJson(request, saveSchema);
  const result = await writeFile(store, projectId, input.path, input.content, {
    editor: 'user',
    ...(input.expectedUpdatedAt ? { expectedUpdatedAt: input.expectedUpdatedAt } : {}),
  });
  return ok({ file: toSummary(result.file) });
});
