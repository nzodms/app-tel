import { LIMITS } from '../core/limits';
import { newId } from '../core/ids';
import type { Id, McpAuditLogRow, McpAuditResult, Store } from '../db';
import { RT, getBus, projectChannel } from '../realtime/bus';

/**
 * MCP audit trail.
 *
 * Every tool call is recorded: who, which project, which tool, what arguments
 * (redacted), the outcome and how long it took. The Claude panel in the studio is
 * a live view of this table — so "what did Claude just do to my project" always
 * has a concrete answer.
 */

const MAX_AUDIT_ROWS = 500;

export interface AuditInput {
  userId: Id | null;
  projectId: Id | null;
  connectionId: Id | null;
  tool: string;
  args: Record<string, unknown>;
  result: McpAuditResult;
  errorMessage?: string | null;
  durationMs: number;
}

export async function recordToolCall(store: Store, input: AuditInput): Promise<McpAuditLogRow> {
  const row: McpAuditLogRow = {
    id: newId('aud'),
    userId: input.userId,
    projectId: input.projectId,
    connectionId: input.connectionId,
    tool: input.tool,
    args: redactArgs(input.args),
    result: input.result,
    errorMessage: input.errorMessage?.slice(0, 500) ?? null,
    durationMs: input.durationMs,
    createdAt: new Date().toISOString(),
  };

  await store.insert('mcpAuditLogs', row);

  if (input.projectId) {
    getBus().publish(projectChannel(input.projectId), RT.mcpActivity, row);
  }

  await trim(store, input.userId);
  return row;
}

export async function listAuditLogs(
  store: Store,
  filter: { userId?: Id; projectId?: Id; limit?: number },
): Promise<McpAuditLogRow[]> {
  return store.select('mcpAuditLogs', {
    match: {
      ...(filter.userId ? { userId: filter.userId } : {}),
      ...(filter.projectId ? { projectId: filter.projectId } : {}),
    },
    orderBy: [{ col: 'createdAt', dir: 'desc' }],
    limit: Math.min(filter.limit ?? 50, 200),
  });
}

/**
 * Keeps whole file bodies and anything secret-shaped out of the audit log: the
 * trail should say *what* changed, not duplicate the payload.
 */
export function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const SENSITIVE = /password|secret|token|authorization|apikey|api_key/i;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args ?? {})) {
    if (SENSITIVE.test(key)) {
      out[key] = '[redacted]';
      continue;
    }
    if (typeof value === 'string') {
      out[key] =
        value.length > 240 ? `${value.slice(0, 240)}… (${value.length} chars)` : value;
      continue;
    }
    if (Array.isArray(value)) {
      out[key] =
        value.length > 20
          ? `[${value.length} items]`
          : value.map((item) =>
              typeof item === 'string' && item.length > 160
                ? `${item.slice(0, 160)}… (${item.length} chars)`
                : item,
            );
      continue;
    }
    if (value !== null && typeof value === 'object') {
      const nested = redactArgs(value as Record<string, unknown>);
      out[key] = nested;
      continue;
    }
    out[key] = value;
  }
  return out;
}

async function trim(store: Store, userId: Id | null): Promise<void> {
  if (!userId) return;
  const total = await store.count('mcpAuditLogs', { match: { userId } });
  const excess = total - MAX_AUDIT_ROWS;
  if (excess <= 0) return;
  const oldest = await store.select('mcpAuditLogs', {
    match: { userId },
    orderBy: [{ col: 'createdAt', dir: 'asc' }],
    limit: excess,
  });
  for (const row of oldest) await store.remove('mcpAuditLogs', row.id);
}

/* -------------------------------------------------------------------------- */
/* Rate limiting                                                               */
/* -------------------------------------------------------------------------- */

interface Bucket {
  hits: number[];
}

const globalRef = globalThis as typeof globalThis & {
  __phonelabRateBuckets?: Map<string, Bucket>;
};

function buckets(): Map<string, Bucket> {
  if (!globalRef.__phonelabRateBuckets) globalRef.__phonelabRateBuckets = new Map();
  return globalRef.__phonelabRateBuckets;
}

/**
 * Sliding-window limiter, per key, in-process.
 *
 * Sufficient for a single-instance deployment and honest about it: in a
 * multi-instance setup this must move to a shared store (documented in
 * docs/STATUS.md). It is *not* the only protection — capabilities and size limits
 * are enforced regardless.
 */
export function checkRateLimit(
  key: string,
  limit: number = LIMITS.mcpCallsPerMinute,
  windowMs = 60_000,
): { allowed: boolean; remaining: number; resetInMs: number } {
  const now = Date.now();
  const bucket = buckets().get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((at) => now - at < windowMs);

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0] ?? now;
    buckets().set(key, bucket);
    return { allowed: false, remaining: 0, resetInMs: windowMs - (now - oldest) };
  }

  bucket.hits.push(now);
  buckets().set(key, bucket);
  return { allowed: true, remaining: limit - bucket.hits.length, resetInMs: windowMs };
}
