import { z } from 'zod';
import { badRequest, conflict, unauthorized } from '../core/errors';
import { hashSecret, sha256, verifySecret } from '../core/crypto';
import { newId, newToken, slugify } from '../core/ids';
import { DEFAULT_PREFERENCES } from '../db';
import type { Id, SessionRow, Store, UserPreferences, UserRow, WorkspaceRow } from '../db';

export const SESSION_COOKIE = 'pl_session';
const SESSION_TTL_DAYS = 30;

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(200),
  password: z
    .string()
    .min(10, 'Use at least 10 characters.')
    .max(200, 'That password is too long.'),
});

export const signUpSchema = credentialsSchema.extend({
  name: z.string().trim().min(1, 'Tell us your name.').max(80),
});

export type PublicUser = Omit<UserRow, 'passwordHash' | 'passwordSalt'>;

export function toPublicUser(user: UserRow): PublicUser {
  const { passwordHash: _hash, passwordSalt: _salt, ...rest } = normalizeUser(user);
  return rest;
}

/**
 * Fills in fields added after a row was first written.
 *
 * Rows created before onboarding existed have no `onboardingStep`, and a Postgres
 * column added by a later migration can be null on old rows. Defaulting here — at
 * the single place every read passes through — means the rest of the code can
 * treat `UserRow` as complete, and an existing account lands on onboarding rather
 * than on a half-rendered dashboard.
 */
export function normalizeUser(user: UserRow): UserRow {
  return {
    ...user,
    onboardingCompletedAt: user.onboardingCompletedAt ?? null,
    onboardingStep: typeof user.onboardingStep === 'number' ? user.onboardingStep : 0,
    onboardingDraft: user.onboardingDraft ?? {},
    activeWorkspaceId: user.activeWorkspaceId ?? null,
    activeProjectId: user.activeProjectId ?? null,
    preferences: { ...DEFAULT_PREFERENCES, ...(user.preferences ?? {}) } as UserPreferences,
  };
}

function hueFor(email: string): number {
  let hash = 0;
  for (let i = 0; i < email.length; i += 1) hash = (hash * 31 + email.charCodeAt(i)) % 360;
  return hash;
}

/* -------------------------------------------------------------------------- */

export interface SignUpResult {
  user: PublicUser;
  workspace: WorkspaceRow;
  sessionToken: string;
  expiresAt: string;
}

/** Creates the user, their personal workspace and an authenticated session. */
export async function signUp(
  store: Store,
  input: z.infer<typeof signUpSchema>,
  userAgent: string | null,
): Promise<SignUpResult> {
  const { email, password, name } = signUpSchema.parse(input);

  const existing = await store.find('users', { match: { email } });
  if (existing) throw conflict('An account already exists for that email address.');

  const { hash, salt } = await hashSecret(password);
  const now = new Date().toISOString();
  const workspaceId = newId('wsp');

  const user: UserRow = {
    id: newId('usr'),
    email,
    name,
    passwordHash: hash,
    passwordSalt: salt,
    avatarHue: hueFor(email),
    createdAt: now,
    updatedAt: now,
    // A brand-new account has seen nothing yet. This is the flag the router reads
    // to send someone to /onboarding instead of /dashboard.
    onboardingCompletedAt: null,
    onboardingStep: 0,
    onboardingDraft: {},
    activeWorkspaceId: workspaceId,
    activeProjectId: null,
    preferences: DEFAULT_PREFERENCES,
  };

  const workspace: WorkspaceRow = {
    id: workspaceId,
    name: `${name.split(' ')[0] ?? name}'s workspace`,
    slug: slugify(`${name}-workspace`, 'workspace'),
    ownerId: user.id,
    createdAt: now,
    updatedAt: now,
  };

  await store.transaction(async (tx) => {
    await tx.insert('users', user);
    await tx.insert('workspaces', workspace);
    await tx.insert('workspaceMembers', {
      id: newId('wsm'),
      workspaceId: workspace.id,
      userId: user.id,
      role: 'owner',
      createdAt: now,
    });
  });

  const session = await createSession(store, user.id, userAgent);
  return {
    user: toPublicUser(user),
    workspace,
    sessionToken: session.token,
    expiresAt: session.expiresAt,
  };
}

export async function signIn(
  store: Store,
  input: z.infer<typeof credentialsSchema>,
  userAgent: string | null,
): Promise<{ user: PublicUser; sessionToken: string; expiresAt: string }> {
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) throw badRequest('Enter your email address and password.');

  const user = await store.find('users', { match: { email: parsed.data.email } });
  // Same error either way: never disclose whether an address is registered.
  const genericFailure = unauthorized('Email address or password is incorrect.');
  if (!user) throw genericFailure;

  const ok = await verifySecret(parsed.data.password, user.passwordHash, user.passwordSalt);
  if (!ok) throw genericFailure;

  const session = await createSession(store, user.id, userAgent);
  return {
    user: toPublicUser(user),
    sessionToken: session.token,
    expiresAt: session.expiresAt,
  };
}

export async function createSession(
  store: Store,
  userId: Id,
  userAgent: string | null,
): Promise<{ token: string; expiresAt: string }> {
  const token = newToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000).toISOString();
  const row: SessionRow = {
    id: newId('ses'),
    tokenHash: sha256(token),
    userId,
    expiresAt,
    createdAt: new Date().toISOString(),
    userAgent: userAgent?.slice(0, 200) ?? null,
  };
  await store.insert('sessions', row);
  return { token, expiresAt };
}

/** Resolves a session cookie to a user, dropping expired sessions as it goes. */
export async function resolveSession(
  store: Store,
  token: string | undefined,
): Promise<PublicUser | null> {
  if (!token) return null;
  const session = await store.find('sessions', { match: { tokenHash: sha256(token) } });
  if (!session) return null;

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await store.remove('sessions', session.id);
    return null;
  }

  const user = await store.find('users', { match: { id: session.userId } });
  return user ? toPublicUser(user) : null;
}

export async function destroySession(store: Store, token: string | undefined): Promise<void> {
  if (!token) return;
  await store.removeWhere('sessions', { match: { tokenHash: sha256(token) } });
}
