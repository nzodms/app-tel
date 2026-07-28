import { z } from 'zod';
import { confirmationRequired } from '@/server/core/errors';
import { ok, readJson, route } from '@/server/http/respond';
import { withProject } from '@/server/http/project-route';
import { restoreVersion } from '@/server/services/versions';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ projectId: string; versionId: string }> };

const schema = z.object({ confirm: z.boolean() });

/**
 * Overwrites the working tree with a snapshot.
 *
 * `confirm` is required even from the UI, and a safety snapshot is always taken
 * first — a restore is never a one-way door.
 */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const { store, actor, projectId, params } = await withProject(ctx.params, 'write');
  const input = await readJson(request, schema);
  if (!input.confirm) {
    throw confirmationRequired('Restoring replaces the working tree. Send confirm: true to proceed.');
  }

  const result = await restoreVersion(store, projectId, params.versionId, 'user', actor.userId);
  return ok({
    restoredVersionId: result.restored.id,
    restoredLabel: result.restored.label,
    filesWritten: result.filesWritten,
    safetySnapshotId: result.safetySnapshot.id,
    safetySnapshotLabel: result.safetySnapshot.label,
  });
});
