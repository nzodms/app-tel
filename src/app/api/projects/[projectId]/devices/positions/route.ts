import { z } from 'zod';
import { ok, readJson, route } from '@/server/http/respond';
import { withProject } from '@/server/http/project-route';
import { moveDevices } from '@/server/services/devices';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * Bulk position commit.
 *
 * Dragging updates the DOM directly and only lands here once, on pointer-up — so
 * a drag is one request, not one per frame.
 */
const schema = z.object({
  positions: z
    .array(
      z.object({
        id: z.string().min(1),
        x: z.number().finite(),
        y: z.number().finite(),
        zIndex: z.number().int().optional(),
      }),
    )
    .min(1)
    .max(24),
});

export const PATCH = route(async (request: Request, ctx: Ctx) => {
  const { store, projectId } = await withProject(ctx.params, 'write');
  const input = await readJson(request, schema);
  const devices = await moveDevices(store, projectId, input.positions);
  return ok({ devices });
});
