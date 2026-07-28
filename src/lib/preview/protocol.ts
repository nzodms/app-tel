/**
 * The preview bridge protocol.
 *
 * Shared by the studio (parent window) and the sandboxed preview runtime. Both
 * sides validate the `nonce`: the preview iframe runs with
 * `sandbox="allow-scripts"` and therefore has an *opaque* origin, so
 * `event.origin` is the string `"null"` and cannot be used for authentication.
 * Instead:
 *
 *   - the parent mints a random nonce per device and passes it in the iframe URL;
 *   - every message in both directions carries it;
 *   - the parent additionally checks `event.source === iframe.contentWindow`.
 *
 * That gives us a channel that other frames on the page cannot forge or read.
 */

export const PREVIEW_PROTOCOL_VERSION = 1;

export type IslandState =
  | 'idle'
  | 'compact'
  | 'notification'
  | 'activity'
  | 'timer'
  | 'call'
  | 'payment'
  | 'delivery';

export interface PreviewDeviceContext {
  deviceId: string;
  deviceName: string;
  role: string;
  userLabel: string | null;
  theme: 'light' | 'dark';
  locale: string;
  network: 'fast' | 'slow' | 'offline';
  /** Edge Case Studio flags currently applied to this device. */
  flags: string[];
  versionLabel: string | null;
  /** Logical viewport, in CSS pixels, of the phone this preview is inside. */
  viewport: { width: number; height: number };
  safeArea: { top: number; bottom: number };
}

/* ------------------------------- parent -> preview ------------------------ */

export type HostMessage =
  | { type: 'host:init'; nonce: string; context: PreviewDeviceContext; shared: Record<string, unknown> }
  | { type: 'host:load'; nonce: string; code: string; hash: string }
  | { type: 'host:context'; nonce: string; context: PreviewDeviceContext }
  | { type: 'host:shared'; nonce: string; shared: Record<string, unknown> }
  | {
      type: 'host:event';
      nonce: string;
      event: { name: string; payload: unknown; fromDeviceId: string | null; fromRole: string | null; at: string };
    }
  | { type: 'host:navigate'; nonce: string; route: string; params?: Record<string, string> }
  | { type: 'host:inspect'; nonce: string; enabled: boolean }
  | { type: 'host:highlight'; nonce: string; sourceRef: string | null }
  | { type: 'host:replay'; nonce: string; step: ReplayStep }
  | { type: 'host:snapshot'; nonce: string; requestId: string }
  | { type: 'host:reset'; nonce: string };

export interface ReplayStep {
  kind: 'tap' | 'input' | 'navigate' | 'event' | 'assert';
  /** Stable target: a `data-pl-id`, else visible label text. */
  target?: string;
  label?: string;
  value?: string;
  route?: string;
  eventName?: string;
  payload?: unknown;
}

/* ------------------------------- preview -> parent ------------------------ */

export type PreviewMessage =
  | { type: 'preview:ready'; nonce: string; protocol: number }
  | { type: 'preview:mounted'; nonce: string; route: string; hash: string }
  | { type: 'preview:navigate'; nonce: string; route: string; from: string | null; title: string | null }
  | {
      type: 'preview:interaction';
      nonce: string;
      action: string;
      label: string | null;
      sourceRef: string | null;
      target: string | null;
      route: string;
    }
  | {
      type: 'preview:emit';
      nonce: string;
      name: string;
      payload: unknown;
      /** Role slug, device id, or `all`. */
      to: string;
    }
  | { type: 'preview:notify'; nonce: string; notification: PreviewNotification }
  | { type: 'preview:shared-set'; nonce: string; key: string; value: unknown }
  | { type: 'preview:log'; nonce: string; level: 'debug' | 'info' | 'warn' | 'error'; message: string }
  | { type: 'preview:error'; nonce: string; message: string; stack: string | null; phase: 'mount' | 'render' | 'runtime' }
  | { type: 'preview:inspect'; nonce: string; sourceRef: string | null; label: string | null; rect: DomRect }
  | { type: 'preview:snapshot'; nonce: string; requestId: string; snapshot: PreviewSnapshot };

export interface DomRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreviewNotification {
  id: string;
  title: string;
  body: string | null;
  kind: 'default' | 'success' | 'warning' | 'error';
  island: IslandState;
  /** Milliseconds the banner stays on screen. */
  duration: number;
  badge: { key: string; value: number } | null;
  islandLabel: string | null;
}

export interface PreviewSnapshot {
  route: string;
  title: string | null;
  /** Visible text content, in document order, trimmed and de-duplicated. */
  texts: string[];
  /** Interactive elements the reviewer/agent can act on. */
  actions: { label: string; target: string | null; sourceRef: string | null }[];
  capturedAt: string;
}

/* --------------------------------- helpers -------------------------------- */

export function isPreviewMessage(value: unknown): value is PreviewMessage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { type?: unknown; nonce?: unknown };
  return (
    typeof candidate.type === 'string' &&
    candidate.type.startsWith('preview:') &&
    typeof candidate.nonce === 'string'
  );
}

export function isHostMessage(value: unknown): value is HostMessage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { type?: unknown; nonce?: unknown };
  return (
    typeof candidate.type === 'string' &&
    candidate.type.startsWith('host:') &&
    typeof candidate.nonce === 'string'
  );
}

/** `path:line:column` produced by esbuild's dev JSX transform. */
export function parseSourceRef(
  ref: string | null | undefined,
): { path: string; line: number; column: number } | null {
  if (!ref) return null;
  const match = /^(.*):(\d+):(\d+)$/.exec(ref);
  if (!match) return null;
  const [, path, line, column] = match;
  if (!path || !line || !column) return null;
  return { path, line: Number(line), column: Number(column) };
}
