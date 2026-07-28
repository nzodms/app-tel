import { created, ok, readJson, route } from '@/server/http/respond';
import { withProject } from '@/server/http/project-route';
import { createDevice, deviceInputSchema, listDevices } from '@/server/services/devices';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route(async (_request: Request, ctx: Ctx) => {
  const { store, projectId } = await withProject(ctx.params, 'read');
  return ok({ devices: await listDevices(store, projectId) });
});

export const POST = route(async (request: Request, ctx: Ctx) => {
  const { store, projectId } = await withProject(ctx.params, 'write');
  const input = await readJson(request, deviceInputSchema);
  const device = await createDevice(store, projectId, input);
  return created({ device });
});
