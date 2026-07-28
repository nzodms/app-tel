import { cookies } from 'next/headers';
import { unauthorized } from '../core/errors';
import { getStore } from '../db';
import { SESSION_COOKIE, resolveSession, type PublicUser } from '../services/auth';
import type { Actor } from '../services/access';

/**
 * `Secure` must follow the scheme, not the build mode.
 *
 * A Vercel preview deployment is served over HTTPS but does not always report
 * NODE_ENV=production; a cookie without `Secure` there is both a downgrade risk
 * and, in a browser enforcing it, simply dropped — which reads as "sign-up
 * worked but I am still logged out".
 */
const isSecureDeployment =
  process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);

export async function readSessionUser(): Promise<PublicUser | null> {
  const jar = await cookies();
  return resolveSession(getStore(), jar.get(SESSION_COOKIE)?.value);
}

export async function requireSessionUser(): Promise<PublicUser> {
  const user = await readSessionUser();
  if (!user) throw unauthorized('Sign in to continue.');
  return user;
}

/** Session-backed actor for the REST routes and server components. */
export async function requireActor(): Promise<{ actor: Actor; user: PublicUser }> {
  const user = await requireSessionUser();
  return { actor: { userId: user.id, via: 'session' }, user };
}

export async function setSessionCookie(token: string, expiresAt: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureDeployment,
    path: '/',
    expires: new Date(expiresAt),
  });
}

export async function clearSessionCookie(): Promise<string | undefined> {
  const jar = await cookies();
  const current = jar.get(SESSION_COOKIE)?.value;
  jar.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureDeployment,
    path: '/',
    maxAge: 0,
  });
  return current;
}
