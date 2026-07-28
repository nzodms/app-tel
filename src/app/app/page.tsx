import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { LogOut } from 'lucide-react';
import { Wordmark } from '@/components/brand/logo';
import { ConnectorCard } from '@/components/dashboard/connector-card';
import { ProjectGrid } from '@/components/dashboard/project-grid';
import { Avatar, Badge } from '@/components/ui/primitives';
import { getStore } from '@/server/db';
import { readSessionUser } from '@/server/http/session';
import { listConnections } from '@/server/oauth/service';
import { mcpResourceUri, stripTrailingSlash } from '@/server/oauth/urls';
import { listProjectsForUser } from '@/server/services/projects';
import { PROJECT_TEMPLATES } from '@/server/templates';
import { SignOutButton } from '@/components/dashboard/sign-out-button';

export const metadata: Metadata = { title: 'Projects' };
export const dynamic = 'force-dynamic';

async function baseUrl(): Promise<string> {
  const configured = process.env.PHONELAB_BASE_URL?.trim();
  if (configured) return stripTrailingSlash(configured);
  const headerList = await headers();
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host') ?? 'localhost:3000';
  const proto =
    headerList.get('x-forwarded-proto') ??
    (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  return stripTrailingSlash(`${proto}://${host}`);
}

export default async function DashboardPage() {
  const user = await readSessionUser();
  if (!user) redirect('/login?next=%2Fapp');

  const store = getStore();
  const [projects, connections, origin] = await Promise.all([
    listProjectsForUser(store, user.id),
    listConnections(store, user.id),
    baseUrl(),
  ]);

  return (
    <div className="min-h-dvh bg-paper-50">
      <header className="sticky top-0 z-20 border-b border-paper-200 bg-paper-0/92 backdrop-blur">
        <div className="mx-auto flex h-13 max-w-[1180px] items-center gap-3 px-5">
          <Link href="/app" className="shrink-0">
            <Wordmark />
          </Link>
          <Badge tone="neutral" className="hidden sm:inline-flex">
            {store.kind === 'local' ? 'local storage driver' : 'Postgres'}
          </Badge>
          <div className="ml-auto flex items-center gap-2.5">
            <Link
              href="/docs/mcp"
              className="text-[12.5px] font-medium text-paper-600 transition-colors hover:text-paper-900"
            >
              MCP docs
            </Link>
            <span className="flex items-center gap-2">
              <Avatar name={user.name} hue={user.avatarHue} size={26} />
              <span className="hidden text-[12.5px] font-medium text-paper-700 sm:inline">
                {user.name}
              </span>
            </span>
            <SignOutButton>
              <LogOut size={13} strokeWidth={1.9} />
            </SignOutButton>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-5 py-7">
        <div className="mb-7">
          <h1 className="text-[21px] font-semibold tracking-[-0.022em] text-paper-900">
            Your studio
          </h1>
          <p className="mt-1 max-w-[620px] text-[13px] leading-relaxed text-paper-600">
            Open a project to get the split view: files and code on the left, interactive phones on a
            canvas on the right. Connect Claude and it edits the same project you are looking at.
          </p>
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

        <ProjectGrid
          projects={projects}
          templates={PROJECT_TEMPLATES.map((template) => ({
            id: template.id,
            name: template.name,
            tagline: template.tagline,
            summary: template.summary,
            highlights: template.highlights,
          }))}
        />
      </main>
    </div>
  );
}
