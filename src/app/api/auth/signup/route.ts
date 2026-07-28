import { getStore } from '@/server/db';
import { created, readJson, route } from '@/server/http/respond';
import { setSessionCookie } from '@/server/http/session';
import { signUp, signUpSchema } from '@/server/services/auth';

export const runtime = 'nodejs';

export const POST = route(async (request: Request) => {
  const input = await readJson(request, signUpSchema);
  const result = await signUp(getStore(), input, request.headers.get('user-agent'));
  await setSessionCookie(result.sessionToken, result.expiresAt);
  return created({ user: result.user, workspace: result.workspace });
});
