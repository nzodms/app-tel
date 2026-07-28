import { z } from 'zod';
import { DEVICE_PRESETS } from '@/lib/devices/presets';
import { EDGE_CASES } from '@/lib/devices/edge-cases';
import { ROLE_CATALOG } from '@/lib/devices/roles';
import type { PreviewSnapshot } from '@/lib/preview/protocol';
import { requireProjectAccess } from '../../services/access';
import {
  createDevice,
  getDevice,
  listDevices,
  removeDevice,
  updateDevice,
} from '../../services/devices';
import { logEvent } from '../../services/events';
import { RT, getBus, projectChannel } from '../../realtime/bus';
import { STUDIO_RPC, askStudio } from '../../realtime/rpc';
import { defineTool, outcome } from '../types';

const projectIdSchema = z.string().min(1).describe('PhoneLab project id.');
const deviceIdSchema = z.string().min(1).describe('Device id (starts with dev_).');

const presetIds = DEVICE_PRESETS.map((preset) => preset.id).join(', ');
const flagIds = EDGE_CASES.map((entry) => entry.id).join(', ');

export const deviceTools = [
  defineTool({
    name: 'list_devices',
    title: 'List devices',
    description:
      'Lists the phones on the project canvas with their role, simulated user, preset, pinned version and active edge-case flags.',
    group: 'devices',
    capability: 'read',
    annotations: { readOnlyHint: true, idempotentHint: true },
    input: z.object({ projectId: projectIdSchema }).strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'read');
      const devices = await listDevices(store, input.projectId);
      const lines = devices.map(
        (device) =>
          `- ${device.name} (${device.id}) · role ${device.role} · ${device.presetId} · ${device.userLabel ?? 'no user'}` +
          `${device.versionId ? ` · pinned to ${device.versionId}` : ' · live'}` +
          `${device.stateFlags.length > 0 ? ` · flags: ${device.stateFlags.join(', ')}` : ''}`,
      );
      return outcome(
        devices.length === 0 ? 'No devices on the canvas.' : `${devices.length} device(s):\n${lines.join('\n')}`,
        {
          devices: devices.map((device) => ({
            id: device.id,
            name: device.name,
            role: device.role,
            presetId: device.presetId,
            orientation: device.orientation,
            userLabel: device.userLabel,
            versionId: device.versionId,
            theme: device.theme,
            locale: device.locale,
            network: device.network,
            stateFlags: device.stateFlags,
            position: { x: device.x, y: device.y },
          })),
          availablePresets: DEVICE_PRESETS.map((preset) => preset.id),
          availableFlags: EDGE_CASES.map((entry) => entry.id),
        },
      );
    },
  }),

  defineTool({
    name: 'create_device',
    title: 'Add device',
    description:
      'Adds a phone to the canvas. Choose a role to decide which side of the app it renders, and optionally pin it to a version so two versions can run side by side.',
    group: 'devices',
    capability: 'write',
    annotations: { readOnlyHint: false, idempotentHint: false },
    input: z
      .object({
        projectId: projectIdSchema,
        name: z.string().trim().min(1).max(60).optional(),
        role: z
          .string()
          .trim()
          .min(1)
          .max(40)
          .optional()
          .describe(`Role slug. Common: ${ROLE_CATALOG.map((role) => role.slug).join(', ')}.`),
        presetId: z.string().optional().describe(`Device format. One of: ${presetIds}.`),
        orientation: z.enum(['portrait', 'landscape']).optional(),
        userLabel: z.string().trim().max(60).nullable().optional().describe('Simulated signed-in user.'),
        versionId: z.string().min(1).nullable().optional().describe('Pin to a version, or null for the live tree.'),
        theme: z.enum(['light', 'dark']).optional(),
        locale: z.string().trim().min(2).max(10).optional(),
        stateFlags: z.array(z.string()).max(20).optional().describe(`Edge-case flags. Available: ${flagIds}.`),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'write');
      const { projectId, ...rest } = input;
      const device = await createDevice(store, projectId, rest);
      await logEvent(store, projectId, {
        kind: 'mcp',
        name: `Claude added device "${device.name}"`,
        deviceId: device.id,
        payload: { role: device.role, presetId: device.presetId },
      });
      return outcome(`Added "${device.name}" (${device.id}) as ${device.role}.`, { device });
    },
  }),

  defineTool({
    name: 'update_device',
    title: 'Update device',
    description:
      'Changes any device setting: name, preset, orientation, role, simulated user, pinned version, theme, locale, or edge-case flags.',
    group: 'devices',
    capability: 'write',
    annotations: { readOnlyHint: false, idempotentHint: true },
    input: z
      .object({
        projectId: projectIdSchema,
        deviceId: deviceIdSchema,
        name: z.string().trim().min(1).max(60).optional(),
        presetId: z.string().optional().describe(`One of: ${presetIds}.`),
        orientation: z.enum(['portrait', 'landscape']).optional(),
        role: z.string().trim().min(1).max(40).optional(),
        userLabel: z.string().trim().max(60).nullable().optional(),
        versionId: z.string().min(1).nullable().optional(),
        theme: z.enum(['light', 'dark']).optional(),
        locale: z.string().trim().min(2).max(10).optional(),
        stateFlags: z.array(z.string()).max(20).optional(),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'write');
      const { projectId, deviceId, ...patch } = input;
      const device = await updateDevice(store, projectId, deviceId, patch);
      return outcome(`Updated "${device.name}".`, { device });
    },
  }),

  defineTool({
    name: 'assign_device_role',
    title: 'Assign role',
    description:
      'Sets a device’s role, and its simulated user to that role’s default unless you pass one. The preview re-renders as that role immediately.',
    group: 'devices',
    capability: 'write',
    annotations: { readOnlyHint: false, idempotentHint: true },
    input: z
      .object({
        projectId: projectIdSchema,
        deviceId: deviceIdSchema,
        role: z.string().trim().min(1).max(40),
        userLabel: z.string().trim().max(60).nullable().optional(),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'write');
      const device = await updateDevice(store, input.projectId, input.deviceId, {
        role: input.role,
        ...(input.userLabel !== undefined ? { userLabel: input.userLabel } : {}),
      });
      return outcome(`"${device.name}" is now the ${device.role} device.`, { device });
    },
  }),

  defineTool({
    name: 'set_device_user',
    title: 'Set simulated user',
    description: 'Sets which user appears to be signed in on a device. Pass null for an anonymous visitor.',
    group: 'devices',
    capability: 'write',
    annotations: { readOnlyHint: false, idempotentHint: true },
    input: z
      .object({
        projectId: projectIdSchema,
        deviceId: deviceIdSchema,
        userLabel: z.string().trim().max(60).nullable(),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'write');
      const device = await updateDevice(store, input.projectId, input.deviceId, {
        userLabel: input.userLabel,
      });
      return outcome(`"${device.name}" now runs as ${device.userLabel ?? 'an anonymous visitor'}.`, {
        device,
      });
    },
  }),

  defineTool({
    name: 'set_device_state',
    title: 'Apply edge cases',
    description:
      'Applies Edge Case Studio flags to a device — slow connection, offline, payment declined, empty data, denied permissions, and so on. Replaces the current set.',
    group: 'devices',
    capability: 'write',
    annotations: { readOnlyHint: false, idempotentHint: true },
    input: z
      .object({
        projectId: projectIdSchema,
        deviceId: deviceIdSchema,
        stateFlags: z.array(z.string()).max(20).describe(`Flags to apply. Available: ${flagIds}.`),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'write');
      const known = new Set(EDGE_CASES.map((entry) => entry.id));
      const unknown = input.stateFlags.filter((flag) => !known.has(flag));
      if (unknown.length > 0) {
        return {
          text: `Unknown flag(s): ${unknown.join(', ')}. Available: ${flagIds}.`,
          isError: true,
        };
      }
      const device = await updateDevice(store, input.projectId, input.deviceId, {
        stateFlags: input.stateFlags,
      });
      await logEvent(store, input.projectId, {
        kind: 'mcp',
        name: `Claude set edge cases on "${device.name}"`,
        deviceId: device.id,
        payload: { stateFlags: device.stateFlags },
      });
      return outcome(
        device.stateFlags.length === 0
          ? `Cleared all edge cases on "${device.name}".`
          : `"${device.name}" now runs with: ${device.stateFlags.join(', ')}.`,
        { device },
      );
    },
  }),

  defineTool({
    name: 'send_device_event',
    title: 'Send device event',
    description:
      'Emits an app event into the canvas, exactly as if a phone had sent it. Use it to trigger the other side of a flow (for example booking.accepted) without clicking through the UI.',
    group: 'devices',
    capability: 'execute',
    annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    input: z
      .object({
        projectId: projectIdSchema,
        name: z.string().trim().min(1).max(120).describe('Event name, e.g. booking.requested.'),
        payload: z.record(z.string(), z.unknown()).optional().describe('JSON payload passed to the handlers.'),
        to: z
          .string()
          .trim()
          .max(60)
          .optional()
          .describe('Target: a role slug, a device id, or "all" (default).'),
        fromDeviceId: deviceIdSchema.optional().describe('Attribute the event to this device.'),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'execute');
      const from = input.fromDeviceId
        ? await getDevice(store, input.projectId, input.fromDeviceId)
        : null;

      const event = await logEvent(store, input.projectId, {
        kind: 'device-event',
        name: input.name,
        deviceId: from?.id ?? null,
        payload: { ...(input.payload ?? {}), to: input.to ?? 'all', origin: 'mcp' },
      });

      // The studio fans this out to the matching device iframes.
      getBus().publish(projectChannel(input.projectId), RT.deviceEvent, {
        ...event,
        dispatch: {
          name: input.name,
          payload: input.payload ?? {},
          to: input.to ?? 'all',
          fromDeviceId: from?.id ?? null,
          fromRole: from?.role ?? null,
        },
      });

      return outcome(
        `Sent "${input.name}" to ${input.to ?? 'all devices'}. Any open studio delivers it to the matching phones.`,
        { event: { id: event.id, sequence: event.sequence, name: event.name } },
      );
    },
  }),

  defineTool({
    name: 'capture_device',
    title: 'Capture device screen',
    description:
      'Returns a structural snapshot of what a phone currently shows: route, visible text and the actions available. This is not an image — it is the DOM state, which is what you need to reason about the screen. Requires an open PhoneLab studio tab for that project.',
    group: 'devices',
    capability: 'execute',
    annotations: { readOnlyHint: true, idempotentHint: false },
    input: z
      .object({
        projectId: projectIdSchema,
        deviceId: deviceIdSchema,
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'execute');
      const device = await getDevice(store, input.projectId, input.deviceId);

      const answer = await askStudio<PreviewSnapshot>(
        input.projectId,
        STUDIO_RPC.captureDevice,
        { deviceId: device.id },
        7_000,
      );

      if (!answer.ok || !answer.value) {
        return {
          text:
            `No PhoneLab studio answered within 7s, so "${device.name}" could not be captured. ` +
            'Open the project in a browser tab and try again — captures read live DOM state, which only a running preview has.',
          isError: true,
        };
      }

      const snapshot = answer.value;
      return outcome(
        [
          `"${device.name}" (${device.role}) at route ${snapshot.route}:`,
          '',
          'Visible text:',
          ...snapshot.texts.slice(0, 60).map((text) => `  ${text}`),
          '',
          'Actions:',
          ...snapshot.actions.slice(0, 30).map(
            (action) => `  "${action.label}"${action.sourceRef ? ` → ${action.sourceRef}` : ''}`,
          ),
        ].join('\n'),
        { deviceId: device.id, deviceName: device.name, role: device.role, snapshot },
      );
    },
  }),

  defineTool({
    name: 'remove_device',
    title: 'Remove device',
    description: 'Removes a phone from the canvas. The project’s code and versions are untouched. Requires confirm=true.',
    group: 'devices',
    capability: 'write',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    destructive: true,
    input: z
      .object({
        projectId: projectIdSchema,
        deviceId: deviceIdSchema,
        confirm: z.boolean().default(false),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'write');
      const removed = await removeDevice(store, input.projectId, input.deviceId);
      return outcome(`Removed "${removed.name}" from the canvas.`, { deviceId: removed.id });
    },
  }),
];
