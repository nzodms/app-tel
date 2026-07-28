import { getStore } from '@/server/db';
import { isAppError, userBootstrapFailed } from '@/server/core/errors';
import { StepTimer, requestIdFrom } from '@/server/core/logging';
import { created, readJson, route } from '@/server/http/respond';
import { setSessionCookie } from '@/server/http/session';
import { signUp, signUpSchema } from '@/server/services/auth';
import { ensureUserBootstrap } from '@/server/services/bootstrap';

export const runtime = 'nodejs';

/**
 * Sign-up, instrumented step by step.
 *
 * The steps are not decoration. Production failed here twice, and both times the
 * logs said only "unhandled route error": once because the storage driver could
 * not write at all, and once because the user row was inserted with a pointer to
 * a workspace that did not exist yet (SQLSTATE 23503). A line per step names
 * which of the five writes died, so neither costs a round of guessing again.
 *
 * Nothing here logs the password, the session token or the cookie — the logger
 * also redacts by key name as a second line of defence.
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

    // signup.user_created → workspace_created → membership_created →
    // active_workspace_set, each as it actually lands.
    const result = await signUp(store, input, request.headers.get('user-agent'), (step) =>
      timer.step(step),
    );

    // Cheap on the happy path (three reads), and the only thing standing between
    // a partial write on a driver without transactions and an unusable account.
    const bootstrap = await ensureUserBootstrap(store, result.user.id);
    if (bootstrap.repaired.length > 0) {
      timer.step('bootstrap_repaired', { repaired: bootstrap.repaired });
    }

    await setSessionCookie(result.sessionToken, result.expiresAt);
    timer.step('cookie_set', { userId: result.user.id });

    return created({ user: result.user, workspace: result.workspace });
  } catch (error) {
    timer.fail(error);

    // A referential failure during account creation is specifically "we could not
    // set up your workspace" — worth saying, because it is neither the caller's
    // input nor an outage they should wait out.
    if (isAppError(error) && error.code === 'foreign_key_violation') {
      throw userBootstrapFailed(
        'Could not set up your workspace. Nothing was saved — try again.',
        { ...error.details, failedAfterStep: timer.lastStep },
      );
    }
    throw error;
  }
});
