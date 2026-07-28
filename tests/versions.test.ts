import { afterEach, describe, expect, it } from 'vitest';
import { findFile, getFile, writeFile, deleteFile } from '@/server/services/files';
import {
  compareVersions,
  createSnapshot,
  diffFileBetween,
  duplicateVersion,
  listVersions,
  restoreVersion,
} from '@/server/services/versions';
import { makeFixture, makeProject, type Fixture } from './helpers';

let fixture: Fixture | null = null;
afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

async function setup() {
  fixture = await makeFixture();
  const { projectId } = await makeProject(fixture);
  return { fixture, projectId, store: fixture.store, userId: fixture.userId };
}

describe('snapshots', () => {
  it('restores the exact file contents', async () => {
    const { store, projectId, userId } = await setup();
    await writeFile(store, projectId, 'src/App.tsx', 'ORIGINAL', { editor: 'user' });

    const snapshot = await createSnapshot(store, projectId, {
      label: 'Known good',
      authorKind: 'user',
      createdBy: userId,
    });

    await writeFile(store, projectId, 'src/App.tsx', 'BROKEN', { editor: 'claude' });
    expect((await getFile(store, projectId, 'src/App.tsx')).content).toBe('BROKEN');

    await restoreVersion(store, projectId, snapshot.id, 'user', userId);
    expect((await getFile(store, projectId, 'src/App.tsx')).content).toBe('ORIGINAL');
  });

  it('brings back a file that was deleted after the snapshot', async () => {
    const { store, projectId, userId } = await setup();
    await writeFile(store, projectId, 'src/keeper.ts', 'keep me', { editor: 'user' });

    const snapshot = await createSnapshot(store, projectId, {
      label: 'Before delete',
      authorKind: 'user',
      createdBy: userId,
    });
    await deleteFile(store, projectId, 'src/keeper.ts', 'claude');
    expect(await findFile(store, projectId, 'src/keeper.ts')).toBeNull();

    await restoreVersion(store, projectId, snapshot.id, 'user', userId);
    expect(await findFile(store, projectId, 'src/keeper.ts')).not.toBeNull();
  });

  it('removes files created after the snapshot', async () => {
    const { store, projectId, userId } = await setup();
    const snapshot = await createSnapshot(store, projectId, {
      label: 'Clean',
      authorKind: 'user',
      createdBy: userId,
    });
    await writeFile(store, projectId, 'src/extra.ts', 'added later', { editor: 'claude' });

    await restoreVersion(store, projectId, snapshot.id, 'user', userId);
    expect(await findFile(store, projectId, 'src/extra.ts')).toBeNull();
  });

  it('always takes a safety snapshot first, so a restore is undoable', async () => {
    const { store, projectId, userId } = await setup();
    await writeFile(store, projectId, 'src/App.tsx', 'V1', { editor: 'user' });
    const first = await createSnapshot(store, projectId, {
      label: 'V1',
      authorKind: 'user',
      createdBy: userId,
    });

    await writeFile(store, projectId, 'src/App.tsx', 'V2 work in progress', { editor: 'user' });
    const restore = await restoreVersion(store, projectId, first.id, 'user', userId);

    expect((await getFile(store, projectId, 'src/App.tsx')).content).toBe('V1');

    // Undo the restore using the automatic snapshot.
    await restoreVersion(store, projectId, restore.safetySnapshot.id, 'user', userId);
    expect((await getFile(store, projectId, 'src/App.tsx')).content).toBe('V2 work in progress');
  });

  it('numbers versions monotonically and lists newest first', async () => {
    const { store, projectId, userId } = await setup();
    await createSnapshot(store, projectId, { label: 'A', authorKind: 'user', createdBy: userId });
    await createSnapshot(store, projectId, { label: 'B', authorKind: 'user', createdBy: userId });

    const versions = await listVersions(store, projectId);
    expect(versions[0]?.label).toBe('B');
    expect(versions[0]?.sequence).toBeGreaterThan(versions[1]?.sequence ?? 0);
  });

  it('duplicates a version without touching the working tree', async () => {
    const { store, projectId, userId } = await setup();
    await writeFile(store, projectId, 'src/App.tsx', 'BASE', { editor: 'user' });
    const base = await createSnapshot(store, projectId, {
      label: 'Base',
      authorKind: 'user',
      createdBy: userId,
    });
    await writeFile(store, projectId, 'src/App.tsx', 'LIVE', { editor: 'user' });

    await duplicateVersion(store, projectId, base.id, 'Base copy', userId, 'user');
    expect((await getFile(store, projectId, 'src/App.tsx')).content).toBe('LIVE');
  });
});

describe('comparison', () => {
  it('classifies added, removed and modified files', async () => {
    const { store, projectId, userId } = await setup();
    await writeFile(store, projectId, 'src/stay.ts', 'same', { editor: 'user' });
    await writeFile(store, projectId, 'src/change.ts', 'before', { editor: 'user' });
    await writeFile(store, projectId, 'src/gone.ts', 'bye', { editor: 'user' });

    const base = await createSnapshot(store, projectId, {
      label: 'Base',
      authorKind: 'user',
      createdBy: userId,
    });

    await writeFile(store, projectId, 'src/change.ts', 'after', { editor: 'user' });
    await deleteFile(store, projectId, 'src/gone.ts', 'user');
    await writeFile(store, projectId, 'src/fresh.ts', 'new file', { editor: 'user' });

    const comparison = await compareVersions(store, projectId, base.id, 'working');
    const byPath = new Map(comparison.changes.map((change) => [change.path, change.status]));

    expect(byPath.get('src/change.ts')).toBe('modified');
    expect(byPath.get('src/gone.ts')).toBe('removed');
    expect(byPath.get('src/fresh.ts')).toBe('added');
    expect(byPath.has('src/stay.ts')).toBe(false);
  });

  it('returns a unified diff for one file', async () => {
    const { store, projectId, userId } = await setup();
    await writeFile(store, projectId, 'src/one.ts', 'alpha\n', { editor: 'user' });
    const base = await createSnapshot(store, projectId, {
      label: 'Base',
      authorKind: 'user',
      createdBy: userId,
    });
    await writeFile(store, projectId, 'src/one.ts', 'omega\n', { editor: 'user' });

    const detail = await diffFileBetween(store, projectId, base.id, 'working', 'src/one.ts');
    expect(detail.before).toBe('alpha\n');
    expect(detail.after).toBe('omega\n');
    expect(detail.unified).toContain('-alpha');
    expect(detail.unified).toContain('+omega');
  });
});
