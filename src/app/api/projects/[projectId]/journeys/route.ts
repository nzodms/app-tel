import { created, ok, readJson, route } from '@/server/http/respond';
import { withProject } from '@/server/http/project-route';
import { createJourney, journeyInputSchema, listJourneys } from '@/server/services/journeys';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route(async (_request: Request, ctx: Ctx) => {
  const { store, projectId } = await withProject(ctx.params, 'read');
  return ok({ journeys: await listJourneys(store, projectId) });
});

export const POST = route(async (request: Request, ctx: Ctx) => {
  const { store, actor, projectId } = await withProject(ctx.params, 'write');
  const input = await readJson(request, journeyInputSchema);
  const journey = await createJourney(store, projectId, input, 'user', actor.userId);
  return created({ journey });
});
