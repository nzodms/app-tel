import { z } from 'zod';
import { badRequest, notFound, tooLarge } from '../core/errors';
import { LIMITS } from '../core/limits';
import { newId } from '../core/ids';
import type { DeviceRow, Id, Store } from '../db';
import { DEFAULT_PRESET_ID, getPreset, isPresetId } from '@/lib/devices/presets';
import { networkFromFlags, toggleFlag } from '@/lib/devices/edge-cases';
import { getRole } from '@/lib/devices/roles';
import { RT, getBus, projectChannel } from '../realtime/bus';

/**
 * Devices on the canvas.
 *
 * A device is a persisted piece of *configuration* — preset, role, simulated user,
 * pinned version, edge-case flags, position. The running preview is transient and
 * lives in the browser; that separation is what lets a phone be dragged around
 * without its preview reloading.
 */

export const deviceInputSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  presetId: z.string().min(1).optional(),
  orientation: z.enum(['portrait', 'landscape']).optional(),
  role: z.string().trim().min(1).max(40).optional(),
  userLabel: z.string().trim().max(60).nullable().optional(),
  versionId: z.string().min(1).nullable().optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  zIndex: z.number().int().optional(),
  theme: z.enum(['light', 'dark']).optional(),
  locale: z.string().trim().min(2).max(10).optional(),
  stateFlags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  scenario: z.string().trim().max(80).nullable().optional(),
});

export type DeviceInput = z.infer<typeof deviceInputSchema>;

export async function listDevices(store: Store, projectId: Id): Promise<DeviceRow[]> {
  return store.select('devices', {
    match: { projectId },
    orderBy: [{ col: 'createdAt' }],
  });
}

export async function getDevice(store: Store, projectId: Id, deviceId: Id): Promise<DeviceRow> {
  const device = await store.find('devices', { match: { id: deviceId, projectId } });
  if (!device) throw notFound('Device not found.');
  return device;
}

export async function createDevice(
  store: Store,
  projectId: Id,
  input: DeviceInput,
): Promise<DeviceRow> {
  const parsed = deviceInputSchema.parse(input);
  const existing = await listDevices(store, projectId);
  if (existing.length >= LIMITS.maxDevicesPerProject) {
    throw tooLarge(
      `A project can hold ${LIMITS.maxDevicesPerProject} devices. Remove one before adding another.`,
    );
  }

  await assertVersionBelongs(store, projectId, parsed.versionId ?? null);

  const presetId =
    parsed.presetId && isPresetId(parsed.presetId) ? parsed.presetId : DEFAULT_PRESET_ID;
  const role = parsed.role ?? 'customer';
  const now = new Date().toISOString();
  const flags = parsed.stateFlags ?? [];

  const device: DeviceRow = {
    id: newId('dev'),
    projectId,
    name: parsed.name ?? getRole(role).label,
    presetId,
    orientation: parsed.orientation ?? 'portrait',
    role,
    userLabel: parsed.userLabel ?? getRole(role).defaultUser,
    versionId: parsed.versionId ?? null,
    ...nextFreeSlot(existing, presetId, parsed.x, parsed.y),
    zIndex: existing.reduce((max, entry) => Math.max(max, entry.zIndex), 0) + 1,
    theme: parsed.theme ?? 'light',
    locale: parsed.locale ?? 'en',
    network: networkFromFlags(flags),
    stateFlags: flags,
    scenario: parsed.scenario ?? null,
    createdAt: now,
    updatedAt: now,
  };

  await store.insert('devices', device);
  getBus().publish(projectChannel(projectId), RT.deviceChanged, { device, created: true });
  return device;
}

export async function updateDevice(
  store: Store,
  projectId: Id,
  deviceId: Id,
  input: DeviceInput,
): Promise<DeviceRow> {
  const parsed = deviceInputSchema.parse(input);
  const current = await getDevice(store, projectId, deviceId);

  if (parsed.presetId !== undefined && !isPresetId(parsed.presetId)) {
    throw badRequest(`Unknown device preset "${parsed.presetId}".`);
  }
  if (parsed.versionId !== undefined) {
    await assertVersionBelongs(store, projectId, parsed.versionId);
  }

  const flags = parsed.stateFlags ?? current.stateFlags;
  const updated = await store.update('devices', deviceId, {
    ...parsed,
    stateFlags: flags,
    network: networkFromFlags(flags),
    updatedAt: new Date().toISOString(),
  });

  getBus().publish(projectChannel(projectId), RT.deviceChanged, { device: updated });
  return updated;
}

/** Applies (or clears) a single Edge Case Studio flag, honouring exclusivity. */
export async function toggleDeviceFlag(
  store: Store,
  projectId: Id,
  deviceId: Id,
  flag: string,
): Promise<DeviceRow> {
  const current = await getDevice(store, projectId, deviceId);
  return updateDevice(store, projectId, deviceId, {
    stateFlags: toggleFlag(current.stateFlags, flag),
  });
}

export async function removeDevice(
  store: Store,
  projectId: Id,
  deviceId: Id,
): Promise<{ id: Id; name: string }> {
  const device = await getDevice(store, projectId, deviceId);
  await store.remove('devices', deviceId);
  getBus().publish(projectChannel(projectId), RT.deviceRemoved, { deviceId });
  return { id: device.id, name: device.name };
}

export async function duplicateDevice(
  store: Store,
  projectId: Id,
  deviceId: Id,
): Promise<DeviceRow> {
  const source = await getDevice(store, projectId, deviceId);
  return createDevice(store, projectId, {
    name: `${source.name} copy`,
    presetId: source.presetId,
    orientation: source.orientation,
    role: source.role,
    userLabel: source.userLabel,
    versionId: source.versionId,
    theme: source.theme,
    locale: source.locale,
    stateFlags: source.stateFlags,
    scenario: source.scenario,
    x: source.x + 60,
    y: source.y + 60,
  });
}

/** Persists a drag or an auto-layout in one round trip. */
export async function moveDevices(
  store: Store,
  projectId: Id,
  positions: readonly { id: Id; x: number; y: number; zIndex?: number }[],
): Promise<DeviceRow[]> {
  const devices = await listDevices(store, projectId);
  const known = new Set(devices.map((device) => device.id));
  const now = new Date().toISOString();
  const updated: DeviceRow[] = [];

  for (const position of positions) {
    if (!known.has(position.id)) continue;
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      throw badRequest('Device positions must be finite numbers.');
    }
    updated.push(
      await store.update('devices', position.id, {
        x: Math.round(position.x),
        y: Math.round(position.y),
        ...(position.zIndex !== undefined ? { zIndex: position.zIndex } : {}),
        updatedAt: now,
      }),
    );
  }

  // One coalesced event: dragging four phones should not fan out four times.
  getBus().publish(projectChannel(projectId), RT.deviceChanged, {
    moved: updated.map((device) => ({ id: device.id, x: device.x, y: device.y })),
  });
  return updated;
}

async function assertVersionBelongs(
  store: Store,
  projectId: Id,
  versionId: Id | null,
): Promise<void> {
  if (!versionId) return;
  const version = await store.find('projectVersions', { match: { id: versionId, projectId } });
  if (!version) throw badRequest('That version does not belong to this project.');
}

/**
 * Picks an empty spot for a new phone: left to right, wrapping into a second row,
 * with a gap based on the chassis width so nothing overlaps on arrival.
 */
function nextFreeSlot(
  existing: readonly DeviceRow[],
  presetId: string,
  x?: number,
  y?: number,
): { x: number; y: number } {
  if (x !== undefined && y !== undefined) return { x: Math.round(x), y: Math.round(y) };

  const preset = getPreset(presetId);
  const step = preset.viewport.width + 2 * (preset.bezel + preset.rail) + 120;
  const perRow = 4;
  const index = existing.length;
  const column = index % perRow;
  const row = Math.floor(index / perRow);
  const rowHeight = preset.viewport.height + 2 * (preset.bezel + preset.rail) + 140;

  const candidate = { x: column * step, y: row * rowHeight };
  const occupied = existing.some(
    (device) => Math.abs(device.x - candidate.x) < 40 && Math.abs(device.y - candidate.y) < 40,
  );
  return occupied ? { x: candidate.x + 60, y: candidate.y + 60 } : candidate;
}
