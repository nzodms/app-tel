'use client';

import type { HostMessage } from '@/lib/preview/protocol';

/**
 * Registry of live preview iframes, keyed by device id.
 *
 * DOM handles do not belong in application state, so they live here. Two things
 * matter:
 *
 *  - each frame has its own nonce, minted before the iframe is created and passed
 *    in its URL; every message we post carries it, and the frame drops anything
 *    that does not match. Combined with the frame's opaque origin (it runs with
 *    `sandbox="allow-scripts"`), that gives a channel other frames cannot forge.
 *  - messages sent before a frame reports `preview:ready` are queued, so callers
 *    never have to think about frame lifecycle.
 */

interface Entry {
  iframe: HTMLIFrameElement;
  nonce: string;
  ready: boolean;
  queue: HostMessage[];
}

type MessageWithoutNonce =
  | Omit<Extract<HostMessage, { type: 'host:init' }>, 'nonce'>
  | Omit<Extract<HostMessage, { type: 'host:load' }>, 'nonce'>
  | Omit<Extract<HostMessage, { type: 'host:context' }>, 'nonce'>
  | Omit<Extract<HostMessage, { type: 'host:shared' }>, 'nonce'>
  | Omit<Extract<HostMessage, { type: 'host:event' }>, 'nonce'>
  | Omit<Extract<HostMessage, { type: 'host:navigate' }>, 'nonce'>
  | Omit<Extract<HostMessage, { type: 'host:inspect' }>, 'nonce'>
  | Omit<Extract<HostMessage, { type: 'host:highlight' }>, 'nonce'>
  | Omit<Extract<HostMessage, { type: 'host:replay' }>, 'nonce'>
  | Omit<Extract<HostMessage, { type: 'host:snapshot' }>, 'nonce'>
  | Omit<Extract<HostMessage, { type: 'host:reset' }>, 'nonce'>;

class PreviewRegistry {
  private readonly entries = new Map<string, Entry>();
  /**
   * One nonce per device, for the lifetime of the page.
   *
   * It used to be minted inside `PreviewFrame` with `useMemo`, so every remount
   * produced a new one. React StrictMode remounts every component in
   * development, which left the registry holding one generation's nonces while
   * the live frames announced themselves with another — `resolve()` then
   * rejected every message from the real frame, the handshake never completed,
   * and the phone waited forever on a build that had already succeeded.
   *
   * Keying it to the device removes the generation entirely: whichever frame is
   * live for a device presents the same nonce the registry expects. The security
   * property is unchanged — it is still an unguessable value the frame must echo,
   * and `resolve()` still requires the message to come from that exact window.
   */
  private readonly nonces = new Map<string, string>();

  /** The stable nonce for a device, minted on first use. */
  nonceForDevice(deviceId: string): string {
    let nonce = this.nonces.get(deviceId);
    if (!nonce) {
      nonce = crypto.randomUUID().replace(/-/g, '');
      this.nonces.set(deviceId, nonce);
    }
    return nonce;
  }

  /**
   * Registers a frame, or re-registers the same one without losing its state.
   *
   * Re-registration is not hypothetical: React StrictMode runs every effect
   * twice in development (mount, cleanup, mount), and the iframe element itself
   * survives that — so it never reloads and never re-announces `preview:ready`.
   * The old implementation reset `ready` to false on the second register, which
   * left the frame permanently un-ready: every message queued forever and the
   * phone sat on "Waiting for build…" behind a perfectly green build.
   *
   * So the same iframe with the same nonce keeps whatever it had. Only a
   * genuinely different frame starts from scratch.
   */
  register(deviceId: string, iframe: HTMLIFrameElement, nonce: string): void {
    const existing = this.entries.get(deviceId);
    const sameFrame = existing?.iframe === iframe && existing.nonce === nonce;
    this.entries.set(deviceId, {
      iframe,
      nonce,
      ready: sameFrame ? existing.ready : false,
      queue: existing?.queue ?? [],
    });
  }

  /**
   * Drops a frame — unless it has already been replaced by a live registration.
   *
   * StrictMode's cleanup fires *after* the second `register` in some orderings,
   * which would otherwise delete the entry that is actually in use.
   */
  unregister(deviceId: string, iframe?: HTMLIFrameElement): void {
    const existing = this.entries.get(deviceId);
    if (!existing) return;
    if (iframe && existing.iframe !== iframe) return;
    this.entries.delete(deviceId);
  }

  /**
   * Any message from a frame proves it is listening.
   *
   * The `preview:ready` announcement is sent once and can be missed — if it is,
   * nothing else would ever mark the frame ready and the queue never drains.
   * Treating any inbound message as proof of life removes that dead end.
   */
  markReadyFromInbound(deviceId: string): void {
    const entry = this.entries.get(deviceId);
    if (!entry || entry.ready) return;
    this.markReady(deviceId);
  }

  /** Called when a frame reports `preview:ready`; flushes anything queued. */
  markReady(deviceId: string): void {
    const entry = this.entries.get(deviceId);
    if (!entry) return;
    entry.ready = true;
    const queued = entry.queue;
    entry.queue = [];
    for (const message of queued) this.deliver(entry, message);
  }

  isReady(deviceId: string): boolean {
    return this.entries.get(deviceId)?.ready ?? false;
  }

  nonceFor(deviceId: string): string | null {
    return this.entries.get(deviceId)?.nonce ?? null;
  }

  /** Verifies that a message really came from this device's frame. */
  matches(deviceId: string, source: MessageEventSource | null, nonce: string): boolean {
    const entry = this.entries.get(deviceId);
    if (!entry) return false;
    // The window is the proof; see `resolve`.
    if (source !== entry.iframe.contentWindow) return false;
    if (entry.nonce !== nonce && nonce) entry.nonce = nonce;
    return true;
  }

  /**
   * Maps an incoming message back to the device that sent it.
   *
   * Both halves must agree: the nonce has to be one we minted, *and* the message
   * has to come from that exact frame's window. A frame cannot impersonate another.
   */
  resolve(source: MessageEventSource | null, nonce: string): string | null {
    if (!source) return null;

    for (const [deviceId, entry] of this.entries) {
      if (source !== entry.iframe.contentWindow) continue;

      /*
       * Identity comes from the window, not the nonce.
       *
       * `event.source` is the unforgeable half: only that exact frame can be the
       * source of its own message, and a sandboxed frame cannot obtain another
       * frame's window. The nonce is the weaker half — it exists so the *frame*
       * can reject messages that did not come from us.
       *
       * Requiring both to match here made the studio brittle for no security
       * gain: React can produce a frame generation whose nonce the registry no
       * longer holds, and every message from the real, live frame was then
       * silently dropped. The handshake never completed and the phone waited
       * forever on a build that had already succeeded.
       *
       * So: trust the window, and re-sync the nonce from what the frame actually
       * presents, so host→frame messages keep being accepted on the other side.
       */
      if (entry.nonce !== nonce && nonce) entry.nonce = nonce;
      return deviceId;
    }
    return null;
  }

  post(deviceId: string, message: MessageWithoutNonce): void {
    const entry = this.entries.get(deviceId);
    if (!entry) return;
    const withNonce = { ...message, nonce: entry.nonce } as HostMessage;
    // Queue everything until the frame is listening, `host:init` included. It
    // used to be exempted and posted immediately — straight past a frame that had
    // not installed its listener yet, so the context arrived nowhere and the
    // first load ran without one.
    if (!entry.ready) {
      entry.queue.push(withNonce);
      return;
    }
    this.deliver(entry, withNonce);
  }

  broadcast(message: MessageWithoutNonce, deviceIds?: readonly string[]): void {
    const targets = deviceIds ?? [...this.entries.keys()];
    for (const deviceId of targets) this.post(deviceId, message);
  }

  deviceIds(): string[] {
    return [...this.entries.keys()];
  }

  private deliver(entry: Entry, message: HostMessage): void {
    // The frame's origin is opaque ("null"), so '*' is the only usable target; the
    // nonce plus the frame's own `event.source` check is what authenticates it.
    entry.iframe.contentWindow?.postMessage(message, '*');
  }
}

export const previewRegistry = new PreviewRegistry();
