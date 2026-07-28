import { getStore } from '@/server/db';
import { ok, route } from '@/server/http/respond';
import { clearSessionCookie } from '@/server/http/session';
import { destroySession } from '@/server/services/auth';

export const runtime = 'nodejs';

export const POST = route(async () => {
  const token = await clearSessionCookie();
  await destroySession(getStore(), token);
  return ok({ signedOut: true });
});
