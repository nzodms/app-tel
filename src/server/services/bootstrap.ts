import { newId, slugify } from '../core/ids';
import { log } from '../core/logging';
import { DEFAULT_PREFERENCES } from '../db';
import type { Id, Store, UserRow, WorkspaceRow } from '../db';

/**
 * Makes an account complete, whatever state it is in.
 *
 * Sign-up writes the user, the workspace and the owner membership in one
 * `store.transaction`, so on the local driver they land together. The Supabase
 * driver has no multi-statement transaction — the REST API cannot express one —
 * so a failure between the three inserts leaves a real, half-built account:
 * a user with no workspace, or a workspace with no owner. That account could
 * previously never sign in usefully and its email address was taken forever.
 *
 * This function repairs any of those states and is safe to call repeatedly. It
 * runs after every sign-up and at the start of every sign-in, so a partial
 * account fixes itself on the next attempt instead of needing support.
 *
 * It never touches an account that is already whole beyond reporting so.
 */
export interface BootstrapResult {
  workspaceId: Id;
  /** What had to be created. Empty when the account was already complete. */
  repaired: ('workspace' | 'membership' | 'preferences' | 'activeWorkspace')[];
}

export async function ensureUserBootstrap(store: Store, userId: Id): Promise<BootstrapResult> {
  const user = await store.find('users', { match: { id: userId } });
  if (!user) throw new Error(`ensureUserBootstrap: no user ${userId}`);

  const repaired: BootstrapResult['repaired'] = [];
  const now = new Date().toISOString();

  // 1. A workspace they are a member of, or one they own, or a new one.
  let workspaceId = await findUsableWorkspace(store, user);

  if (!workspaceId) {
    const workspace: WorkspaceRow = {
      id: newId('wsp'),
      name: `${user.name.split(' ')[0] ?? user.name}'s workspace`,
      slug: slugify(`${user.name}-workspace-${user.id.slice(-6)}`, 'workspace'),
      ownerId: user.id,
      createdAt: now,
      updatedAt: now,
    };
    await store.insert('workspaces', workspace);
    workspaceId = workspace.id;
    repaired.push('workspace');
  }

  // 2. An owner membership on it. Checked separately because a workspace can
  //    exist without one if the second insert of the sign-up failed.
  const membership = await store.find('workspaceMembers', { match: { workspaceId, userId } });
  if (!membership) {
    await store.insert('workspaceMembers', {
      id: newId('wsm'),
      workspaceId,
      userId,
      role: 'owner',
      createdAt: now,
    });
    repaired.push('membership');
  }

  // 3. Fields added by later migrations, null on rows written before them.
  const patch: Record<string, unknown> = {};
  if (!user.preferences) {
    patch.preferences = DEFAULT_PREFERENCES;
    repaired.push('preferences');
  }
  if (!user.activeWorkspaceId) {
    patch.activeWorkspaceId = workspaceId;
    repaired.push('activeWorkspace');
  }
  if (user.onboardingStep === null || user.onboardingStep === undefined) {
    patch.onboardingStep = 0;
  }
  if (!user.onboardingDraft) {
    patch.onboardingDraft = {};
  }
  if (Object.keys(patch).length > 0) {
    await store.update('users', userId, { ...patch, updatedAt: now });
  }

  if (repaired.length > 0) {
    log('warn', 'bootstrap.repaired', { userId, workspaceId, repaired });
  }

  return { workspaceId, repaired };
}

/** The workspace this account should use, if it already has one. */
async function findUsableWorkspace(store: Store, user: UserRow): Promise<Id | null> {
  if (user.activeWorkspaceId) {
    const active = await store.find('workspaces', { match: { id: user.activeWorkspaceId } });
    if (active) return active.id;
  }

  const membership = await store.find('workspaceMembers', { match: { userId: user.id } });
  if (membership) {
    const workspace = await store.find('workspaces', { match: { id: membership.workspaceId } });
    if (workspace) return workspace.id;
  }

  // Owned but not joined: the workspace insert succeeded and the membership
  // insert did not.
  const owned = await store.find('workspaces', { match: { ownerId: user.id } });
  return owned?.id ?? null;
}
