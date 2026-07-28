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

  register(deviceId: string, iframe: HTMLIFrameElement, nonce: string): void {
    const existing = this.entries.get(deviceId);
    this.entries.set(deviceId, {
      iframe,
      nonce,
      ready: false,
      queue: existing?.queue ?? [],
    });
  }

  unregister(deviceId: string): void {
    this.entries.delete(deviceId);
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
    if (entry.nonce !== nonce) return false;
    return source === entry.iframe.contentWindow;
  }

  /**
   * Maps an incoming message back to the device that sent it.
   *
   * Both halves must agree: the nonce has to be one we minted, *and* the message
   * has to come from that exact frame's window. A frame cannot impersonate another.
   */
  resolve(source: MessageEventSource | null, nonce: string): string | null {
    for (const [deviceId, entry] of this.entries) {
      if (entry.nonce === nonce && source === entry.iframe.contentWindow) return deviceId;
    }
    return null;
  }

  post(deviceId: string, message: MessageWithoutNonce): void {
    const entry = this.entries.get(deviceId);
    if (!entry) return;
    const withNonce = { ...message, nonce: entry.nonce } as HostMessage;
    if (!entry.ready && message.type !== 'host:init') {
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
