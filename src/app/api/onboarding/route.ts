import { z } from 'zod';
import { getStore } from '@/server/db';
import { ok, readJson, route } from '@/server/http/respond';
import { requireActor } from '@/server/http/session';
import {
  completeOnboarding,
  getOnboardingState,
  resetOnboarding,
  saveOnboardingProgress,
  saveProgressSchema,
  skipOnboarding,
} from '@/server/services/onboarding';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** The whole onboarding surface: read the state, save a step, finish, skip, reopen. */
export const GET = route(async () => {
  const { actor } = await requireActor();
  return ok({ state: await getOnboardingState(getStore(), actor.userId) });
});

const bodySchema = z.discriminatedUnion('action', [
  saveProgressSchema.extend({ action: z.literal('save') }),
  z.object({ action: z.literal('complete'), draft: z.record(z.string(), z.unknown()).optional() }),
  z.object({ action: z.literal('skip') }),
  z.object({ action: z.literal('reset') }),
]);

export const POST = route(async (request: Request) => {
  const { actor } = await requireActor();
  const store = getStore();
  const body = await readJson(request, bodySchema);

  switch (body.action) {
    case 'save':
      return ok({ state: await saveOnboardingProgress(store, actor.userId, body) });
    case 'complete': {
      const result = await completeOnboarding(store, actor, { draft: body.draft });
      return ok({
        state: result.state,
        projectId: result.project?.id ?? null,
        redirectTo: result.redirectTo,
      });
    }
    case 'skip':
      return ok({ state: await skipOnboarding(store, actor.userId), redirectTo: '/dashboard' });
    case 'reset':
      return ok({ state: await resetOnboarding(store, actor.userId), redirectTo: '/onboarding' });
  }
});
