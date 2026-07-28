import { noContent, ok, readJson, route } from '@/server/http/respond';
import { withProject } from '@/server/http/project-route';
import { deviceInputSchema, removeDevice, updateDevice } from '@/server/services/devices';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ projectId: string; deviceId: string }> };

export const PATCH = route(async (request: Request, ctx: Ctx) => {
  const { store, projectId, params } = await withProject(ctx.params, 'write');
  const input = await readJson(request, deviceInputSchema);
  const device = await updateDevice(store, projectId, params.deviceId, input);
  return ok({ device });
});

export const DELETE = route(async (_request: Request, ctx: Ctx) => {
  const { store, projectId, params } = await withProject(ctx.params, 'write');
  await removeDevice(store, projectId, params.deviceId);
  return noContent();
});
