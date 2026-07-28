import { newToken } from '../core/ids';
import { getBus, projectChannel } from './bus';

/**
 * Server → studio requests that need an answer.
 *
 * Some MCP tools (`capture_device`, `refresh_devices`) need something only a
 * browser can do: the phones live in an open studio tab. Rather than pretend, the
 * server publishes a request on the project channel, a connected studio performs
 * it and POSTs the answer back, and the pending promise resolves.
 *
 * If no studio is open the promise times out and the tool says so plainly instead
 * of inventing a result. Pending requests are process-local, which is fine because
 * the SSE stream that carries them is too.
 */

interface Pending {
  resolve: (value: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

const globalRef = globalThis as typeof globalThis & {
  __phonelabPendingRpc?: Map<string, Pending>;
};

function pending(): Map<string, Pending> {
  if (!globalRef.__phonelabPendingRpc) globalRef.__phonelabPendingRpc = new Map();
  return globalRef.__phonelabPendingRpc;
}

export interface StudioRequestResult<T> {
  ok: boolean;
  value: T | null;
  /** True when no studio answered in time. */
  timedOut: boolean;
  requestId: string;
}

export async function askStudio<T>(
  projectId: string,
  event: string,
  payload: Record<string, unknown>,
  timeoutMs = 6_000,
): Promise<StudioRequestResult<T>> {
  const requestId = `rpc_${newToken(9)}`;

  const answer = new Promise<unknown>((resolve) => {
    const timer = setTimeout(() => {
      pending().delete(requestId);
      resolve(undefined);
    }, timeoutMs);
    pending().set(requestId, { resolve, timer });
  });

  getBus().publish(projectChannel(projectId), event, { ...payload, requestId });

  const value = await answer;
  if (value === undefined) return { ok: false, value: null, timedOut: true, requestId };
  return { ok: true, value: value as T, timedOut: false, requestId };
}

/** Called by the route the studio posts its answer to. */
export function answerStudioRequest(requestId: string, value: unknown): boolean {
  const entry = pending().get(requestId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending().delete(requestId);
  entry.resolve(value);
  return true;
}

/** Realtime event names for studio-directed requests. */
export const STUDIO_RPC = {
  captureDevice: 'studio.capture-device',
  refreshDevices: 'studio.refresh-devices',
} as const;
