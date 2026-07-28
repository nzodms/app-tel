import { getStore, type Store } from '@/server/db';
import { requireActor } from './session';
import { requireProjectAccess, type Actor, type Capability, type ProjectAccess } from '@/server/services/access';

/**
 * Boilerplate remover for project-scoped routes.
 *
 * Resolving the actor and checking the capability in one place means no route can
 * forget to — and the check is the same one the MCP tools use.
 */
export async function withProject<P extends { projectId: string }>(
  params: Promise<P>,
  capability: Capability,
): Promise<{
  store: Store;
  actor: Actor;
  access: ProjectAccess;
  projectId: string;
  params: P;
}> {
  const [{ actor }, resolved] = await Promise.all([requireActor(), params]);
  const store = getStore();
  const access = await requireProjectAccess(store, actor, resolved.projectId, capability);
  return { store, actor, access, projectId: resolved.projectId, params: resolved };
}
