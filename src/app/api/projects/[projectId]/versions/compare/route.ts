import { badRequest } from '@/server/core/errors';
import { ok, route } from '@/server/http/respond';
import { withProject } from '@/server/http/project-route';
import { compareVersions, diffFileBetween } from '@/server/services/versions';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * Version comparison. Without `path` it returns the changed-file summary; with
 * `path` it returns that file's full line diff for the side-by-side view.
 */
export const GET = route(async (request: Request, ctx: Ctx) => {
  const { store, projectId } = await withProject(ctx.params, 'read');
  const url = new URL(request.url);
  const base = url.searchParams.get('base');
  const target = url.searchParams.get('target');
  const path = url.searchParams.get('path');
  if (!base || !target) throw badRequest('base and target are required.');

  const baseRef = base === 'working' ? 'working' : base;
  const targetRef = target === 'working' ? 'working' : target;

  if (path) {
    const detail = await diffFileBetween(store, projectId, baseRef, targetRef, path);
    return ok({ detail });
  }

  return ok({ comparison: await compareVersions(store, projectId, baseRef, targetRef) });
});
