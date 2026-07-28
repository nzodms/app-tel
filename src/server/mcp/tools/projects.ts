import { z } from 'zod';
import { forbidden } from '../../core/errors';
import { PROJECT_TEMPLATES } from '../../templates';
import { getWorkspaceAccess, listAccessibleWorkspaceIds, requireProjectAccess } from '../../services/access';
import {
  archiveProject,
  createProject,
  duplicateProject,
  listProjectsForUser,
  projectRoles,
  updateProject,
} from '../../services/projects';
import { listFiles } from '../../services/files';
import { listDevices } from '../../services/devices';
import { listVersions } from '../../services/versions';
import { listThreads } from '../../services/comments';
import { previewStatus } from '../../services/preview';
import { defineTool, outcome } from '../types';

const projectIdSchema = z.string().min(1).describe('PhoneLab project id (starts with prj_).');

export const projectTools = [
  defineTool({
    name: 'list_projects',
    title: 'List projects',
    description:
      'Lists every PhoneLab project the connected account can reach, with device, version and open-comment counts. Start here to find a project id.',
    group: 'projects',
    capability: 'read',
    annotations: { readOnlyHint: true, idempotentHint: true },
    input: z
      .object({
        includeArchived: z.boolean().optional().describe('Include archived projects. Defaults to false.'),
        nameContains: z.string().max(80).optional().describe('Case-insensitive filter on the project name.'),
      })
      .strict(),
    async handler(input, { store, actor }) {
      const all = await listProjectsForUser(store, actor.userId);
      const filtered = all
        .filter((project) => (input.includeArchived ? true : project.status === 'active'))
        .filter((project) =>
          input.nameContains
            ? project.name.toLowerCase().includes(input.nameContains.toLowerCase())
            : true,
        );

      if (filtered.length === 0) {
        return outcome(
          'No projects matched. Create one in PhoneLab, or call create_project with a template id.',
          { projects: [], templates: PROJECT_TEMPLATES.map((template) => template.id) },
        );
      }

      const lines = filtered.map(
        (project) =>
          `- ${project.name} (${project.id}) · ${project.fileCount} files · ${project.deviceCount} devices · ${project.versionCount} versions` +
          `${project.openCommentCount > 0 ? ` · ${project.openCommentCount} open comments` : ''}` +
          `${project.status === 'archived' ? ' · archived' : ''}`,
      );

      return outcome(`${filtered.length} project(s):\n${lines.join('\n')}`, {
        projects: filtered.map((project) => ({
          id: project.id,
          name: project.name,
          workspaceId: project.workspaceId,
          workspaceName: project.workspaceName,
          status: project.status,
          entryFile: project.entryFile,
          fileCount: project.fileCount,
          deviceCount: project.deviceCount,
          versionCount: project.versionCount,
          openCommentCount: project.openCommentCount,
          updatedAt: project.updatedAt,
        })),
      });
    },
  }),

  defineTool({
    name: 'get_project',
    title: 'Get project',
    description:
      'Full snapshot of one project: metadata, roles, devices on the canvas, versions, build status and open comment count. Call this before making changes.',
    group: 'projects',
    capability: 'read',
    annotations: { readOnlyHint: true, idempotentHint: true },
    input: z.object({ projectId: projectIdSchema }).strict(),
    async handler(input, { store, actor, baseUrl }) {
      const { project } = await requireProjectAccess(store, actor, input.projectId, 'read');
      const [files, devices, versions, roles, threads, preview] = await Promise.all([
        listFiles(store, project.id),
        listDevices(store, project.id),
        listVersions(store, project.id),
        projectRoles(store, project),
        listThreads(store, project.id, { status: 'open' }),
        previewStatus(store, project.id),
      ]);

      const text = [
        `${project.name} (${project.id})`,
        project.description,
        '',
        `Entry point: ${project.entryFile}`,
        `Files: ${files.length}`,
        `Roles: ${roles.map((role) => `${role.label} (${role.slug})`).join(', ') || 'none declared'}`,
        `Devices: ${devices.map((device) => `${device.name} [${device.role}]`).join(', ') || 'none'}`,
        `Versions: ${versions.map((version) => version.label).join(', ') || 'none'}`,
        `Last build: ${
          preview.lastBuild
            ? `${preview.lastBuild.status}${preview.lastBuild.durationMs ? ` in ${preview.lastBuild.durationMs}ms` : ''}`
            : 'never built'
        }`,
        `Open comments: ${threads.length}`,
        `Studio: ${baseUrl}/studio/${project.id}`,
      ].join('\n');

      return outcome(text, {
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          entryFile: project.entryFile,
          templateId: project.templateId,
          platform: project.platform,
          status: project.status,
          activeVersionId: project.activeVersionId,
          workspaceId: project.workspaceId,
          studioUrl: `${baseUrl}/studio/${project.id}`,
        },
        roles,
        files: files.map((file) => ({ path: file.path, size: file.size, lastEditedBy: file.lastEditedBy })),
        devices: devices.map((device) => ({
          id: device.id,
          name: device.name,
          role: device.role,
          presetId: device.presetId,
          userLabel: device.userLabel,
          versionId: device.versionId,
          stateFlags: device.stateFlags,
          theme: device.theme,
          locale: device.locale,
        })),
        versions: versions.map((version) => ({
          id: version.id,
          label: version.label,
          sequence: version.sequence,
          createdAt: version.createdAt,
          authorKind: version.authorKind,
          changedPaths: version.changedPaths,
        })),
        lastBuild: preview.lastBuild
          ? {
              status: preview.lastBuild.status,
              durationMs: preview.lastBuild.durationMs,
              diagnostics: preview.lastBuild.diagnostics,
            }
          : null,
        openCommentCount: threads.length,
      });
    },
  }),

  defineTool({
    name: 'create_project',
    title: 'Create project',
    description:
      'Creates a project from a PhoneLab template, including its starting files, canvas devices and an initial version snapshot.',
    group: 'projects',
    capability: 'write',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    input: z
      .object({
        name: z.string().trim().min(1).max(80).describe('Project name.'),
        templateId: z
          .string()
          .min(1)
          .describe(`Template to start from. One of: ${PROJECT_TEMPLATES.map((t) => t.id).join(', ')}.`),
        workspaceId: z
          .string()
          .min(1)
          .optional()
          .describe('Workspace to create it in. Defaults to the account’s first workspace.'),
        description: z.string().trim().max(400).optional(),
      })
      .strict(),
    async handler(input, { store, actor, baseUrl }) {
      const workspaceIds = await listAccessibleWorkspaceIds(store, actor.userId);
      const workspaceId = input.workspaceId ?? workspaceIds[0];
      if (!workspaceId) {
        return {
          text: 'This account has no workspace yet. Create one in PhoneLab first.',
          isError: true,
        };
      }
      await getWorkspaceAccess(store, actor, workspaceId, 'write');

      const created = await createProject(store, actor, {
        workspaceId,
        name: input.name,
        templateId: input.templateId,
        ...(input.description ? { description: input.description } : {}),
      });

      return outcome(
        `Created "${created.project.name}" (${created.project.id}) with ${created.devices.length} devices and ${created.versionIds.length} version(s).\nOpen it at ${baseUrl}/studio/${created.project.id}`,
        {
          projectId: created.project.id,
          studioUrl: `${baseUrl}/studio/${created.project.id}`,
          entryFile: created.project.entryFile,
          deviceIds: created.devices.map((device) => device.id),
          versionIds: created.versionIds,
        },
      );
    },
  }),

  defineTool({
    name: 'update_project',
    title: 'Update project',
    description:
      'Updates project metadata: name, description, entry file, or the version pinned as active.',
    group: 'projects',
    capability: 'write',
    annotations: { readOnlyHint: false, idempotentHint: true },
    input: z
      .object({
        projectId: projectIdSchema,
        name: z.string().trim().min(1).max(80).optional(),
        description: z.string().trim().max(400).optional(),
        entryFile: z.string().trim().min(1).max(240).optional().describe('Must be an existing file.'),
        activeVersionId: z.string().min(1).nullable().optional(),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'write');
      const { projectId, ...patch } = input;
      const updated = await updateProject(store, projectId, patch);
      return outcome(`Updated "${updated.name}".`, {
        project: {
          id: updated.id,
          name: updated.name,
          description: updated.description,
          entryFile: updated.entryFile,
          activeVersionId: updated.activeVersionId,
        },
      });
    },
  }),

  defineTool({
    name: 'duplicate_project',
    title: 'Duplicate project',
    description:
      'Copies a project — files and canvas devices — into a new project in the same workspace, with a fresh initial snapshot.',
    group: 'projects',
    capability: 'write',
    annotations: { readOnlyHint: false, idempotentHint: false },
    input: z
      .object({
        projectId: projectIdSchema,
        name: z.string().trim().min(1).max(80).describe('Name for the copy.'),
      })
      .strict(),
    async handler(input, { store, actor, baseUrl }) {
      await requireProjectAccess(store, actor, input.projectId, 'write');
      const copy = await duplicateProject(store, actor, input.projectId, input.name);
      return outcome(`Duplicated to "${copy.name}" (${copy.id}).`, {
        projectId: copy.id,
        studioUrl: `${baseUrl}/studio/${copy.id}`,
      });
    },
  }),

  defineTool({
    name: 'archive_project',
    title: 'Archive project',
    description:
      'Archives (or restores) a project. Archiving hides it from the default list; nothing is deleted and it can be restored with archived=false.',
    group: 'projects',
    capability: 'admin',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    destructive: true,
    input: z
      .object({
        projectId: projectIdSchema,
        archived: z.boolean().default(true).describe('true to archive, false to restore.'),
        confirm: z
          .boolean()
          .default(false)
          .describe('Must be true to apply. Call once without it to see what would happen.'),
      })
      .strict(),
    async handler(input, { store, actor }) {
      const { project } = await requireProjectAccess(store, actor, input.projectId, 'admin');
      const updated = await archiveProject(store, input.projectId, input.archived);
      return outcome(
        `"${project.name}" is now ${updated.status}.`,
        { projectId: updated.id, status: updated.status },
      );
    },
  }),

  defineTool({
    name: 'list_templates',
    title: 'List templates',
    description: 'Lists the project templates available to create_project, with what each one demonstrates.',
    group: 'projects',
    capability: 'read',
    annotations: { readOnlyHint: true, idempotentHint: true },
    input: z.object({}).strict(),
    async handler(_input, { actor }) {
      if (!actor.userId) throw forbidden();
      const lines = PROJECT_TEMPLATES.map(
        (template) => `- ${template.id}: ${template.name} — ${template.summary}`,
      );
      return outcome(`Templates:\n${lines.join('\n')}`, {
        templates: PROJECT_TEMPLATES.map((template) => ({
          id: template.id,
          name: template.name,
          tagline: template.tagline,
          summary: template.summary,
          roles: template.roles.map((role) => role.slug),
          highlights: template.highlights,
        })),
      });
    },
  }),
];
