import type { StudioSnapshot } from '@/components/studio/types';
import { getStore, type Store } from '../db';
import { mcpResourceUri } from '../oauth/urls';
import { listConnections } from '../oauth/service';
import { listAuditLogs } from './audit';
import { buildTree, listFiles, toSummary } from './files';
import { listDevices } from './devices';
import { listVersions } from './versions';
import { listJourneys } from './journeys';
import { listEvents } from './events';
import { listThreads } from './comments';
import { listShareLinks, toPublicShare } from './shares';
import { previewStatus } from './preview';
import { projectRoles } from './projects';
import type { PublicUser } from './auth';
import type { ProjectAccess } from './access';

/**
 * Everything the studio needs for its first paint, assembled server-side.
 *
 * One round of queries instead of a dozen client fetches on load — the studio is a
 * dense screen and it should not arrive empty.
 */
export async function loadStudioSnapshot(
  access: ProjectAccess,
  user: PublicUser,
  baseUrl: string,
  store: Store = getStore(),
): Promise<StudioSnapshot> {
  const project = access.project;

  const [files, devices, versions, journeys, events, threads, shares, preview, roles, connections, calls] =
    await Promise.all([
      listFiles(store, project.id),
      listDevices(store, project.id),
      listVersions(store, project.id),
      listJourneys(store, project.id),
      listEvents(store, project.id, { limit: 200 }),
      listThreads(store, project.id),
      listShareLinks(store, project.id),
      previewStatus(store, project.id),
      projectRoles(store, project),
      listConnections(store, user.id),
      // Scoped to this project, not to the account: the Claude panel says "last
      // tool" next to *this* project's activity, and an unscoped query made it
      // report a call Claude made in some other project — or claim no tool had
      // been called when one had, in the project you were not looking at.
      listAuditLogs(store, { userId: user.id, projectId: project.id, limit: 25 }),
    ]);

  const live = connections.filter((connection) => connection.revokedAt === null);

  return {
    user,
    project,
    roles,
    files: files.map(toSummary),
    tree: buildTree(files),
    devices,
    versions,
    journeys,
    events,
    threads,
    shares: shares.map(toPublicShare),
    lastBuild: preview.lastBuild,
    diagnostics: preview.diagnostics,
    mcp: {
      connected: live.length > 0,
      connectionCount: live.length,
      lastUsedAt:
        live
          .map((connection) => connection.lastUsedAt)
          .filter((value): value is string => value !== null)
          .sort()
          .at(-1) ?? null,
      connections: live.map((connection) => ({
        id: connection.id,
        name: connection.name,
        scopes: connection.scopes,
        lastUsedAt: connection.lastUsedAt,
        protocolVersion: connection.protocolVersion,
        toolCallCount: connection.toolCallCount,
      })),
      recentCalls: calls,
      endpoint: mcpResourceUri(baseUrl),
    },
    baseUrl,
    storeKind: store.kind,
  };
}
