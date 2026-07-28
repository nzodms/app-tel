import type {
  BuildRunRow,
  DeviceEventRow,
  DeviceRow,
  Diagnostic,
  JourneyRow,
  McpAuditLogRow,
  ProjectRow,
} from '@/server/db';
import type { FileSummary, TreeNode } from '@/server/services/files';
import type { VersionSummary } from '@/server/services/versions';
import type { ThreadWithComments } from '@/server/services/comments';
import type { PublicShareLink } from '@/server/services/shares';
import type { ProjectRoleInfo } from '@/server/services/projects';
import type { PublicUser } from '@/server/services/auth';

/** Everything the studio needs on first paint, rendered on the server. */
export interface StudioSnapshot {
  user: PublicUser;
  project: ProjectRow;
  roles: ProjectRoleInfo[];
  files: FileSummary[];
  tree: TreeNode[];
  devices: DeviceRow[];
  versions: VersionSummary[];
  journeys: JourneyRow[];
  events: DeviceEventRow[];
  threads: ThreadWithComments[];
  shares: PublicShareLink[];
  lastBuild: BuildRunRow | null;
  diagnostics: Diagnostic[];
  mcp: McpStatus;
  baseUrl: string;
  storeKind: 'local' | 'supabase';
}

export interface McpStatus {
  /** A connection exists and has been used. */
  connected: boolean;
  connectionCount: number;
  lastUsedAt: string | null;
  connections: {
    id: string;
    name: string;
    scopes: string[];
    lastUsedAt: string | null;
    protocolVersion: string | null;
    toolCallCount: number;
  }[];
  recentCalls: McpAuditLogRow[];
  endpoint: string;
}

export type BundleRef = 'working' | (string & {});

export interface BundleState {
  ref: BundleRef;
  status: 'idle' | 'building' | 'ready' | 'error';
  code: string | null;
  hash: string | null;
  diagnostics: Diagnostic[];
  durationMs: number | null;
  bytes: number | null;
  error: string | null;
}

export type LeftTab = 'files' | 'code' | 'logs' | 'versions' | 'claude' | 'comments';

export interface OpenFile {
  path: string;
  /** Dirty buffer, or null when the tab matches the saved file. */
  draft: string | null;
  /** `updatedAt` of the version we loaded, for conflict detection. */
  baseUpdatedAt: string | null;
  content: string | null;
  loading: boolean;
  error: string | null;
}

export interface RecordedStep {
  kind: 'tap' | 'input' | 'navigate' | 'event' | 'wait' | 'note';
  label: string;
  deviceId: string | null;
  deviceRole: string | null;
  payload: Record<string, unknown>;
  waitMs: number;
  at: number;
}

export interface InspectorTarget {
  deviceId: string;
  sourceRef: string | null;
  label: string | null;
  rect: { x: number; y: number; width: number; height: number };
}

export interface CompareState {
  active: boolean;
  baseRef: BundleRef;
  targetRef: BundleRef;
  /** Mirror navigation between the two comparison phones. */
  syncNavigation: boolean;
  /** File selected in the diff view. */
  path: string | null;
}
