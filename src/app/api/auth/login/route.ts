import { getStore } from '@/server/db';
import { ok, readJson, route } from '@/server/http/respond';
import { setSessionCookie } from '@/server/http/session';
import { credentialsSchema, signIn } from '@/server/services/auth';

export const runtime = 'nodejs';

export const POST = route(async (request: Request) => {
  const input = await readJson(request, credentialsSchema);
  const result = await signIn(getStore(), input, request.headers.get('user-agent'));
  await setSessionCookie(result.sessionToken, result.expiresAt);
  return ok({ user: result.user });
});
