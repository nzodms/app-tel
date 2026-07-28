'use client';

import { useEffect } from 'react';
import { useStudioApi } from './context';

/**
 * Subscribes the studio to its project's realtime stream.
 *
 * This is the wire that makes "Claude edited a file" show up without a refresh:
 * the service publishes, the SSE route forwards, and the store reconciles. The
 * browser's own `EventSource` handles reconnection and `Last-Event-ID`, so a
 * dropped connection catches up instead of losing events.
 */
export function useRealtime(projectId: string): void {
  const store = useStudioApi();

  useEffect(() => {
    const source = new EventSource(`/api/realtime?projectId=${encodeURIComponent(projectId)}`);

    const forward = (event: string) => (message: MessageEvent<string>) => {
      let payload: unknown = null;
      try {
        payload = message.data ? JSON.parse(message.data) : null;
      } catch {
        payload = message.data;
      }
      store.getState().applyRealtime(event, payload);
    };

    // Named events, so the store can switch on them directly.
    const names = [
      'file.changed',
      'file.created',
      'file.deleted',
      'tree.changed',
      'build.started',
      'build.finished',
      'preview.changed',
      'version.created',
      'version.restored',
      'project.changed',
      'device.changed',
      'device.removed',
      'event.logged',
      'device.event',
      'journey.changed',
      'journey.progress',
      'comment.changed',
      'share.changed',
      'mcp.activity',
      'studio.capture-device',
      'studio.refresh-devices',
    ];

    const handlers = names.map((name) => {
      const handler = forward(name);
      source.addEventListener(name, handler as EventListener);
      return { name, handler };
    });

    source.onerror = () => {
      // EventSource retries on its own using the `retry` hint from the server; a
      // transient error is not worth surfacing to the user.
    };

    return () => {
      for (const { name, handler } of handlers) {
        source.removeEventListener(name, handler as EventListener);
      }
      source.close();
    };
  }, [projectId, store]);
}
