import { getStore } from '@/server/db';
import { requireActor } from '@/server/http/session';
import { requireProjectAccess } from '@/server/services/access';
import { getBus, projectChannel } from '@/server/realtime/bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Server-Sent Events stream for one project.
 *
 * This is how a change made by Claude over MCP reaches an open studio: the service
 * publishes on the project channel, this stream forwards it, and the client
 * reconciles. No polling.
 *
 * `Last-Event-ID` is honoured from a small ring buffer, so a dropped connection
 * catches up instead of silently missing events. A comment line every 25s keeps
 * proxies from closing an idle stream.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');
  if (!projectId) {
    return new Response('projectId is required', { status: 400 });
  }

  const { actor } = await requireActor();
  const store = getStore();
  // Throws 404 if this user cannot see the project — the stream is access-checked
  // exactly like every other read.
  await requireProjectAccess(store, actor, projectId, 'read');

  const bus = getBus();
  const channel = projectChannel(projectId);
  const lastEventId = Number(request.headers.get('last-event-id') ?? '0');

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: string) => {
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // The client went away between the publish and this write.
        }
      };

      send(`retry: 3000\n\n`);
      send(`event: open\ndata: ${JSON.stringify({ projectId, at: new Date().toISOString() })}\n\n`);

      if (Number.isFinite(lastEventId) && lastEventId > 0) {
        for (const message of bus.replay(channel, lastEventId)) {
          send(
            `id: ${message.seq}\nevent: ${message.event}\ndata: ${JSON.stringify(message.payload)}\n\n`,
          );
        }
      }

      unsubscribe = bus.subscribe(channel, (message) => {
        send(
          `id: ${message.seq}\nevent: ${message.event}\ndata: ${JSON.stringify(message.payload)}\n\n`,
        );
      });

      heartbeat = setInterval(() => send(`: ping\n\n`), 25_000);

      request.signal.addEventListener('abort', () => {
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
