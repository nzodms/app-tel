import { getStore } from '@/server/db';
import { StepTimer, requestIdFrom } from '@/server/core/logging';
import { ok, readJson, route } from '@/server/http/respond';
import { setSessionCookie } from '@/server/http/session';
import { credentialsSchema, signIn } from '@/server/services/auth';
import { ensureUserBootstrap } from '@/server/services/bootstrap';

export const runtime = 'nodejs';

export const POST = route(async (request: Request) => {
  const requestId = requestIdFrom(request);
  const timer = new StepTimer('signin', { requestId });

  try {
    timer.step('request_received');
    const input = await readJson(request, credentialsSchema);
    timer.step('validation_passed');

    const store = getStore();
    const result = await signIn(store, input, request.headers.get('user-agent'));
    timer.step('credentials_verified', { userId: result.user.id });

    // The recovery point for an account whose sign-up half-succeeded: it becomes
    // whole on the next sign-in rather than staying broken with its email taken.
    const bootstrap = await ensureUserBootstrap(store, result.user.id);
    if (bootstrap.repaired.length > 0) {
      timer.step('bootstrap_repaired', { repaired: bootstrap.repaired });
    }

    await setSessionCookie(result.sessionToken, result.expiresAt);
    timer.step('session_created', { userId: result.user.id });

    return ok({ user: result.user });
  } catch (error) {
    timer.fail(error);
    throw error;
  }
});
