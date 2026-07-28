import { getStore } from '@/server/db';
import { ok, readJson, route } from '@/server/http/respond';
import { requireActor } from '@/server/http/session';
import { getWorkspaceAccess } from '@/server/services/access';
import { renameWorkspace, renameWorkspaceSchema } from '@/server/services/profile';

export const runtime = 'nodejs';

export const PATCH = route(
  async (request: Request, context: { params: Promise<{ workspaceId: string }> }) => {
    const { actor } = await requireActor();
    const { workspaceId } = await context.params;
    const store = getStore();
    await getWorkspaceAccess(store, actor, workspaceId, 'admin');
    const body = await readJson(request, renameWorkspaceSchema);
    return ok({ workspace: await renameWorkspace(store, workspaceId, body.name) });
  },
);
