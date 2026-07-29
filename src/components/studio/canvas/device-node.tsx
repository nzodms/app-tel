'use client';

import { memo, useCallback, useState } from 'react';
import { deviceGeometry, getPreset } from '@/lib/devices/presets';
import { getRole, roleColor } from '@/lib/devices/roles';
import type { DeviceRow } from '@/server/db';
import { useStudio } from '../context';
import { DeviceChassis } from './device-chassis';
import { PreviewFrame } from './preview-frame';
import { BuildErrorCard } from './build-error-card';
import { BuildStateOverlay } from './build-state-overlay';
import { deriveBuildPhase, derivePreviewPresence } from '../build-phase';
import { DeviceActionBar } from './device-action-bar';
import { canvasApi } from './canvas-api';

/**
 * One phone on the canvas: its label, its chassis, and its live preview.
 *
 * Memoised, and it subscribes to only its own slice of state, so a change on one
 * phone never re-renders the others. Its position is written to the DOM by the
 * canvas — this component does not read x/y during a drag at all.
 */
export const DeviceNode = memo(function DeviceNode({
  device,
  selected,
  registerNode,
  onDragStart,
}: {
  device: DeviceRow;
  selected: boolean;
  registerNode: (deviceId: string, node: HTMLDivElement | null) => void;
  onDragStart: (deviceId: string, event: React.PointerEvent) => void;
}) {
  const chrome = useStudio((state) => state.chrome[device.id]);
  const bundle = useStudio((state) => state.bundles[String(device.versionId ?? 'working')]);
  const versionLabel = useStudio(
    (state) => state.versions.find((version) => version.id === device.versionId)?.label ?? null,
  );
  const dismissNotification = useStudio((state) => state.dismissNotification);
  const resolveSheet = useStudio((state) => state.resolveSheet);
  const replayStep = useStudio((state) => state.replay?.step ?? null);
  const replayActive = useStudio((state) => Boolean(state.replay));
  const projectName = useStudio((state) => state.snapshot.project.name);
  // What the server will compile until a build has answered with its own value.
  const entryFile = useStudio((state) => state.snapshot.project.entryFile);

  const preset = getPreset(device.presetId);
  const geometry = deviceGeometry(preset, device.orientation);
  const role = getRole(device.role);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      // Only a primary-button press on our own chrome starts a drag; the screen
      // belongs to the app (its events go to the iframe and never reach us).
      if (event.button !== 0) return;
      onDragStart(device.id, event);
    },
    [device.id, onDragStart],
  );

  const badgeTotal = Object.values(chrome?.badges ?? {}).reduce((sum, value) => sum + value, 0);

  // Hover state lives here rather than in the store: it changes on every pointer
  // move across the canvas and must never cause a render anywhere else.
  const [hovered, setHovered] = useState(false);
  // Session-only, deliberately. `DeviceRow` has no `locked` column and nothing
  // persists one — see the note on `DeviceActionBarProps.locked`.
  const [locked, setLocked] = useState(false);

  const dimmed = replayActive && replayStep === null;
  const screenContents = (
    <>
      <PreviewFrame
        deviceId={device.id}
        width={geometry.screen.width}
        height={geometry.screen.height}
        title={`${device.name} preview`}
      />

      {/* Build failure is shown *inside* the device: that is where you are looking. */}
      {bundle?.status === 'error' ? <BuildErrorCard deviceId={device.id} bundle={bundle} /> : null}

      {/* Every other build state. The phase is derived from what is genuinely
          known — including whether the frame has actually mounted the code, which
          is a separate fact from the build having succeeded, and the reason a
          phone could read "ready" while showing nothing. */}
      <BuildStateOverlay
        phase={deriveBuildPhase(bundle, Boolean(chrome?.mounted))}
        deviceId={device.id}
        projectName={projectName}
        roleLabel={role.label}
        roleColor={roleColor(device.role)}
        theme={device.theme}
        entry={bundle?.entry ?? entryFile}
        lastBuildMs={bundle?.lastCompletedMs ?? null}
        hasPreview={derivePreviewPresence(bundle, Boolean(chrome?.mounted)) !== 'none'}
      />
    </>
  );

  return (
    <div
      ref={(node) => registerNode(device.id, node)}
      className="pl-gpu absolute left-0 top-0"
      style={{ zIndex: selected || hovered ? 40 : device.zIndex }}
      onPointerDown={locked ? undefined : onPointerDown}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      data-device-id={device.id}
      data-locked={locked ? 'true' : undefined}
    >
      <DeviceActionBar
        device={device}
        hovered={hovered}
        selected={selected}
        locked={locked}
        onToggleLock={(_, next) => setLocked(next)}
        onFocus={(deviceId) => canvasApi.get()?.focusDevice(deviceId)}
      />
      {/* Label strip: also a drag handle, and the only place with device chrome. */}
      <div
        className="mb-2 flex items-center gap-1.5 pl-1"
        style={{ width: geometry.chassis.width, cursor: 'grab' }}
      >
        <span
          className="size-[7px] shrink-0 rounded-full"
          style={{ background: roleColor(device.role) }}
          aria-hidden="true"
        />
        <span className="truncate text-[12px] font-semibold tracking-[-0.008em] text-paper-800">
          {device.name}
        </span>
        <span className="shrink-0 text-[11px] text-paper-500">{role.label}</span>
        {device.userLabel ? (
          <span className="truncate text-[11px] text-paper-400">· {device.userLabel}</span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {versionLabel ? (
            <span className="rounded border border-paper-200 bg-paper-0 px-1 py-[1px] text-[10px] font-medium text-paper-600">
              {versionLabel}
            </span>
          ) : null}
          {device.stateFlags.length > 0 ? (
            <span
              className="rounded border border-caution-200 bg-caution-50 px-1 py-[1px] text-[10px] font-medium text-caution-700"
              title={device.stateFlags.join(', ')}
            >
              {device.stateFlags.length} edge case{device.stateFlags.length === 1 ? '' : 's'}
            </span>
          ) : null}
          {badgeTotal > 0 ? (
            <span className="rounded-full bg-danger-500 px-1.5 py-[1px] text-[10px] font-semibold text-white">
              {badgeTotal}
            </span>
          ) : null}
          {device.theme === 'dark' ? (
            <span className="rounded border border-paper-300 bg-paper-800 px-1 py-[1px] text-[10px] font-medium text-paper-100">
              dark
            </span>
          ) : null}
          {device.locale !== 'en' ? (
            <span className="rounded border border-paper-200 bg-paper-0 px-1 py-[1px] text-[10px] font-medium uppercase text-paper-600">
              {device.locale}
            </span>
          ) : null}
        </span>
      </div>

      <DeviceChassis
        preset={preset}
        orientation={device.orientation}
        theme={device.theme}
        selected={selected}
        dimmed={dimmed}
        route={chrome?.route ?? null}
        title={projectName}
        chrome={{
          status: chrome?.status ?? { battery: 82, charging: false, signal: 4, wifi: true, network: device.network },
          island: chrome?.island ?? { state: 'compact', label: null, detail: null, progress: null, tone: 'default' },
          notifications: chrome?.notifications ?? [],
          sheet: chrome?.sheet ?? null,
          keyboardOpen: device.stateFlags.includes('keyboard-open'),
        }}
        onDismissNotification={(id) => dismissNotification(device.id, id)}
        onResolveSheet={(sheetId, allowed) => resolveSheet(device.id, sheetId, allowed)}
      >
        {screenContents}
      </DeviceChassis>
    </div>
  );
});
