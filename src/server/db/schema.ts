/**
 * PhoneLab data model.
 *
 * A single source of truth for both storage drivers:
 *  - `LocalStore` persists these shapes verbatim as JSON (dev / single-node).
 *  - `SupabaseStore` maps them to the Postgres tables in
 *    `supabase/migrations/0001_init.sql` — camelCase <-> snake_case is handled
 *    algorithmically by the driver, so there is no hand-written mapping layer.
 *
 * Row types double as API DTOs. Anything secret (password hashes, token hashes)
 * is stripped at the service boundary, never sent to a client.
 */

export type Id = string;
/** ISO-8601 UTC timestamp. */
export type Timestamp = string;

/* -------------------------------------------------------------------------- */
/* Identity & tenancy                                                          */
/* -------------------------------------------------------------------------- */

export interface UserRow {
  id: Id;
  email: string;
  name: string;
  /** scrypt digest, hex. Never leaves the server. */
  passwordHash: string;
  passwordSalt: string;
  /** 0-359, used for deterministic avatar colouring. */
  avatarHue: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;

  /* --- onboarding ------------------------------------------------------- */
  /**
   * Set when the user finishes (or explicitly skips) onboarding.
   *
   * Deliberately its own field rather than inferred from "has a project": a
   * project can exist because someone opened the demo, was invited to a
   * workspace, or had one created over MCP — none of which means they have been
   * shown around.
   */
  onboardingCompletedAt: Timestamp | null;
  /** Furthest step reached, so a reload resumes rather than restarts. */
  onboardingStep: number;
  /** Answers collected so far. Persisted on every step. */
  onboardingDraft: Record<string, unknown>;
  /** Where "open PhoneLab" should land. */
  activeWorkspaceId: Id | null;
  activeProjectId: Id | null;
  /** UI preferences that belong to the person, not the browser. */
  preferences: UserPreferences;
}

import type { UserPreferences } from '@/lib/preferences';

export { DEFAULT_PREFERENCES, type UserPreferences } from '@/lib/preferences';

export interface SessionRow {
  id: Id;
  /** SHA-256 of the cookie value. The raw value is only ever in the cookie. */
  tokenHash: string;
  userId: Id;
  expiresAt: Timestamp;
  createdAt: Timestamp;
  userAgent: string | null;
}

export type WorkspaceMemberRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface WorkspaceRow {
  id: Id;
  name: string;
  slug: string;
  ownerId: Id;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface WorkspaceMemberRow {
  id: Id;
  workspaceId: Id;
  userId: Id;
  role: WorkspaceMemberRole;
  createdAt: Timestamp;
}

/* -------------------------------------------------------------------------- */
/* Projects & files                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Runtime family a project targets. V1 ships `web-react` (compiled and run in a
 * sandboxed browser iframe). `expo-rnw` is reserved for the React Native Web
 * path and is not selectable yet — see docs/STATUS.md.
 */
export type ProjectPlatform = 'web-react' | 'expo-rnw';
export type ProjectStatus = 'active' | 'archived';

export interface ProjectRow {
  id: Id;
  workspaceId: Id;
  name: string;
  slug: string;
  description: string;
  templateId: string;
  platform: ProjectPlatform;
  status: ProjectStatus;
  /** Version currently pinned as "the" version for new devices; null = live working tree. */
  activeVersionId: Id | null;
  entryFile: string;
  createdBy: Id;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /**
   * Demo projects are shown in their own section and are never treated as the
   * user's own work — opening one must not look like finishing onboarding.
   */
  isDemo: boolean;
  /** Free-form product brief captured during onboarding, shown in the studio. */
  brief: ProjectBrief | null;
}

export interface ProjectBrief {
  category: string;
  audience: string;
  summary: string;
  roles: string[];
}

/** Who last touched a file — drives the "modified by Claude" markers in the tree. */
export type EditorKind = 'user' | 'claude' | 'system';

export interface ProjectFileRow {
  id: Id;
  projectId: Id;
  /** Normalised, POSIX-style, no leading slash. e.g. `app/screens/Home.tsx` */
  path: string;
  content: string;
  size: number;
  language: string;
  lastEditedBy: EditorKind;
  lastEditedAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /** Soft delete keeps history honest and makes MCP `delete_file` restorable. */
  deletedAt: Timestamp | null;
}

/* -------------------------------------------------------------------------- */
/* Versions (snapshots)                                                        */
/* -------------------------------------------------------------------------- */

export interface ProjectVersionRow {
  id: Id;
  projectId: Id;
  label: string;
  description: string;
  /** Monotonic per project, 1-based. */
  sequence: number;
  createdBy: Id | null;
  authorKind: EditorKind;
  /** Free-form reference to the prompt / MCP action that produced this snapshot. */
  promptRef: string | null;
  fileCount: number;
  parentVersionId: Id | null;
  createdAt: Timestamp;
}

/** Immutable copy of one file at snapshot time. */
export interface VersionFileRow {
  id: Id;
  versionId: Id;
  projectId: Id;
  path: string;
  content: string;
  language: string;
}

/* -------------------------------------------------------------------------- */
/* Devices on the canvas                                                       */
/* -------------------------------------------------------------------------- */

export type DeviceOrientation = 'portrait' | 'landscape';
export type NetworkCondition = 'fast' | 'slow' | 'offline';
export type ColorScheme = 'light' | 'dark';

export interface DeviceRow {
  id: Id;
  projectId: Id;
  name: string;
  presetId: string;
  orientation: DeviceOrientation;
  /** Role slug, e.g. `customer`. Roles are project-configurable. */
  role: string;
  /** Display name of the simulated signed-in user, or null for anonymous. */
  userLabel: string | null;
  /** null => follow the project's live working tree. */
  versionId: Id | null;
  x: number;
  y: number;
  zIndex: number;
  theme: ColorScheme;
  locale: string;
  network: NetworkCondition;
  /** Active Edge Case Studio flags, e.g. `['payment-declined','empty-list']`. */
  stateFlags: string[];
  scenario: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/* -------------------------------------------------------------------------- */
/* Timeline: one table backs logs, device events and the activity feed          */
/* -------------------------------------------------------------------------- */

export type EventKind =
  | 'system'
  | 'build'
  | 'runtime'
  | 'navigation'
  | 'interaction'
  | 'device-event'
  | 'notification'
  | 'error'
  | 'mcp'
  | 'journey'
  | 'comment';

export type EventLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DeviceEventRow {
  id: Id;
  projectId: Id;
  /** Server-assigned, strictly increasing per project. Gives replay determinism. */
  sequence: number;
  /** Emitting device, or null for project-level events (build, MCP, …). */
  deviceId: Id | null;
  /** For cross-device messages: the intended recipient. */
  targetDeviceId: Id | null;
  kind: EventKind;
  level: EventLevel;
  name: string;
  payload: Record<string, unknown>;
  screen: string | null;
  createdAt: Timestamp;
}

/* -------------------------------------------------------------------------- */
/* Preview & build                                                             */
/* -------------------------------------------------------------------------- */

export type PreviewStatus = 'starting' | 'running' | 'stopped' | 'error';

export interface PreviewSessionRow {
  id: Id;
  projectId: Id;
  versionId: Id | null;
  status: PreviewStatus;
  /** Content hash of the compiled bundle; changes drive iframe reloads. */
  bundleHash: string | null;
  startedAt: Timestamp;
  stoppedAt: Timestamp | null;
  error: string | null;
}

export interface Diagnostic {
  severity: 'error' | 'warning';
  message: string;
  file: string | null;
  line: number | null;
  column: number | null;
  /** `esbuild` for bundle diagnostics, `runtime` for in-preview exceptions. */
  source: 'esbuild' | 'runtime';
}

export type BuildStatus = 'running' | 'success' | 'error';

export interface BuildRunRow {
  id: Id;
  projectId: Id;
  previewSessionId: Id | null;
  versionId: Id | null;
  status: BuildStatus;
  startedAt: Timestamp;
  finishedAt: Timestamp | null;
  durationMs: number | null;
  diagnostics: Diagnostic[];
  bundleBytes: number | null;
  triggeredBy: EditorKind;
}

/* -------------------------------------------------------------------------- */
/* Journeys                                                                    */
/* -------------------------------------------------------------------------- */

export type JourneyStepKind =
  | 'open'
  | 'navigate'
  | 'tap'
  | 'input'
  | 'wait'
  | 'event'
  | 'notification'
  | 'assert'
  | 'note';

export interface JourneyRow {
  id: Id;
  projectId: Id;
  name: string;
  description: string;
  createdBy: Id | null;
  authorKind: EditorKind;
  stepCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface JourneyStepRow {
  id: Id;
  journeyId: Id;
  projectId: Id;
  /** 0-based position in the journey. */
  index: number;
  kind: JourneyStepKind;
  /** Device this step targets. Resolved by role at replay time if missing. */
  deviceId: Id | null;
  deviceRole: string | null;
  label: string;
  payload: Record<string, unknown>;
  /** Delay applied *before* the step during replay. */
  waitMs: number;
  createdAt: Timestamp;
}

export type JourneyRunStatus = 'running' | 'paused' | 'completed' | 'failed' | 'stopped';

export interface JourneyRunRow {
  id: Id;
  journeyId: Id;
  projectId: Id;
  status: JourneyRunStatus;
  currentStep: number;
  speed: number;
  startedAt: Timestamp;
  finishedAt: Timestamp | null;
  /** Per-step outcomes, appended as the run progresses. */
  report: JourneyStepResult[];
  error: string | null;
}

export interface JourneyStepResult {
  index: number;
  kind: JourneyStepKind;
  label: string;
  status: 'ok' | 'error' | 'skipped';
  message: string | null;
  at: Timestamp;
  durationMs: number;
}

/* -------------------------------------------------------------------------- */
/* Sharing & feedback                                                          */
/* -------------------------------------------------------------------------- */

export type ShareAccess = 'read' | 'comment';
export type ShareVisibility = 'public' | 'password' | 'email';

export interface ShareLinkRow {
  id: Id;
  projectId: Id;
  /** URL-safe public identifier. Long enough to be unguessable. */
  token: string;
  /** Pinned version. null = whatever is live (discouraged for reviewers). */
  versionId: Id | null;
  access: ShareAccess;
  visibility: ShareVisibility;
  passwordHash: string | null;
  passwordSalt: string | null;
  allowedEmails: string[];
  /** Device roles a reviewer may switch between. */
  allowedRoles: string[];
  allowVersionCompare: boolean;
  allowJourneys: boolean;
  label: string;
  expiresAt: Timestamp | null;
  revokedAt: Timestamp | null;
  createdBy: Id;
  createdAt: Timestamp;
  viewCount: number;
  lastViewedAt: Timestamp | null;
}

export type ThreadStatus = 'open' | 'resolved';

/**
 * A comment thread is anchored to a precise place: version + device preset +
 * role + screen + normalised coordinates inside the viewport. That is what makes
 * reviewer feedback actionable (and what MCP hands to Claude).
 */
export interface CommentThreadRow {
  id: Id;
  projectId: Id;
  shareLinkId: Id | null;
  versionId: Id | null;
  deviceId: Id | null;
  presetId: string | null;
  role: string | null;
  screen: string | null;
  /** 0..1 relative to the *viewport* (not the chassis), so it survives zoom. */
  anchorX: number;
  anchorY: number;
  /** Best-effort `data-pl-src` of the element under the click: `path:line:col`. */
  sourceRef: string | null;
  /** Human label of the element clicked, for context in the code panel. */
  elementLabel: string | null;
  /** The last recorded interaction before the comment was left. */
  precedingAction: string | null;
  status: ThreadStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  resolvedAt: Timestamp | null;
  resolvedBy: Id | null;
  /** Set when the owner converted the thread into a task. */
  taskTitle: string | null;
}

export type CommentAuthorKind = 'owner' | 'guest' | 'claude';

export interface CommentRow {
  id: Id;
  threadId: Id;
  projectId: Id;
  authorKind: CommentAuthorKind;
  authorName: string;
  authorEmail: string | null;
  body: string;
  createdAt: Timestamp;
}

/* -------------------------------------------------------------------------- */
/* MCP + OAuth 2.1                                                             */
/* -------------------------------------------------------------------------- */

export interface McpConnectionRow {
  id: Id;
  userId: Id;
  clientId: string;
  name: string;
  scopes: string[];
  lastUsedAt: Timestamp | null;
  createdAt: Timestamp;
  revokedAt: Timestamp | null;
  /** Protocol revision negotiated on the most recent `initialize`. */
  protocolVersion: string | null;
  toolCallCount: number;
}

export type McpAuditResult = 'ok' | 'error' | 'denied';

export interface McpAuditLogRow {
  id: Id;
  userId: Id | null;
  projectId: Id | null;
  connectionId: Id | null;
  tool: string;
  /** Arguments with large/secret values elided — see `redactArgs`. */
  args: Record<string, unknown>;
  result: McpAuditResult;
  errorMessage: string | null;
  durationMs: number;
  createdAt: Timestamp;
}

export interface OauthClientRow {
  id: Id;
  clientId: string;
  clientName: string;
  redirectUris: string[];
  /** Hash only; public clients (PKCE) have none. */
  clientSecretHash: string | null;
  clientSecretSalt: string | null;
  tokenEndpointAuthMethod: 'none' | 'client_secret_post' | 'client_secret_basic';
  grantTypes: string[];
  responseTypes: string[];
  scope: string;
  softwareId: string | null;
  createdAt: Timestamp;
}

export interface OauthCodeRow {
  id: Id;
  /** SHA-256 of the authorization code. */
  codeHash: string;
  clientId: string;
  userId: Id;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  scope: string;
  /** RFC 8707 resource indicator this code is bound to. */
  resource: string;
  expiresAt: Timestamp;
  usedAt: Timestamp | null;
  createdAt: Timestamp;
}

export type TokenKind = 'access' | 'refresh';

export interface OauthTokenRow {
  id: Id;
  tokenHash: string;
  kind: TokenKind;
  clientId: string;
  userId: Id;
  connectionId: Id | null;
  scope: string;
  /** Audience. Validated on every MCP request (RFC 8707 §2). */
  resource: string;
  expiresAt: Timestamp | null;
  revokedAt: Timestamp | null;
  createdAt: Timestamp;
  lastUsedAt: Timestamp | null;
  /** Shown once in the UI for personal access tokens so users can identify them. */
  displayHint: string | null;
}

/* -------------------------------------------------------------------------- */
/* Table registry                                                              */
/* -------------------------------------------------------------------------- */

export interface Tables {
  users: UserRow;
  sessions: SessionRow;
  workspaces: WorkspaceRow;
  workspaceMembers: WorkspaceMemberRow;
  projects: ProjectRow;
  projectFiles: ProjectFileRow;
  projectVersions: ProjectVersionRow;
  versionFiles: VersionFileRow;
  devices: DeviceRow;
  deviceEvents: DeviceEventRow;
  previewSessions: PreviewSessionRow;
  buildRuns: BuildRunRow;
  journeys: JourneyRow;
  journeySteps: JourneyStepRow;
  journeyRuns: JourneyRunRow;
  shareLinks: ShareLinkRow;
  commentThreads: CommentThreadRow;
  comments: CommentRow;
  mcpConnections: McpConnectionRow;
  mcpAuditLogs: McpAuditLogRow;
  oauthClients: OauthClientRow;
  oauthCodes: OauthCodeRow;
  oauthTokens: OauthTokenRow;
}

export type TableName = keyof Tables;
export type Row<T extends TableName> = Tables[T];

export const TABLE_NAMES: readonly TableName[] = [
  'users',
  'sessions',
  'workspaces',
  'workspaceMembers',
  'projects',
  'projectFiles',
  'projectVersions',
  'versionFiles',
  'devices',
  'deviceEvents',
  'previewSessions',
  'buildRuns',
  'journeys',
  'journeySteps',
  'journeyRuns',
  'shareLinks',
  'commentThreads',
  'comments',
  'mcpConnections',
  'mcpAuditLogs',
  'oauthClients',
  'oauthCodes',
  'oauthTokens',
] as const;
