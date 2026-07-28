import { created, ok, readJson, route } from '@/server/http/respond';
import { requireActor } from '@/server/http/session';
import { getStore } from '@/server/db';
import { getWorkspaceAccess, listAccessibleWorkspaceIds } from '@/server/services/access';
import { createProject, createProjectSchema, listProjectsForUser } from '@/server/services/projects';
import { badRequest } from '@/server/core/errors';

export const runtime = 'nodejs';
export const maxDuration = 30;

export const GET = route(async () => {
  const { actor } = await requireActor();
  return ok({ projects: await listProjectsForUser(getStore(), actor.userId) });
});

export const POST = route(async (request: Request) => {
  const { actor } = await requireActor();
  const store = getStore();
  const input = await readJson(request, createProjectSchema.partial({ workspaceId: true }));

  const workspaceId =
    input.workspaceId ?? (await listAccessibleWorkspaceIds(store, actor.userId))[0];
  if (!workspaceId) throw badRequest('You have no workspace yet.');
  await getWorkspaceAccess(store, actor, workspaceId, 'write');

  const result = await createProject(store, actor, { ...input, workspaceId });
  return created({
    project: result.project,
    deviceIds: result.devices.map((device) => device.id),
    versionIds: result.versionIds,
  });
});
