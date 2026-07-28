import { afterEach, describe, expect, it } from 'vitest';
import { LIMITS } from '@/server/core/limits';
import {
  applyPatch,
  buildTree,
  deleteFile,
  findFile,
  getFile,
  listFiles,
  renameFile,
  searchCode,
  writeFile,
} from '@/server/services/files';
import { normalizeProjectPath } from '@/server/services/paths';
import { makeFixture, makeProject, type Fixture } from './helpers';

let fixture: Fixture | null = null;
afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

async function setup() {
  fixture = await makeFixture();
  const { projectId } = await makeProject(fixture);
  return { fixture, projectId, store: fixture.store };
}

describe('path validation', () => {
  it('rejects traversal', () => {
    expect(() => normalizeProjectPath('../secrets.txt')).toThrow(/cannot climb above/);
    expect(() => normalizeProjectPath('src/../../etc/passwd')).toThrow(/cannot climb above/);
  });

  it('normalises redundant separators', () => {
    expect(normalizeProjectPath('/src//a/./b.tsx')).toBe('src/a/b.tsx');
  });

  it('rejects paths that are only separators', () => {
    expect(() => normalizeProjectPath('///')).toThrow();
  });
});

describe('writing files', () => {
  it('creates, then updates, tracking the editor', async () => {
    const { store, projectId } = await setup();

    const created = await writeFile(store, projectId, 'src/new.ts', 'export const a = 1;', {
      editor: 'user',
    });
    expect(created.created).toBe(true);
    expect(created.file.lastEditedBy).toBe('user');

    const updated = await writeFile(store, projectId, 'src/new.ts', 'export const a = 2;', {
      editor: 'claude',
    });
    expect(updated.created).toBe(false);
    expect(updated.previousContent).toBe('export const a = 1;');
    expect(updated.file.lastEditedBy).toBe('claude');
  });

  it('refuses to overwrite when createOnly is set', async () => {
    const { store, projectId } = await setup();
    await writeFile(store, projectId, 'src/x.ts', 'a', { editor: 'user', createOnly: true });
    await expect(
      writeFile(store, projectId, 'src/x.ts', 'b', { editor: 'user', createOnly: true }),
    ).rejects.toThrow(/already exists/);
  });

  it('detects a concurrent edit through expectedUpdatedAt', async () => {
    const { store, projectId } = await setup();
    const first = await writeFile(store, projectId, 'src/y.ts', 'a', { editor: 'user' });
    // Someone else (Claude) writes in between.
    await writeFile(store, projectId, 'src/y.ts', 'from claude', { editor: 'claude' });

    await expect(
      writeFile(store, projectId, 'src/y.ts', 'stale', {
        editor: 'user',
        expectedUpdatedAt: first.file.updatedAt,
      }),
    ).rejects.toThrow(/changed since you opened it/);
  });

  it('enforces the single-file size limit', async () => {
    const { store, projectId } = await setup();
    const huge = 'x'.repeat(LIMITS.maxFileBytes + 1);
    await expect(
      writeFile(store, projectId, 'src/huge.ts', huge, { editor: 'user' }),
    ).rejects.toThrow(/the limit is/);
  });
});

describe('patching', () => {
  it('applies an exact single-match edit', async () => {
    const { store, projectId } = await setup();
    await writeFile(store, projectId, 'src/p.ts', 'const label = "Book";\n', { editor: 'user' });

    const result = await applyPatch(
      store,
      projectId,
      'src/p.ts',
      [{ find: '"Book"', replace: '"Reserve"' }],
      'claude',
    );
    expect(result.replacements).toBe(1);
    expect((await getFile(store, projectId, 'src/p.ts')).content).toContain('"Reserve"');
  });

  it('refuses an ambiguous edit rather than guessing', async () => {
    const { store, projectId } = await setup();
    await writeFile(store, projectId, 'src/p.ts', 'const a = 1;\nconst b = 2;\n', {
      editor: 'user',
    });
    await expect(
      applyPatch(store, projectId, 'src/p.ts', [{ find: 'const', replace: 'let' }], 'claude'),
    ).rejects.toThrow(/found 2 matches/);
  });

  it('allows an ambiguous edit when replaceAll is explicit', async () => {
    const { store, projectId } = await setup();
    await writeFile(store, projectId, 'src/p.ts', 'const a = 1;\nconst b = 2;\n', {
      editor: 'user',
    });
    const result = await applyPatch(
      store,
      projectId,
      'src/p.ts',
      [{ find: 'const', replace: 'let', replaceAll: true }],
      'claude',
    );
    expect(result.replacements).toBe(2);
  });

  it('reports a miss instead of writing nothing silently', async () => {
    const { store, projectId } = await setup();
    await writeFile(store, projectId, 'src/p.ts', 'hello', { editor: 'user' });
    await expect(
      applyPatch(store, projectId, 'src/p.ts', [{ find: 'goodbye', replace: 'x' }], 'claude'),
    ).rejects.toThrow(/was not found/);
  });
});

describe('rename and delete', () => {
  it('renames and refuses to clobber', async () => {
    const { store, projectId } = await setup();
    await writeFile(store, projectId, 'src/a.ts', 'a', { editor: 'user' });
    await writeFile(store, projectId, 'src/b.ts', 'b', { editor: 'user' });

    const moved = await renameFile(store, projectId, 'src/a.ts', 'src/moved.ts', 'user');
    expect(moved.path).toBe('src/moved.ts');
    await expect(renameFile(store, projectId, 'src/moved.ts', 'src/b.ts', 'user')).rejects.toThrow(
      /already exists/,
    );
  });

  it('soft-deletes so the file can come back', async () => {
    const { store, projectId } = await setup();
    await writeFile(store, projectId, 'src/tmp.ts', 'x', { editor: 'user' });
    await deleteFile(store, projectId, 'src/tmp.ts', 'user');

    expect(await findFile(store, projectId, 'src/tmp.ts')).toBeNull();
    // Still present in storage, marked deleted — which is what makes restore work.
    const raw = await store.find('projectFiles', { match: { projectId, path: 'src/tmp.ts' } });
    expect(raw?.deletedAt).not.toBeNull();
  });
});

describe('search and tree', () => {
  it('finds matches with line and column', async () => {
    const { store, projectId } = await setup();
    await writeFile(store, projectId, 'src/s.ts', 'alpha\nbeta gamma\n', { editor: 'user' });

    const result = await searchCode(store, projectId, { query: 'gamma' });
    const match = result.matches.find((entry) => entry.path === 'src/s.ts');
    expect(match?.line).toBe(2);
    expect(match?.column).toBe(6);
  });

  it('supports regular expressions and rejects invalid ones', async () => {
    const { store, projectId } = await setup();
    await writeFile(store, projectId, 'src/s.ts', 'id_42 id_7', { editor: 'user' });

    const found = await searchCode(store, projectId, { query: 'id_\\d+', regex: true });
    expect(found.matches.length).toBeGreaterThanOrEqual(1);
    await expect(searchCode(store, projectId, { query: '([', regex: true })).rejects.toThrow(
      /Invalid regular expression/,
    );
  });

  it('builds a nested tree with directories first', async () => {
    const { store, projectId } = await setup();
    const tree = buildTree(await listFiles(store, projectId));
    expect(tree.some((node) => node.kind === 'directory' && node.name === 'src')).toBe(true);
    const rootFiles = tree.filter((node) => node.kind === 'file');
    const rootDirs = tree.filter((node) => node.kind === 'directory');
    if (rootDirs.length > 0 && rootFiles.length > 0) {
      expect(tree.indexOf(rootDirs[0]!)).toBeLessThan(tree.indexOf(rootFiles[0]!));
    }
  });
});
