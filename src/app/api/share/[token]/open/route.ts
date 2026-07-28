import { z } from 'zod';
import { ok, readJson, route } from '@/server/http/respond';
import { getStore } from '@/server/db';
import { buildPreview } from '@/server/services/preview';
import { openShareLink, recordShareView, reviewerRoles, toPublicShare } from '@/server/services/shares';
import { projectRoles } from '@/server/services/projects';
import { latestVersion, listVersions } from '@/server/services/versions';
import { listThreads } from '@/server/services/comments';
import { getPreset, DEFAULT_PRESET_ID } from '@/lib/devices/presets';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ token: string }> };

const schema = z.object({
  password: z.string().max(200).optional(),
  email: z.string().max(200).optional(),
});

/**
 * Opens a share link for a reviewer.
 *
 * What a reviewer receives: the compiled bundle for the pinned version, the roles
 * they may switch between, and the comments already left. What they never receive:
 * the file tree, any file contents, other versions' code, or anything about the
 * workspace. The reviewer surface has no session and no access to the project API.
 */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const { token } = await ctx.params;
  const input = await readJson(request, schema);
  const store = getStore();

  const gate = await openShareLink(store, token, input);
  if (gate.state !== 'ok') {
    return ok({ state: gate.state, link: { label: gate.link.label, access: gate.link.access } });
  }

  const { link, project } = gate;
  await recordShareView(store, link);

  const ref = link.versionId ?? 'working';
  const build = await buildPreview(store, project.id, ref, 'system');
  const [roles, versions, threads] = await Promise.all([
    projectRoles(store, project),
    listVersions(store, project.id),
    listThreads(store, project.id, { status: 'open' }),
  ]);

  const allowedRoles = reviewerRoles(
    link,
    roles.map((role) => role.slug),
  );
  const pinned = versions.find((version) => version.id === link.versionId) ?? null;

  // Comparison, when the owner enabled it: the version immediately before the pinned one.
  let comparison: { versionId: string; label: string; code: string; hash: string } | null = null;
  if (link.allowVersionCompare) {
    const ordered = versions.slice().sort((a, b) => b.sequence - a.sequence);
    const index = ordered.findIndex((version) => version.id === link.versionId);
    const previous = index >= 0 ? ordered[index + 1] : ordered[1];
    if (previous) {
      const previousBuild = await buildPreview(store, project.id, previous.id, 'system');
      if (previousBuild.ok) {
        comparison = {
          versionId: previous.id,
          label: previous.label,
          code: previousBuild.code,
          hash: previousBuild.hash,
        };
      }
    }
  }

  return ok({
    state: 'ok',
    share: toPublicShare(link),
    project: { id: project.id, name: project.name, description: project.description },
    version: pinned
      ? { id: pinned.id, label: pinned.label, description: pinned.description }
      : { id: null, label: 'Working tree', description: '' },
    roles: roles.filter((role) => allowedRoles.includes(role.slug)),
    presetId: DEFAULT_PRESET_ID,
    viewport: getPreset(DEFAULT_PRESET_ID).viewport,
    bundle: build.ok
      ? { code: build.code, hash: build.hash }
      : { code: null, hash: null, error: build.diagnostics[0]?.message ?? 'Build failed' },
    comparison,
    threads: threads.map((thread) => ({
      id: thread.id,
      anchorX: thread.anchorX,
      anchorY: thread.anchorY,
      screen: thread.screen,
      role: thread.role,
      author: thread.comments[0]?.authorName ?? 'Reviewer',
      body: thread.comments[0]?.body ?? '',
      createdAt: thread.createdAt,
    })),
    latestVersionId: (await latestVersion(store, project.id))?.id ?? null,
  });
});
