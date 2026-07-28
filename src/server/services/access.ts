import { forbidden, notFound } from '../core/errors';
import type {
  Id,
  ProjectRow,
  Store,
  WorkspaceMemberRole,
  WorkspaceRow,
} from '../db';

/**
 * One authorisation vocabulary shared by the REST routes, the studio and MCP.
 *
 * Every entry point resolves an `Actor` and asks for a `Capability`; nothing in
 * the app reads workspace roles or MCP scopes directly. That is what keeps the
 * MCP surface from accidentally being more powerful than the UI.
 */
export type Capability = 'read' | 'write' | 'execute' | 'share' | 'admin';

const ROLE_CAPABILITIES: Record<WorkspaceMemberRole, readonly Capability[]> = {
  owner: ['read', 'write', 'execute', 'share', 'admin'],
  admin: ['read', 'write', 'execute', 'share', 'admin'],
  editor: ['read', 'write', 'execute', 'share'],
  viewer: ['read'],
};

/** MCP OAuth scopes, and the capabilities each one unlocks. */
export const MCP_SCOPES = {
  'projects.read': {
    label: 'Read your projects',
    description: 'List projects, browse the file tree, read files, logs and versions.',
    capabilities: ['read'] as const,
  },
  'projects.write': {
    label: 'Modify your projects',
    description: 'Create, patch, rename and delete files, and create version snapshots.',
    capabilities: ['read', 'write'] as const,
  },
  'preview.run': {
    label: 'Run previews and journeys',
    description: 'Start or restart previews, read build output, drive devices and journeys.',
    capabilities: ['read', 'execute'] as const,
  },
  'share.manage': {
    label: 'Manage sharing and feedback',
    description: 'Create or revoke share links and act on reviewer comments.',
    capabilities: ['read', 'share'] as const,
  },
} as const;

export type McpScope = keyof typeof MCP_SCOPES;

export const ALL_MCP_SCOPES = Object.keys(MCP_SCOPES) as McpScope[];

export function isMcpScope(value: string): value is McpScope {
  return Object.prototype.hasOwnProperty.call(MCP_SCOPES, value);
}

export function parseScopeString(scope: string): McpScope[] {
  return scope
    .split(/[\s,]+/)
    .filter((entry) => entry.length > 0)
    .filter(isMcpScope);
}

export function capabilitiesForScopes(scopes: readonly string[]): Set<Capability> {
  const out = new Set<Capability>();
  for (const scope of scopes) {
    if (!isMcpScope(scope)) continue;
    for (const capability of MCP_SCOPES[scope].capabilities) out.add(capability);
  }
  return out;
}

/* -------------------------------------------------------------------------- */

export interface Actor {
  userId: Id;
  /** How this request authenticated. Drives audit rows and error copy. */
  via: 'session' | 'mcp';
  /** Only present for MCP actors. */
  scopes?: readonly string[];
  connectionId?: Id | null;
}

export interface ProjectAccess {
  project: ProjectRow;
  workspace: WorkspaceRow;
  role: WorkspaceMemberRole;
  capabilities: Set<Capability>;
}

/** Intersection of "what the member may do" and "what the token was granted". */
function effectiveCapabilities(
  role: WorkspaceMemberRole,
  actor: Actor,
): Set<Capability> {
  const fromRole = new Set<Capability>(ROLE_CAPABILITIES[role]);
  if (actor.via !== 'mcp') return fromRole;
  const fromScopes = capabilitiesForScopes(actor.scopes ?? []);
  return new Set([...fromRole].filter((capability) => fromScopes.has(capability)));
}

export async function listAccessibleWorkspaceIds(store: Store, userId: Id): Promise<Id[]> {
  const memberships = await store.select('workspaceMembers', { match: { userId } });
  return memberships.map((member) => member.workspaceId);
}

export async function getWorkspaceAccess(
  store: Store,
  actor: Actor,
  workspaceId: Id,
  capability: Capability,
): Promise<{ workspace: WorkspaceRow; role: WorkspaceMemberRole }> {
  const workspace = await store.find('workspaces', { match: { id: workspaceId } });
  if (!workspace) throw notFound('Workspace not found.');
  const membership = await store.find('workspaceMembers', {
    match: { workspaceId, userId: actor.userId },
  });
  if (!membership) throw notFound('Workspace not found.');
  const capabilities = effectiveCapabilities(membership.role, actor);
  if (!capabilities.has(capability)) {
    throw forbidden(missingCapabilityMessage(capability, actor));
  }
  return { workspace, role: membership.role };
}

/**
 * The single gate for project-scoped work. Returns 404 (not 403) when the user is
 * not a member, so project existence is not leaked across tenants.
 */
export async function requireProjectAccess(
  store: Store,
  actor: Actor,
  projectId: Id,
  capability: Capability,
): Promise<ProjectAccess> {
  const project = await store.find('projects', { match: { id: projectId } });
  if (!project) throw notFound('Project not found.');

  const membership = await store.find('workspaceMembers', {
    match: { workspaceId: project.workspaceId, userId: actor.userId },
  });
  if (!membership) throw notFound('Project not found.');

  const workspace = await store.find('workspaces', { match: { id: project.workspaceId } });
  if (!workspace) throw notFound('Project not found.');

  const capabilities = effectiveCapabilities(membership.role, actor);
  if (!capabilities.has(capability)) {
    throw forbidden(missingCapabilityMessage(capability, actor));
  }

  return { project, workspace, role: membership.role, capabilities };
}

function missingCapabilityMessage(capability: Capability, actor: Actor): string {
  if (actor.via === 'mcp') {
    const needed = ALL_MCP_SCOPES.filter((scope) =>
      (MCP_SCOPES[scope].capabilities as readonly Capability[]).includes(capability),
    );
    return (
      `This connection is missing the "${capability}" capability. ` +
      `Re-authorise the PhoneLab connector with one of: ${needed.join(', ')}.`
    );
  }
  return `Your workspace role does not allow "${capability}" on this project.`;
}
