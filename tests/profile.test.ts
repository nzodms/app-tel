import { describe, expect, it } from 'vitest';
import { makeFixture } from './helpers';
import {
  listWorkspacesForUser,
  rememberActiveProject,
  renameWorkspace,
  updateProfile,
} from '@/server/services/profile';
import { createProject } from '@/server/services/projects';
import { DEFAULT_PREFERENCES } from '@/lib/preferences';

describe('preferences', () => {
  it('merge rather than replace, so a partial patch keeps the rest', async () => {
    const fixture = await makeFixture();
    try {
      const updated = await updateProfile(fixture.store, fixture.userId, {
        preferences: { leftPaneWidth: 38 },
      });
      expect(updated.preferences).toEqual({ ...DEFAULT_PREFERENCES, leftPaneWidth: 38 });

      const again = await updateProfile(fixture.store, fixture.userId, {
        preferences: { canvasGrid: false },
      });
      expect(again.preferences.leftPaneWidth).toBe(38);
      expect(again.preferences.canvasGrid).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });

  it('reject a pane width that would leave no canvas', async () => {
    const fixture = await makeFixture();
    try {
      await expect(
        updateProfile(fixture.store, fixture.userId, { preferences: { leftPaneWidth: 95 } }),
      ).rejects.toThrow();
    } finally {
      await fixture.cleanup();
    }
  });

  it('never leak the password hash', async () => {
    const fixture = await makeFixture();
    try {
      const updated = await updateProfile(fixture.store, fixture.userId, { name: 'Renamed' });
      expect(updated.name).toBe('Renamed');
      expect(updated).not.toHaveProperty('passwordHash');
      expect(updated).not.toHaveProperty('passwordSalt');
    } finally {
      await fixture.cleanup();
    }
  });
});

describe('the last opened project', () => {
  it('is remembered, and clearing it is allowed', async () => {
    const fixture = await makeFixture();
    try {
      const created = await createProject(fixture.store, fixture.actor, {
        workspaceId: fixture.workspaceId,
        name: 'Opened',
        templateId: 'starter',
      });

      await rememberActiveProject(fixture.store, fixture.userId, created.project.id);
      let user = await fixture.store.find('users', { match: { id: fixture.userId } });
      expect(user?.activeProjectId).toBe(created.project.id);

      await rememberActiveProject(fixture.store, fixture.userId, null);
      user = await fixture.store.find('users', { match: { id: fixture.userId } });
      expect(user?.activeProjectId).toBeNull();
    } finally {
      await fixture.cleanup();
    }
  });

  it('does not throw when the account is gone', async () => {
    const fixture = await makeFixture();
    try {
      await expect(
        rememberActiveProject(fixture.store, 'usr_missing', 'prj_missing'),
      ).resolves.toBeUndefined();
    } finally {
      await fixture.cleanup();
    }
  });
});

describe('workspaces', () => {
  it('are listed with real counts', async () => {
    const fixture = await makeFixture();
    try {
      await createProject(fixture.store, fixture.actor, {
        workspaceId: fixture.workspaceId,
        name: 'One',
        templateId: 'starter',
      });

      const workspaces = await listWorkspacesForUser(fixture.store, fixture.userId);
      expect(workspaces).toHaveLength(1);
      expect(workspaces[0]?.projectCount).toBe(1);
      expect(workspaces[0]?.memberCount).toBe(1);
      expect(workspaces[0]?.role).toBe('owner');
      expect(workspaces[0]?.isActive).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it('can be renamed, and reject an empty name', async () => {
    const fixture = await makeFixture();
    try {
      const renamed = await renameWorkspace(fixture.store, fixture.workspaceId, 'Padel Nord');
      expect(renamed.name).toBe('Padel Nord');
      await expect(renameWorkspace(fixture.store, fixture.workspaceId, '   ')).rejects.toThrow();
    } finally {
      await fixture.cleanup();
    }
  });
});
