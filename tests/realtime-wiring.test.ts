import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearEvents, logEvent } from '@/server/services/events';
import { buildPreview } from '@/server/services/preview';
import { loadStudioSnapshot } from '@/server/services/studio-snapshot';
import { requireProjectAccess } from '@/server/services/access';
import { recordToolCall } from '@/server/services/audit';
import { getBus, projectChannel, RT } from '@/server/realtime/bus';
import { toPublicUser } from '@/server/services/auth';
import type { UserRow } from '@/server/db';
import { makeFixture, makeProject, type Fixture } from './helpers';

/**
 * The realtime wiring, end to end: publisher → event name → client reducer.
 *
 * Every bug covered here had the same shape — a server that published something
 * truthful and a client that quietly dropped it, or never heard it at all. The
 * failure mode is silence, which is exactly what a test suite is for: nothing
 * throws, nothing logs, the UI simply keeps showing the old answer.
 */

let fixture: Fixture | null = null;
afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

async function setup() {
  fixture = await makeFixture();
  const { projectId } = await makeProject(fixture);
  return { fixture, projectId, store: fixture.store, actor: fixture.actor, userId: fixture.userId };
}

/** Records everything published on a project channel until it is disposed. */
function recorder(projectId: string) {
  const seen: { event: string; payload: unknown }[] = [];
  const stop = getBus().subscribe(projectChannel(projectId), (message) => {
    seen.push({ event: message.event, payload: message.payload });
  });
  return {
    seen,
    stop,
    names: () => seen.map((entry) => entry.event),
    of: (event: string) => seen.filter((entry) => entry.event === event),
  };
}

describe('clearing the timeline', () => {
  it('announces a distinct event rather than an append with no row', async () => {
    const { store, projectId } = await setup();
    await logEvent(store, projectId, { kind: 'system', name: 'before' });

    const bus = recorder(projectId);
    try {
      const removed = await clearEvents(store, projectId);
      expect(removed).toBeGreaterThan(0);

      // The old code published `event.logged` with `{cleared:true}`. The client's
      // append path requires a `sequence`, so it dropped the message and the log
      // stayed on screen after Clear log emptied the server.
      expect(bus.of(RT.eventLogged)).toHaveLength(0);
      expect(bus.of(RT.eventsCleared)).toHaveLength(1);
      expect(bus.of(RT.eventsCleared)[0]?.payload).toMatchObject({ removed });
    } finally {
      bus.stop();
    }
  });

  it('is a name the client actually subscribes to', async () => {
    // The SSE client attaches one listener per name; a published event whose name
    // is not in that list never reaches the browser at all.
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/components/studio/use-realtime.ts', import.meta.url), 'utf8'),
    );
    for (const name of Object.values(RT)) {
      expect(source, `use-realtime.ts does not listen for "${name}"`).toContain(`'${name}'`);
    }
  });
});

describe('build announcements', () => {
  it('publishes a start and a finish for a real build', async () => {
    const { store, projectId } = await setup();
    const bus = recorder(projectId);
    try {
      await buildPreview(store, projectId, 'working', 'claude');
      expect(bus.of(RT.buildStarted)).toHaveLength(1);
      expect(bus.of(RT.buildFinished)).toHaveLength(1);
      expect(bus.of(RT.buildStarted)[0]?.payload).toMatchObject({ triggeredBy: 'claude' });
      expect(bus.of(RT.buildFinished)[0]?.payload).toMatchObject({
        cached: false,
        triggeredBy: 'claude',
      });
    } finally {
      bus.stop();
    }
  });

  it('still announces the outcome when the build was served from cache', async () => {
    const { store, projectId } = await setup();
    await buildPreview(store, projectId, 'working', 'user');

    const bus = recorder(projectId);
    try {
      const second = await buildPreview(store, projectId, 'working', 'claude');
      expect(second.cached).toBe(true);

      // No `started` — nothing started. But observers that only learn about builds
      // from the bus previously heard *nothing at all* on a cache hit, so a phone
      // or a feed waiting on the finish waited forever.
      expect(bus.of(RT.buildStarted)).toHaveLength(0);
      expect(bus.of(RT.buildFinished)).toHaveLength(1);
      expect(bus.of(RT.buildFinished)[0]?.payload).toMatchObject({
        cached: true,
        triggeredBy: 'claude',
        ok: true,
      });
    } finally {
      bus.stop();
    }
  });
});

describe('the studio snapshot', () => {
  it('scopes recent Claude tool calls to the project being opened', async () => {
    const { store, actor, userId } = await setup();
    if (!fixture) throw new Error('fixture');
    const first = await makeProject(fixture);
    const second = await makeProject(fixture);

    await recordToolCall(store, {
      userId,
      projectId: first.projectId,
      connectionId: null,
      tool: 'phonelab_write_file',
      args: {},
      result: 'ok',
      errorMessage: null,
      durationMs: 4,
    });

    const user = await store.find('users', { match: { id: userId } });
    const publicUser = toPublicUser(user as UserRow);

    const accessSecond = await requireProjectAccess(store, actor, second.projectId, 'read');
    const snapshotSecond = await loadStudioSnapshot(
      accessSecond,
      publicUser,
      'http://localhost:3000',
      store,
    );
    // The call belongs to another project; this one has not been touched.
    expect(snapshotSecond.mcp.recentCalls).toHaveLength(0);

    const accessFirst = await requireProjectAccess(store, actor, first.projectId, 'read');
    const snapshotFirst = await loadStudioSnapshot(
      accessFirst,
      publicUser,
      'http://localhost:3000',
      store,
    );
    expect(snapshotFirst.mcp.recentCalls).toHaveLength(1);
    expect(snapshotFirst.mcp.recentCalls[0]?.tool).toBe('phonelab_write_file');
  });
});

/** A studio store seeded from a genuine snapshot, not a hand-written stub. */
async function makeStudio() {
  const { store, actor, projectId, userId } = await setup();
  const user = await store.find('users', { match: { id: userId } });
  const access = await requireProjectAccess(store, actor, projectId, 'read');
  const snapshot = await loadStudioSnapshot(
    access,
    toPublicUser(user as UserRow),
    'http://localhost:3000',
    store,
  );
  const { createStudioStore } = await import('@/components/studio/store');
  return { studio: createStudioStore(snapshot), snapshot, projectId };
}

describe('the client reducer', () => {
  it('empties the log when the stream is cleared', async () => {
    const { studio } = await makeStudio();
    studio.getState().appendEvent({
      id: 'evt_1',
      projectId: 'p',
      sequence: 999,
      deviceId: null,
      targetDeviceId: null,
      kind: 'system',
      level: 'info',
      name: 'hello',
      payload: {},
      screen: null,
      createdAt: new Date().toISOString(),
    });
    expect(studio.getState().events.length).toBeGreaterThan(0);

    studio.getState().applyRealtime('events.cleared', { removed: 3 });
    expect(studio.getState().events).toEqual([]);
  });

  it('shows a build someone else started, and only someone else', async () => {
    vi.useFakeTimers();
    try {
      const { studio } = await makeStudio();

      // Our own save must not make the studio announce that Claude is building.
      studio.getState().applyRealtime('build.started', {
        buildId: 'bld_mine',
        ref: 'working',
        triggeredBy: 'user',
      });
      expect(studio.getState().remoteBuild).toBeNull();

      studio.getState().applyRealtime('build.started', {
        buildId: 'bld_claude',
        ref: 'working',
        triggeredBy: 'claude',
      });
      expect(studio.getState().remoteBuild?.buildId).toBe('bld_claude');
      expect(studio.getState().remoteBuild?.triggeredBy).toBe('claude');

      // An unrelated build finishing must not clear the one still running.
      studio.getState().applyRealtime('build.finished', { buildId: 'bld_other', ok: true });
      expect(studio.getState().remoteBuild?.buildId).toBe('bld_claude');

      studio.getState().applyRealtime('build.finished', { buildId: 'bld_claude', ok: true });
      expect(studio.getState().remoteBuild).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops claiming a build is running if the finish never arrives', async () => {
    vi.useFakeTimers();
    try {
      const { studio } = await makeStudio();
      studio.getState().applyRealtime('build.started', {
        buildId: 'bld_lost',
        ref: 'working',
        triggeredBy: 'claude',
      });
      expect(studio.getState().remoteBuild).not.toBeNull();

      await vi.advanceTimersByTimeAsync(120_001);
      expect(studio.getState().remoteBuild).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('picks up a renamed project without a reload', async () => {
    const { studio, snapshot } = await makeStudio();
    expect(studio.getState().snapshot.project.name).toBe(snapshot.project.name);

    studio.getState().applyRealtime('project.changed', {
      project: { ...snapshot.project, name: 'Renamed in another tab' },
    });
    expect(studio.getState().snapshot.project.name).toBe('Renamed in another tab');
  });

  it('ignores an event name it does not know instead of throwing', async () => {
    const { studio } = await makeStudio();
    const before = JSON.stringify(studio.getState().events);
    expect(() => studio.getState().applyRealtime('something.new', { a: 1 })).not.toThrow();
    expect(JSON.stringify(studio.getState().events)).toBe(before);
  });
});
