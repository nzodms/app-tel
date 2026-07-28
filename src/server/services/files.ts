import { badRequest, conflict, notFound, tooLarge } from '../core/errors';
import { LIMITS, byteLength } from '../core/limits';
import { newId } from '../core/ids';
import type { EditorKind, Id, ProjectFileRow, Store } from '../db';
import { RT, getBus, projectChannel } from '../realtime/bus';
import { languageForPath, normalizeProjectPath } from './paths';

/**
 * The project working tree.
 *
 * Every mutation goes through here — the REST routes, the editor and the MCP
 * write tools all share this code, so limits, path validation, `lastEditedBy`
 * bookkeeping and realtime notifications can never diverge between them.
 */

export interface FileSummary {
  id: Id;
  path: string;
  size: number;
  language: string;
  lastEditedBy: EditorKind;
  lastEditedAt: string;
  updatedAt: string;
}

export function toSummary(row: ProjectFileRow): FileSummary {
  return {
    id: row.id,
    path: row.path,
    size: row.size,
    language: row.language,
    lastEditedBy: row.lastEditedBy,
    lastEditedAt: row.lastEditedAt,
    updatedAt: row.updatedAt,
  };
}

export async function listFiles(store: Store, projectId: Id): Promise<ProjectFileRow[]> {
  const rows = await store.select('projectFiles', {
    match: { projectId },
    where: [{ col: 'deletedAt', op: 'isNull' }],
    orderBy: [{ col: 'path' }],
  });
  return rows;
}

export async function getFile(
  store: Store,
  projectId: Id,
  path: string,
): Promise<ProjectFileRow> {
  const normalized = normalizeProjectPath(path);
  const row = await store.find('projectFiles', {
    match: { projectId, path: normalized },
    where: [{ col: 'deletedAt', op: 'isNull' }],
  });
  if (!row) throw notFound(`No file at "${normalized}".`);
  return row;
}

export async function findFile(
  store: Store,
  projectId: Id,
  path: string,
): Promise<ProjectFileRow | null> {
  return store.find('projectFiles', {
    match: { projectId, path: normalizeProjectPath(path) },
    where: [{ col: 'deletedAt', op: 'isNull' }],
  });
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export interface WriteOptions {
  editor: EditorKind;
  /** Fail instead of overwriting when the file already exists. */
  createOnly?: boolean;
  /**
   * Optimistic concurrency: when provided, the write is rejected if the file has
   * changed since this timestamp. Used by the editor to avoid clobbering a change
   * Claude made while the tab was open.
   */
  expectedUpdatedAt?: string;
}

export interface WriteResult {
  file: ProjectFileRow;
  created: boolean;
  previousContent: string | null;
}

export async function writeFile(
  store: Store,
  projectId: Id,
  path: string,
  content: string,
  options: WriteOptions,
): Promise<WriteResult> {
  const normalized = normalizeProjectPath(path);
  const size = byteLength(content);

  if (size > LIMITS.maxFileBytes) {
    throw tooLarge(
      `"${normalized}" is ${formatBytes(size)}; the limit is ${formatBytes(LIMITS.maxFileBytes)}.`,
      { path: normalized, size, limit: LIMITS.maxFileBytes },
    );
  }

  const result = await store.transaction(async (tx) => {
    const existing = await tx.find('projectFiles', {
      match: { projectId, path: normalized },
    });
    const now = new Date().toISOString();

    if (existing && existing.deletedAt === null) {
      if (options.createOnly) {
        throw conflict(`"${normalized}" already exists.`, { path: normalized });
      }
      if (options.expectedUpdatedAt && existing.updatedAt !== options.expectedUpdatedAt) {
        throw conflict(
          `"${normalized}" changed since you opened it (last edited by ${existing.lastEditedBy}). Reload the file and re-apply your change.`,
          { path: normalized, currentUpdatedAt: existing.updatedAt },
        );
      }

      const updated = await tx.update('projectFiles', existing.id, {
        content,
        size,
        language: languageForPath(normalized),
        lastEditedBy: options.editor,
        lastEditedAt: now,
        updatedAt: now,
      });
      return { file: updated, created: false, previousContent: existing.content };
    }

    // New file (or resurrecting a soft-deleted one): enforce project-level budgets.
    await assertProjectCapacity(tx, projectId, size, existing?.id ?? null);

    if (existing) {
      const restored = await tx.update('projectFiles', existing.id, {
        content,
        size,
        language: languageForPath(normalized),
        lastEditedBy: options.editor,
        lastEditedAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      return { file: restored, created: true, previousContent: null };
    }

    const row: ProjectFileRow = {
      id: newId('fil'),
      projectId,
      path: normalized,
      content,
      size,
      language: languageForPath(normalized),
      lastEditedBy: options.editor,
      lastEditedAt: now,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await tx.insert('projectFiles', row);
    return { file: row, created: true, previousContent: null };
  });

  await touchProject(store, projectId);
  const bus = getBus();
  bus.publish(projectChannel(projectId), result.created ? RT.fileCreated : RT.fileChanged, {
    path: normalized,
    editor: options.editor,
    file: toSummary(result.file),
  });
  if (result.created) bus.publish(projectChannel(projectId), RT.treeChanged, { path: normalized });

  return result;
}

/**
 * Applies a literal search/replace patch.
 *
 * Deliberately *not* a fuzzy matcher: `find` must appear exactly once unless
 * `replaceAll` is set. That makes MCP edits precise and reviewable — Claude never
 * has to resend a whole file to change one component, and an ambiguous patch is
 * an error rather than a guess.
 */
export interface PatchEdit {
  find: string;
  replace: string;
  replaceAll?: boolean;
}

export interface PatchResult {
  file: ProjectFileRow;
  appliedEdits: number;
  replacements: number;
}

export async function applyPatch(
  store: Store,
  projectId: Id,
  path: string,
  edits: readonly PatchEdit[],
  editor: EditorKind,
): Promise<PatchResult> {
  if (edits.length === 0) throw badRequest('Provide at least one edit.');

  const current = await getFile(store, projectId, path);
  let content = current.content;
  let replacements = 0;

  for (const [index, edit] of edits.entries()) {
    if (edit.find === '') {
      throw badRequest(`Edit ${index + 1}: "find" cannot be empty.`);
    }
    const occurrences = countOccurrences(content, edit.find);
    if (occurrences === 0) {
      throw badRequest(
        `Edit ${index + 1}: the text to replace was not found in "${current.path}". ` +
          'Read the file again and patch against its current contents.',
        { path: current.path, editIndex: index },
      );
    }
    if (occurrences > 1 && !edit.replaceAll) {
      throw conflict(
        `Edit ${index + 1}: found ${occurrences} matches in "${current.path}". ` +
          'Include more surrounding context to make it unique, or set replaceAll.',
        { path: current.path, editIndex: index, occurrences },
      );
    }
    content = edit.replaceAll
      ? content.split(edit.find).join(edit.replace)
      : content.replace(edit.find, edit.replace);
    replacements += edit.replaceAll ? occurrences : 1;
  }

  const written = await writeFile(store, projectId, current.path, content, { editor });
  return { file: written.file, appliedEdits: edits.length, replacements };
}

export async function renameFile(
  store: Store,
  projectId: Id,
  from: string,
  to: string,
  editor: EditorKind,
): Promise<ProjectFileRow> {
  const source = await getFile(store, projectId, from);
  const target = normalizeProjectPath(to);
  if (target === source.path) return source;

  const clash = await findFile(store, projectId, target);
  if (clash) throw conflict(`"${target}" already exists.`, { path: target });

  const now = new Date().toISOString();
  const updated = await store.update('projectFiles', source.id, {
    path: target,
    language: languageForPath(target),
    lastEditedBy: editor,
    lastEditedAt: now,
    updatedAt: now,
  });

  await touchProject(store, projectId);
  const bus = getBus();
  bus.publish(projectChannel(projectId), RT.treeChanged, { from: source.path, to: target });
  bus.publish(projectChannel(projectId), RT.fileChanged, {
    path: target,
    editor,
    file: toSummary(updated),
  });
  return updated;
}

/**
 * Soft delete. The row is kept so a version restore or an `undo` can bring it
 * back — which is why `delete_file` over MCP is recoverable rather than final.
 */
export async function deleteFile(
  store: Store,
  projectId: Id,
  path: string,
  editor: EditorKind,
): Promise<{ path: string }> {
  const file = await getFile(store, projectId, path);
  const now = new Date().toISOString();
  await store.update('projectFiles', file.id, {
    deletedAt: now,
    updatedAt: now,
    lastEditedBy: editor,
    lastEditedAt: now,
  });

  await touchProject(store, projectId);
  const bus = getBus();
  bus.publish(projectChannel(projectId), RT.fileDeleted, { path: file.path, editor });
  bus.publish(projectChannel(projectId), RT.treeChanged, { path: file.path });
  return { path: file.path };
}

/* -------------------------------------------------------------------------- */
/* Search                                                                      */
/* -------------------------------------------------------------------------- */

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  text: string;
}

export interface SearchOptions {
  query: string;
  /** Substring filter on the file path, e.g. `screens/`. */
  pathFilter?: string;
  caseSensitive?: boolean;
  regex?: boolean;
  maxResults?: number;
}

export async function searchCode(
  store: Store,
  projectId: Id,
  options: SearchOptions,
): Promise<{ matches: SearchMatch[]; truncated: boolean; filesSearched: number }> {
  const query = options.query;
  if (query.trim() === '') throw badRequest('Provide something to search for.');

  const limit = Math.min(Math.max(options.maxResults ?? 100, 1), 500);
  const files = await listFiles(store, projectId);
  const candidates = options.pathFilter
    ? files.filter((file) => file.path.toLowerCase().includes(options.pathFilter!.toLowerCase()))
    : files;

  let pattern: RegExp;
  try {
    pattern = options.regex
      ? new RegExp(query, options.caseSensitive ? 'g' : 'gi')
      : new RegExp(escapeRegExp(query), options.caseSensitive ? 'g' : 'gi');
  } catch (error) {
    throw badRequest(
      `Invalid regular expression: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  const matches: SearchMatch[] = [];
  let truncated = false;

  for (const file of candidates) {
    const lines = file.content.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      pattern.lastIndex = 0;
      let match = pattern.exec(line);
      while (match) {
        if (matches.length >= limit) {
          truncated = true;
          break;
        }
        matches.push({
          path: file.path,
          line: index + 1,
          column: match.index + 1,
          text: line.length > 400 ? `${line.slice(0, 400)}…` : line,
        });
        if (match[0] === '') break;
        match = pattern.exec(line);
      }
      if (truncated) break;
    }
    if (truncated) break;
  }

  return { matches, truncated, filesSearched: candidates.length };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

async function assertProjectCapacity(
  store: Store,
  projectId: Id,
  incomingBytes: number,
  ignoreFileId: Id | null,
): Promise<void> {
  const files = await store.select('projectFiles', {
    match: { projectId },
    where: [{ col: 'deletedAt', op: 'isNull' }],
  });
  const live = files.filter((file) => file.id !== ignoreFileId);

  if (live.length + 1 > LIMITS.maxFilesPerProject) {
    throw tooLarge(
      `This project already has ${live.length} files; the limit is ${LIMITS.maxFilesPerProject}.`,
    );
  }
  const total = live.reduce((sum, file) => sum + file.size, 0) + incomingBytes;
  if (total > LIMITS.maxProjectBytes) {
    throw tooLarge(
      `That write would take the project to ${formatBytes(total)}; the limit is ${formatBytes(LIMITS.maxProjectBytes)}.`,
    );
  }
}

async function touchProject(store: Store, projectId: Id): Promise<void> {
  await store
    .update('projects', projectId, { updatedAt: new Date().toISOString() })
    .catch(() => undefined);
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* -------------------------------------------------------------------------- */
/* File tree (for the Files panel and MCP `list_files`)                        */
/* -------------------------------------------------------------------------- */

export interface TreeNode {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  children?: TreeNode[];
  size?: number;
  language?: string;
  lastEditedBy?: EditorKind;
  lastEditedAt?: string;
}

export function buildTree(files: readonly ProjectFileRow[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', kind: 'directory', children: [] };

  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const segments = file.path.split('/');
    let cursor = root;
    for (let index = 0; index < segments.length; index += 1) {
      const name = segments[index] as string;
      const isLeaf = index === segments.length - 1;
      const path = segments.slice(0, index + 1).join('/');

      if (isLeaf) {
        cursor.children?.push({
          name,
          path,
          kind: 'file',
          size: file.size,
          language: file.language,
          lastEditedBy: file.lastEditedBy,
          lastEditedAt: file.lastEditedAt,
        });
        continue;
      }

      let next = cursor.children?.find(
        (child) => child.kind === 'directory' && child.name === name,
      );
      if (!next) {
        next = { name, path, kind: 'directory', children: [] };
        cursor.children?.push(next);
      }
      cursor = next;
    }
  }

  sortTree(root);
  return root.children ?? [];
}

function sortTree(node: TreeNode): void {
  if (!node.children) return;
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) sortTree(child);
}
