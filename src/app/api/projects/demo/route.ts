import { badRequest } from '@/server/core/errors';
import { getStore } from '@/server/db';
import { created, route } from '@/server/http/respond';
import { requireActor } from '@/server/http/session';
import { getWorkspaceAccess, listAccessibleWorkspaceIds } from '@/server/services/access';
import { createProject } from '@/server/services/projects';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Creates the PadelFlow demo, flagged as a demo.
 *
 * Its own route rather than a flag on `POST /api/projects`, because `isDemo` is
 * not something a client should be able to set: the dashboard uses it to decide
 * what counts as the person's own work.
 */
export const POST = route(async () => {
  const { actor } = await requireActor();
  const store = getStore();

  const workspaceId = (await listAccessibleWorkspaceIds(store, actor.userId))[0];
  if (!workspaceId) throw badRequest('You have no workspace yet.');
  await getWorkspaceAccess(store, actor, workspaceId, 'write');

  const result = await createProject(
    store,
    actor,
    { workspaceId, name: 'PadelFlow', templateId: 'padelflow' },
    { isDemo: true },
  );
  return created({
    project: result.project,
    deviceIds: result.devices.map((device) => device.id),
    versionIds: result.versionIds,
  });
});
