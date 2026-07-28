import { z } from 'zod';
import { badRequest, conflict, notFound } from '../core/errors';
import { LIMITS, byteLength } from '../core/limits';
import { newId, slugify } from '../core/ids';
import type {
  DeviceRow,
  Id,
  ProjectBrief,
  ProjectFileRow,
  ProjectRow,
  Store,
} from '../db';
import { isPresetId, DEFAULT_PRESET_ID, deviceGeometry, getPreset } from '@/lib/devices/presets';
import { arrangeDevices } from '@/lib/devices/layout';
import {
  PROJECT_TEMPLATES,
  getTemplate,
  templateFiles,
  type TemplateDevice,
  type TemplateJourney,
} from '../templates';
import { RT, getBus, projectChannel } from '../realtime/bus';
import { languageForPath } from './paths';
import { createSnapshot } from './versions';
import { createJourney } from './journeys';
import { logEvent } from './events';
import { listFiles } from './files';
import {
  defaultUserFor,
  generateScaffoldFiles,
  generateScaffoldJourney,
  getCategory,
} from './scaffold';
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

/**
 * Server-side extras that are not part of the public create payload.
 *
 * Onboarding uses these to lay its generated `src/lib/config.ts` over the
 * blueprint template and to record the brief it was generated from; the demo
 * seeder uses `isDemo`. Nothing here is settable over the REST or MCP surface.
 */
export interface CreateProjectOptions {
  isDemo?: boolean;
  brief?: ProjectBrief | null;
  /** Laid over the template's files, matched by path. */
  extraFiles?: readonly { path: string; content: string }[];
  /** Replaces the template's device layout. */
  devices?: readonly TemplateDevice[];
  /** Replaces the template's journeys. */
  journeys?: readonly TemplateJourney[];
  initialVersionLabel?: string;
  initialVersionDescription?: string;
}

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
  options: CreateProjectOptions = {},
): Promise<{ project: ProjectRow; devices: DeviceRow[]; versionIds: Id[] }> {
  const parsed = createProjectSchema.parse(input);
  const template = getTemplate(parsed.templateId);
  if (!template) {
    throw badRequest(
      `Unknown template "${parsed.templateId}". Available: ${PROJECT_TEMPLATES.filter((entry) => !entry.hidden)
        .map((entry) => entry.id)
        .join(', ')}.`,
    );
  }

  const sources = mergeSources(templateFiles(template.sourceKey), options.extraFiles ?? []);
  if (sources.length === 0) {
    throw badRequest(
      `Template "${template.id}" has no files. Run "npm run gen" to rebuild template sources.`,
    );
  }
  if (template.requiresGeneratedFiles) {
    const missing = template.requiresGeneratedFiles.filter(
      (path) => !sources.some((source) => source.path === path),
    );
    if (missing.length > 0) {
      // The blueprint template is deliberately incomplete on disk: onboarding
      // supplies the generated config. Creating from it without that would
      // produce a project that cannot compile, so refuse instead.
      throw badRequest(
        `Template "${template.id}" is only usable through the project generator; it is missing ${missing.join(', ')}.`,
      );
    }
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
    isDemo: options.isDemo ?? false,
    brief: options.brief ?? null,
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

  const deviceLayout = options.devices ?? template.devices;
  const placed = deviceLayout.slice(0, LIMITS.maxDevicesPerProject);

  /*
   * Positions are computed, not copied from the template.
   *
   * A template's x/y are arbitrary numbers someone typed while writing it — they
   * are not a considered layout, and they do not know how many devices the
   * project ends up with or what shape the canvas is. Running them through the
   * same layout engine the canvas uses means a project is well composed the
   * moment it opens, for any template and any device count, and it leaves
   * `needsArrange` free to stay conservative about layouts a person chose.
   */
  const arranged = new Map(
    arrangeDevices({
      devices: placed.map((device, index) => {
        const geometry = deviceGeometry(
          getPreset(isPresetId(device.presetId) ? device.presetId : DEFAULT_PRESET_ID),
          'portrait',
        );
        return {
          id: String(index),
          role: device.role,
          width: geometry.chassis.width,
          height: geometry.chassis.height,
        };
      }),
    }).map((position) => [position.id, position]),
  );

  const devices: DeviceRow[] = placed.map(
    (device, index) => ({
      id: newId('dev'),
      projectId,
      name: device.name,
      presetId: isPresetId(device.presetId) ? device.presetId : DEFAULT_PRESET_ID,
      orientation: 'portrait',
      role: device.role,
      userLabel: device.userLabel,
      versionId: null,
      x: arranged.get(String(index))?.x ?? device.x,
      y: arranged.get(String(index))?.y ?? device.y,
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
    label: options.initialVersionLabel ?? 'V1',
    description: options.initialVersionDescription ?? `Initial ${template.name} scaffold.`,
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
  for (const journey of options.journeys ?? template.journeys ?? []) {
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

/** Template files with the generated ones laid over the top, matched by path. */
function mergeSources(
  base: readonly { path: string; content: string }[],
  extra: readonly { path: string; content: string }[],
): { path: string; content: string }[] {
  const byPath = new Map(base.map((source) => [source.path, { ...source }]));
  for (const source of extra) byPath.set(source.path, { ...source });
  return [...byPath.values()];
}

/* -------------------------------------------------------------------------- */
/* Generated projects                                                          */
/* -------------------------------------------------------------------------- */

export const generateProjectSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1, 'Give the project a name.').max(80),
  brief: z.object({
    category: z.string().trim().max(40).default('other'),
    audience: z.string().trim().max(200).default(''),
    summary: z.string().trim().max(400).default(''),
    roles: z.array(z.string().trim().min(1).max(24)).max(6).default([]),
  }),
});

/**
 * Creates a project from a brief rather than a template id.
 *
 * The blueprint template supplies every screen; the generator supplies one file of
 * vocabulary and demo data. Onboarding's last step and `/projects/new` both call
 * this, so the two cannot produce different projects for the same answers.
 */
export async function createGeneratedProject(
  store: Store,
  actor: Actor,
  input: z.infer<typeof generateProjectSchema>,
): Promise<{ project: ProjectRow; devices: DeviceRow[]; versionIds: Id[] }> {
  const parsed = generateProjectSchema.parse(input);
  const category = getCategory(parsed.brief.category);
  const roles = normalizeRoleSlugs(parsed.brief.roles, category.suggestedRoles);
  const brief: ProjectBrief = {
    category: category.id,
    audience: parsed.brief.audience,
    summary: parsed.brief.summary,
    roles,
  };
  const scaffold = { appName: parsed.name, brief };

  return createProject(
    store,
    actor,
    {
      workspaceId: parsed.workspaceId,
      name: parsed.name,
      templateId: 'blueprint',
      description: brief.summary || category.hint,
    },
    {
      brief,
      extraFiles: generateScaffoldFiles(scaffold),
      devices: roles.slice(0, 2).map((role, index) => ({
        name: titleCaseRole(role),
        role,
        presetId: DEFAULT_PRESET_ID,
        userLabel: defaultUserFor(role),
        x: index * 620,
        y: 0,
      })),
      journeys: [generateScaffoldJourney(scaffold)],
      initialVersionDescription: `Generated from your brief: ${brief.summary || category.hint}`,
    },
  );
}

/** At least two distinct roles, because the point is two phones talking. */
export function normalizeRoleSlugs(
  roles: readonly string[],
  fallback: readonly string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const role of roles) {
    const slug = slugify(role, '');
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  for (const role of fallback) {
    if (out.length >= 2) break;
    if (seen.has(role)) continue;
    seen.add(role);
    out.push(role);
  }
  return out.slice(0, 6);
}

function titleCaseRole(value: string): string {
  return value.replace(/[-_]/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
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
    // A copy of the demo is the user's own project, not another demo.
    isDemo: false,
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
