import { badRequest, notFound, tooLarge } from '../core/errors';
import { LIMITS } from '../core/limits';
import { newId } from '../core/ids';
import type {
  EditorKind,
  Id,
  ProjectVersionRow,
  Store,
  VersionFileRow,
} from '../db';
import { fileDiff, unifiedDiff, type FileDiff } from '@/lib/diff';
import { RT, getBus, projectChannel } from '../realtime/bus';
import { languageForPath } from './paths';
import { listFiles } from './files';

/**
 * Snapshots.
 *
 * A version is a full copy of the working tree at a point in time, not a delta.
 * That makes restore, share-a-specific-version and "run V1 and V2 side by side"
 * trivially correct — at the cost of storage, which is the right trade for a
 * design tool. Deltas can be introduced later behind the same API.
 */

export interface VersionSummary {
  id: Id;
  label: string;
  description: string;
  sequence: number;
  authorKind: EditorKind;
  createdBy: Id | null;
  createdAt: string;
  fileCount: number;
  promptRef: string | null;
  parentVersionId: Id | null;
  /** Paths that differ from the parent version. */
  changedPaths: string[];
}

export interface CreateSnapshotInput {
  label?: string;
  description?: string;
  authorKind: EditorKind;
  createdBy: Id | null;
  promptRef?: string | null;
  parentVersionId?: Id | null;
}

export async function createSnapshot(
  store: Store,
  projectId: Id,
  input: CreateSnapshotInput,
): Promise<ProjectVersionRow> {
  const files = await listFiles(store, projectId);
  if (files.length === 0) throw badRequest('There is nothing to snapshot — the project has no files.');

  const existing = await store.count('projectVersions', { match: { projectId } });
  if (existing >= LIMITS.maxVersionsPerProject) {
    throw tooLarge(
      `This project has ${existing} versions; the limit is ${LIMITS.maxVersionsPerProject}. Delete some before creating more.`,
    );
  }

  const previous = await latestVersion(store, projectId);
  const sequence = (previous?.sequence ?? 0) + 1;
  const now = new Date().toISOString();

  const version: ProjectVersionRow = {
    id: newId('ver'),
    projectId,
    label: (input.label ?? `V${sequence}`).slice(0, 80),
    description: (input.description ?? '').slice(0, 600),
    sequence,
    createdBy: input.createdBy,
    authorKind: input.authorKind,
    promptRef: input.promptRef ?? null,
    fileCount: files.length,
    parentVersionId: input.parentVersionId ?? previous?.id ?? null,
    createdAt: now,
  };

  const versionFiles: VersionFileRow[] = files.map((file) => ({
    id: newId('vfl'),
    versionId: version.id,
    projectId,
    path: file.path,
    content: file.content,
    language: file.language,
  }));

  await store.transaction(async (tx) => {
    await tx.insert('projectVersions', version);
    await tx.insertMany('versionFiles', versionFiles);
  });

  getBus().publish(projectChannel(projectId), RT.versionCreated, {
    versionId: version.id,
    label: version.label,
    authorKind: version.authorKind,
    sequence: version.sequence,
  });

  return version;
}

export async function latestVersion(
  store: Store,
  projectId: Id,
): Promise<ProjectVersionRow | null> {
  return store.find('projectVersions', {
    match: { projectId },
    orderBy: [{ col: 'sequence', dir: 'desc' }],
  });
}

export async function listVersions(store: Store, projectId: Id): Promise<VersionSummary[]> {
  const versions = await store.select('projectVersions', {
    match: { projectId },
    orderBy: [{ col: 'sequence', dir: 'desc' }],
  });

  const summaries: VersionSummary[] = [];
  for (const version of versions) {
    const changedPaths = version.parentVersionId
      ? await changedPathsBetween(store, version.parentVersionId, version.id)
      : [];
    summaries.push({
      id: version.id,
      label: version.label,
      description: version.description,
      sequence: version.sequence,
      authorKind: version.authorKind,
      createdBy: version.createdBy,
      createdAt: version.createdAt,
      fileCount: version.fileCount,
      promptRef: version.promptRef,
      parentVersionId: version.parentVersionId,
      changedPaths,
    });
  }
  return summaries;
}

export async function getVersion(
  store: Store,
  projectId: Id,
  versionId: Id,
): Promise<ProjectVersionRow> {
  const version = await store.find('projectVersions', { match: { id: versionId, projectId } });
  if (!version) throw notFound('Version not found.');
  return version;
}

export async function versionFiles(
  store: Store,
  versionId: Id,
): Promise<VersionFileRow[]> {
  return store.select('versionFiles', {
    match: { versionId },
    orderBy: [{ col: 'path' }],
  });
}

export async function renameVersion(
  store: Store,
  projectId: Id,
  versionId: Id,
  patch: { label?: string; description?: string },
): Promise<ProjectVersionRow> {
  await getVersion(store, projectId, versionId);
  const updated = await store.update('projectVersions', versionId, {
    ...(patch.label !== undefined ? { label: patch.label.slice(0, 80) } : {}),
    ...(patch.description !== undefined ? { description: patch.description.slice(0, 600) } : {}),
  });
  getBus().publish(projectChannel(projectId), RT.versionCreated, {
    versionId,
    label: updated.label,
    renamed: true,
  });
  return updated;
}

/**
 * Restores a version into the working tree.
 *
 * Takes a safety snapshot of the current state first, so a restore is itself
 * undoable — nothing a user or Claude does here can lose work.
 */
export async function restoreVersion(
  store: Store,
  projectId: Id,
  versionId: Id,
  editor: EditorKind,
  actorId: Id | null,
): Promise<{ restored: ProjectVersionRow; safetySnapshot: ProjectVersionRow; filesWritten: number }> {
  const version = await getVersion(store, projectId, versionId);

  const safetySnapshot = await createSnapshot(store, projectId, {
    label: `Before restoring ${version.label}`,
    description: `Automatic snapshot taken before restoring "${version.label}".`,
    authorKind: 'system',
    createdBy: actorId,
  });

  const snapshotFiles = await versionFiles(store, versionId);
  const now = new Date().toISOString();

  await store.transaction(async (tx) => {
    const current = await tx.select('projectFiles', { match: { projectId } });
    const byPath = new Map(current.map((file) => [file.path, file]));
    const keep = new Set(snapshotFiles.map((file) => file.path));

    for (const file of snapshotFiles) {
      const existing = byPath.get(file.path);
      if (existing) {
        await tx.update('projectFiles', existing.id, {
          content: file.content,
          size: Buffer.byteLength(file.content, 'utf8'),
          language: file.language,
          lastEditedBy: editor,
          lastEditedAt: now,
          updatedAt: now,
          deletedAt: null,
        });
      } else {
        await tx.insert('projectFiles', {
          id: newId('fil'),
          projectId,
          path: file.path,
          content: file.content,
          size: Buffer.byteLength(file.content, 'utf8'),
          language: file.language || languageForPath(file.path),
          lastEditedBy: editor,
          lastEditedAt: now,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
      }
    }

    // Files that did not exist in the snapshot are soft-deleted, not dropped.
    for (const file of current) {
      if (!keep.has(file.path) && file.deletedAt === null) {
        await tx.update('projectFiles', file.id, {
          deletedAt: now,
          updatedAt: now,
          lastEditedBy: editor,
          lastEditedAt: now,
        });
      }
    }

    await tx.update('projects', projectId, { updatedAt: now });
  });

  const bus = getBus();
  bus.publish(projectChannel(projectId), RT.versionRestored, {
    versionId,
    label: version.label,
    safetySnapshotId: safetySnapshot.id,
  });
  bus.publish(projectChannel(projectId), RT.treeChanged, { reason: 'restore' });

  return { restored: version, safetySnapshot, filesWritten: snapshotFiles.length };
}

export async function duplicateVersion(
  store: Store,
  projectId: Id,
  versionId: Id,
  label: string,
  actorId: Id | null,
  authorKind: EditorKind,
): Promise<ProjectVersionRow> {
  const source = await getVersion(store, projectId, versionId);
  const files = await versionFiles(store, versionId);
  const previous = await latestVersion(store, projectId);
  const sequence = (previous?.sequence ?? 0) + 1;
  const now = new Date().toISOString();

  const copy: ProjectVersionRow = {
    id: newId('ver'),
    projectId,
    label: label.slice(0, 80) || `${source.label} (copy)`,
    description: `Duplicated from "${source.label}".`,
    sequence,
    createdBy: actorId,
    authorKind,
    promptRef: source.promptRef,
    fileCount: files.length,
    parentVersionId: source.id,
    createdAt: now,
  };

  await store.transaction(async (tx) => {
    await tx.insert('projectVersions', copy);
    await tx.insertMany(
      'versionFiles',
      files.map((file) => ({ ...file, id: newId('vfl'), versionId: copy.id })),
    );
  });

  getBus().publish(projectChannel(projectId), RT.versionCreated, {
    versionId: copy.id,
    label: copy.label,
    authorKind,
    sequence,
  });
  return copy;
}

/* -------------------------------------------------------------------------- */
/* Comparison                                                                  */
/* -------------------------------------------------------------------------- */

export type ChangeStatus = 'added' | 'removed' | 'modified';

export interface FileChange {
  path: string;
  status: ChangeStatus;
  additions: number;
  deletions: number;
}

export interface VersionComparison {
  base: { id: Id; label: string; sequence: number } | { id: 'working'; label: string; sequence: null };
  target: { id: Id; label: string; sequence: number } | { id: 'working'; label: string; sequence: null };
  changes: FileChange[];
  totals: { added: number; removed: number; modified: number; additions: number; deletions: number };
}

/** `'working'` compares against the live tree, which is what the studio shows. */
export type VersionRef = Id | 'working';

async function filesFor(
  store: Store,
  projectId: Id,
  ref: VersionRef,
): Promise<Map<string, string>> {
  if (ref === 'working') {
    const files = await listFiles(store, projectId);
    return new Map(files.map((file) => [file.path, file.content]));
  }
  const files = await versionFiles(store, ref);
  return new Map(files.map((file) => [file.path, file.content]));
}

async function refLabel(
  store: Store,
  projectId: Id,
  ref: VersionRef,
): Promise<VersionComparison['base']> {
  if (ref === 'working') return { id: 'working', label: 'Working tree', sequence: null };
  const version = await getVersion(store, projectId, ref);
  return { id: version.id, label: version.label, sequence: version.sequence };
}

export async function compareVersions(
  store: Store,
  projectId: Id,
  baseRef: VersionRef,
  targetRef: VersionRef,
): Promise<VersionComparison> {
  const [baseFiles, targetFiles] = await Promise.all([
    filesFor(store, projectId, baseRef),
    filesFor(store, projectId, targetRef),
  ]);

  const paths = [...new Set([...baseFiles.keys(), ...targetFiles.keys()])].sort();
  const changes: FileChange[] = [];
  let additions = 0;
  let deletions = 0;

  for (const path of paths) {
    const before = baseFiles.get(path);
    const after = targetFiles.get(path);
    if (before === after) continue;

    if (before === undefined && after !== undefined) {
      const lines = after === '' ? 0 : after.split('\n').length;
      changes.push({ path, status: 'added', additions: lines, deletions: 0 });
      additions += lines;
      continue;
    }
    if (after === undefined && before !== undefined) {
      const lines = before === '' ? 0 : before.split('\n').length;
      changes.push({ path, status: 'removed', additions: 0, deletions: lines });
      deletions += lines;
      continue;
    }
    const diff = fileDiff(before ?? '', after ?? '', 0);
    changes.push({
      path,
      status: 'modified',
      additions: diff.additions,
      deletions: diff.deletions,
    });
    additions += diff.additions;
    deletions += diff.deletions;
  }

  return {
    base: await refLabel(store, projectId, baseRef),
    target: await refLabel(store, projectId, targetRef),
    changes,
    totals: {
      added: changes.filter((change) => change.status === 'added').length,
      removed: changes.filter((change) => change.status === 'removed').length,
      modified: changes.filter((change) => change.status === 'modified').length,
      additions,
      deletions,
    },
  };
}

export async function changedPathsBetween(
  store: Store,
  baseRef: VersionRef,
  targetRef: VersionRef,
): Promise<string[]> {
  const [base, target] = await Promise.all([
    baseRef === 'working' ? new Map<string, string>() : filesForVersion(store, baseRef),
    targetRef === 'working' ? new Map<string, string>() : filesForVersion(store, targetRef),
  ]);
  const paths = new Set([...base.keys(), ...target.keys()]);
  return [...paths].filter((path) => base.get(path) !== target.get(path)).sort();
}

async function filesForVersion(store: Store, versionId: Id): Promise<Map<string, string>> {
  const files = await versionFiles(store, versionId);
  return new Map(files.map((file) => [file.path, file.content]));
}

/** Per-file diff detail, used by the code panel's diff view and MCP. */
export async function diffFileBetween(
  store: Store,
  projectId: Id,
  baseRef: VersionRef,
  targetRef: VersionRef,
  path: string,
): Promise<{ path: string; before: string | null; after: string | null; diff: FileDiff; unified: string }> {
  const [baseFiles, targetFiles] = await Promise.all([
    filesFor(store, projectId, baseRef),
    filesFor(store, projectId, targetRef),
  ]);
  const before = baseFiles.get(path) ?? null;
  const after = targetFiles.get(path) ?? null;
  if (before === null && after === null) throw notFound(`"${path}" is in neither version.`);
  return {
    path,
    before,
    after,
    diff: fileDiff(before ?? '', after ?? ''),
    unified: unifiedDiff(path, before ?? '', after ?? ''),
  };
}
