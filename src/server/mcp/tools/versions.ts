import { z } from 'zod';
import { requireProjectAccess } from '../../services/access';
import {
  compareVersions,
  createSnapshot,
  diffFileBetween,
  duplicateVersion,
  getVersion,
  listVersions,
  renameVersion,
  restoreVersion,
  versionFiles,
  type VersionRef,
} from '../../services/versions';
import { logEvent } from '../../services/events';
import { defineTool, outcome } from '../types';

const projectIdSchema = z.string().min(1).describe('PhoneLab project id.');
const refSchema = z
  .string()
  .min(1)
  .describe('A version id, or "working" for the live working tree.');

function toRef(value: string): VersionRef {
  return value === 'working' ? 'working' : value;
}

export const versionTools = [
  defineTool({
    name: 'create_snapshot',
    title: 'Create version snapshot',
    description:
      'Snapshots the current working tree as a named version. Do this after finishing a change so it can be compared, shared and restored. Snapshots are full copies, so restoring one is exact.',
    group: 'versions',
    capability: 'write',
    annotations: { readOnlyHint: false, idempotentHint: false },
    input: z
      .object({
        projectId: projectIdSchema,
        label: z.string().trim().max(80).optional().describe('Short name, e.g. "V3 · shared payment".'),
        description: z.string().trim().max(600).optional().describe('What changed and why.'),
        promptRef: z
          .string()
          .trim()
          .max(400)
          .optional()
          .describe('The request that produced this change, for the version history.'),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'write');
      const version = await createSnapshot(store, input.projectId, {
        authorKind: 'claude',
        createdBy: actor.userId,
        ...(input.label ? { label: input.label } : {}),
        ...(input.description ? { description: input.description } : {}),
        ...(input.promptRef ? { promptRef: input.promptRef } : {}),
      });
      await logEvent(store, input.projectId, {
        kind: 'mcp',
        name: `Claude created version "${version.label}"`,
        payload: { versionId: version.id, files: version.fileCount },
      });
      return outcome(
        `Created "${version.label}" (${version.id}) with ${version.fileCount} files.`,
        {
          versionId: version.id,
          label: version.label,
          sequence: version.sequence,
          fileCount: version.fileCount,
        },
      );
    },
  }),

  defineTool({
    name: 'list_versions',
    title: 'List versions',
    description: 'Version history, newest first, with author, description and the paths each version changed.',
    group: 'versions',
    capability: 'read',
    annotations: { readOnlyHint: true, idempotentHint: true },
    input: z.object({ projectId: projectIdSchema }).strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'read');
      const versions = await listVersions(store, input.projectId);
      const lines = versions.map(
        (version) =>
          `- ${version.label} (${version.id}) · #${version.sequence} · by ${version.authorKind} · ${version.createdAt}` +
          `${version.changedPaths.length > 0 ? ` · changed: ${version.changedPaths.slice(0, 6).join(', ')}${version.changedPaths.length > 6 ? '…' : ''}` : ''}`,
      );
      return outcome(
        versions.length === 0 ? 'No versions yet.' : `${versions.length} version(s):\n${lines.join('\n')}`,
        { versions },
      );
    },
  }),

  defineTool({
    name: 'get_version',
    title: 'Get version',
    description: 'Metadata for one version and the list of files it contains.',
    group: 'versions',
    capability: 'read',
    annotations: { readOnlyHint: true, idempotentHint: true },
    input: z.object({ projectId: projectIdSchema, versionId: z.string().min(1) }).strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'read');
      const version = await getVersion(store, input.projectId, input.versionId);
      const files = await versionFiles(store, input.versionId);
      return outcome(
        `${version.label} (#${version.sequence}) · ${files.length} files · ${version.description || 'no description'}`,
        {
          version: {
            id: version.id,
            label: version.label,
            description: version.description,
            sequence: version.sequence,
            authorKind: version.authorKind,
            promptRef: version.promptRef,
            createdAt: version.createdAt,
          },
          files: files.map((file) => ({ path: file.path, bytes: file.content.length })),
        },
      );
    },
  }),

  defineTool({
    name: 'rename_version',
    title: 'Rename version',
    description: 'Changes a version’s label or description.',
    group: 'versions',
    capability: 'write',
    annotations: { readOnlyHint: false, idempotentHint: true },
    input: z
      .object({
        projectId: projectIdSchema,
        versionId: z.string().min(1),
        label: z.string().trim().max(80).optional(),
        description: z.string().trim().max(600).optional(),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'write');
      const version = await renameVersion(store, input.projectId, input.versionId, {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      });
      return outcome(`Renamed to "${version.label}".`, { versionId: version.id, label: version.label });
    },
  }),

  defineTool({
    name: 'restore_version',
    title: 'Restore version',
    description:
      'Replaces the working tree with a version’s files. A safety snapshot of the current state is taken first, so the restore itself can be undone. Requires confirm=true.',
    group: 'versions',
    capability: 'write',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    destructive: true,
    input: z
      .object({
        projectId: projectIdSchema,
        versionId: z.string().min(1),
        confirm: z.boolean().default(false).describe('Must be true to overwrite the working tree.'),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'write');
      const result = await restoreVersion(
        store,
        input.projectId,
        input.versionId,
        'claude',
        actor.userId,
      );
      await logEvent(store, input.projectId, {
        kind: 'mcp',
        level: 'warn',
        name: `Claude restored version "${result.restored.label}"`,
        payload: { versionId: result.restored.id, safetySnapshotId: result.safetySnapshot.id },
      });
      return outcome(
        `Restored "${result.restored.label}" — ${result.filesWritten} file(s) written. Previous state saved as "${result.safetySnapshot.label}" (${result.safetySnapshot.id}).`,
        {
          restoredVersionId: result.restored.id,
          filesWritten: result.filesWritten,
          safetySnapshotId: result.safetySnapshot.id,
        },
      );
    },
  }),

  defineTool({
    name: 'duplicate_version',
    title: 'Duplicate version',
    description: 'Copies a version into a new one without touching the working tree.',
    group: 'versions',
    capability: 'write',
    annotations: { readOnlyHint: false, idempotentHint: false },
    input: z
      .object({
        projectId: projectIdSchema,
        versionId: z.string().min(1),
        label: z.string().trim().min(1).max(80),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'write');
      const copy = await duplicateVersion(
        store,
        input.projectId,
        input.versionId,
        input.label,
        actor.userId,
        'claude',
      );
      return outcome(`Duplicated to "${copy.label}" (${copy.id}).`, { versionId: copy.id });
    },
  }),

  defineTool({
    name: 'compare_versions',
    title: 'Compare versions',
    description:
      'Diffs two versions (or a version against the working tree). Returns the changed files with line counts; pass a path to get the full unified diff for that file.',
    group: 'versions',
    capability: 'read',
    annotations: { readOnlyHint: true, idempotentHint: true },
    input: z
      .object({
        projectId: projectIdSchema,
        base: refSchema,
        target: refSchema,
        path: z
          .string()
          .max(240)
          .optional()
          .describe('Optional: return the unified diff for just this file.'),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'read');

      if (input.path) {
        const detail = await diffFileBetween(
          store,
          input.projectId,
          toRef(input.base),
          toRef(input.target),
          input.path,
        );
        return outcome(
          detail.unified || `${input.path} is identical in both versions.`,
          {
            path: detail.path,
            additions: detail.diff.additions,
            deletions: detail.diff.deletions,
            unified: detail.unified,
            existsInBase: detail.before !== null,
            existsInTarget: detail.after !== null,
          },
        );
      }

      const comparison = await compareVersions(
        store,
        input.projectId,
        toRef(input.base),
        toRef(input.target),
      );
      if (comparison.changes.length === 0) {
        return outcome(
          `${comparison.base.label} and ${comparison.target.label} are identical.`,
          comparison as unknown as Record<string, unknown>,
        );
      }
      const lines = comparison.changes.map(
        (change) => `${change.status.padEnd(8)} ${change.path}  +${change.additions} -${change.deletions}`,
      );
      return outcome(
        [
          `${comparison.base.label} → ${comparison.target.label}`,
          `${comparison.changes.length} file(s) changed, +${comparison.totals.additions} -${comparison.totals.deletions}`,
          '',
          ...lines,
        ].join('\n'),
        comparison as unknown as Record<string, unknown>,
      );
    },
  }),
];
