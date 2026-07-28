import { afterEach, describe, expect, it } from 'vitest';
import { listEvents, logEvent } from '@/server/services/events';
import {
  createShareLink,
  openShareLink,
  reviewerRoles,
  revokeShareLink,
  toPublicShare,
} from '@/server/services/shares';
import { createDevice, listDevices, moveDevices, updateDevice } from '@/server/services/devices';
import { makeFixture, makeProject, makeStore, type Fixture } from './helpers';

let fixture: Fixture | null = null;
afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

async function setup() {
  fixture = await makeFixture();
  const { projectId } = await makeProject(fixture);
  return { fixture, projectId, store: fixture.store, userId: fixture.userId };
}

describe('local store semantics', () => {
  it('serialises concurrent writes without losing any', async () => {
    const { store, cleanup } = await makeStore();
    try {
      await Promise.all(
        Array.from({ length: 40 }, (_, index) =>
          store.insert('deviceEvents', {
            id: `evt_${index}`,
            projectId: 'p',
            sequence: index,
            deviceId: null,
            targetDeviceId: null,
            kind: 'system',
            level: 'info',
            name: `event ${index}`,
            payload: {},
            screen: null,
            createdAt: new Date().toISOString(),
          }),
        ),
      );
      expect(await store.count('deviceEvents', {})).toBe(40);
    } finally {
      await cleanup();
    }
  });

  it('gives a transaction an isolated, consistent view', async () => {
    const { store, cleanup } = await makeStore();
    try {
      await store.insert('workspaces', {
        id: 'wsp_1',
        name: 'A',
        slug: 'a',
        ownerId: 'usr_1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Two transactions incrementing a counter must not interleave.
      const bump = () =>
        store.transaction(async (tx) => {
          const row = await tx.find('workspaces', { match: { id: 'wsp_1' } });
          const next = `${(row?.name ?? '').length + 1}`.padStart((row?.name ?? '').length + 1, 'A');
          await tx.update('workspaces', 'wsp_1', { name: next });
        });

      await Promise.all([bump(), bump(), bump()]);
      const final = await store.find('workspaces', { match: { id: 'wsp_1' } });
      expect(final?.name.length).toBe(4);
    } finally {
      await cleanup();
    }
  });

  it('supports the predicate vocabulary the services rely on', async () => {
    const { store, cleanup } = await makeStore();
    try {
      const now = new Date().toISOString();
      await store.insertMany('projectFiles', [
        {
          id: 'f1',
          projectId: 'p',
          path: 'src/App.tsx',
          content: 'a',
          size: 1,
          language: 'typescript',
          lastEditedBy: 'user',
          lastEditedAt: now,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
        {
          id: 'f2',
          projectId: 'p',
          path: 'src/Old.tsx',
          content: 'b',
          size: 1,
          language: 'typescript',
          lastEditedBy: 'claude',
          lastEditedAt: now,
          createdAt: now,
          updatedAt: now,
          deletedAt: now,
        },
      ]);

      const live = await store.select('projectFiles', {
        match: { projectId: 'p' },
        where: [{ col: 'deletedAt', op: 'isNull' }],
      });
      expect(live.map((file) => file.id)).toEqual(['f1']);

      const byIn = await store.select('projectFiles', {
        where: [{ col: 'id', op: 'in', value: ['f1', 'f2'] }],
        orderBy: [{ col: 'path', dir: 'desc' }],
      });
      expect(byIn.map((file) => file.path)).toEqual(['src/Old.tsx', 'src/App.tsx']);

      const contains = await store.select('projectFiles', {
        where: [{ col: 'path', op: 'contains', value: 'app' }],
      });
      expect(contains).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });
});

describe('event stream', () => {
  it('assigns strictly increasing sequence numbers even under concurrency', async () => {
    const { store, projectId } = await setup();
    await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        logEvent(store, projectId, { kind: 'system', name: `n${index}` }),
      ),
    );

    const events = await listEvents(store, projectId, { limit: 1000 });
    const sequences = events.map((event) => event.sequence);
    expect(new Set(sequences).size).toBe(sequences.length);
    expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);
  });

  it('filters by kind, level and device', async () => {
    const { store, projectId } = await setup();
    const device = (await listDevices(store, projectId))[0];

    await logEvent(store, projectId, { kind: 'build', name: 'built', level: 'info' });
    await logEvent(store, projectId, {
      kind: 'error',
      name: 'crashed',
      level: 'error',
      deviceId: device?.id ?? null,
    });

    const errors = await listEvents(store, projectId, { levels: ['error'] });
    expect(errors.every((event) => event.level === 'error')).toBe(true);

    const forDevice = await listEvents(store, projectId, { deviceId: device?.id ?? null });
    expect(forDevice.every((event) => event.deviceId === device?.id)).toBe(true);
  });

  it('truncates oversized payloads rather than storing them whole', async () => {
    const { store, projectId } = await setup();
    const event = await logEvent(store, projectId, {
      kind: 'system',
      name: 'big',
      payload: { blob: 'x'.repeat(20_000) },
    });
    expect(event.payload.truncated).toBe(true);
  });
});

describe('devices', () => {
  it('derives the network condition from edge-case flags', async () => {
    const { store, projectId } = await setup();
    const device = await createDevice(store, projectId, { role: 'customer' });
    expect(device.network).toBe('fast');

    const offline = await updateDevice(store, projectId, device.id, { stateFlags: ['offline'] });
    expect(offline.network).toBe('offline');

    const slow = await updateDevice(store, projectId, device.id, { stateFlags: ['slow-network'] });
    expect(slow.network).toBe('slow');
  });

  it('places new devices without overlapping', async () => {
    const { store, projectId } = await setup();
    const before = await listDevices(store, projectId);
    const added = await createDevice(store, projectId, { role: 'admin' });
    const collides = before.some(
      (device) => Math.abs(device.x - added.x) < 40 && Math.abs(device.y - added.y) < 40,
    );
    expect(collides).toBe(false);
  });

  it('commits positions in bulk and rounds them', async () => {
    const { store, projectId } = await setup();
    const devices = await listDevices(store, projectId);
    const moved = await moveDevices(
      store,
      projectId,
      devices.map((device, index) => ({ id: device.id, x: index * 100.6, y: 12.4 })),
    );
    expect(moved.every((device) => Number.isInteger(device.x) && Number.isInteger(device.y))).toBe(
      true,
    );
  });
});

describe('share links', () => {
  it('pins to the newest version by default', async () => {
    const { store, projectId, userId } = await setup();
    const link = await createShareLink(store, projectId, userId, {
      label: '',
      access: 'comment',
      visibility: 'public',
      allowedEmails: [],
      allowedRoles: [],
      allowVersionCompare: false,
      allowJourneys: true,
      expiresInDays: null,
    });
    expect(link.versionId).not.toBeNull();
  });

  it('gates a password link until the password is supplied', async () => {
    const { store, projectId, userId } = await setup();
    const link = await createShareLink(store, projectId, userId, {
      label: 'Protected',
      access: 'comment',
      visibility: 'password',
      password: 'padel2026',
      allowedEmails: [],
      allowedRoles: [],
      allowVersionCompare: false,
      allowJourneys: true,
      expiresInDays: null,
    });

    const gate = await openShareLink(store, link.token);
    expect(gate.state).toBe('password-required');

    await expect(openShareLink(store, link.token, { password: 'wrong' })).rejects.toThrow(
      /not correct/,
    );

    const opened = await openShareLink(store, link.token, { password: 'padel2026' });
    expect(opened.state).toBe('ok');
  });

  it('gates an email link to the invite list', async () => {
    const { store, projectId, userId } = await setup();
    const link = await createShareLink(store, projectId, userId, {
      label: 'Invite only',
      access: 'read',
      visibility: 'email',
      allowedEmails: ['friend@example.com'],
      allowedRoles: [],
      allowVersionCompare: false,
      allowJourneys: true,
      expiresInDays: null,
    });

    expect((await openShareLink(store, link.token)).state).toBe('email-required');
    await expect(
      openShareLink(store, link.token, { email: 'stranger@example.com' }),
    ).rejects.toThrow(/not on the invite list/);
    expect((await openShareLink(store, link.token, { email: 'friend@example.com' })).state).toBe(
      'ok',
    );
  });

  it('stops working the moment it is revoked', async () => {
    const { store, projectId, userId } = await setup();
    const link = await createShareLink(store, projectId, userId, {
      label: 'Temp',
      access: 'read',
      visibility: 'public',
      allowedEmails: [],
      allowedRoles: [],
      allowVersionCompare: false,
      allowJourneys: true,
      expiresInDays: null,
    });
    expect((await openShareLink(store, link.token)).state).toBe('ok');

    await revokeShareLink(store, projectId, link.id);
    await expect(openShareLink(store, link.token)).rejects.toThrow(/revoked/);
  });

  it('never exposes password hashes or the invite list publicly', async () => {
    const { store, projectId, userId } = await setup();
    const link = await createShareLink(store, projectId, userId, {
      label: 'Protected',
      access: 'read',
      visibility: 'password',
      password: 'padel2026',
      allowedEmails: ['a@example.com'],
      allowedRoles: [],
      allowVersionCompare: false,
      allowJourneys: true,
      expiresInDays: null,
    });

    const publicView = toPublicShare(link) as unknown as Record<string, unknown>;
    expect(publicView.passwordHash).toBeUndefined();
    expect(publicView.passwordSalt).toBeUndefined();
    expect(publicView.allowedEmails).toBeUndefined();
    expect(publicView.hasPassword).toBe(true);
    expect(publicView.emailGated).toBe(true);
  });

  it('restricts reviewer roles to the allow-list, or offers all when empty', () => {
    const asLink = (allowedRoles: string[]) =>
      ({ allowedRoles }) as unknown as Parameters<typeof reviewerRoles>[0];

    expect(reviewerRoles(asLink(['customer']), ['customer', 'provider', 'admin'])).toEqual([
      'customer',
    ]);

    const unrestricted = asLink([]);
    expect(reviewerRoles(unrestricted, ['customer', 'provider'])).toEqual(['customer', 'provider']);
  });
});
