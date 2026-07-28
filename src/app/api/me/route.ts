import { getStore } from '@/server/db';
import { ok, readJson, route } from '@/server/http/respond';
import { requireActor } from '@/server/http/session';
import { updateProfile, updateProfileSchema } from '@/server/services/profile';

export const runtime = 'nodejs';

export const GET = route(async () => {
  const { user } = await requireActor();
  return ok({ user });
});

export const PATCH = route(async (request: Request) => {
  const { actor } = await requireActor();
  const patch = await readJson(request, updateProfileSchema);
  return ok({ user: await updateProfile(getStore(), actor.userId, patch) });
});
