'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  Copy,
  Crosshair,
  GitBranch,
  Lock,
  Pin,
  RectangleHorizontal,
  RectangleVertical,
  SlidersHorizontal,
  Trash2,
  Unlock,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { DEVICE_PRESETS, getPreset, isRotatable } from '@/lib/devices/presets';
import { FAMILY_LABELS, FAMILY_ORDER, FamilyIcon } from '../device-family';
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
 *     the app's own screen. Note that `pointer-events` is a *class*, not a
 *     transitioned property: the moment the bar starts fading out it stops being
 *     hit-testable, so a bar mid-fade over a neighbouring phone cannot take that
 *     phone's click.
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
 * ## What the bar says, and how loudly
 *
 * Four chips at one weight is a debug toolbar, not information design. They are
 * not equally important and they no longer look it:
 *
 *   role        identity — what this phone *is*. The heaviest type in the bar,
 *               and the only thing here that is not a control: no surface, no
 *               hover, no pointer cursor, so it cannot be mistaken for one.
 *   format      the primary control — what it is running *on*. A step under the
 *               identity, and the only chip that is always meaningful, because
 *               every phone has a format.
 *   version     a chip whose *value* decides its weight. "Working tree" is the
 *   edge cases  default and recedes to paper-600; a pinned snapshot takes the
 *               studio's accent tint and three active edge cases take the caution
 *               tint, because that is the state that explains what you are
 *               looking at. A pinned phone also swaps its icon from a branch to a
 *               pin — the shape changes, not just the colour.
 *   actions     focus / duplicate / lock / delete: icon-only, quietest at rest,
 *               and set apart by 12px rather than by a rule.
 *
 * Spacing is the separator. The two hairline dividers are gone: groups are told
 * apart by 4px between chips against 12px before the action cluster, and the bar
 * is 32px tall with 24px chips so the row has somewhere to breathe. Chips never
 * change size between states — tints and text colours only, never a border that
 * appears on hover — so nothing in the row moves while you are aiming at it.
 *
 * ## Motion
 *
 * Every state here is a two-value CSS transition on transform / opacity /
 * background-color, so globals.css collapses all of it under
 * `prefers-reduced-motion` and `[data-reduce-motion='true']` without this file
 * needing an escape hatch, and none of it can cost a layout.
 *
 * The entrance is a 180ms fade with 4px of rise on `--ease-out-quint`: damped,
 * no overshoot, and gone in 120ms because leaving should feel immediate. It is
 * held back by an 80ms delay in the *show* direction only, which is what stops
 * the bar from playing on every phone you sweep the pointer across — a cancelled
 * transition never starts, so a sweep costs nothing at all. The delay is not
 * motion and deliberately survives reduced motion: it is hover intent.
 *
 * One consequence worth stating, because it was a real bug: the 8px between the
 * chassis and the bar belongs to a `pointer-events: none` wrapper, so a pointer
 * sample landing in that gap used to count as leaving the phone and the bar
 * vanished while you were travelling to it. The bar therefore carries a
 * transparent ::before over exactly that gap — same trick as `IconButton`'s hit
 * bleed — so moving from the phone to a chip never breaks contact. It is part of
 * the bar, so it is inert whenever the bar is.
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

/* ------------------------------------------------------------------ chips -- */
/**
 * The tone ladder. Each entry is layered over `Button`'s `ghost` variant, which
 * already owns the rest → hover → active steps; these only re-point the colours,
 * including the hover and active ones, so a tinted chip does not fall back to the
 * neutral hover half way through the ladder.
 *
 * No entry changes the box: no border appears, no weight changes, no padding
 * moves. A chip that resizes on hover makes a row of chips jitter under the
 * pointer, and these sit 4px apart.
 */

/** The primary control: always carries a value, so it never recedes. */
const CHIP_PRIMARY = 'text-paper-800 hover:text-paper-900';

/** A chip sitting on its default value. Readable, deliberately unremarkable. */
const CHIP_MUTED = 'text-paper-600 hover:text-paper-900 active:text-paper-900';

/** Pinned to a snapshot — the studio's "this one is set" tint. */
const CHIP_PINNED =
  'bg-azure-50 text-azure-700 hover:bg-azure-100 hover:text-azure-700 ' +
  'active:bg-azure-200 active:text-azure-700';

/** Edge cases active — the state most likely to explain what you are seeing. */
const CHIP_FLAGGED =
  'bg-caution-50 text-caution-700 hover:bg-caution-200/50 hover:text-caution-700 ' +
  'active:bg-caution-200/75 active:text-caution-700';

/**
 * Open is a fourth state and has to be distinguishable from hover, otherwise the
 * chip you just opened looks exactly like the chip you are merely pointing at.
 * It sits one step past hover and holds while the pointer is inside the menu.
 *
 * Both re-point hover and active as well: left to the variant, hovering an open
 * chip would have *lightened* it back to the hover surface it already passed.
 */
const CHIP_OPEN = 'bg-paper-150 text-paper-900 hover:bg-paper-200 active:bg-paper-200';
const CHIP_OPEN_PINNED =
  'bg-azure-100 text-azure-700 hover:bg-azure-200 hover:text-azure-700 active:bg-azure-200';

/** Trailing icon actions: quietest at rest, full contrast under the pointer. */
const ACTION = 'text-paper-600';
/** A latched toggle. Hover and press go *darker*, since lighter would read as off. */
const ACTION_ON =
  'bg-paper-150 text-paper-900 hover:bg-paper-200 hover:text-paper-900 active:bg-paper-300';
const ACTION_DANGER =
  'text-paper-600 hover:bg-danger-50 hover:text-danger-700 ' +
  'active:bg-danger-100 active:text-danger-700';

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

/**
 * The disclosure caret on a menu chip.
 *
 * Turning it over is the one piece of motion inside the bar, and it is honest:
 * the menu really is open. `opacity` rather than a fixed grey so the caret stays
 * one step under whatever tone its chip is currently wearing — neutral, azure or
 * caution, light theme or dark — instead of needing a colour per state.
 */
function Caret({ open }: { open: boolean }) {
  return (
    <ChevronDown
      size={11}
      strokeWidth={2}
      aria-hidden="true"
      className={cn(
        'shrink-0 opacity-55',
        'transition-transform duration-[160ms] [transition-timing-function:var(--ease-out-quint)]',
        open && 'rotate-180',
      )}
    />
  );
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
 *
 * The wrapper is rendered whether or not the phone is locked (only the `title`
 * is conditional), because it is also the flex box that holds a group together:
 * a wrapper that appears with the lock would change the bar's spacing with it.
 */
function LockedGroup({
  locked,
  className,
  children,
}: {
  locked: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex items-center', className)} title={locked ? LOCKED_NOTE : undefined}>
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

  /**
   * Confirming replaces the whole row, which unmounts the button that was
   * focused — so a keyboard user was dropped back to <body> in the middle of a
   * destructive flow. Focus lands on Cancel, the safe half of the choice.
   * `preventScroll` because this box lives inside the transformed canvas world
   * and focusing must never scroll it. Queried rather than ref'd: `Button` takes
   * no ref, and this needs no other plumbing.
   */
  useEffect(() => {
    if (!confirmingDelete) return;
    barRef.current
      ?.querySelector<HTMLButtonElement>('[data-pl-confirm-cancel]')
      ?.focus({ preventScroll: true });
  }, [confirmingDelete]);

  const preset = getPreset(device.presetId);
  const role = getRole(device.role);
  const flagCount = device.stateFlags.length;
  // Same truthiness test the label below uses, so the tint and the words can
  // never disagree about whether this phone is pinned.
  const pinned = Boolean(device.versionId);
  const pinnedVersion = device.versionId
    ? (versions.find((version) => version.id === device.versionId) ?? null)
    : null;
  // A pinned id with no matching snapshot in the list is still pinned — say so
  // rather than falling back to "Working tree", which would be a lie.
  const versionText = device.versionId ? (pinnedVersion?.label ?? 'Pinned snapshot') : 'Working tree';
  // Snapshot labels are written by hand and can be long; the chip caps them so a
  // bar cannot grow wider than the phones around it. The full text is never lost
  // — it is in the tooltip, which is where the rest of the explanation already is.
  const versionTitle = pinned
    ? `Pinned to ${versionText} — this phone ignores changes to the working tree.`
    : 'Following the working tree — this phone rebuilds as files change.';

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
          style={{ transform: visible ? 'translateY(0)' : 'translateY(4px)' }}
          className={cn(
            // No `whitespace-nowrap` here: it would inherit into the popovers and
            // flatten their wrapped notes. The buttons bring their own.
            'relative flex h-8 items-center gap-1 rounded-[var(--radius-panel)]',
            // pl > pr because the row starts with bare text and ends with icon
            // buttons, whose glyphs are already inset ~5px inside their own box:
            // symmetric padding would make the bar look right-heavy.
            'border border-paper-200 bg-paper-0/97 pl-2.5 pr-1.5 shadow-float',
            // The bridge across the 8px gap above — see the motion note at the top.
            // Transparent, no layout, and inert with the rest of the bar.
            //
            // 9px, not 8: an absolutely positioned child is laid out against its
            // containing block's *padding* box, so `-top-2` on a 1px-bordered bar
            // starts the bridge one pixel below the chassis and leaves a 1px band
            // of bare canvas there — which a slow pointer lands in, which is the
            // exact bug this bridge exists to fix. -9/9 puts its top edge flush
            // with the chassis and its bottom 1px inside the bar's own border.
            "before:absolute before:inset-x-0 before:-top-[9px] before:h-[9px] before:content-['']",
            'transition-[opacity,transform,visibility] [transition-timing-function:var(--ease-out-quint)]',
            visible
              ? // Held back by 80ms so a pointer sweeping the canvas never starts
                // it; a transition that is cancelled before its delay elapses does
                // no work at all.
                'pointer-events-auto visible opacity-100 delay-[80ms] duration-[180ms]'
              : // No delay and a shorter fade on the way out: arriving is allowed to
                // be gentle, leaving has to feel immediate.
                'invisible opacity-0 duration-[120ms]',
          )}
        >
          {confirmingDelete ? (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 whitespace-nowrap px-0.5 text-[11.5px] font-medium text-paper-800">
                <Trash2 size={12} strokeWidth={1.8} className="shrink-0 text-danger-600" aria-hidden="true" />
                Delete {device.name}?
              </span>
              <div className="flex items-center gap-1">
                <Button
                  size="xs"
                  variant="ghost"
                  data-pl-confirm-cancel=""
                  className={CHIP_MUTED}
                  onClick={() => setConfirmingDelete(false)}
                >
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
              </div>
            </div>
          ) : (
            <>
              {/* Role — identity, not a control: no endpoint in this bar writes it,
                  so it gets no surface, no hover and no pointer cursor. The extra
                  margin is what separates it from the controls; there is no rule
                  there any more. */}
              <span
                className="mr-1 flex shrink-0 cursor-default select-none items-center gap-1.5 whitespace-nowrap text-[11.5px] font-semibold tracking-[-0.005em] text-paper-900"
                title={`${role.label} — ${role.description}`}
              >
                <span
                  className="size-[7px] shrink-0 rounded-full"
                  style={{ background: roleColor(device.role) }}
                  aria-hidden="true"
                />
                {role.label}
              </span>

              {/* Configuration: format, orientation, and which code this phone runs. */}
              <LockedGroup locked={locked} className="gap-1">
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
                        aria-expanded={open}
                        title={`Format · ${preset.formatNote}`}
                        className={cn(CHIP_PRIMARY, open && CHIP_OPEN)}
                      >
                        <FamilyIcon family={preset.family} />
                        {preset.name}
                        <Caret open={open} />
                      </Button>
                      <MenuOpenSignal open={open} onChange={changeOpenMenus} />
                    </>
                  )}
                >
                  {({ close }) => (
                    <div className="max-h-[320px] overflow-y-auto">
                      {FAMILY_ORDER.filter((family) =>
                        DEVICE_PRESETS.some((entry) => entry.family === family),
                      ).map((family) => (
                        <div key={family}>
                          <MenuLabel>{FAMILY_LABELS[family]}</MenuLabel>
                          {DEVICE_PRESETS.filter((entry) => entry.family === family).map((entry) => (
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
                        </div>
                      ))}
                      <MenuNote>
                        Preset names describe the viewport format. PhoneLab is not affiliated with any
                        device manufacturer.
                      </MenuNote>
                    </div>
                  )}
                </Popover>

                {/* Orientation. Only offered where it means something: a monitor
                    and a laptop do not turn, and `deviceGeometry` ignores the
                    field for them — a button that persisted a value nothing read
                    would be a control that does nothing.

                    Muted, because unlike the format this one is already legible
                    from the canvas: the phone is visibly on its side. */}
                {isRotatable(preset) ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={locked}
                    className={CHIP_MUTED}
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
                ) : null}

                {/* Pinned version. The default — following the working tree — is
                    the quiet case; a pin is not, and says so with the accent tint
                    and a different glyph, so it reads before you get to the word. */}
                <Popover
                  width={244}
                  trigger={({ open, toggle }) => (
                    <>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={toggle}
                        disabled={locked}
                        aria-expanded={open}
                        title={versionTitle}
                        className={cn(
                          pinned ? CHIP_PINNED : CHIP_MUTED,
                          open && (pinned ? CHIP_OPEN_PINNED : CHIP_OPEN),
                        )}
                      >
                        {pinned ? (
                          <Pin size={12} strokeWidth={1.8} className="shrink-0" />
                        ) : (
                          <GitBranch size={12} strokeWidth={1.8} className="shrink-0" />
                        )}
                        <span className="max-w-[128px] truncate">{versionText}</span>
                        <Caret open={open} />
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
              </LockedGroup>

              {/* Edge cases: the count, and the way into the studio that owns them.
                  Same rule as the version pin — none is the quiet case, any is
                  not — and it stays live while the phone is locked, because
                  looking at an edge case does not change the device. */}
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
                className={flagCount > 0 ? CHIP_FLAGGED : CHIP_MUTED}
              >
                <SlidersHorizontal size={12} strokeWidth={1.8} className="shrink-0" />
                {flagCount > 0
                  ? `${flagCount} edge case${flagCount === 1 ? '' : 's'}`
                  : 'No edge cases'}
              </Button>

              {/* Actions. 12px away from the last chip — the gap is the divider —
                  and 2px apart from each other, which is exactly the bleed
                  `IconButton` extends its hit area by, so two neighbours can only
                  overlap inside the gap and never over each other's glyph. */}
              <div className="ml-2 flex items-center gap-0.5">
                <IconButton
                  size="xs"
                  label="Focus this phone"
                  title="Focus this phone on the canvas"
                  className={ACTION}
                  onClick={() => onFocus(device.id)}
                >
                  <Crosshair size={13} strokeWidth={1.8} />
                </IconButton>

                <IconButton
                  size="xs"
                  label="Duplicate this phone"
                  title="Duplicate — same role, format, pinned version and edge cases"
                  className={ACTION}
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
                  className={locked ? ACTION_ON : ACTION}
                >
                  {locked ? (
                    <Lock size={13} strokeWidth={1.8} />
                  ) : (
                    <Unlock size={13} strokeWidth={1.8} />
                  )}
                </IconButton>

                <LockedGroup locked={locked}>
                  <IconButton
                    size="xs"
                    label="Delete this phone"
                    title="Delete this phone from the canvas"
                    disabled={locked}
                    onClick={() => setConfirmingDelete(true)}
                    className={ACTION_DANGER}
                  >
                    <Trash2 size={13} strokeWidth={1.8} />
                  </IconButton>
                </LockedGroup>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
