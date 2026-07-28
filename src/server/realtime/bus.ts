/**
 * Realtime fan-out.
 *
 * PhoneLab needs *push*, not polling: an MCP tool writes a file and every open
 * studio tab must see the tree, the editor, the logs and the phones update.
 *
 * The default driver is in-process and feeds Server-Sent Events streams
 * (`/api/realtime`). That is genuinely push-based and survives page reloads via
 * `Last-Event-ID` replay from a small ring buffer. It is scoped to one Node
 * process, which covers `next dev`, a container, or a single-instance deploy.
 *
 * For multi-instance deployments the same interface is meant to be backed by a
 * broker (Supabase Realtime / Redis). That adapter is *not* implemented in V1 —
 * see docs/STATUS.md, "what is not built yet".
 */

export interface RealtimeMessage {
  /** Monotonic within the process; used as the SSE event id. */
  seq: number;
  channel: string;
  event: string;
  payload: unknown;
  at: string;
}

export type RealtimeHandler = (message: RealtimeMessage) => void;

export interface RealtimeBus {
  publish(channel: string, event: string, payload?: unknown): RealtimeMessage;
  subscribe(channel: string, handler: RealtimeHandler): () => void;
  /** Messages after `afterSeq`, for reconnect replay. */
  replay(channel: string, afterSeq: number): RealtimeMessage[];
}

const RING_SIZE = 200;

class InProcessBus implements RealtimeBus {
  private seq = 0;
  private readonly handlers = new Map<string, Set<RealtimeHandler>>();
  private readonly history = new Map<string, RealtimeMessage[]>();

  publish(channel: string, event: string, payload: unknown = null): RealtimeMessage {
    this.seq += 1;
    const message: RealtimeMessage = {
      seq: this.seq,
      channel,
      event,
      payload,
      at: new Date().toISOString(),
    };

    const ring = this.history.get(channel) ?? [];
    ring.push(message);
    if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE);
    this.history.set(channel, ring);

    for (const handler of this.handlers.get(channel) ?? []) {
      try {
        handler(message);
      } catch (error) {
        console.error('[phonelab] realtime handler failed', error);
      }
    }
    return message;
  }

  subscribe(channel: string, handler: RealtimeHandler): () => void {
    const set = this.handlers.get(channel) ?? new Set<RealtimeHandler>();
    set.add(handler);
    this.handlers.set(channel, set);
    return () => {
      set.delete(handler);
      if (set.size === 0) this.handlers.delete(channel);
    };
  }

  replay(channel: string, afterSeq: number): RealtimeMessage[] {
    return (this.history.get(channel) ?? []).filter((message) => message.seq > afterSeq);
  }
}

/**
 * Survive Next.js dev hot-reloads: the module graph is re-evaluated but the
 * process (and its open SSE streams) is not.
 */
const globalRef = globalThis as typeof globalThis & { __phonelabBus?: RealtimeBus };

export function getBus(): RealtimeBus {
  if (!globalRef.__phonelabBus) globalRef.__phonelabBus = new InProcessBus();
  return globalRef.__phonelabBus;
}

export const projectChannel = (projectId: string) => `project:${projectId}`;

/** Events published on a project channel. Keep this list in sync with the client. */
export const RT = {
  fileChanged: 'file.changed',
  fileDeleted: 'file.deleted',
  fileCreated: 'file.created',
  treeChanged: 'tree.changed',
  buildStarted: 'build.started',
  buildFinished: 'build.finished',
  previewChanged: 'preview.changed',
  versionCreated: 'version.created',
  versionRestored: 'version.restored',
  projectChanged: 'project.changed',
  deviceChanged: 'device.changed',
  deviceRemoved: 'device.removed',
  eventLogged: 'event.logged',
  deviceEvent: 'device.event',
  journeyChanged: 'journey.changed',
  journeyProgress: 'journey.progress',
  commentChanged: 'comment.changed',
  shareChanged: 'share.changed',
  mcpActivity: 'mcp.activity',
} as const;

export type RealtimeEventName = (typeof RT)[keyof typeof RT];
