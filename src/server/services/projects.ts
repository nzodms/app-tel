import { z } from 'zod';
import { badRequest, conflict, notFound } from '../core/errors';
import { LIMITS, byteLength } from '../core/limits';
import { newId, slugify } from '../core/ids';
import type {
  DeviceRow,
  Id,
  ProjectFileRow,
  ProjectRow,
  Store,
} from '../db';
import { isPresetId, DEFAULT_PRESET_ID } from '@/lib/devices/presets';
import { PROJECT_TEMPLATES, getTemplate, templateFiles } from '../templates';
import { RT, getBus, projectChannel } from '../realtime/bus';
import { languageForPath } from './paths';
import { createSnapshot } from './versions';
import { createJourney } from './journeys';
import { logEvent } from './events';
import { listFiles } from './files';
import type { Actor } from './access';

/**
 * Projects: creation from a template, listing, metadata and lifecycle.
 *
 * Creating a project is one transaction that lays down the working tree, the
 * canvas devices the template recommends, and an initial snapshot — so a new
 * project is immediately runnable, comparable and shareable.
 */

export const createProjectSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1, 'Give the project a name.').max(80),
  templateId: z.string().min(1),
  description: z.string().trim().max(400).optional(),
  /** For templates that ship a variant, also create it as a second version. */
  includeVariant: z.boolean().optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export interface ProjectRoleInfo {
  slug: string;
  label: string;
  defaultUser: string | null;
}

export interface ProjectManifest {
  name?: string;
  entry?: string;
  roles?: { slug: string; label?: string; user?: string | null }[];
  screens?: { route: string; title?: string; role?: string }[];
  sharedStateKeys?: string[];
  events?: { name: string; from?: string; to?: string }[];
}

/* -------------------------------------------------------------------------- */
/* Creation                                                                    */
/* -------------------------------------------------------------------------- */

export async function createProject(
  store: Store,
  actor: Actor,
  input: CreateProjectInput,
): Promise<{ project: ProjectRow; devices: DeviceRow[]; versionIds: Id[] }> {
  const parsed = createProjectSchema.parse(input);
  const template = getTemplate(parsed.templateId);
  if (!template) {
    throw badRequest(
      `Unknown template "${parsed.templateId}". Available: ${PROJECT_TEMPLATES.map((entry) => entry.id).join(', ')}.`,
    );
  }

  const sources = templateFiles(template.sourceKey);
  if (sources.length === 0) {
    throw badRequest(
      `Template "${template.id}" has no files. Run "npm run gen" to rebuild template sources.`,
    );
  }

  const now = new Date().toISOString();
  const projectId = newId('prj');
  const slug = await uniqueSlug(store, parsed.workspaceId, slugify(parsed.name));

  const project: ProjectRow = {
    id: projectId,
    workspaceId: parsed.workspaceId,
    name: parsed.name,
    slug,
    description: parsed.description ?? template.summary,
    templateId: template.id,
    platform: 'web-react',
    status: 'active',
    activeVersionId: null,
    entryFile: template.entryFile,
    createdBy: actor.userId,
    createdAt: now,
    updatedAt: now,
  };

  const files: ProjectFileRow[] = sources.map((source) => ({
    id: newId('fil'),
    projectId,
    path: source.path,
    content: source.content,
    size: byteLength(source.content),
    language: languageForPath(source.path),
    lastEditedBy: 'system',
    lastEditedAt: now,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }));

  const devices: DeviceRow[] = template.devices.slice(0, LIMITS.maxDevicesPerProject).map(
    (device, index) => ({
      id: newId('dev'),
      projectId,
      name: device.name,
      presetId: isPresetId(device.presetId) ? device.presetId : DEFAULT_PRESET_ID,
      orientation: 'portrait',
      role: device.role,
      userLabel: device.userLabel,
      versionId: null,
      x: device.x,
      y: device.y,
      zIndex: index + 1,
      theme: 'light',
      locale: 'en',
      network: 'fast',
      stateFlags: [],
      scenario: null,
      createdAt: now,
      updatedAt: now,
    }),
  );

  await store.transaction(async (tx) => {
    await tx.insert('projects', project);
    await tx.insertMany('projectFiles', files);
    await tx.insertMany('devices', devices);
  });

  const versionIds: Id[] = [];

  const initial = await createSnapshot(store, projectId, {
    label: 'V1',
    description: `Initial ${template.name} scaffold.`,
    authorKind: 'system',
    createdBy: actor.userId,
  });
  versionIds.push(initial.id);

  // Some templates ship a second variant so version comparison has real content.
  if (parsed.includeVariant !== false && template.variantSourceKey) {
    const overlay = templateFiles(template.variantSourceKey);
    if (overlay.length > 0) {
      await applyOverlay(store, projectId, overlay);
      const variant = await createSnapshot(store, projectId, {
        label: template.variantLabel ?? 'V2',
        description: template.variantDescription ?? 'Second variant.',
        authorKind: 'system',
        createdBy: actor.userId,
        parentVersionId: initial.id,
      });
      versionIds.push(variant.id);
    }
  }

  // Templates may ship recorded journeys so replay works from the first minute.
  for (const journey of template.journeys ?? []) {
    await createJourney(
      store,
      projectId,
      {
        name: journey.name,
        description: journey.description,
        steps: journey.steps.map((step) => ({
          kind: step.kind,
          label: step.label,
          deviceId: null,
          deviceRole: step.deviceRole,
          payload: step.payload,
          waitMs: step.waitMs,
        })),
      },
      'system',
      actor.userId,
    );
  }

  await logEvent(store, projectId, {
    kind: 'system',
    name: `Project created from ${template.name}`,
    payload: { templateId: template.id, files: files.length, devices: devices.length },
  });

  return { project, devices, versionIds };
}

async function applyOverlay(
  store: Store,
  projectId: Id,
  overlay: readonly { path: string; content: string }[],
): Promise<void> {
  const now = new Date().toISOString();
  await store.transaction(async (tx) => {
    const current = await tx.select('projectFiles', { match: { projectId } });
    const byPath = new Map(current.map((file) => [file.path, file]));
    for (const source of overlay) {
      const existing = byPath.get(source.path);
      const size = byteLength(source.content);
      if (existing) {
        await tx.update('projectFiles', existing.id, {
          content: source.content,
          size,
          lastEditedBy: 'system',
          lastEditedAt: now,
          updatedAt: now,
          deletedAt: null,
        });
      } else {
        await tx.insert('projectFiles', {
          id: newId('fil'),
          projectId,
          path: source.path,
          content: source.content,
          size,
          language: languageForPath(source.path),
          lastEditedBy: 'system',
          lastEditedAt: now,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
      }
    }
  });
}

async function uniqueSlug(store: Store, workspaceId: Id, base: string): Promise<string> {
  let candidate = base;
  for (let attempt = 2; attempt < 60; attempt += 1) {
    const clash = await store.find('projects', { match: { workspaceId, slug: candidate } });
    if (!clash) return candidate;
    candidate = `${base}-${attempt}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export interface ProjectListItem extends ProjectRow {
  deviceCount: number;
  versionCount: number;
  fileCount: number;
  openCommentCount: number;
  workspaceName: string;
}

export async function listProjectsForUser(
  store: Store,
  userId: Id,
): Promise<ProjectListItem[]> {
  const memberships = await store.select('workspaceMembers', { match: { userId } });
  if (memberships.length === 0) return [];

  const workspaceIds = memberships.map((member) => member.workspaceId);
  const workspaces = await store.select('workspaces', {
    where: [{ col: 'id', op: 'in', value: workspaceIds }],
  });
  const workspaceNames = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));

  const projects = await store.select('projects', {
    where: [{ col: 'workspaceId', op: 'in', value: workspaceIds }],
    orderBy: [{ col: 'updatedAt', dir: 'desc' }],
  });

  const items: ProjectListItem[] = [];
  for (const project of projects) {
    const [deviceCount, versionCount, files, threads] = await Promise.all([
      store.count('devices', { match: { projectId: project.id } }),
      store.count('projectVersions', { match: { projectId: project.id } }),
      listFiles(store, project.id),
      store.count('commentThreads', { match: { projectId: project.id, status: 'open' } }),
    ]);
    items.push({
      ...project,
      deviceCount,
      versionCount,
      fileCount: files.length,
      openCommentCount: threads,
      workspaceName: workspaceNames.get(project.workspaceId) ?? 'Workspace',
    });
  }
  return items;
}

export async function getProject(store: Store, projectId: Id): Promise<ProjectRow> {
  const project = await store.find('projects', { match: { id: projectId } });
  if (!project) throw notFound('Project not found.');
  return project;
}

/** Reads `app.json` if the template provides one; falls back to the registry. */
export async function projectManifest(
  store: Store,
  project: ProjectRow,
): Promise<ProjectManifest | null> {
  const file = await store.find('projectFiles', {
    match: { projectId: project.id, path: 'app.json' },
    where: [{ col: 'deletedAt', op: 'isNull' }],
  });
  if (!file) return null;
  try {
    return JSON.parse(file.content) as ProjectManifest;
  } catch {
    // A broken app.json should not take the studio down; the Logs panel will
    // surface the parse failure when the preview builds.
    return null;
  }
}

export async function projectRoles(
  store: Store,
  project: ProjectRow,
): Promise<ProjectRoleInfo[]> {
  const manifest = await projectManifest(store, project);
  if (manifest?.roles && manifest.roles.length > 0) {
    return manifest.roles.map((role) => ({
      slug: role.slug,
      label: role.label ?? role.slug,
      defaultUser: role.user ?? null,
    }));
  }
  const template = getTemplate(project.templateId);
  return (template?.roles ?? []).map((role) => ({
    slug: role.slug,
    label: role.label,
    defaultUser: role.user,
  }));
}

/* -------------------------------------------------------------------------- */
/* Mutations                                                                   */
/* -------------------------------------------------------------------------- */

export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(400).optional(),
  entryFile: z.string().trim().min(1).max(240).optional(),
  activeVersionId: z.string().min(1).nullable().optional(),
});

export async function updateProject(
  store: Store,
  projectId: Id,
  patch: z.infer<typeof updateProjectSchema>,
): Promise<ProjectRow> {
  const parsed = updateProjectSchema.parse(patch);
  if (parsed.activeVersionId) {
    const version = await store.find('projectVersions', {
      match: { id: parsed.activeVersionId, projectId },
    });
    if (!version) throw badRequest('That version does not belong to this project.');
  }
  if (parsed.entryFile) {
    const file = await store.find('projectFiles', {
      match: { projectId, path: parsed.entryFile },
      where: [{ col: 'deletedAt', op: 'isNull' }],
    });
    if (!file) throw badRequest(`There is no file at "${parsed.entryFile}" to use as the entry point.`);
  }

  const updated = await store.update('projects', projectId, {
    ...parsed,
    updatedAt: new Date().toISOString(),
  });
  getBus().publish(projectChannel(projectId), RT.projectChanged, { project: updated });
  return updated;
}

export async function archiveProject(
  store: Store,
  projectId: Id,
  archived: boolean,
): Promise<ProjectRow> {
  const updated = await store.update('projects', projectId, {
    status: archived ? 'archived' : 'active',
    updatedAt: new Date().toISOString(),
  });
  getBus().publish(projectChannel(projectId), RT.projectChanged, { project: updated });
  return updated;
}

export async function duplicateProject(
  store: Store,
  actor: Actor,
  projectId: Id,
  name: string,
): Promise<ProjectRow> {
  const source = await getProject(store, projectId);
  const files = await listFiles(store, projectId);
  const devices = await store.select('devices', { match: { projectId } });

  const now = new Date().toISOString();
  const newProjectId = newId('prj');
  const slug = await uniqueSlug(store, source.workspaceId, slugify(name || `${source.name} copy`));

  const copy: ProjectRow = {
    ...source,
    id: newProjectId,
    name: name || `${source.name} copy`,
    slug,
    activeVersionId: null,
    createdBy: actor.userId,
    createdAt: now,
    updatedAt: now,
    status: 'active',
  };

  await store.transaction(async (tx) => {
    await tx.insert('projects', copy);
    await tx.insertMany(
      'projectFiles',
      files.map((file) => ({ ...file, id: newId('fil'), projectId: newProjectId })),
    );
    await tx.insertMany(
      'devices',
      devices.map((device) => ({
        ...device,
        id: newId('dev'),
        projectId: newProjectId,
        versionId: null,
      })),
    );
  });

  await createSnapshot(store, newProjectId, {
    label: 'V1',
    description: `Duplicated from "${source.name}".`,
    authorKind: actor.via === 'mcp' ? 'claude' : 'user',
    createdBy: actor.userId,
  });

  if (files.length === 0) {
    throw conflict('The source project has no files to duplicate.');
  }

  return copy;
}
