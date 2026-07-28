import { getStore } from '@/server/db';
import { StepTimer, requestIdFrom } from '@/server/core/logging';
import { created, readJson, route } from '@/server/http/respond';
import { setSessionCookie } from '@/server/http/session';
import { signUp, signUpSchema } from '@/server/services/auth';
import { ensureUserBootstrap } from '@/server/services/bootstrap';

export const runtime = 'nodejs';

/**
 * Sign-up, instrumented step by step.
 *
 * This route returned a bare 500 in production for every attempt, and the logs
 * said only "unhandled route error". Each step below now emits a line, so the
 * next failure names the step it died on and the driver it was talking to
 * instead of requiring someone to guess from the source.
 *
 * Nothing here logs the password, the session token or the cookie — the logger
 * redacts by key name as a second line of defence.
 */
export const POST = route(async (request: Request) => {
  const requestId = requestIdFrom(request);
  const timer = new StepTimer('signup', { requestId });

  try {
    timer.step('request_received');

    const input = await readJson(request, signUpSchema);
    timer.step('validation_passed', { emailDomain: input.email.split('@')[1] ?? null });

    // Resolving the driver can itself throw a configuration error. Doing it after
    // validation means a misconfigured deployment still rejects a bad password
    // with a 422 rather than a confusing 503.
    const store = getStore();
    timer.step('storage_resolved', { driver: store.kind });

    const result = await signUp(store, input, request.headers.get('user-agent'));
    timer.step('auth_user_created', { userId: result.user.id });
    timer.step('workspace_created', { workspaceId: result.workspace.id });

    // Cheap on the happy path (three reads), and the only thing standing between
    // a partial write on a driver without transactions and an unusable account.
    const bootstrap = await ensureUserBootstrap(store, result.user.id);
    timer.step('profile_created', {
      workspaceId: bootstrap.workspaceId,
      repaired: bootstrap.repaired,
    });

    await setSessionCookie(result.sessionToken, result.expiresAt);
    timer.step('session_created', { userId: result.user.id });

    return created({ user: result.user, workspace: result.workspace });
  } catch (error) {
    timer.fail(error);
    throw error;
  }
});
