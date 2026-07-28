import { LIMITS } from '../core/limits';
import { newId } from '../core/ids';
import type { DeviceEventRow, EventKind, EventLevel, Id, Store } from '../db';
import { RT, getBus, projectChannel } from '../realtime/bus';

/**
 * The timeline.
 *
 * One append-only stream per project backs the Logs panel, the timeline strip,
 * the Claude activity feed and journey recording. The server assigns `sequence`,
 * which is what makes replay and cross-device ordering deterministic rather than
 * dependent on which browser tab was fastest.
 */

export interface LogEventInput {
  kind: EventKind;
  name: string;
  level?: EventLevel;
  deviceId?: Id | null;
  targetDeviceId?: Id | null;
  payload?: Record<string, unknown>;
  screen?: string | null;
}

export async function logEvent(
  store: Store,
  projectId: Id,
  input: LogEventInput,
): Promise<DeviceEventRow> {
  const row = await store.transaction(async (tx) => {
    const last = await tx.find('deviceEvents', {
      match: { projectId },
      orderBy: [{ col: 'sequence', dir: 'desc' }],
    });
    const event: DeviceEventRow = {
      id: newId('evt'),
      projectId,
      sequence: (last?.sequence ?? 0) + 1,
      deviceId: input.deviceId ?? null,
      targetDeviceId: input.targetDeviceId ?? null,
      kind: input.kind,
      level: input.level ?? 'info',
      name: input.name.slice(0, 200),
      payload: truncatePayload(input.payload ?? {}),
      screen: input.screen ?? null,
      createdAt: new Date().toISOString(),
    };
    await tx.insert('deviceEvents', event);
    return event;
  });

  await trimEvents(store, projectId);

  const bus = getBus();
  bus.publish(projectChannel(projectId), RT.eventLogged, row);
  if (row.kind === 'device-event' || row.kind === 'notification') {
    bus.publish(projectChannel(projectId), RT.deviceEvent, row);
  }
  if (row.kind === 'mcp') {
    bus.publish(projectChannel(projectId), RT.mcpActivity, row);
  }
  return row;
}

export interface EventQuery {
  kinds?: readonly EventKind[];
  levels?: readonly EventLevel[];
  deviceId?: Id | null;
  /** Only events after this sequence — used by SSE catch-up. */
  afterSequence?: number;
  limit?: number;
}

export async function listEvents(
  store: Store,
  projectId: Id,
  query: EventQuery = {},
): Promise<DeviceEventRow[]> {
  const rows = await store.select('deviceEvents', {
    match: { projectId },
    where: query.afterSequence
      ? [{ col: 'sequence', op: 'gt', value: query.afterSequence }]
      : undefined,
    orderBy: [{ col: 'sequence', dir: 'desc' }],
    limit: Math.min(query.limit ?? 300, 1000),
  });

  const filtered = rows.filter((row) => {
    if (query.kinds && query.kinds.length > 0 && !query.kinds.includes(row.kind)) return false;
    if (query.levels && query.levels.length > 0 && !query.levels.includes(row.level)) return false;
    if (query.deviceId !== undefined && query.deviceId !== null && row.deviceId !== query.deviceId) {
      return false;
    }
    return true;
  });

  return filtered.reverse();
}

export async function clearEvents(store: Store, projectId: Id): Promise<number> {
  const removed = await store.removeWhere('deviceEvents', { match: { projectId } });
  getBus().publish(projectChannel(projectId), RT.eventLogged, { cleared: true });
  return removed;
}

/** Keeps the stream bounded; oldest events go first. */
async function trimEvents(store: Store, projectId: Id): Promise<void> {
  const total = await store.count('deviceEvents', { match: { projectId } });
  const excess = total - LIMITS.maxEventsPerProject;
  if (excess <= 0) return;

  const oldest = await store.select('deviceEvents', {
    match: { projectId },
    orderBy: [{ col: 'sequence', dir: 'asc' }],
    limit: excess,
  });
  for (const row of oldest) await store.remove('deviceEvents', row.id);
}

/** Guards against a runaway payload filling the store. */
function truncatePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const serialised = JSON.stringify(payload ?? {});
  if (serialised.length <= 8_000) return payload;
  return {
    truncated: true,
    preview: `${serialised.slice(0, 4_000)}…`,
    originalLength: serialised.length,
  };
}
