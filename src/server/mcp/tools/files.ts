import { z } from 'zod';
import { LIMITS } from '../../core/limits';
import { requireProjectAccess } from '../../services/access';
import {
  applyPatch,
  buildTree,
  deleteFile,
  formatBytes,
  getFile,
  listFiles,
  renameFile,
  searchCode,
  writeFile,
} from '../../services/files';
import { logEvent } from '../../services/events';
import { unifiedDiff } from '@/lib/diff';
import { defineTool, outcome } from '../types';

const projectIdSchema = z.string().min(1).describe('PhoneLab project id.');
const pathSchema = z
  .string()
  .min(1)
  .max(LIMITS.maxPathLength)
  .describe('Project-relative POSIX path, e.g. src/player/screens/Courts.tsx.');

/** Keeps a single tool response from blowing past a sensible context budget. */
function clip(content: string): { text: string; truncated: boolean } {
  if (Buffer.byteLength(content, 'utf8') <= LIMITS.maxMcpReadBytes) {
    return { text: content, truncated: false };
  }
  return {
    text: `${content.slice(0, LIMITS.maxMcpReadBytes)}\n…[truncated: file is ${formatBytes(Buffer.byteLength(content, 'utf8'))}]`,
    truncated: true,
  };
}

export const fileTools = [
  defineTool({
    name: 'list_files',
    title: 'List files',
    description:
      'Lists the project working tree. Returns a flat list with sizes and who last edited each file, plus a nested tree.',
    group: 'files',
    capability: 'read',
    annotations: { readOnlyHint: true, idempotentHint: true },
    input: z
      .object({
        projectId: projectIdSchema,
        pathPrefix: z.string().max(240).optional().describe('Only paths starting with this prefix.'),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'read');
      const all = await listFiles(store, input.projectId);
      const files = input.pathPrefix
        ? all.filter((file) => file.path.startsWith(input.pathPrefix as string))
        : all;

      const lines = files.map(
        (file) =>
          `${file.path} · ${formatBytes(file.size)}${file.lastEditedBy === 'claude' ? ' · last edited by Claude' : ''}`,
      );
      return outcome(
        files.length === 0 ? 'No files matched.' : `${files.length} file(s):\n${lines.join('\n')}`,
        {
          files: files.map((file) => ({
            path: file.path,
            size: file.size,
            language: file.language,
            lastEditedBy: file.lastEditedBy,
            lastEditedAt: file.lastEditedAt,
          })),
          tree: buildTree(files),
        },
      );
    },
  }),

  defineTool({
    name: 'read_file',
    title: 'Read file',
    description:
      'Reads one file. Returns its contents plus `updatedAt`, which you can pass to write_file as `expectedUpdatedAt` to avoid overwriting a concurrent edit.',
    group: 'files',
    capability: 'read',
    annotations: { readOnlyHint: true, idempotentHint: true },
    input: z
      .object({
        projectId: projectIdSchema,
        path: pathSchema,
        startLine: z.number().int().min(1).optional().describe('1-based first line to return.'),
        endLine: z.number().int().min(1).optional().describe('1-based last line to return, inclusive.'),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'read');
      const file = await getFile(store, input.projectId, input.path);

      let content = file.content;
      let range: { startLine: number; endLine: number } | null = null;
      if (input.startLine || input.endLine) {
        const lines = content.split('\n');
        const start = (input.startLine ?? 1) - 1;
        const end = input.endLine ?? lines.length;
        content = lines.slice(start, end).join('\n');
        range = { startLine: start + 1, endLine: Math.min(end, lines.length) };
      }

      const clipped = clip(content);
      return outcome(`${file.path}${range ? ` (lines ${range.startLine}-${range.endLine})` : ''}:\n\n${clipped.text}`, {
        path: file.path,
        content: clipped.text,
        truncated: clipped.truncated,
        language: file.language,
        size: file.size,
        updatedAt: file.updatedAt,
        lastEditedBy: file.lastEditedBy,
        ...(range ? { range } : {}),
      });
    },
  }),

  defineTool({
    name: 'read_files',
    title: 'Read several files',
    description:
      'Reads up to 20 files in one call. Prefer this over repeated read_file when orienting yourself in a project.',
    group: 'files',
    capability: 'read',
    annotations: { readOnlyHint: true, idempotentHint: true },
    input: z
      .object({
        projectId: projectIdSchema,
        paths: z.array(pathSchema).min(1).max(20),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'read');

      const results: {
        path: string;
        content?: string;
        updatedAt?: string;
        truncated?: boolean;
        error?: string;
      }[] = [];
      const parts: string[] = [];
      let budget = LIMITS.maxMcpReadBytes;

      for (const path of input.paths) {
        try {
          const file = await getFile(store, input.projectId, path);
          if (budget <= 0) {
            results.push({ path, error: 'skipped: response size budget reached' });
            continue;
          }
          const allowed = file.content.slice(0, budget);
          const truncated = allowed.length < file.content.length;
          budget -= Buffer.byteLength(allowed, 'utf8');
          results.push({ path: file.path, content: allowed, updatedAt: file.updatedAt, truncated });
          parts.push(`----- ${file.path} -----\n${allowed}${truncated ? '\n…[truncated]' : ''}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'could not be read';
          results.push({ path, error: message });
          parts.push(`----- ${path} -----\n[${message}]`);
        }
      }

      return outcome(parts.join('\n\n'), { files: results });
    },
  }),

  defineTool({
    name: 'search_code',
    title: 'Search code',
    description:
      'Searches file contents across the project. Use this to locate the component or string you need before patching.',
    group: 'files',
    capability: 'read',
    annotations: { readOnlyHint: true, idempotentHint: true },
    input: z
      .object({
        projectId: projectIdSchema,
        query: z.string().min(1).max(400).describe('Text, or a regular expression when regex=true.'),
        pathFilter: z.string().max(200).optional().describe('Only search paths containing this text.'),
        regex: z.boolean().optional().describe('Treat query as a JavaScript regular expression.'),
        caseSensitive: z.boolean().optional(),
        maxResults: z.number().int().min(1).max(500).optional().describe('Defaults to 100.'),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'read');
      const { projectId, ...options } = input;
      const result = await searchCode(store, projectId, options);

      if (result.matches.length === 0) {
        return outcome(
          `No matches for "${input.query}" across ${result.filesSearched} file(s).`,
          { matches: [], filesSearched: result.filesSearched },
        );
      }
      const lines = result.matches.map(
        (match) => `${match.path}:${match.line}:${match.column}  ${match.text.trim()}`,
      );
      return outcome(
        `${result.matches.length} match(es)${result.truncated ? ' (truncated)' : ''}:\n${lines.join('\n')}`,
        { matches: result.matches, truncated: result.truncated, filesSearched: result.filesSearched },
      );
    },
  }),

  defineTool({
    name: 'apply_patch',
    title: 'Patch a file',
    description:
      'The preferred way to change code: applies exact find/replace edits to one file. Each `find` must match exactly once unless replaceAll is set, so an ambiguous edit fails loudly instead of guessing. You never need to resend a whole file to change a component.',
    group: 'files',
    capability: 'write',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    input: z
      .object({
        projectId: projectIdSchema,
        path: pathSchema,
        edits: z
          .array(
            z.object({
              find: z.string().min(1).describe('Exact text to find, including indentation.'),
              replace: z.string().describe('Replacement text. Empty string deletes the match.'),
              replaceAll: z.boolean().optional().describe('Replace every occurrence instead of requiring exactly one.'),
            }),
          )
          .min(1)
          .max(30),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'write');
      const before = await getFile(store, input.projectId, input.path);
      const result = await applyPatch(store, input.projectId, input.path, input.edits, 'claude');

      await logEvent(store, input.projectId, {
        kind: 'mcp',
        name: `Claude patched ${result.file.path}`,
        payload: { path: result.file.path, edits: result.appliedEdits, replacements: result.replacements },
      });

      return outcome(
        `Applied ${result.appliedEdits} edit(s) to ${result.file.path} (${result.replacements} replacement(s)).\n\n${unifiedDiff(result.file.path, before.content, result.file.content)}`,
        {
          path: result.file.path,
          appliedEdits: result.appliedEdits,
          replacements: result.replacements,
          size: result.file.size,
          updatedAt: result.file.updatedAt,
          diff: unifiedDiff(result.file.path, before.content, result.file.content),
        },
      );
    },
  }),

  defineTool({
    name: 'write_file',
    title: 'Write file',
    description:
      'Replaces a file’s entire contents, creating it if needed. Prefer apply_patch for edits to existing files; use this for new files or full rewrites.',
    group: 'files',
    capability: 'write',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    input: z
      .object({
        projectId: projectIdSchema,
        path: pathSchema,
        content: z.string().max(LIMITS.maxFileBytes).describe('The complete new contents.'),
        expectedUpdatedAt: z
          .string()
          .optional()
          .describe('The `updatedAt` you last read. The write is rejected if the file changed since.'),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'write');
      const result = await writeFile(store, input.projectId, input.path, input.content, {
        editor: 'claude',
        ...(input.expectedUpdatedAt ? { expectedUpdatedAt: input.expectedUpdatedAt } : {}),
      });

      await logEvent(store, input.projectId, {
        kind: 'mcp',
        name: `Claude ${result.created ? 'created' : 'rewrote'} ${result.file.path}`,
        payload: { path: result.file.path, created: result.created, size: result.file.size },
      });

      const diff =
        result.previousContent === null
          ? null
          : unifiedDiff(result.file.path, result.previousContent, result.file.content);

      return outcome(
        `${result.created ? 'Created' : 'Updated'} ${result.file.path} (${formatBytes(result.file.size)}).${diff ? `\n\n${diff}` : ''}`,
        {
          path: result.file.path,
          created: result.created,
          size: result.file.size,
          updatedAt: result.file.updatedAt,
          ...(diff ? { diff } : {}),
        },
      );
    },
  }),

  defineTool({
    name: 'create_file',
    title: 'Create file',
    description: 'Creates a new file. Fails if the path already exists, so it can never clobber work.',
    group: 'files',
    capability: 'write',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    input: z
      .object({
        projectId: projectIdSchema,
        path: pathSchema,
        content: z.string().max(LIMITS.maxFileBytes),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'write');
      const result = await writeFile(store, input.projectId, input.path, input.content, {
        editor: 'claude',
        createOnly: true,
      });
      await logEvent(store, input.projectId, {
        kind: 'mcp',
        name: `Claude created ${result.file.path}`,
        payload: { path: result.file.path, size: result.file.size },
      });
      return outcome(`Created ${result.file.path} (${formatBytes(result.file.size)}).`, {
        path: result.file.path,
        size: result.file.size,
        updatedAt: result.file.updatedAt,
      });
    },
  }),

  defineTool({
    name: 'rename_file',
    title: 'Rename or move file',
    description:
      'Moves a file to a new path. Import statements are not rewritten — search_code for the old path and patch the references.',
    group: 'files',
    capability: 'write',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    input: z
      .object({
        projectId: projectIdSchema,
        from: pathSchema,
        to: pathSchema,
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'write');
      const file = await renameFile(store, input.projectId, input.from, input.to, 'claude');
      await logEvent(store, input.projectId, {
        kind: 'mcp',
        name: `Claude renamed ${input.from} → ${file.path}`,
        payload: { from: input.from, to: file.path },
      });
      return outcome(
        `Renamed ${input.from} → ${file.path}. Imports were not updated automatically.`,
        { from: input.from, to: file.path },
      );
    },
  }),

  defineTool({
    name: 'delete_file',
    title: 'Delete file',
    description:
      'Deletes a file. The delete is recoverable: the file is retained internally and any version snapshot can restore it. Requires confirm=true.',
    group: 'files',
    capability: 'write',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    destructive: true,
    input: z
      .object({
        projectId: projectIdSchema,
        path: pathSchema,
        confirm: z.boolean().default(false).describe('Must be true to delete.'),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'write');
      const result = await deleteFile(store, input.projectId, input.path, 'claude');
      await logEvent(store, input.projectId, {
        kind: 'mcp',
        level: 'warn',
        name: `Claude deleted ${result.path}`,
        payload: { path: result.path },
      });
      return outcome(
        `Deleted ${result.path}. Restore it with restore_version if that was a mistake.`,
        { path: result.path, recoverable: true },
      );
    },
  }),
];
