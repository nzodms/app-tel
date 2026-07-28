import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalStore } from '@/server/db/local-store';
import type { Store } from '@/server/db';
import { signUp } from '@/server/services/auth';
import { createProject } from '@/server/services/projects';
import type { Actor } from '@/server/services/access';

/**
 * Test fixtures.
 *
 * Every suite gets a real `LocalStore` on a throwaway directory — the same driver
 * the app runs on locally, not a stub. That means the tests exercise the actual
 * query semantics, transaction behaviour and JSON round-tripping.
 */

export interface Fixture {
  store: Store;
  actor: Actor;
  userId: string;
  workspaceId: string;
  cleanup: () => Promise<void>;
}

export async function makeStore(): Promise<{ store: Store; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'phonelab-test-'));
  const store = new LocalStore(dir);
  return { store, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export async function makeFixture(): Promise<Fixture> {
  const { store, cleanup } = await makeStore();
  const result = await signUp(
    store,
    { name: 'Test User', email: `user-${Date.now()}@example.com`, password: 'a-good-password' },
    null,
  );
  const membership = await store.find('workspaceMembers', { match: { userId: result.user.id } });
  if (!membership) throw new Error('signUp did not create a workspace membership');

  return {
    store,
    actor: { userId: result.user.id, via: 'session' },
    userId: result.user.id,
    workspaceId: membership.workspaceId,
    cleanup,
  };
}

export async function makeProject(
  fixture: Fixture,
  templateId = 'starter',
): Promise<{ projectId: string }> {
  const created = await createProject(fixture.store, fixture.actor, {
    workspaceId: fixture.workspaceId,
    name: 'Test project',
    templateId,
  });
  return { projectId: created.project.id };
}
