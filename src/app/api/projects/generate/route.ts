import { badRequest } from '@/server/core/errors';
import { getStore } from '@/server/db';
import { created, readJson, route } from '@/server/http/respond';
import { requireActor } from '@/server/http/session';
import { getWorkspaceAccess, listAccessibleWorkspaceIds } from '@/server/services/access';
import { createGeneratedProject, generateProjectSchema } from '@/server/services/projects';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Creates a project from a brief — the same path onboarding's last step takes. */
export const POST = route(async (request: Request) => {
  const { actor } = await requireActor();
  const store = getStore();
  const input = await readJson(request, generateProjectSchema.partial({ workspaceId: true }));

  const workspaceId =
    input.workspaceId ?? (await listAccessibleWorkspaceIds(store, actor.userId))[0];
  if (!workspaceId) throw badRequest('You have no workspace yet.');
  await getWorkspaceAccess(store, actor, workspaceId, 'write');

  const result = await createGeneratedProject(store, actor, { ...input, workspaceId });
  return created({
    project: result.project,
    deviceIds: result.devices.map((device) => device.id),
    versionIds: result.versionIds,
  });
});
