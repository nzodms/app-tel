import { describe, expect, it } from 'vitest';
import { makeFixture, makeStore } from './helpers';
import { signUp, toPublicUser } from '@/server/services/auth';
import {
  TOTAL_STEPS,
  completeOnboarding,
  getOnboardingState,
  landingPathFor,
  parseDraft,
  resetOnboarding,
  saveOnboardingProgress,
  skipOnboarding,
} from '@/server/services/onboarding';
import { createProject, listProjectsForUser } from '@/server/services/projects';
import { getCategory, generateScaffoldFiles } from '@/server/services/scaffold';
import { buildPreview } from '@/server/services/preview';
import { listFiles } from '@/server/services/files';
import { DEFAULT_PREFERENCES } from '@/lib/preferences';

/**
 * Onboarding.
 *
 * The behaviour these lock down is the one that was wrong: a new account being
 * treated as onboarded because a project happened to exist.
 */

describe('a new account', () => {
  it('has not been onboarded', async () => {
    const { store, cleanup } = await makeStore();
    try {
      const result = await signUp(
        store,
        { name: 'Léa Martin', email: 'lea@example.com', password: 'a-good-password' },
        null,
      );
      expect(result.user.onboardingCompletedAt).toBeNull();
      expect(result.user.onboardingStep).toBe(0);
      expect(result.user.preferences).toEqual(DEFAULT_PREFERENCES);
      expect(result.user.activeWorkspaceId).toBe(result.workspace.id);
      expect(landingPathFor(result.user)).toBe('/onboarding');
    } finally {
      await cleanup();
    }
  });

  it('is still not onboarded after a project appears', async () => {
    const fixture = await makeFixture();
    try {
      // This is the exact confusion that shipped: a project exists, so the app
      // behaved as though the person had been shown around.
      await createProject(fixture.store, fixture.actor, {
        workspaceId: fixture.workspaceId,
        name: 'Made over MCP',
        templateId: 'starter',
      });

      const state = await getOnboardingState(fixture.store, fixture.userId);
      expect(state.completed).toBe(false);

      const user = await fixture.store.find('users', { match: { id: fixture.userId } });
      expect(landingPathFor(toPublicUser(user!))).toBe('/onboarding');
    } finally {
      await fixture.cleanup();
    }
  });
});

describe('progress', () => {
  it('resumes at the step it was left on', async () => {
    const fixture = await makeFixture();
    try {
      await saveOnboardingProgress(fixture.store, fixture.userId, {
        step: 2,
        draft: { appName: 'Padel Nord', category: 'booking' },
      });
      const state = await getOnboardingState(fixture.store, fixture.userId);
      expect(state.step).toBe(2);
      expect(state.stepId).toBe('audience');
      expect(state.draft.appName).toBe('Padel Nord');
    } finally {
      await fixture.cleanup();
    }
  });

  it('merges each step into the draft rather than replacing it', async () => {
    const fixture = await makeFixture();
    try {
      await saveOnboardingProgress(fixture.store, fixture.userId, {
        step: 1,
        draft: { appName: 'Padel Nord' },
      });
      const state = await saveOnboardingProgress(fixture.store, fixture.userId, {
        step: 2,
        draft: { roles: ['member', 'club'] },
      });
      expect(state.draft.appName).toBe('Padel Nord');
      expect(state.draft.roles).toEqual(['member', 'club']);
    } finally {
      await fixture.cleanup();
    }
  });

  it('clamps a step outside the flow', async () => {
    const fixture = await makeFixture();
    try {
      await expect(
        saveOnboardingProgress(fixture.store, fixture.userId, { step: 99 }),
      ).rejects.toThrow();
      const state = await saveOnboardingProgress(fixture.store, fixture.userId, {
        step: TOTAL_STEPS - 1,
      });
      expect(state.step).toBe(TOTAL_STEPS - 1);
    } finally {
      await fixture.cleanup();
    }
  });

  it('falls back to an empty draft rather than failing on a malformed one', () => {
    expect(parseDraft({ roles: 'not an array', appName: 42 }).roles).toEqual([]);
    expect(parseDraft(null).startWith).toBe('generated');
  });
});

describe('completion', () => {
  it('creates a real, compiling project from the brief', async () => {
    const fixture = await makeFixture();
    try {
      const result = await completeOnboarding(fixture.store, fixture.actor, {
        draft: {
          appName: 'Padel Nord',
          category: 'booking',
          summary: 'Members book a court and the club confirms it.',
          audience: 'Club members',
          roles: ['member', 'club'],
          startWith: 'generated',
        },
      });

      expect(result.state.completed).toBe(true);
      expect(result.project).not.toBeNull();
      expect(result.redirectTo).toBe(`/studio/${result.project!.id}`);
      expect(result.project!.isDemo).toBe(false);
      expect(result.project!.brief).toEqual({
        category: 'booking',
        audience: 'Club members',
        summary: 'Members book a court and the club confirms it.',
        roles: ['member', 'club'],
      });

      const projectId = result.project!.id;
      const files = await listFiles(fixture.store, projectId);
      const paths = files.map((file) => file.path);
      expect(paths).toContain('src/App.tsx');
      expect(paths).toContain('src/lib/config.ts');
      expect(paths).toContain('app.json');

      const devices = await fixture.store.select('devices', { match: { projectId } });
      expect(devices.map((device) => device.role).sort()).toEqual(['club', 'member']);

      const versions = await fixture.store.select('projectVersions', { match: { projectId } });
      expect(versions).toHaveLength(1);

      const journeys = await fixture.store.select('journeys', { match: { projectId } });
      expect(journeys).toHaveLength(1);

      // The point of the whole exercise: what onboarding produces must run.
      const build = await buildPreview(fixture.store, projectId, 'working', 'system');
      expect(build.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
      expect(build.ok).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it('points the account at the project it created', async () => {
    const fixture = await makeFixture();
    try {
      const result = await completeOnboarding(fixture.store, fixture.actor, {
        draft: { appName: 'Rivet', category: 'saas', roles: ['customer', 'admin'] },
      });
      const user = await fixture.store.find('users', { match: { id: fixture.userId } });
      expect(user?.activeProjectId).toBe(result.project!.id);
      // Landing goes to the dashboard, not straight back into the studio.
      expect(landingPathFor(toPublicUser(user!))).toBe('/dashboard');
    } finally {
      await fixture.cleanup();
    }
  });

  it('flags the demo as a demo and a template project as your own', async () => {
    const fixture = await makeFixture();
    try {
      const demo = await completeOnboarding(fixture.store, fixture.actor, {
        draft: { startWith: 'padelflow' },
      });
      expect(demo.project?.isDemo).toBe(true);

      const own = await createProject(fixture.store, fixture.actor, {
        workspaceId: fixture.workspaceId,
        name: 'Mine',
        templateId: 'starter',
      });
      expect(own.project.isDemo).toBe(false);

      const listed = await listProjectsForUser(fixture.store, fixture.userId);
      expect(listed.filter((project) => !project.isDemo).map((project) => project.name)).toEqual([
        'Mine',
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('can finish without creating anything', async () => {
    const fixture = await makeFixture();
    try {
      const result = await completeOnboarding(fixture.store, fixture.actor, {
        draft: { startWith: 'empty' },
      });
      expect(result.project).toBeNull();
      expect(result.redirectTo).toBe('/dashboard');
      expect(result.state.completed).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it('supplies a second role when the brief only names one', async () => {
    const fixture = await makeFixture();
    try {
      const result = await completeOnboarding(fixture.store, fixture.actor, {
        draft: { appName: 'Solo', category: 'delivery', roles: ['customer'] },
      });
      const devices = await fixture.store.select('devices', {
        match: { projectId: result.project!.id },
      });
      expect(devices).toHaveLength(2);
      expect(devices.map((device) => device.role)).toContain('customer');
    } finally {
      await fixture.cleanup();
    }
  });
});

describe('skip and reset', () => {
  it('skipping marks it done without creating a project', async () => {
    const fixture = await makeFixture();
    try {
      const state = await skipOnboarding(fixture.store, fixture.userId);
      expect(state.completed).toBe(true);
      expect(state.draft.skipped).toBe(true);
      expect(await listProjectsForUser(fixture.store, fixture.userId)).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('resetting reopens onboarding and keeps every project', async () => {
    const fixture = await makeFixture();
    try {
      const done = await completeOnboarding(fixture.store, fixture.actor, {
        draft: { appName: 'Keep me', category: 'other', roles: ['customer', 'provider'] },
      });
      const before = await listProjectsForUser(fixture.store, fixture.userId);

      const state = await resetOnboarding(fixture.store, fixture.userId);
      expect(state.completed).toBe(false);
      expect(state.step).toBe(0);

      const after = await listProjectsForUser(fixture.store, fixture.userId);
      expect(after.map((project) => project.id)).toEqual(before.map((project) => project.id));

      const files = await listFiles(fixture.store, done.project!.id);
      expect(files.length).toBeGreaterThan(5);
    } finally {
      await fixture.cleanup();
    }
  });
});

describe('the scaffold generator', () => {
  it('is deterministic', () => {
    const input = {
      appName: 'Padel Nord',
      brief: { category: 'booking', audience: 'Members', summary: 'Book a court.', roles: ['member', 'club'] },
    };
    expect(generateScaffoldFiles(input)).toEqual(generateScaffoldFiles(input));
  });

  it('uses the category vocabulary and the brief roles', () => {
    const files = generateScaffoldFiles({
      appName: 'Rivet',
      brief: { category: 'delivery', audience: '', summary: '', roles: ['customer', 'courier'] },
    });
    const config = files.find((file) => file.path === 'src/lib/config.ts')?.content ?? '';
    expect(config).toContain('"requesterRole": "customer"');
    expect(config).toContain('"fulfillerRole": "courier"');
    expect(config).toContain('"requestNoun": "Order"');
    expect(config).toContain('"requested": "order.requested"');

    const manifest = JSON.parse(files.find((file) => file.path === 'app.json')?.content ?? '{}');
    expect(manifest.name).toBe('Rivet');
    expect(manifest.roles.map((role: { slug: string }) => role.slug)).toEqual([
      'customer',
      'courier',
    ]);
  });

  it('falls back to a usable category for an unknown one', () => {
    expect(getCategory('not-a-category').id).toBe('other');
  });
});

describe('the blueprint template', () => {
  it('cannot be created without its generated config', async () => {
    const fixture = await makeFixture();
    try {
      await expect(
        createProject(fixture.store, fixture.actor, {
          workspaceId: fixture.workspaceId,
          name: 'Broken',
          templateId: 'blueprint',
        }),
      ).rejects.toThrow(/only usable through the project generator/);
    } finally {
      await fixture.cleanup();
    }
  });
});
