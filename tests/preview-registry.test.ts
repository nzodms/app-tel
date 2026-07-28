import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The handshake that decides whether a phone ever shows anything.
 *
 * A compiled bundle reaches a phone only if the studio can map an inbound
 * `preview:ready` back to a device. That mapping was failing, and the symptom
 * was brutal and misleading: the build badge read "Built in 57ms" while both
 * phones sat on "Waiting for build…" forever. Nothing was broken about the
 * build — the code was sitting in a queue behind a frame the registry still
 * believed was not listening.
 *
 * Two causes, both covered here:
 *  - `resolve()` required the nonce to match as well as the window, and React
 *    can produce a frame generation whose nonce the registry no longer holds.
 *  - a re-registration of the same frame reset `ready`, so the one-shot
 *    announcement was never replaced.
 */

// A minimal stand-in for an iframe: only `contentWindow` identity matters.
function fakeFrame(label: string): HTMLIFrameElement {
  const contentWindow = { label, postMessage: vi.fn() };
  return { contentWindow } as unknown as HTMLIFrameElement;
}

let registry: typeof import('@/components/studio/preview-registry').previewRegistry;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('crypto', { randomUUID: () => `nonce-${Math.random().toString(36).slice(2)}` });
  ({ previewRegistry: registry } = await import('@/components/studio/preview-registry'));
});

describe('resolving a frame back to its device', () => {
  it('identifies by window, so a stale nonce cannot orphan a live frame', () => {
    const frame = fakeFrame('a');
    registry.register('dev_1', frame, 'nonce-registered');

    // The frame presents a nonce the registry has never seen — exactly the
    // situation that dropped every message from the real frame.
    const resolved = registry.resolve(frame.contentWindow, 'nonce-from-a-later-generation');
    expect(resolved).toBe('dev_1');
  });

  it('re-syncs the nonce so host→frame messages keep being accepted', () => {
    const frame = fakeFrame('a');
    registry.register('dev_1', frame, 'old');
    registry.resolve(frame.contentWindow, 'new');
    expect(registry.nonceFor('dev_1')).toBe('new');
  });

  it('still refuses a window that belongs to no registered frame', () => {
    registry.register('dev_1', fakeFrame('a'), 'n1');
    expect(registry.resolve(fakeFrame('impostor').contentWindow, 'n1')).toBeNull();
  });

  it('never resolves a null source', () => {
    registry.register('dev_1', fakeFrame('a'), 'n1');
    expect(registry.resolve(null, 'n1')).toBeNull();
  });

  it('keeps devices apart: one frame cannot answer for another', () => {
    const one = fakeFrame('one');
    const two = fakeFrame('two');
    registry.register('dev_1', one, 'n1');
    registry.register('dev_2', two, 'n2');

    expect(registry.resolve(one.contentWindow, 'n1')).toBe('dev_1');
    expect(registry.resolve(two.contentWindow, 'n1')).toBe('dev_2');
  });
});

describe('readiness survives a re-registration', () => {
  it('keeps ready when the same frame registers again', () => {
    const frame = fakeFrame('a');
    registry.register('dev_1', frame, 'n1');
    registry.markReady('dev_1');
    expect(registry.isReady('dev_1')).toBe(true);

    // React StrictMode: mount, cleanup, mount — same element throughout, so the
    // frame never reloads and never re-announces.
    registry.register('dev_1', frame, 'n1');
    expect(registry.isReady('dev_1')).toBe(true);
  });

  it('starts fresh for a genuinely different frame', () => {
    registry.register('dev_1', fakeFrame('a'), 'n1');
    registry.markReady('dev_1');
    registry.register('dev_1', fakeFrame('b'), 'n2');
    expect(registry.isReady('dev_1')).toBe(false);
  });

  it('a cleanup for an already-replaced frame does not delete the live entry', () => {
    const old = fakeFrame('old');
    const live = fakeFrame('live');
    registry.register('dev_1', old, 'n1');
    registry.register('dev_1', live, 'n2');

    registry.unregister('dev_1', old);
    expect(registry.resolve(live.contentWindow, 'n2')).toBe('dev_1');
  });

  it('any inbound message marks a frame ready, so a missed announcement recovers', () => {
    const frame = fakeFrame('a');
    registry.register('dev_1', frame, 'n1');
    expect(registry.isReady('dev_1')).toBe(false);

    registry.markReadyFromInbound('dev_1');
    expect(registry.isReady('dev_1')).toBe(true);
  });
});

describe('queueing until the frame is listening', () => {
  it('holds every message, including host:init, then flushes in order', () => {
    const frame = fakeFrame('a');
    registry.register('dev_1', frame, 'n1');

    registry.post('dev_1', { type: 'host:init', context: {}, shared: {} } as never);
    registry.post('dev_1', { type: 'host:load', code: 'x', hash: 'h' } as never);

    const post = frame.contentWindow!.postMessage as unknown as ReturnType<typeof vi.fn>;
    // `host:init` used to be posted immediately — straight past a frame that had
    // not installed its listener yet.
    expect(post).not.toHaveBeenCalled();

    registry.markReady('dev_1');
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0]?.[0]).toMatchObject({ type: 'host:init' });
    expect(post.mock.calls[1]?.[0]).toMatchObject({ type: 'host:load' });
  });

  it('delivers immediately once ready', () => {
    const frame = fakeFrame('a');
    registry.register('dev_1', frame, 'n1');
    registry.markReady('dev_1');
    registry.post('dev_1', { type: 'host:load', code: 'x', hash: 'h' } as never);
    expect(frame.contentWindow!.postMessage).toHaveBeenCalledTimes(1);
  });

  it('stamps the device nonce onto everything it sends', () => {
    const frame = fakeFrame('a');
    registry.register('dev_1', frame, 'n1');
    registry.markReady('dev_1');
    registry.post('dev_1', { type: 'host:load', code: 'x', hash: 'h' } as never);
    const post = frame.contentWindow!.postMessage as unknown as ReturnType<typeof vi.fn>;
    expect(post.mock.calls[0]?.[0]).toMatchObject({ nonce: 'n1' });
  });
});

describe('nonces', () => {
  it('are stable per device across remounts', () => {
    const first = registry.nonceForDevice('dev_1');
    expect(registry.nonceForDevice('dev_1')).toBe(first);
  });

  it('differ between devices', () => {
    expect(registry.nonceForDevice('dev_1')).not.toBe(registry.nonceForDevice('dev_2'));
  });
});
