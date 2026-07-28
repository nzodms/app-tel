import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AppHeader } from '@/components/app-shell/app-header';
import { ConnectorCard } from '@/components/dashboard/connector-card';
import { ProjectList } from '@/components/dashboard/project-list';
import { Badge } from '@/components/ui/primitives';
import { getStore } from '@/server/db';
import { requestOrigin } from '@/server/http/origin';
import { readSessionUser } from '@/server/http/session';
import { listConnections } from '@/server/oauth/service';
import { mcpResourceUri } from '@/server/oauth/urls';
import { listProjectsForUser } from '@/server/services/projects';

export const metadata: Metadata = { title: 'Projects' };
export const dynamic = 'force-dynamic';

/**
 * `/dashboard` — where a signed-in person lands.
 *
 * Someone who has never been through onboarding is sent there first. That check
 * reads `onboardingCompletedAt`, never "do they have a project": a project can
 * exist because the demo was created or because Claude made one over MCP.
 */
export default async function DashboardPage() {
  const user = await readSessionUser();
  if (!user) redirect('/login?next=%2Fdashboard');
  if (!user.onboardingCompletedAt) redirect('/onboarding');

  const store = getStore();
  const [projects, connections, origin] = await Promise.all([
    listProjectsForUser(store, user.id),
    listConnections(store, user.id),
    requestOrigin(),
  ]);

  const active = connections.filter((connection) => !connection.revokedAt);

  return (
    <div className="min-h-dvh bg-paper-50">
      <AppHeader user={user} active="dashboard" />

      <main className="mx-auto max-w-[1180px] px-5 py-7">
        <div className="mb-7 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[21px] font-semibold tracking-[-0.022em] text-paper-900">
              Your studio
            </h1>
            <p className="mt-1 max-w-[620px] text-[13px] leading-relaxed text-paper-600">
              Open a project to get the split view: files and code on the left, interactive phones
              on a canvas on the right. Connect Claude and it edits the same project you are looking
              at.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="neutral">
              {store.kind === 'local' ? 'local storage driver' : 'Postgres'}
            </Badge>
            <Badge tone={active.length > 0 ? 'positive' : 'neutral'}>
              {active.length > 0
                ? `${active.length} Claude connection${active.length === 1 ? '' : 's'}`
                : 'Claude not connected'}
            </Badge>
          </div>
        </div>

        <div className="mb-8">
          <ConnectorCard
            endpoint={mcpResourceUri(origin)}
            connections={connections.map((connection) => ({
              id: connection.id,
              name: connection.name,
              scopes: connection.scopes,
              createdAt: connection.createdAt,
              lastUsedAt: connection.lastUsedAt,
              revokedAt: connection.revokedAt,
              protocolVersion: connection.protocolVersion,
              toolCallCount: connection.toolCallCount,
            }))}
          />
        </div>

        <ProjectList projects={projects} lastOpenedId={user.activeProjectId} />
      </main>
    </div>
  );
}
