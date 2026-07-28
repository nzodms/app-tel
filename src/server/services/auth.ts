import { z } from 'zod';
import { badRequest, conflict, unauthorized } from '../core/errors';
import { hashSecret, sha256, verifySecret } from '../core/crypto';
import { newId, newToken, slugify } from '../core/ids';
import { ensureUserBootstrap } from './bootstrap';
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

/** Steps a caller can log as they complete. See the sign-up route. */
export type SignUpStep =
  | 'user_created'
  | 'workspace_created'
  | 'membership_created'
  | 'active_workspace_set'
  | 'session_created';

/**
 * Creates the user, their personal workspace and an authenticated session.
 *
 * The order of the writes is the whole point — see the comment on
 * `activeWorkspaceId` below.
 */
export async function signUp(
  store: Store,
  input: z.infer<typeof signUpSchema>,
  userAgent: string | null,
  onStep?: (step: SignUpStep) => void,
): Promise<SignUpResult> {
  const { email, password, name } = signUpSchema.parse(input);

  const existing = await store.find('users', { match: { email } });
  if (existing) throw conflict('An account already exists for that email address.');

  const { hash, salt } = await hashSecret(password);
  const now = new Date().toISOString();
  const userId = newId('usr');
  const workspaceId = newId('wsp');

  const user: UserRow = {
    id: userId,
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
    // Deliberately null on insert. `users.active_workspace_id` is a foreign key to
    // `workspaces.id`, and `workspaces.owner_id` is a foreign key back to
    // `users.id` — a cycle. Writing the id here before the workspace row exists
    // is what made every production sign-up fail with SQLSTATE 23503
    // (users_active_workspace_id_fkey). It never showed up locally: the JSON
    // driver has no foreign keys, so it accepted the dangling reference happily.
    // Step 5 below sets it, once the workspace it points at is really there.
    activeWorkspaceId: null,
    activeProjectId: null,
    preferences: DEFAULT_PREFERENCES,
  };

  const workspace: WorkspaceRow = {
    id: workspaceId,
    name: `${name.split(' ')[0] ?? name}'s workspace`,
    slug: slugify(`${name}-workspace`, 'workspace'),
    ownerId: userId,
    createdAt: now,
    updatedAt: now,
  };

  const membership = {
    id: newId('wsm'),
    workspaceId,
    userId,
    role: 'owner' as const,
    createdAt: now,
  };

  /*
   * Ordered so that every row only ever references rows that already exist.
   *
   * `store.transaction` is a real transaction on the local driver and a plain
   * sequence on Supabase — the REST API cannot express a multi-statement
   * transaction. So correctness cannot rest on rollback: the order has to be
   * valid step by step, and a failure part-way has to clean up after itself.
   * That is what `onStep` reports and the catch block undoes.
   */
  try {
    await store.transaction(async (tx) => {
      await tx.insert('users', user);            // 2. user, no workspace pointer
      onStep?.('user_created');

      await tx.insert('workspaces', workspace);  // 3. workspace owned by the user
      onStep?.('workspace_created');

      await tx.insert('workspaceMembers', membership); // 4. owner membership
      onStep?.('membership_created');
    });

    // 5. Only now does the pointer have something valid to point at.
    await store.update('users', userId, { activeWorkspaceId: workspaceId, updatedAt: now });
    onStep?.('active_workspace_set');
  } catch (error) {
    // Compensation. Without a transaction on Supabase, a failure at step 3 or 4
    // would otherwise leave a user row whose email address is taken forever by an
    // account that cannot be used. Best-effort and in reverse order.
    await rollbackBootstrap(store, { userId, workspaceId, membershipId: membership.id });
    throw error;
  }

  // 6. The session comes last: it is the thing that says "this account is ready",
  //    and handing one out before the workspace exists is how someone ends up
  //    signed in to an account that cannot create anything.
  const session = await createSession(store, userId, userAgent);
  onStep?.('session_created');

  return {
    user: toPublicUser({ ...user, activeWorkspaceId: workspaceId }),
    workspace,
    sessionToken: session.token,
    expiresAt: session.expiresAt,
  };
}

/**
 * Undoes a partial sign-up.
 *
 * Every delete is independent and failure-tolerant: we are already on an error
 * path, and a cleanup that throws would replace a useful error with a useless
 * one. Anything that survives here is repaired by `ensureUserBootstrap` on the
 * next sign-in instead.
 */
async function rollbackBootstrap(
  store: Store,
  ids: { userId: Id; workspaceId: Id; membershipId: Id },
): Promise<void> {
  for (const undo of [
    () => store.remove('workspaceMembers', ids.membershipId),
    () => store.remove('workspaces', ids.workspaceId),
    () => store.remove('users', ids.userId),
  ]) {
    try {
      await undo();
    } catch {
      // Nothing actionable: the row may simply never have been written.
    }
  }
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

  // The recovery point for an account whose sign-up half-succeeded: a missing
  // workspace or owner membership is rebuilt here rather than leaving the person
  // permanently locked out of an address they already registered. Idempotent, so
  // it costs three reads on the overwhelmingly common healthy path.
  await ensureUserBootstrap(store, user.id);

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
