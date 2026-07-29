'use client';

import { canvasApi } from './canvas/canvas-api';
import type { Command } from './commands';
import type { StudioStore } from './store';

/**
 * Focus mode and Presentation mode: the model, and the rules for leaving them.
 *
 * ---------------------------------------------------------------------------
 * Two modes, and why they are not the same feature
 * ---------------------------------------------------------------------------
 * FOCUS is about one device. The panels go away, the canvas frames a single
 * device, and everything else recedes — because the camera moved, not because
 * anything was dimmed or hidden. Nothing else on the canvas is drawn differently
 * in focus mode. That is deliberate: a scrim over the other phones would be a
 * second, competing statement about which device matters, and the camera has
 * already made it.
 *
 * PRESENTATION is about the room. Every panel goes, the toolbar goes, the canvas
 * runs edge to edge, and the only chrome left is the quiet bar in
 * presentation-chrome.tsx. Someone who is not on the team is looking at this.
 *
 * ---------------------------------------------------------------------------
 * What this file will not do
 * ---------------------------------------------------------------------------
 * It does not hide chrome by writing to the studio store. Nothing here calls
 * `toggleTimeline`, `toggleEdgeCases` or `setLeftTab`, so there is no previous
 * panel state to remember and no way to restore it wrongly: the host simply does
 * not *show* what `chromeFor(mode)` says is hidden, and the moment the mode ends
 * the panels are exactly as they were — same tab, same width, same open files,
 * same scroll position. "Restore the previous layout" is therefore true by
 * construction rather than by a second reducer that copies state back.
 *
 * The one thing a mode really does change is the camera, and that is the one
 * thing this file captures and puts back. See CameraSnapshot for exactly how
 * much of the camera can be captured today, and what cannot.
 *
 * ---------------------------------------------------------------------------
 * Shape
 * ---------------------------------------------------------------------------
 * Everything down to "the live value" is pure: state in, state and a list of
 * effects out. No DOM, no React, no canvas. That is what makes the entering and
 * leaving rules testable on their own, and it is why the wiring step cannot get
 * the restore wrong — it does not implement it.
 *
 * Below that line there is one module-level value and a set of listeners, for
 * the same reason canvas-api.ts has one: a command palette entry is handed a
 * zustand store and nothing else, so a mode that lives in a component's
 * `useState` could never be entered from the palette. The effects are executed
 * through a `CameraPort`, so the impure part is four one-line calls into the
 * canvas handle and can be swapped for a fake in a test.
 *
 * ---------------------------------------------------------------------------
 * What this expects of whoever wires it up
 * ---------------------------------------------------------------------------
 * Four things, all in the studio shell:
 *
 *  1. `const view = useViewMode()` (presentation-chrome.tsx) and
 *     `const chrome = chromeFor(view.mode)`.
 *  2. Do not render what `chrome` says is hidden — but keep the DOM around the
 *     canvas the same shape. The left column should be hidden with the `hidden`
 *     attribute rather than unmounted (Tailwind's preflight makes that
 *     `display: none !important`, so it beats the column's own `flex`): it keeps
 *     the open editors, the scroll positions and the pane width, which is most
 *     of what "restore the previous layout" means. The toolbar and the timeline
 *     can render `null` — but in their existing slot, never by re-ordering or
 *     re-wrapping the element that holds the canvas, because moving an ancestor
 *     of a preview iframe in the DOM reloads the app inside it.
 *  3. Render `<PresentationChrome />` once, unconditionally, inside
 *     `<StudioProvider>`. It draws itself only when there is a mode to draw.
 *  4. Add `...viewModeCommands(state)` to `studioCommands()` in commands.ts.
 *
 * Nothing else. Entering, leaving, Escape, the camera and the device that is
 * being focused are all handled between this file and its chrome.
 */

/* -------------------------------------------------------------------------- */
/* The model                                                                   */
/* -------------------------------------------------------------------------- */

export type ViewMode = 'normal' | 'focus' | 'presentation';

/**
 * The part of the camera that can be captured and put back.
 *
 * It is the zoom, and only the zoom, because that is all the canvas handle
 * exposes: `CanvasApi` (canvas/canvas-api.ts) has `getZoom()` and `zoomTo()` and
 * offers no way to read the pan or to set an absolute one. The pan therefore is
 * NOT restored, and this file does not pretend otherwise — the type carries what
 * can honestly be restored and nothing else.
 *
 * What leaving actually does, then: it puts the zoom back and then asks the
 * canvas to `revealDevice` the device that was being focused, which pans the
 * least distance that brings it fully into view and does nothing at all when it
 * is already visible. So you come back to the scale you were working at, with
 * the thing you were looking at still on screen. It is not the identical
 * viewport, and it is not described anywhere in the UI as if it were.
 *
 * The fix is small and belongs to whoever owns the canvas: a `getView()` /
 * `setView(view, durationMs)` pair on `CanvasApi` (canvas.tsx already keeps
 * exactly that value in `viewRef` and already has `easeViewTo` to animate to
 * it). When it exists, `CameraSnapshot`, `canvasCamera.capture` and
 * `canvasCamera.restore` are the only three things in this file that change.
 */
export interface CameraSnapshot {
  readonly zoom: number;
}

export interface ViewModeState {
  readonly mode: ViewMode;
  /**
   * The device the camera was last asked to frame while in a mode, or null.
   *
   * In focus mode this is what the mode is *about*. In presentation mode it is
   * whichever device the presenter last jumped to, which is what the bar's
   * controls act on; null means the camera is showing the room.
   */
  readonly focusedDeviceId: string | null;
  /**
   * Where the camera was before the first mode moved it, or null when it has
   * not been moved (the canvas was not mounted, so there was nothing to read).
   *
   * Captured once, on entering the first mode, and carried unchanged through
   * every mode change until the modes are left. Going focus → presentation →
   * focus → normal therefore returns to where the camera was before any of it,
   * not to where the previous mode happened to leave it.
   */
  readonly restoreTo: CameraSnapshot | null;
}

export const NORMAL_VIEW: ViewModeState = Object.freeze({
  mode: 'normal',
  focusedDeviceId: null,
  restoreTo: null,
});

/**
 * What each mode shows. One row per mode, so the difference between them is a
 * table you can read rather than a set of conditions spread across a layout.
 *
 * Every flag here is something the studio shell can actually honour, because it
 * renders that thing itself. There is deliberately no flag for the per-device
 * action bars or the device label strips: those are drawn by device-node.tsx,
 * which is not wired to this, so a flag for them would be a promise this model
 * cannot keep. See the note in presentation-chrome.tsx about what that leaves
 * visible during a presentation.
 */
export interface ChromeVisibility {
  /** The left column — tab bar, panel and the drag handle beside it. */
  readonly leftPanel: boolean;
  /** The studio toolbar across the top. */
  readonly toolbar: boolean;
  /** The event timeline under the canvas. */
  readonly timeline: boolean;
  /** The Edge Case Studio, when the user has it open. */
  readonly edgeCases: boolean;
  /** The inspector result card. */
  readonly inspector: boolean;
  /** The bar from presentation-chrome.tsx. */
  readonly viewChrome: boolean;
}

const CHROME: Record<ViewMode, ChromeVisibility> = {
  normal: {
    leftPanel: true,
    toolbar: true,
    timeline: true,
    edgeCases: true,
    inspector: true,
    viewChrome: false,
  },
  // Focus is still a working mode: you are looking hard at one device, not
  // showing it to anyone. The toolbar stays (zoom, arrange, edge cases are all
  // things you reach for while focused) and so does the Edge Case Studio, which
  // is at its most useful pointed at the one device filling the screen. What
  // goes is everything that competes for the *width*: the left column and the
  // timeline.
  focus: {
    leftPanel: false,
    toolbar: true,
    timeline: false,
    edgeCases: true,
    inspector: true,
    viewChrome: true,
  },
  // Presentation keeps nothing that says "development tool". `toolbar: false`
  // is not "no toolbar": the bar in presentation-chrome.tsx is the toolbar,
  // reduced to what a demo actually needs — the project, the version on screen,
  // the devices, and the way out.
  presentation: {
    leftPanel: false,
    toolbar: false,
    timeline: false,
    edgeCases: false,
    inspector: false,
    viewChrome: true,
  },
};

export function chromeFor(mode: ViewMode): ChromeVisibility {
  return CHROME[mode];
}

/* -------------------------------------------------------------------------- */
/* Transitions                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Camera work a transition asks for. Data, not calls — the reducer stays pure
 * and the host (or a test) decides when and against what they run.
 */
export type ViewModeEffect =
  /** Fill the viewport with one device. `CanvasApi.focusDevice`. */
  | { readonly kind: 'frame-device'; readonly deviceId: string }
  /** Bring every device into view. `CanvasApi.fit`. */
  | { readonly kind: 'frame-all' }
  /**
   * Put the zoom back, then keep `keepInView` on screen if there is one — see
   * CameraSnapshot for why leaving is these two steps and not one.
   */
  | {
      readonly kind: 'restore-camera';
      readonly camera: CameraSnapshot;
      readonly keepInView: string | null;
    };

export type ViewModeAction =
  /**
   * `camera` is the reading of the camera at the moment of the action. Optional
   * because `viewModes.dispatch` fills it in from the port; a caller driving the
   * reducer directly passes it (or null) itself.
   */
  | { readonly kind: 'enter-focus'; readonly deviceId: string; readonly camera?: CameraSnapshot | null }
  | { readonly kind: 'enter-presentation'; readonly camera?: CameraSnapshot | null }
  /** Point the camera at a device without changing mode. */
  | { readonly kind: 'show-device'; readonly deviceId: string }
  | { readonly kind: 'leave' }
  /** A device disappeared — deleted here, or by Claude over MCP, or in another tab. */
  | { readonly kind: 'device-removed'; readonly deviceId: string };

export interface ViewModeTransition {
  readonly state: ViewModeState;
  readonly effects: readonly ViewModeEffect[];
}

/** No state change and nothing to do — returned as the same object, so a host can `===` it. */
function unchanged(state: ViewModeState): ViewModeTransition {
  return { state, effects: [] };
}

/**
 * The whole of entering and leaving, in one pure function.
 *
 * Rules worth stating out loud, because each of them is a bug that a hand-wired
 * version tends to have:
 *
 *  - the camera is captured on the FIRST entry and never overwritten, so a chain
 *    of modes still returns to where the camera was before the chain started;
 *  - leaving from 'normal' is a no-op that returns the same state object, so a
 *    stray Escape cannot fire a camera move;
 *  - entering presentation from focus does not re-frame anything: the camera is
 *    already on a device and moving it would be a jump with no cause;
 *  - a focus mode whose device has been deleted is not a mode any more, so it
 *    leaves and restores; a presentation whose last-shown device has been
 *    deleted is still a presentation of a room, and only forgets the device.
 */
export function viewModeReducer(state: ViewModeState, action: ViewModeAction): ViewModeTransition {
  switch (action.kind) {
    case 'enter-focus': {
      const restoreTo = state.restoreTo ?? action.camera ?? null;
      const same =
        state.mode === 'focus' &&
        state.focusedDeviceId === action.deviceId &&
        state.restoreTo === restoreTo;
      return {
        // Asking again for the device already focused re-frames it — the camera
        // may have been panned since — but returns the same state object, so it
        // costs no render.
        state: same ? state : { mode: 'focus', focusedDeviceId: action.deviceId, restoreTo },
        effects: [{ kind: 'frame-device', deviceId: action.deviceId }],
      };
    }

    case 'enter-presentation': {
      if (state.mode === 'presentation') return unchanged(state);
      const restoreTo = state.restoreTo ?? action.camera ?? null;
      // From focus the camera is already framing something deliberate; from
      // normal the viewport is about to get much bigger (every panel is going
      // away), and a fit is what makes the devices use it. It is the same call
      // studio.tsx already makes after the split resizer changes the canvas
      // size, for the same reason.
      const effects: ViewModeEffect[] = state.mode === 'focus' ? [] : [{ kind: 'frame-all' }];
      return {
        state: {
          mode: 'presentation',
          focusedDeviceId: state.mode === 'focus' ? state.focusedDeviceId : null,
          restoreTo,
        },
        effects,
      };
    }

    case 'show-device': {
      // In 'normal' this is just a camera move — the same thing the existing
      // "Zoom to <device>" command does — so it changes no state and captures
      // nothing: there is no mode to come back from.
      if (state.mode === 'normal') {
        return { state, effects: [{ kind: 'frame-device', deviceId: action.deviceId }] };
      }
      return {
        state:
          state.focusedDeviceId === action.deviceId
            ? state
            : { ...state, focusedDeviceId: action.deviceId },
        effects: [{ kind: 'frame-device', deviceId: action.deviceId }],
      };
    }

    case 'leave': {
      if (state.mode === 'normal') return unchanged(state);
      const effects: ViewModeEffect[] = state.restoreTo
        ? [{ kind: 'restore-camera', camera: state.restoreTo, keepInView: state.focusedDeviceId }]
        : [];
      return { state: NORMAL_VIEW, effects };
    }

    case 'device-removed': {
      if (state.focusedDeviceId !== action.deviceId) return unchanged(state);
      if (state.mode === 'focus') {
        // Leaving, minus the `keepInView`: the device it would have kept in
        // view is the one that has just stopped existing.
        const effects: ViewModeEffect[] = state.restoreTo
          ? [{ kind: 'restore-camera', camera: state.restoreTo, keepInView: null }]
          : [];
        return { state: NORMAL_VIEW, effects };
      }
      return { state: { ...state, focusedDeviceId: null }, effects: [] };
    }

    default:
      return unchanged(state);
  }
}

/* -------------------------------------------------------------------------- */
/* Reading the studio: what is on screen, and what can be focused              */
/* -------------------------------------------------------------------------- */

/**
 * Which device a "focus" would act on, or the reason there is none.
 *
 * The reasons are worded exactly as commands.ts words them for the other
 * device-scoped commands, so the palette reads consistently. The one extra rule:
 * a canvas holding a single device does not need that device selected first —
 * there is nothing else it could mean.
 */
export interface FocusCandidate {
  readonly id: string;
  readonly name: string;
}

export type FocusChoice =
  | { readonly ok: true; readonly device: FocusCandidate }
  | { readonly ok: false; readonly reason: string };

export function focusChoice(
  devices: readonly FocusCandidate[],
  selectedIds: readonly string[],
): FocusChoice {
  if (devices.length === 0) return { ok: false, reason: 'There are no devices on the canvas.' };

  const selected = devices.filter((device) => selectedIds.includes(device.id));
  const sole = selected.length === 1 ? selected[0] : undefined;
  if (sole) return { ok: true, device: sole };
  if (selected.length > 1) {
    return { ok: false, reason: 'Several devices are selected — select just one.' };
  }

  const only = devices.length === 1 ? devices[0] : undefined;
  if (only) return { ok: true, device: only };
  return { ok: false, reason: 'Select a device first.' };
}

/**
 * What version the canvas is showing, as one honest line.
 *
 * Every device carries its own `versionId` (null = the working tree), so the
 * canvas can legitimately be showing two different versions at once. That case
 * is reported as itself rather than collapsed into whichever version happened to
 * be first: a presentation bar saying "V3" while one phone is running V2 would
 * be the exact kind of confident, wrong statement this product refuses to make.
 *
 * A pinned id with no matching snapshot in the list is still pinned — the same
 * wording the device action bar uses, and for the same reason.
 */
export interface VersionOnScreen {
  readonly kind: 'working' | 'pinned' | 'mixed';
  /** Short enough for a chip. */
  readonly label: string;
  /** One sentence for a title attribute. Never the only thing shown. */
  readonly detail: string;
}

export function versionOnScreen(
  devices: readonly { readonly versionId: string | null }[],
  versions: readonly { readonly id: string; readonly label: string }[],
): VersionOnScreen | null {
  if (devices.length === 0) return null;

  const distinct = new Set(devices.map((device) => device.versionId));
  if (distinct.size > 1) {
    return {
      kind: 'mixed',
      label: `${distinct.size} versions`,
      detail: 'The devices on the canvas are not all showing the same version.',
    };
  }

  const only = [...distinct][0] ?? null;
  if (only === null) {
    return {
      kind: 'working',
      label: 'Working version',
      detail: 'The project’s current files, not a saved snapshot.',
    };
  }

  const version = versions.find((entry) => entry.id === only);
  return {
    kind: 'pinned',
    label: version?.label ?? 'Pinned snapshot',
    detail: version
      ? `Every device is pinned to the snapshot “${version.label}”.`
      : 'Every device is pinned to a snapshot that is not in this project’s list.',
  };
}

/* ========================================================================== */
/* The live value. Everything above this line is pure.                        */
/* ========================================================================== */

/**
 * The four camera moves a mode needs, as an interface, so the reducer's effects
 * can be run against the real canvas or against a fake.
 *
 * Not one of these is new camera code: they are `CanvasApi.getZoom`, `zoomTo`,
 * `focusDevice`, `revealDevice` and `fit`, which canvas.tsx already implements
 * and tunes. There is exactly one camera in this app.
 */
export interface CameraPort {
  /** Null when the canvas is not mounted — then there is nothing to restore. */
  capture(): CameraSnapshot | null;
  restore(camera: CameraSnapshot): void;
  /** Fill the viewport with one device. */
  frameDevice(deviceId: string): void;
  /** Pan the least distance that brings a device fully into view; nothing if it already is. */
  keepInView(deviceId: string): void;
  frameAll(): void;
}

export const canvasCamera: CameraPort = {
  capture: () => {
    const api = canvasApi.get();
    return api ? { zoom: api.getZoom() } : null;
  },
  restore: (camera) => canvasApi.get()?.zoomTo(camera.zoom),
  frameDevice: (deviceId) => canvasApi.get()?.focusDevice(deviceId),
  keepInView: (deviceId) => canvasApi.get()?.revealDevice(deviceId),
  frameAll: () => canvasApi.get()?.fit(),
};

export function runViewModeEffects(
  effects: readonly ViewModeEffect[],
  port: CameraPort = canvasCamera,
): void {
  for (const effect of effects) {
    switch (effect.kind) {
      case 'frame-device':
        port.frameDevice(effect.deviceId);
        break;
      case 'frame-all':
        port.frameAll();
        break;
      case 'restore-camera':
        port.restore(effect.camera);
        if (effect.keepInView !== null) port.keepInView(effect.keepInView);
        break;
      default:
        break;
    }
  }
}

let current: ViewModeState = NORMAL_VIEW;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Runs the camera on the frame *after* the mode change has been painted.
 *
 * Load bearing: entering and leaving a mode changes the size of the canvas
 * viewport (the panels are what it was sharing the window with), and every one
 * of these moves measures that viewport. Run in the same tick they would fit,
 * frame and reveal against the layout that is on its way out.
 */
function schedule(effects: readonly ViewModeEffect[], port: CameraPort): void {
  if (effects.length === 0) return;
  if (typeof window === 'undefined') {
    runViewModeEffects(effects, port);
    return;
  }
  window.requestAnimationFrame(() => runViewModeEffects(effects, port));
}

/**
 * The mode the studio is in, readable and writable from anywhere in it.
 *
 * Subscribe with `useViewMode()` from presentation-chrome.tsx rather than
 * wiring `useSyncExternalStore` by hand.
 */
export const viewModes = {
  get(): ViewModeState {
    return current;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  dispatch(action: ViewModeAction, port: CameraPort = canvasCamera): ViewModeState {
    const filled =
      (action.kind === 'enter-focus' || action.kind === 'enter-presentation') &&
      action.camera === undefined
        ? { ...action, camera: port.capture() }
        : action;

    const { state, effects } = viewModeReducer(current, filled);
    if (state !== current) {
      current = state;
      notify();
    }
    schedule(effects, port);
    return state;
  },
  /**
   * Back to normal without touching the camera.
   *
   * For teardown only — the studio unmounting, a different project opening.
   * This module outlives a React tree, and a mode left over from the last one
   * would otherwise describe a canvas that no longer exists.
   * `<PresentationChrome />` calls this when it unmounts, so a host that renders
   * it has nothing to remember.
   */
  reset(): void {
    if (current === NORMAL_VIEW) return;
    current = NORMAL_VIEW;
    notify();
  },
};

/* -------------------------------------------------------------------------- */
/* The actions, by name                                                        */
/* -------------------------------------------------------------------------- */

/** Fill the screen with one device. Captures the camera on the way in. */
export function enterFocusMode(deviceId: string): ViewModeState {
  return viewModes.dispatch({ kind: 'enter-focus', deviceId });
}

/** Panels away, canvas edge to edge. Captures the camera on the way in. */
export function enterPresentationMode(): ViewModeState {
  return viewModes.dispatch({ kind: 'enter-presentation' });
}

/** Point the camera at a device. Changes no mode. */
export function showDeviceOnCanvas(deviceId: string): ViewModeState {
  return viewModes.dispatch({ kind: 'show-device', deviceId });
}

/** Back to the studio, with the camera put back. Safe to call in any mode. */
export function leaveViewMode(): ViewModeState {
  return viewModes.dispatch({ kind: 'leave' });
}

/** Tell the modes a device is gone, so a focus on it cannot outlive it. */
export function deviceRemoved(deviceId: string): ViewModeState {
  return viewModes.dispatch({ kind: 'device-removed', deviceId });
}

/* -------------------------------------------------------------------------- */
/* Palette entries                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The two commands, ready for the registry.
 *
 * Expected call site: one line in `studioCommands()` in commands.ts —
 * `...viewModeCommands(state)` — alongside the other groups. They are `Command`
 * objects exactly like the ones in that file, so the palette and the keyboard
 * layer pick them up with no other change.
 *
 * Both are toggles, and their titles say which way they will go, because the
 * palette shows the title and the person reading it deserves to know whether
 * they are about to enter or leave. `enabled` re-reads the live mode rather than
 * the snapshot it was built from, exactly as the rest of the registry does.
 *
 * The shortcuts are a suggestion: `p` and `⇧F` are unclaimed by commands.ts and
 * by studio.tsx today. If a later slice wants them, drop them here — everything
 * else keeps working, the rows just lose their key caps.
 *
 * Deliberately NOT bound: Escape. The keyboard layer claims any key a command
 * declares and says the reason out loud when the command cannot run, so an
 * Escape shortcut would make every Escape in the studio — closing a menu,
 * cancelling inspect — either leave a mode or raise a toast. Leaving by Escape
 * is owned by the chrome that is on screen while a mode is live; see
 * presentation-chrome.tsx.
 */
export function viewModeCommands(state: StudioStore): Command[] {
  const view = viewModes.get();
  const choice = focusChoice(state.devices, state.selectedDeviceIds);
  const focused =
    view.mode === 'focus'
      ? (state.devices.find((device) => device.id === view.focusedDeviceId) ?? null)
      : null;

  return [
    {
      id: 'view.focus',
      title:
        view.mode === 'focus'
          ? focused
            ? `Stop focusing on ${focused.name}`
            : 'Leave focus mode'
          : choice.ok
            ? `Focus on ${choice.device.name}`
            : 'Focus on the selected device',
      subtitle:
        view.mode === 'focus'
          ? 'Brings the panels back and puts the zoom back where it was.'
          : 'Hides the panels and fills the screen with one device. Esc leaves.',
      group: 'Canvas',
      shortcut: 'shift+f',
      keywords: 'focus single device isolate zoom fill screen',
      enabled: (live) => {
        if (viewModes.get().mode === 'focus') return true;
        const now = focusChoice(live.devices, live.selectedDeviceIds);
        return now.ok ? true : now.reason;
      },
      run: (store) => {
        if (viewModes.get().mode === 'focus') {
          leaveViewMode();
          return;
        }
        const live = store.getState();
        const now = focusChoice(live.devices, live.selectedDeviceIds);
        if (now.ok) enterFocusMode(now.device.id);
      },
    },
    {
      id: 'view.presentation',
      title: view.mode === 'presentation' ? 'Leave presentation mode' : 'Present to a client',
      subtitle:
        view.mode === 'presentation'
          ? 'Brings the panels and the toolbar back.'
          : 'Hides every panel and runs the canvas edge to edge. Esc leaves.',
      group: 'Project',
      shortcut: 'p',
      keywords: 'presentation present client demo review hide panels',
      enabled: (live) =>
        viewModes.get().mode === 'presentation' || live.devices.length > 0
          ? true
          : 'There is nothing on the canvas to present.',
      run: () => {
        if (viewModes.get().mode === 'presentation') leaveViewMode();
        else enterPresentationMode();
      },
    },
  ];
}
