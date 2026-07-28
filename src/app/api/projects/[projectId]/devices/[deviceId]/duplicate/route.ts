import { created, route } from '@/server/http/respond';
import { withProject } from '@/server/http/project-route';
import { duplicateDevice } from '@/server/services/devices';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ projectId: string; deviceId: string }> };

export const POST = route(async (_request: Request, ctx: Ctx) => {
  const { store, projectId, params } = await withProject(ctx.params, 'write');
  const device = await duplicateDevice(store, projectId, params.deviceId);
  return created({ device });
});
