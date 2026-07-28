import { z } from 'zod';
import { notFound } from '../core/errors';
import { DEFAULT_PREFERENCES } from '../db';
import type { Id, Store, UserPreferences, WorkspaceRow } from '../db';
import { normalizeUser, toPublicUser, type PublicUser } from './auth';

/**
 * The person's own account: their name, their UI preferences, and which project
 * they had open last.
 *
 * Preferences live on the user rather than in localStorage because they follow you
 * between machines, and because the studio renders them server-side on the first
 * paint — a pane width read from localStorage would flash at the default width first.
 */

export const preferencesSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  leftPaneWidth: z.number().min(15).max(60).optional(),
  editorMinimap: z.boolean().optional(),
  canvasSnap: z.boolean().optional(),
  canvasGrid: z.boolean().optional(),
  reduceMotion: z.boolean().optional(),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, 'Your name cannot be empty.').max(80).optional(),
  preferences: preferencesSchema.optional(),
  activeProjectId: z.string().min(1).nullable().optional(),
});

export async function updateProfile(
  store: Store,
  userId: Id,
  patch: z.infer<typeof updateProfileSchema>,
): Promise<PublicUser> {
  const parsed = updateProfileSchema.parse(patch);
  const row = await store.find('users', { match: { id: userId } });
  if (!row) throw notFound('Account not found.');
  const user = normalizeUser(row);

  const next: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (parsed.name !== undefined) next.name = parsed.name;
  if (parsed.activeProjectId !== undefined) next.activeProjectId = parsed.activeProjectId;
  if (parsed.preferences) {
    const merged: UserPreferences = {
      ...DEFAULT_PREFERENCES,
      ...user.preferences,
      ...parsed.preferences,
    };
    next.preferences = merged;
  }

  const updated = await store.update('users', userId, next);
  return toPublicUser(normalizeUser(updated));
}

/**
 * Remembers the project someone was last in.
 *
 * Best-effort on purpose: it runs on every studio open, and a write failure there
 * must never stop the studio from loading.
 */
export async function rememberActiveProject(
  store: Store,
  userId: Id,
  projectId: Id | null,
): Promise<void> {
  try {
    const row = await store.find('users', { match: { id: userId } });
    if (!row || row.activeProjectId === projectId) return;
    await store.update('users', userId, {
      activeProjectId: projectId,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    // Nothing the person can act on, and nothing depends on it.
  }
}

/* -------------------------------------------------------------------------- */
/* Workspaces                                                                  */
/* -------------------------------------------------------------------------- */

export interface WorkspaceSummary extends WorkspaceRow {
  role: string;
  memberCount: number;
  projectCount: number;
  isActive: boolean;
}

export async function listWorkspacesForUser(
  store: Store,
  userId: Id,
): Promise<WorkspaceSummary[]> {
  const row = await store.find('users', { match: { id: userId } });
  const activeId = row ? normalizeUser(row).activeWorkspaceId : null;

  const memberships = await store.select('workspaceMembers', { match: { userId } });
  const summaries: WorkspaceSummary[] = [];
  for (const membership of memberships) {
    const workspace = await store.find('workspaces', { match: { id: membership.workspaceId } });
    if (!workspace) continue;
    const [memberCount, projectCount] = await Promise.all([
      store.count('workspaceMembers', { match: { workspaceId: workspace.id } }),
      store.count('projects', { match: { workspaceId: workspace.id } }),
    ]);
    summaries.push({
      ...workspace,
      role: membership.role,
      memberCount,
      projectCount,
      isActive: workspace.id === activeId,
    });
  }
  return summaries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export const renameWorkspaceSchema = z.object({
  name: z.string().trim().min(1, 'Give the workspace a name.').max(80),
});

export async function renameWorkspace(
  store: Store,
  workspaceId: Id,
  name: string,
): Promise<WorkspaceRow> {
  const parsed = renameWorkspaceSchema.parse({ name });
  return store.update('workspaces', workspaceId, {
    name: parsed.name,
    updatedAt: new Date().toISOString(),
  });
}
