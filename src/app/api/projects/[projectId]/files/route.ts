import { z } from 'zod';
import { LIMITS } from '@/server/core/limits';
import { created, noContent, ok, readJson, route } from '@/server/http/respond';
import { withProject } from '@/server/http/project-route';
import { buildTree, deleteFile, listFiles, renameFile, toSummary, writeFile } from '@/server/services/files';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route(async (_request: Request, ctx: Ctx) => {
  const { store, projectId } = await withProject(ctx.params, 'read');
  const files = await listFiles(store, projectId);
  return ok({ files: files.map(toSummary), tree: buildTree(files) });
});

const createSchema = z.object({
  path: z.string().min(1).max(LIMITS.maxPathLength),
  content: z.string().max(LIMITS.maxFileBytes).default(''),
});

export const POST = route(async (request: Request, ctx: Ctx) => {
  const { store, projectId } = await withProject(ctx.params, 'write');
  const input = await readJson(request, createSchema);
  const result = await writeFile(store, projectId, input.path, input.content, {
    editor: 'user',
    createOnly: true,
  });
  return created({ file: toSummary(result.file) });
});

const renameSchema = z.object({
  from: z.string().min(1).max(LIMITS.maxPathLength),
  to: z.string().min(1).max(LIMITS.maxPathLength),
});

export const PATCH = route(async (request: Request, ctx: Ctx) => {
  const { store, projectId } = await withProject(ctx.params, 'write');
  const input = await readJson(request, renameSchema);
  const file = await renameFile(store, projectId, input.from, input.to, 'user');
  return ok({ file: toSummary(file) });
});

export const DELETE = route(async (request: Request, ctx: Ctx) => {
  const { store, projectId } = await withProject(ctx.params, 'write');
  const path = new URL(request.url).searchParams.get('path');
  if (!path) return ok({ error: { code: 'bad_request', message: 'path is required.' } }, { status: 400 });
  await deleteFile(store, projectId, path, 'user');
  return noContent();
});
