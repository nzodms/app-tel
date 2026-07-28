'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  Copy,
  Crosshair,
  GitBranch,
  Lock,
  RectangleHorizontal,
  RectangleVertical,
  SlidersHorizontal,
  Smartphone,
  Trash2,
  Unlock,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { DEVICE_PRESETS, getPreset } from '@/lib/devices/presets';
import { getRole, roleColor } from '@/lib/devices/roles';
import { Button, IconButton } from '@/components/ui/primitives';
import { MenuItem, MenuLabel, Popover } from '@/components/ui/popover';
import type { DeviceRow } from '@/server/db';
import { useStudio } from '../context';
import { canvasApi } from './canvas-api';

/**
 * The contextual action bar for one phone.
 *
 * It floats *under* the chassis and appears only while the phone is hovered or
 * selected — the canvas is meant to be a wall of running apps, not a wall of
 * chrome. Four rules make that safe:
 *
 *  1. It is never permanent. Hidden means `visibility: hidden` (out of the tab
 *     order and out of the accessibility tree) plus `pointer-events: none`, so a
 *     hidden bar can neither be tabbed into nor swallow a click meant for the
 *     phone. It also sits below the chassis, so even when visible it never covers
 *     the app's own screen.
 *  2. It is not a drag handle. `pointerdown` is stopped at the bar, so pressing a
 *     control never reaches the device node's drag handler. Dragging is still
 *     started by the label strip and the chassis, exactly as before.
 *  3. Nothing here is decorative. Every switch writes a real field through
 *     `patchDevice`, and the two things the studio genuinely cannot persist —
 *     focus and lock — are callbacks the caller owns (see the props below).
 *  4. It never touches the preview. Changing the pinned version goes through
 *     `patchDevice`, which is the same path the Edge Case Studio uses; the iframe
 *     is messaged, never re-created.
 *
 * ## Sizing at low canvas zoom
 *
 * The bar renders inside the canvas world, which is scaled by the viewport's
 * transform, so a 12px label is 12 × zoom physical pixels — unreadable at the 0.3
 * zoom you get when fitting eight phones on screen. The bar therefore
 * counter-scales: it subscribes to `canvasApi` and writes `1 / zoom` into a CSS
 * custom property on its own wrapper, clamped to [0.5, 2.2]. Result:
 *
 *  - between roughly 45% and 200% zoom the bar has a constant *physical* size, so
 *    its type and its hit targets are the same as the rest of the studio chrome;
 *  - outside that range it degrades instead of exploding — a bar three times the
 *    width of the phone would hide the phones next to it, which is worse than a
 *    slightly small bar.
 *
 * The counter-scale is written straight to the DOM from the zoom subscription and
 * skipped when the value has not changed, so panning and zooming the canvas cause
 * no React render here — same discipline as the drag path.
 */

/** Counter-scale bounds. See the sizing note above. */
const SCALE_MIN = 0.5;
const SCALE_MAX = 2.2;

const LOCKED_NOTE = 'Locked in this browser session — unlock to change it.';

export interface DeviceActionBarProps {
  device: DeviceRow;
  /** True while the pointer is over this device's node. */
  hovered: boolean;
  /** True while this device is part of the canvas selection. */
  selected: boolean;
  /**
   * Session-only lock, owned entirely by the caller.
   *
   * `DeviceRow` has no `locked` column and no endpoint writes one, so there is
   * nothing to persist and nothing to sync: this is React state in the canvas,
   * lost on reload, invisible to anyone else on the project and invisible to
   * Claude over MCP. The tooltip says exactly that rather than implying a setting.
   *
   * Inside this bar, `locked` disables the controls that change *this* device
   * (format, orientation, pinned version, delete). What it means outside the bar
   * — usually "do not drag me" — is the caller's decision.
   */
  locked: boolean;
  onToggleLock: (deviceId: string, next: boolean) => void;
  /**
   * Focus does not exist in the store. The canvas has `canvasApi.focusDevice`,
   * but wiring it is not this component's business — the caller decides what
   * focusing means (recentre, solo, both) and passes it in.
   */
  onFocus: (deviceId: string) => void;
  className?: string;
}

/**
 * Reports a popover's open state to the bar.
 *
 * The bar has to stay visible while one of its menus is open, even if the pointer
 * has left the phone. `Popover` owns that state and only exposes it to its trigger
 * render prop, so this effect-only child forwards it upward — legal, unlike
 * calling `setState` during the trigger's render.
 */
function MenuOpenSignal({ open, onChange }: { open: boolean; onChange: (delta: number) => void }) {
  useEffect(() => {
    if (!open) return;
    onChange(1);
    return () => onChange(-1);
  }, [open, onChange]);
  return null;
}

function Divider() {
  return <span className="mx-0.5 h-4 w-px shrink-0 bg-paper-200" aria-hidden="true" />;
}

/** A menu note, in the same voice as the toolbar's format disclaimer. */
function MenuNote({ children }: { children: ReactNode }) {
  return (
    <p className="border-t border-paper-150 px-2.5 py-1.5 text-[10.5px] leading-snug text-paper-400">
      {children}
    </p>
  );
}

/**
 * A disabled control receives no pointer events, so its own `title` never opens.
 * When the phone is locked the explanation moves to a wrapper that does — greyed
 * controls that cannot say why they are greyed are the usual reason people think
 * something is broken.
 */
function LockedHint({ locked, children }: { locked: boolean; children: ReactNode }) {
  if (!locked) return <>{children}</>;
  // Same flex/gap as the bar, so wrapping changes nothing about the layout.
  return (
    <div className="flex items-center gap-0.5" title={LOCKED_NOTE}>
      {children}
    </div>
  );
}

export function DeviceActionBar({
  device,
  hovered,
  selected,
  locked,
  onToggleLock,
  onFocus,
  className,
}: DeviceActionBarProps) {
  const patchDevice = useStudio((state) => state.patchDevice);
  const duplicateDevice = useStudio((state) => state.duplicateDevice);
  const removeDevice = useStudio((state) => state.removeDevice);
  const selectDevice = useStudio((state) => state.selectDevice);
  const toggleEdgeCases = useStudio((state) => state.toggleEdgeCases);
  const edgeCasesOpen = useStudio((state) => state.edgeCasesOpen);
  const versions = useStudio((state) => state.versions);

  const [openMenus, setOpenMenus] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const scalerRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  const changeOpenMenus = useCallback((delta: number) => {
    setOpenMenus((count) => Math.max(0, count + delta));
  }, []);

  /* Counter-scale — see the sizing note at the top. No React render involved. */
  useEffect(() => {
    let last = -1;
    return canvasApi.subscribe((zoom) => {
      const scale = Math.min(Math.max(1 / (zoom || 1), SCALE_MIN), SCALE_MAX);
      if (Math.abs(scale - last) < 0.002) return;
      last = scale;
      scalerRef.current?.style.setProperty('--pl-action-bar-scale', scale.toFixed(3));
    });
  }, []);

  /* A pending delete must not get stuck: Escape or a click elsewhere cancels it. */
  useEffect(() => {
    if (!confirmingDelete) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setConfirmingDelete(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConfirmingDelete(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [confirmingDelete]);

  const preset = getPreset(device.presetId);
  const role = getRole(device.role);
  const flagCount = device.stateFlags.length;
  const pinnedVersion = device.versionId
    ? (versions.find((version) => version.id === device.versionId) ?? null)
    : null;
  // A pinned id with no matching snapshot in the list is still pinned — say so
  // rather than falling back to "Working tree", which would be a lie.
  const versionText = device.versionId ? (pinnedVersion?.label ?? 'Pinned snapshot') : 'Working tree';

  const visible = hovered || selected || openMenus > 0 || confirmingDelete;

  /**
   * Interacting with the bar selects the phone (so the Edge Case Studio and the
   * inspector follow), and never starts a drag.
   */
  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.stopPropagation();
      if (!selected) selectDevice(device.id);
    },
    [device.id, selectDevice, selected],
  );

  return (
    <div
      className={cn(
        // `w-max` matters: an absolutely positioned box at `left-1/2` otherwise
        // shrink-to-fits into the half-width that is left, which would squeeze the
        // controls instead of letting the bar be as wide as it needs to be.
        'pointer-events-none absolute left-1/2 top-full z-[45] w-max',
        className,
      )}
      data-testid={`device-action-bar-${device.id}`}
      data-visible={visible ? 'true' : 'false'}
    >
      <div
        ref={scalerRef}
        className="pt-2"
        style={{
          transform: 'translateX(-50%) scale(var(--pl-action-bar-scale, 1))',
          transformOrigin: 'top center',
        }}
      >
        <div
          ref={barRef}
          role="toolbar"
          aria-label={`${device.name} actions`}
          onPointerDown={onPointerDown}
          // The rise is an inline transform rather than a `translate-y-*` utility so
          // the transitioned property is unambiguously `transform`. The scale lives
          // on the wrapper above, so the two never fight over one property.
          style={{ transform: visible ? 'translateY(0)' : 'translateY(3px)' }}
          className={cn(
            // No `whitespace-nowrap` here: it would inherit into the popovers and
            // flatten their wrapped notes. The buttons bring their own.
            'flex h-[30px] items-center gap-0.5 rounded-[var(--radius-panel)]',
            'border border-paper-200 bg-paper-0/97 px-1 shadow-float backdrop-blur',
            'transition-[opacity,transform,visibility] duration-[160ms]',
            '[transition-timing-function:var(--ease-out-quint)]',
            visible ? 'pointer-events-auto visible opacity-100' : 'invisible opacity-0',
          )}
        >
          {confirmingDelete ? (
            <>
              <span className="whitespace-nowrap px-1.5 text-[11.5px] font-medium text-paper-700">
                Delete {device.name}?
              </span>
              <Button size="xs" variant="ghost" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
              <Button
                size="xs"
                variant="danger"
                onClick={() => {
                  setConfirmingDelete(false);
                  void removeDevice(device.id);
                }}
              >
                Delete
              </Button>
            </>
          ) : (
            <>
              {/* Role — identity, not a control: no endpoint in this bar writes it. */}
              <span
                className="flex shrink-0 items-center gap-1.5 whitespace-nowrap px-1.5 text-[11.5px] font-medium text-paper-700"
                title={`${role.label} — ${role.description}`}
              >
                <span
                  className="size-[7px] shrink-0 rounded-full"
                  style={{ background: roleColor(device.role) }}
                  aria-hidden="true"
                />
                {role.label}
              </span>

              <Divider />

              {/* Configuration: format, orientation, and which code this phone runs. */}
              <LockedHint locked={locked}>
                {/* Format */}
                <Popover
                  width={236}
                  trigger={({ open, toggle }) => (
                    <>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={toggle}
                        disabled={locked}
                        title={`Format · ${preset.formatNote}`}
                        className={cn(open && 'bg-paper-100')}
                      >
                        <Smartphone size={12} strokeWidth={1.8} />
                        {preset.name}
                        <ChevronDown size={11} strokeWidth={2} className="text-paper-400" />
                      </Button>
                      <MenuOpenSignal open={open} onChange={changeOpenMenus} />
                    </>
                  )}
                >
                  {({ close }) => (
                    <div className="max-h-[280px] overflow-y-auto">
                      <MenuLabel>Format</MenuLabel>
                      {DEVICE_PRESETS.map((entry) => (
                        <MenuItem
                          key={entry.id}
                          active={entry.id === device.presetId}
                          hint={`${entry.viewport.width}×${entry.viewport.height}`}
                          onClick={() => {
                            if (entry.id !== device.presetId) {
                              void patchDevice(device.id, { presetId: entry.id });
                            }
                            close();
                          }}
                        >
                          {entry.name}
                        </MenuItem>
                      ))}
                      <MenuNote>
                        Preset names describe the viewport format. PhoneLab is not affiliated with any
                        device manufacturer.
                      </MenuNote>
                    </div>
                  )}
                </Popover>

                {/* Orientation */}
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={locked}
                  title={
                    device.orientation === 'portrait' ? 'Rotate to landscape' : 'Rotate to portrait'
                  }
                  onClick={() =>
                    void patchDevice(device.id, {
                      orientation: device.orientation === 'portrait' ? 'landscape' : 'portrait',
                    })
                  }
                >
                  {device.orientation === 'portrait' ? (
                    <RectangleVertical size={12} strokeWidth={1.8} />
                  ) : (
                    <RectangleHorizontal size={12} strokeWidth={1.8} />
                  )}
                  {device.orientation === 'portrait' ? 'Portrait' : 'Landscape'}
                </Button>

                {/* Pinned version */}
                <Popover
                  width={244}
                  trigger={({ open, toggle }) => (
                    <>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={toggle}
                        disabled={locked}
                        title={
                          device.versionId
                            ? 'Pinned to a snapshot — this phone ignores changes to the working tree.'
                            : 'Following the working tree — this phone rebuilds as files change.'
                        }
                        className={cn(open && 'bg-paper-100', device.versionId && 'text-paper-900')}
                      >
                        <GitBranch size={12} strokeWidth={1.8} />
                        {versionText}
                        <ChevronDown size={11} strokeWidth={2} className="text-paper-400" />
                      </Button>
                      <MenuOpenSignal open={open} onChange={changeOpenMenus} />
                    </>
                  )}
                >
                  {({ close }) => (
                    <div className="max-h-[300px] overflow-y-auto">
                      <MenuLabel>This phone runs</MenuLabel>
                      <MenuItem
                        active={device.versionId === null}
                        hint="live"
                        onClick={() => {
                          if (device.versionId !== null) {
                            void patchDevice(device.id, { versionId: null });
                          }
                          close();
                        }}
                      >
                        Working tree
                      </MenuItem>
                      {[...versions]
                        .sort((a, b) => b.sequence - a.sequence)
                        .map((version) => (
                          <MenuItem
                            key={version.id}
                            active={version.id === device.versionId}
                            hint={`${version.fileCount} file${version.fileCount === 1 ? '' : 's'}`}
                            onClick={() => {
                              if (version.id !== device.versionId) {
                                void patchDevice(device.id, { versionId: version.id });
                              }
                              close();
                            }}
                          >
                            {version.label}
                          </MenuItem>
                        ))}
                      {versions.length === 0 ? (
                        <MenuNote>
                          No snapshots yet. Every phone follows the working tree until one is taken.
                        </MenuNote>
                      ) : (
                        <MenuNote>
                          A pinned phone keeps running that snapshot while the working tree changes —
                          which is how you put two versions side by side.
                        </MenuNote>
                      )}
                    </div>
                  )}
                </Popover>
              </LockedHint>

              {/* Edge cases: the count, and the way into the studio that owns them. */}
              <Button
                size="xs"
                variant="ghost"
                title={
                  flagCount > 0
                    ? `Active on this phone: ${device.stateFlags.join(', ')}`
                    : 'No edge cases active on this phone'
                }
                onClick={() => {
                  selectDevice(device.id);
                  if (!edgeCasesOpen) toggleEdgeCases();
                }}
                className={cn(
                  flagCount > 0 && 'bg-caution-50 text-caution-700 hover:bg-caution-50/80',
                )}
              >
                <SlidersHorizontal size={12} strokeWidth={1.8} />
                {flagCount > 0
                  ? `${flagCount} edge case${flagCount === 1 ? '' : 's'}`
                  : 'No edge cases'}
              </Button>

              <Divider />

              <IconButton
                size="xs"
                label="Focus this phone"
                title="Focus this phone on the canvas"
                onClick={() => onFocus(device.id)}
              >
                <Crosshair size={13} strokeWidth={1.8} />
              </IconButton>

              <IconButton
                size="xs"
                label="Duplicate this phone"
                title="Duplicate — same role, format, pinned version and edge cases"
                onClick={() => void duplicateDevice(device.id)}
              >
                <Copy size={13} strokeWidth={1.8} />
              </IconButton>

              <IconButton
                size="xs"
                label={locked ? 'Unlock this phone' : 'Lock this phone'}
                title={
                  locked
                    ? 'Unlock. The lock applies to this browser session only — it is not saved and nobody else sees it.'
                    : 'Lock. Applies to this browser session only — it is not saved and nobody else sees it.'
                }
                aria-pressed={locked}
                onClick={() => onToggleLock(device.id, !locked)}
                className={cn(locked && 'bg-paper-100 text-paper-900')}
              >
                {locked ? (
                  <Lock size={13} strokeWidth={1.8} />
                ) : (
                  <Unlock size={13} strokeWidth={1.8} />
                )}
              </IconButton>

              <LockedHint locked={locked}>
                <IconButton
                  size="xs"
                  label="Delete this phone"
                  title="Delete this phone from the canvas"
                  disabled={locked}
                  onClick={() => setConfirmingDelete(true)}
                  className="text-paper-600 hover:bg-danger-50 hover:text-danger-700"
                >
                  <Trash2 size={13} strokeWidth={1.8} />
                </IconButton>
              </LockedHint>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
