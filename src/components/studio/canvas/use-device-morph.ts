'use client';

import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react';
import { deviceGeometry, type DeviceGeometry, type DevicePreset } from '@/lib/devices/presets';

/**
 * One device becoming another.
 *
 * Changing a format used to be a single frame: the art was replaced, the box
 * jumped to its new size, the display resized. Correct, and abrupt — a MacBook
 * did not *become* a phone, it was swapped for one. This hook is the timing and
 * the arithmetic behind making that one continuous move; `device-chassis.tsx`
 * spends what it returns.
 *
 * ## What is actually allowed to move
 *
 * The hard constraint is the preview: a sandboxed `<iframe>` reloads the instant
 * the browser re-parents it, and it rasterises at the wrong resolution while an
 * ancestor is mid-*scale*. So the display is never scaled and never re-parented.
 * It is also not ours to resize on a curve: `device-node.tsx` hands the frame its
 * new logical width and height in the same commit as the new preset, so the app
 * re-lays-out at its destination size in one frame no matter what this file does.
 *
 * That fact decides the whole design. Everything animates *around* a display that
 * resizes once:
 *
 *  - **The chassis art** is drawn twice for the length of the morph — the format
 *    being left and the format being arrived at, each rendered at its *own*
 *    natural size so every rail, radius and button inside it is correct — and the
 *    two are mapped onto each other with `transform: scale()`. Nothing here
 *    reflows: a laptop squashing into a phone is a compositor job, and the two
 *    layers cross-fade so the object dissolves instead of being replaced.
 *  - **The display** gets a `translate()` from where it was to where it is going,
 *    so the running app does not teleport, and a `clip-path: inset()` that opens
 *    from the *old* display rect to the new one. The clip is what stops a growing
 *    format (portrait → landscape, phone → tablet) from painting its full-size
 *    screen outside a chassis that has not grown yet. On a shrinking format there
 *    is nothing to hide, and no clip is emitted at all.
 *
 * Consequence worth stating plainly: at t=0 the outgoing art, the display's
 * position and the display's aperture are all *exactly* the format you were
 * looking at a frame ago, and at t=1 they are exactly the new one. The only thing
 * that changes in one step is the app's own layout, which is the truth — the app
 * really was handed a new viewport.
 *
 * ## The obvious alternative, and why it is not here
 *
 * The straightforward version of this is to transition `width` and `height` on the
 * chassis box and let the art lay out into it. It is one element and the canvas
 * positions devices by transform on an ancestor, so the reflow would at least stay
 * inside the device — but it would be wrong on screen before it was ever a
 * question of cost. Every chassis is drawn from *fixed* preset numbers: the rail is
 * 8px, the buttons start 168px down, a laptop's deck is 26px tall. Animate the box
 * underneath that and you do not get a phone shrinking, you get a phone-detailed
 * object at the wrong size — buttons a third of the way down a laptop, a 16px
 * tablet bezel around a phone-sized screen — and both the outgoing and the incoming
 * art are distorted that way at once, because both are laying out into the same
 * animating box. Scaling each layer inside its own correct box is cheaper *and* it
 * is the only version where what you see mid-flight is two real devices.
 *
 * ## Why CSS transitions and not a JS timeline
 *
 * `globals.css` collapses `transition-duration` under both
 * `prefers-reduced-motion: reduce` and `[data-reduce-motion='true']`, so a CSS
 * transition honours the setting for free. This hook goes one further and does
 * not start a morph at all when motion is reduced — the outgoing layer is never
 * mounted and no transform is ever written, which is "skip straight to the
 * destination" rather than "animate to it in 0.01ms".
 *
 * ## The two-phase render
 *
 * A transition needs a *from* value that the browser has already computed. So a
 * morph renders twice: once at the start values with `transition: none`, then —
 * inside a layout effect, after one forced style flush and before the browser has
 * painted anything — again at the destination with the transitions attached. The
 * start frame is therefore never painted, which is the difference between a morph
 * and a morph with one stale frame in front of it.
 */

export type DeviceOrientation = 'portrait' | 'landscape';

export interface DeviceFormat {
  preset: DevicePreset;
  orientation: DeviceOrientation;
}

export interface DeviceMorph {
  /** The format being left behind, still drawn. `null` whenever nothing is morphing. */
  leaving: DeviceFormat | null;
  /** The layer holding the outgoing art, sized to *its* chassis. */
  leavingStyle: CSSProperties;
  /** The layer holding the current art, sized to the current chassis. */
  arrivingStyle: CSSProperties;
  /** Extra style for the display box: a translation and an aperture, never a scale. */
  screenStyle: CSSProperties;
}

/* -------------------------------------------------------------------------- */
/* Motion                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The shape change — the box, the art scale, the display's position and aperture.
 *
 * 260ms on `--ease-out-quint` is not a taste call: it is exactly what
 * `canvas.tsx` eases the viewport with when a format change pushes a device off
 * screen (`easeViewTo`, quintic-out, 260ms default). The pan and the morph run
 * together often enough that they have to be one motion rather than two.
 */
const SHAPE_MS = 260;
const SHAPE = `${SHAPE_MS}ms var(--ease-out-quint)`;

/**
 * The identity change — which object you are looking at.
 *
 * Slower than the shape and on a symmetric curve, deliberately: the silhouette
 * lands first and the old device lingers underneath for a moment, which is what
 * reads as one thing turning into another. Cross-fading on the same fast curve as
 * the shape just reads as a fast swap. The incoming layer is drawn *over* the
 * outgoing one, so wherever the new silhouette covers the old there is no
 * transparency dip — only the parts sticking out of the new shape ghost.
 */
const FADE_OUT = '220ms var(--ease-in-out-quad)';
const FADE_IN = '200ms var(--ease-in-out-quad)';

/** How long the outgoing layer outlives its own animation before unmounting. */
const TAIL_MS = 40;

const NO_STYLE: CSSProperties = {};

/* -------------------------------------------------------------------------- */

interface MorphRun {
  /** Identifies this run so a late timer never cancels a newer one. */
  id: number;
  phase: 'start' | 'run';
  from: DeviceFormat;
  fromGeometry: DeviceGeometry;
  /** The format key this run is heading for; a run for any other key is stale. */
  toKey: string;
}

interface FormatSnapshot {
  key: string;
  preset: DevicePreset;
  orientation: DeviceOrientation;
}

/**
 * What counts as "a different device".
 *
 * The preset's id plus the orientation the geometry *actually resolved to* —
 * `deviceGeometry` ignores orientation on the families that do not turn, so
 * asking a MacBook for landscape changes nothing and must not fire a morph that
 * animates from a box to itself. Theme, role and version are all absent on
 * purpose: none of them move a single edge of the object.
 */
function formatKey(preset: DevicePreset, geometry: DeviceGeometry): string {
  return `${preset.id}|${geometry.landscape ? 'landscape' : 'portrait'}`;
}

/**
 * The same test `canvas.tsx` makes before easing the viewport: the OS setting, or
 * the app's own switch for people whose OS says otherwise.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  return (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    document.documentElement.dataset.reduceMotion === 'true'
  );
}

/** Short, stable numbers in the style string — 4dp is far below a device pixel. */
function ratio(numerator: number, denominator: number): string {
  if (denominator <= 0) return '1';
  return (Math.round((numerator / denominator) * 10000) / 10000).toString();
}

/**
 * `useLayoutEffect` warns when a client component is rendered on the server, and
 * every studio surface is. The effect is a no-op there anyway: a morph needs a
 * previous format, and the server only ever renders the first one.
 */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function useDeviceMorph({
  preset,
  orientation,
  geometry,
  screenRadius,
}: {
  preset: DevicePreset;
  orientation: DeviceOrientation;
  geometry: DeviceGeometry;
  /** The display's corner radius, as CSS, so the aperture keeps the same corners. */
  screenRadius: string;
}): DeviceMorph {
  const key = formatKey(preset, geometry);

  const [current, setCurrent] = useState<FormatSnapshot>(() => ({ key, preset, orientation }));
  const [run, setRun] = useState<MorphRun | null>(null);

  // Derived from props during render, which is the supported way to react to a
  // prop change without a wasted commit: the outgoing art has to be on screen in
  // the *same* frame the new preset arrives, or there is a hole where the device
  // was. React re-runs this component immediately and nothing is painted twice.
  if (current.key !== key) {
    const previous = current;
    const reduced = prefersReducedMotion();
    setCurrent({ key, preset, orientation });
    setRun((active) =>
      reduced
        ? null
        : {
            id: (active?.id ?? 0) + 1,
            phase: 'start',
            from: { preset: previous.preset, orientation: previous.orientation },
            fromGeometry: deviceGeometry(previous.preset, previous.orientation),
            toKey: key,
          },
    );
  }

  const active = run && run.toKey === key ? run : null;
  const phase = active?.phase ?? null;
  const runId = active?.id ?? null;

  useIsomorphicLayoutEffect(() => {
    if (phase !== 'start') return;
    // Reading a layout property forces the style we just wrote — the start
    // transform, with transitions off — to be computed. The state change below is
    // flushed before paint, so the browser sees start → destination as a change
    // it can transition, and the user never sees the start frame.
    flushStyles();
    setRun((entry) =>
      entry && entry.id === runId && entry.phase === 'start' ? { ...entry, phase: 'run' } : entry,
    );
  }, [phase, runId]);

  useEffect(() => {
    if (phase !== 'run') return;
    const timer = window.setTimeout(() => {
      setRun((entry) => (entry && entry.id === runId ? null : entry));
    }, SHAPE_MS + TAIL_MS);
    return () => window.clearTimeout(timer);
  }, [phase, runId]);

  if (!active) {
    return {
      leaving: null,
      leavingStyle: NO_STYLE,
      arrivingStyle: { width: geometry.chassis.width, height: geometry.chassis.height },
      screenStyle: NO_STYLE,
    };
  }

  const from = active.fromGeometry;
  const starting = active.phase === 'start';

  // Each art layer keeps its own size and is mapped onto the other's box. Anchored
  // top-left because that is where the device is anchored on the canvas: a format
  // change moves the bottom-right corner, never the origin.
  const toNew = `scale(${ratio(geometry.chassis.width, from.chassis.width)}, ${ratio(
    geometry.chassis.height,
    from.chassis.height,
  )})`;
  const toOld = `scale(${ratio(from.chassis.width, geometry.chassis.width)}, ${ratio(
    from.chassis.height,
    geometry.chassis.height,
  )})`;

  // The display, translated from the old screen origin to the new one. With that
  // translation in force the box's own origin *is* the old screen origin at t=0,
  // so the aperture below is measured from there.
  const dx = from.screenOrigin.x - geometry.screenOrigin.x;
  const dy = from.screenOrigin.y - geometry.screenOrigin.y;

  // Hide only what the old display did not have room for. A shrinking format
  // yields zero on both axes and gets no clip at all.
  const hiddenRight = Math.max(0, geometry.screen.width - from.screen.width);
  const hiddenBottom = Math.max(0, geometry.screen.height - from.screen.height);
  const clips = hiddenRight > 0.5 || hiddenBottom > 0.5;

  const screenStyle: CSSProperties = {};
  if (dx !== 0 || dy !== 0 || clips) {
    const moves = `transform ${SHAPE}`;
    screenStyle.transform = starting ? `translate(${dx}px, ${dy}px)` : 'none';
    screenStyle.transition = starting ? 'none' : clips ? `${moves}, clip-path ${SHAPE}` : moves;
    if (clips) {
      // Both ends carry the same `round`, or there is nothing to interpolate
      // between and the aperture would jump open instead of sliding open.
      screenStyle.clipPath = starting
        ? `inset(0px ${hiddenRight}px ${hiddenBottom}px 0px round ${screenRadius})`
        : `inset(0px 0px 0px 0px round ${screenRadius})`;
    }
  }

  return {
    leaving: active.from,
    leavingStyle: {
      width: from.chassis.width,
      height: from.chassis.height,
      transformOrigin: '0 0',
      transform: starting ? 'none' : toNew,
      opacity: starting ? 1 : 0,
      transition: starting ? 'none' : `transform ${SHAPE}, opacity ${FADE_OUT}`,
      willChange: 'transform, opacity',
    },
    arrivingStyle: {
      width: geometry.chassis.width,
      height: geometry.chassis.height,
      transformOrigin: '0 0',
      transform: starting ? toOld : 'none',
      opacity: starting ? 0 : 1,
      transition: starting ? 'none' : `transform ${SHAPE}, opacity ${FADE_IN}`,
      willChange: 'transform, opacity',
    },
    screenStyle,
  };
}

/**
 * Force the pending style and layout to be computed *now*.
 *
 * The read is the point; the value is not, and it is returned only so nothing can
 * decide the statement is dead. No element is passed in because none would help:
 * a geometry read is answered by laying out the whole document, so scoping it to
 * the device that is morphing would cost exactly the same and buy nothing. Once
 * per format change.
 */
function flushStyles(): number {
  return document.documentElement.offsetWidth;
}
