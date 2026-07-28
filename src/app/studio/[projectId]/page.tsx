import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { Studio } from '@/components/studio/studio';
import { getStore } from '@/server/db';
import { isAppError } from '@/server/core/errors';
import { readSessionUser } from '@/server/http/session';
import { requireProjectAccess } from '@/server/services/access';
import { loadStudioSnapshot } from '@/server/services/studio-snapshot';
import { listProjectsForUser } from '@/server/services/projects';
import { rememberActiveProject } from '@/server/services/profile';
import { stripTrailingSlash } from '@/server/oauth/urls';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ projectId: string }>;
}): Promise<Metadata> {
  const { projectId } = await params;
  const user = await readSessionUser();
  if (!user) return { title: 'Studio' };
  try {
    const access = await requireProjectAccess(
      getStore(),
      { userId: user.id, via: 'session' },
      projectId,
      'read',
    );
    return { title: access.project.name };
  } catch {
    return { title: 'Studio' };
  }
}

/** Resolves this deployment's origin from the request, for links and the MCP URL. */
async function resolveBaseUrl(): Promise<string> {
  const configured = process.env.PHONELAB_BASE_URL?.trim();
  if (configured) return stripTrailingSlash(configured);
  const headerList = await headers();
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host') ?? 'localhost:3000';
  const proto =
    headerList.get('x-forwarded-proto') ??
    (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  return stripTrailingSlash(`${proto}://${host}`);
}

export default async function StudioPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const user = await readSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/studio/${projectId}`)}`);
  // A bookmarked studio URL must not be a way around onboarding.
  if (!user.onboardingCompletedAt) redirect('/onboarding');

  const store = getStore();
  let snapshot;
  let switcher;
  try {
    const access = await requireProjectAccess(
      store,
      { userId: user.id, via: 'session' },
      projectId,
      'read',
    );
    const [loaded, projects] = await Promise.all([
      loadStudioSnapshot(access, user, await resolveBaseUrl(), store),
      listProjectsForUser(store, user.id),
    ]);
    snapshot = loaded;
    switcher = projects.map((project) => ({
      id: project.id,
      name: project.name,
      workspaceName: project.workspaceName,
      isDemo: project.isDemo,
      updatedAt: project.updatedAt,
    }));
  } catch (error) {
    if (isAppError(error) && (error.code === 'not_found' || error.code === 'forbidden')) notFound();
    throw error;
  }

  await rememberActiveProject(store, user.id, projectId);

  return <Studio snapshot={snapshot} projects={switcher} />;
}
