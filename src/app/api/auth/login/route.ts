import { getStore } from '@/server/db';
import { StepTimer, requestIdFrom } from '@/server/core/logging';
import { ok, readJson, route } from '@/server/http/respond';
import { setSessionCookie } from '@/server/http/session';
import { credentialsSchema, signIn } from '@/server/services/auth';

export const runtime = 'nodejs';

export const POST = route(async (request: Request) => {
  const requestId = requestIdFrom(request);
  const timer = new StepTimer('signin', { requestId });

  try {
    timer.step('request_received');
    const input = await readJson(request, credentialsSchema);
    timer.step('validation_passed');

    const store = getStore();
    // signIn repairs a half-built account itself, so every caller gets it.
    const result = await signIn(store, input, request.headers.get('user-agent'));
    timer.step('credentials_verified', { userId: result.user.id });

    await setSessionCookie(result.sessionToken, result.expiresAt);
    timer.step('session_created', { userId: result.user.id });

    return ok({ user: result.user });
  } catch (error) {
    timer.fail(error);
    throw error;
  }
});
