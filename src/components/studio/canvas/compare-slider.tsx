'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { ChevronLeft, ChevronRight, FileWarning, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/cn';
import { isPreviewMessage, type PreviewDeviceContext } from '@/lib/preview/protocol';
import {
  BUILD_PHASE_LABELS,
  deriveBuildPhase,
  derivePreviewPresence,
  type BuildPhase,
  type PreviewPresence,
} from '../build-phase';
import { previewRegistry } from '../preview-registry';
import type { BundleState } from '../types';
import { PreviewFrame } from './preview-frame';

/**
 * Before / after: two versions of the same app, both live, split by a divider
 * you drag.
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM, AND WHY IT IS SOLVED THIS WAY
 * ---------------------------------------------------------------------------
 * Each side is a real sandboxed preview iframe running real compiled code. An
 * iframe reloads — losing its route, its scroll, its form state, everything —
 * the moment the browser moves it in the DOM. So the split cannot be done by
 * putting the frames into containers that get resized or re-ordered, and it
 * cannot be done by swapping which frame is mounted.
 *
 * What is done instead: both frames are mounted once, at full size, stacked, and
 * never touched again. The only thing that changes while you drag is a single
 * CSS custom property on their common ancestor, which two complementary
 * `clip-path: inset(...)` rules read:
 *
 *     after  (below)   inset(0 0 0 var(--pl-compare-split))          → right of the split
 *     before (above)   inset(0 calc(100% - var(--pl-compare-split)) 0 0) → left of the split
 *
 * Clipping is not re-parenting. The element keeps its box, its position and its
 * ancestors; only the region it paints into changes, so nothing in either
 * document is disturbed and neither app reloads or re-mounts.
 *
 * `clip-path` also removes the clipped-away region from hit testing (CSS Masking
 * Level 1 — the clipping path affects both rendering and pointer events). Because
 * the two clips are exactly complementary, every point in the viewport belongs
 * to exactly one frame, which is what keeps both apps interactive on their own
 * side: taps left of the divider reach the "before" app, taps right of it fall
 * straight through to the "after" app underneath. This is the one browser
 * behaviour this component depends on and cannot degrade gracefully without.
 *
 * One known consequence, not a defect and not something to paper over: with the
 * divider pushed fully to an edge, the hidden frame's intersection with the
 * viewport is empty, and browsers may throttle rendering in an iframe in that
 * state. It does not reload and it does not lose anything; it catches up when it
 * is revealed again. Do not "fix" that by keeping a sliver of it visible.
 *
 * REJECTED, and why:
 *  - Two frames in halves that resize. Correct, but changing a width is layout,
 *    and layout on a per-pointer-move path is exactly what the canvas is not
 *    allowed to do.
 *  - The same thing done with `transform: scaleX(s)` on the wrapper and
 *    `scaleX(1/s)` on the content, to keep it off the layout path. It puts a
 *    scale on an ancestor of a live iframe, and the counter-scale goes to
 *    infinity as the split approaches an edge.
 *
 * ---------------------------------------------------------------------------
 * HOW THE DRAG STAYS CHEAP
 * ---------------------------------------------------------------------------
 *  - The drag itself causes no React render. `pointermove` records a clientX and
 *    schedules one `requestAnimationFrame`; the frame writes one custom property
 *    and two ARIA attributes straight to the DOM. State is committed once, on
 *    pointer-up. (Something unrelated — a frame reporting that it has mounted —
 *    can still render mid-drag, which is why the imperative writes have to
 *    survive one: React only writes an inline style or attribute whose *rendered*
 *    value changed, and those do not change until the commit.)
 *  - The viewport's rectangle is measured once, at pointer-down. Nothing on the
 *    move path reads layout, so nothing on it can force a synchronous reflow.
 *  - The divider is positioned by `translateX(var(--pl-compare-split))` on a
 *    full-width layer — a percentage translate resolves against the element's own
 *    width, so the same variable that drives the clips drives the divider, with
 *    no second source of truth and no `left` write.
 *  - Easing is a variable too (`--pl-compare-ease`), set to 0s for the duration
 *    of a pointer drag. A drag is direct manipulation: the divider must be under
 *    the finger, not chasing it. Keyboard steps and the double-click snap do ease
 *    — through a CSS transition, so the reduced-motion rules in globals.css
 *    collapse them without this component knowing anything about the setting.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS ALLOWED TO CLAIM
 * ---------------------------------------------------------------------------
 * Each half reports its own state from the two facts that can be observed: the
 * `BundleState` for that ref, and whether that frame has itself said
 * `preview:mounted`. Both go through `deriveBuildPhase` / `derivePreviewPresence`
 * so a comparison half says exactly what a phone would say, in the same words.
 * There is no progress bar and no invented step list, for the reason set out at
 * the top of `build-phase.ts`.
 *
 * A side whose build failed says so *on that side* rather than showing an empty
 * half. That card is deliberately a local, slimmer echo of `build-error-card.tsx`
 * — same voice, same ordering, same refusal to invent a compile error when the
 * request never reached the compiler — and not an import of it, because that
 * component reads the studio store through four hooks and a comparison half is
 * not a device.
 *
 * NOT DONE HERE, on purpose: no device chassis, no status bar, no dynamic island.
 * This draws two app viewports and the divider between them; whoever mounts it
 * decides what frames it.
 */

/* -------------------------------------------------------------------------- */
/* Contract                                                                     */
/* -------------------------------------------------------------------------- */

/** The percentage of the viewport given to the left ("before") side. */
const SPLIT_VAR = '--pl-compare-split';
/** Transition duration for split changes. Written to 0s while a pointer drags. */
const EASE_VAR = '--pl-compare-ease';
/** Short enough to read as a step rather than an animation. */
const EASE_MS = 150;

/** Left of the divider. `right` inset is the distance from the right edge. */
const CLIP_BEFORE = `inset(0 calc(100% - var(${SPLIT_VAR})) 0 0)`;
/** Right of the divider, exactly complementary — the two meet, they never gap. */
const CLIP_AFTER = `inset(0 0 0 var(${SPLIT_VAR}))`;

/** Keyboard steps, in percent. Shift multiplies the small one. */
const STEP = 1;
const BIG_STEP = 10;

type VarStyle = CSSProperties & { [key: `--${string}`]: string | number };

/** `BundleState['diagnostics']` element, without importing the database barrel. */
type BundleDiagnostic = BundleState['diagnostics'][number];

/**
 * The light ramp, pinned for everything drawn over an app.
 *
 * globals.css guarantees that a device looks identical in both studio themes by
 * re-pointing the Tailwind colour tokens at the frozen `--pl-*` values inside
 * `[data-device-id] > .relative`. This viewport is two app screens and the chrome
 * drawn on top of them, but it is *not* inside a device node, so that rule cannot
 * reach it — and a failure card that turns dark because the studio is dark would
 * be the same bug that rule exists to prevent.
 *
 * So: the same guarantee, applied here. Every entry points at the frozen token
 * rather than repeating a literal, so nothing can drift out of step with the
 * light theme; only this *list* can go stale. If you use another colour token
 * inside the viewport, add it here.
 *
 * `shadow-hairline` and `shadow-panel` are deliberately not used below: the dark
 * theme overrides `--pl-shadow-hairline` / `--pl-shadow-panel` directly and there
 * is no frozen light copy of either to point back at (unlike
 * `--pl-shadow-float-light`), so they cannot be pinned without copying a value.
 */
const SCREEN_TOKENS: VarStyle = {
  colorScheme: 'light',
  '--color-paper-0': 'var(--pl-paper-0)',
  '--color-paper-25': 'var(--pl-paper-25)',
  '--color-paper-50': 'var(--pl-paper-50)',
  '--color-paper-100': 'var(--pl-paper-100)',
  '--color-paper-150': 'var(--pl-paper-150)',
  '--color-paper-200': 'var(--pl-paper-200)',
  '--color-paper-300': 'var(--pl-paper-300)',
  '--color-paper-400': 'var(--pl-paper-400)',
  '--color-paper-500': 'var(--pl-paper-500)',
  '--color-paper-600': 'var(--pl-paper-600)',
  '--color-paper-700': 'var(--pl-paper-700)',
  '--color-paper-800': 'var(--pl-paper-800)',
  '--color-paper-900': 'var(--pl-paper-900)',
  '--color-danger-50': 'var(--pl-danger-50)',
  '--color-danger-100': 'var(--pl-danger-100)',
  '--color-danger-200': 'var(--pl-danger-200)',
  '--color-danger-600': 'var(--pl-danger-600)',
  '--color-danger-700': 'var(--pl-danger-700)',
  '--pl-shadow-float': 'var(--pl-shadow-float-light)',
};

/** One half of the comparison. */
export interface CompareSide {
  /**
   * Preview-registry id for this half's frame. Stable for the life of the page
   * and **not** the id of a real device: the studio store keys devices by id and
   * would then try to drive this frame as if it were one. Something like
   * `compare:before:<projectId>` is right.
   */
  frameId: string;
  /**
   * What this version is called, in words. `versionRefLabel` below produces it
   * from a `BundleRef` — "Working tree" for the unsaved one — because a
   * before/after with no labels is a guess about which half is which.
   */
  label: string;
  /** A second line, e.g. "4 files changed". Optional, and omitted when null. */
  hint?: string | null;
  /** The bundle for this side's ref, or null when nothing has been asked of it. */
  bundle: BundleState | null;
  /**
   * The context the frame is initialised with. Give it a stable identity
   * (`useMemo`) — a new object every render re-posts `host:context` every render.
   */
  context: PreviewDeviceContext;
  /** Rebuilds this side. Omit it and no retry button is drawn — see the card. */
  onRetry?: (() => void) | undefined;
}

export interface CompareSliderProps {
  /** The left half. Conventionally the older version. */
  before: CompareSide;
  /** The right half. Conventionally the newer one. */
  after: CompareSide;
  /** Logical viewport size, in CSS pixels. Both halves are exactly this size. */
  width: number;
  height: number;
  /** Where the divider starts, 0–100. Defaults to the middle. */
  initialSplit?: number;
  /** Corner radius of the viewport. 0 by default — square, like a raw screen. */
  radius?: number;
  /**
   * Mirror one side's navigation onto the other, so both apps show the same
   * screen. Safe from feedback loops: `host:navigate` moves the runtime's route
   * directly and does not make it emit `preview:navigate` back (only the app's
   * own `useRouter().navigate` does).
   */
  syncNavigation?: boolean;
  /** Called when a gesture ends or a key lands — never per pointermove. */
  onSplitCommit?: (split: number) => void;
  className?: string;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                      */
/* -------------------------------------------------------------------------- */

export function clampSplit(value: number): number {
  if (!Number.isFinite(value)) return 50;
  if (value < 0) return 0;
  if (value > 100) return 100;
  // Three decimals is finer than a pixel on any viewport this renders at, and it
  // keeps the custom property from carrying a 17-digit float.
  return Math.round(value * 1000) / 1000;
}

/**
 * What to call a `BundleRef` on a comparison side.
 *
 * `working` is the unsaved tree, and saying so is the whole point of labelling.
 * A ref that is not in `versions` falls back to the ref itself — that is what it
 * literally is, and "Snapshot" would be a claim about something not loaded.
 */
export function versionRefLabel(
  ref: string,
  versions: readonly { id: string; label: string }[],
): string {
  if (ref === 'working') return 'Working tree';
  return versions.find((version) => version.id === ref)?.label ?? ref;
}

/* -------------------------------------------------------------------------- */
/* The slider                                                                   */
/* -------------------------------------------------------------------------- */

export function CompareSlider({
  before,
  after,
  width,
  height,
  initialSplit = 50,
  radius = 0,
  syncNavigation = false,
  onSplitCommit,
  className,
}: CompareSliderProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const shieldRef = useRef<HTMLDivElement | null>(null);

  /* The live split. The DOM is the fast path; this is the record of what it says. */
  const splitRef = useRef(clampSplit(initialSplit));
  /* Committed value — the only thing React renders, so a drag costs no renders. */
  const [committed, setCommitted] = useState(() => clampSplit(initialSplit));

  const dragRef = useRef<{ pointerId: number; left: number; width: number } | null>(null);
  const rafRef = useRef(0);
  const pendingXRef = useRef<number | null>(null);

  /* Per-frame facts, reported by the frames themselves. */
  const [mounted, setMounted] = useState<Record<string, boolean>>({});
  const [frameErrors, setFrameErrors] = useState<Record<string, string | null>>({});

  const valueText = useCallback(
    (split: number) =>
      `${Math.round(split)}% ${before.label}, ${100 - Math.round(split)}% ${after.label}`,
    [before.label, after.label],
  );

  /** The whole fast path: one custom property and two ARIA attributes. */
  const applySplit = useCallback(
    (next: number) => {
      const split = clampSplit(next);
      splitRef.current = split;
      rootRef.current?.style.setProperty(SPLIT_VAR, `${split}%`);
      const handle = handleRef.current;
      if (handle) {
        handle.setAttribute('aria-valuenow', String(Math.round(split)));
        handle.setAttribute('aria-valuetext', valueText(split));
      }
    },
    [valueText],
  );

  const setEasing = useCallback((on: boolean) => {
    rootRef.current?.style.setProperty(EASE_VAR, on ? `${EASE_MS}ms` : '0s');
  }, []);

  const commit = useCallback(() => {
    const split = splitRef.current;
    setCommitted(split);
    onSplitCommit?.(split);
  }, [onSplitCommit]);

  /* ---------------------------------------------------------------- pointer */

  const flush = useCallback(() => {
    rafRef.current = 0;
    const drag = dragRef.current;
    const clientX = pendingXRef.current;
    if (!drag || clientX === null) return;
    pendingXRef.current = null;
    applySplit(((clientX - drag.left) / drag.width) * 100);
  }, [applySplit]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const viewport = viewportRef.current;
      if (!viewport) return;
      // The one layout read of the whole gesture. Nothing pans or zooms while a
      // pointer is captured here, so this rectangle stays true until pointer-up.
      const rect = viewport.getBoundingClientRect();
      if (rect.width <= 0) return;

      dragRef.current = { pointerId: event.pointerId, left: rect.left, width: rect.width };
      event.currentTarget.setPointerCapture(event.pointerId);
      // `preventDefault` below suppresses the focus a press would normally give
      // this element, and a divider you cannot focus by clicking is one you
      // cannot then nudge with the arrow keys. Not `:focus-visible` after a
      // pointer press, so no ring appears for mouse users.
      event.currentTarget.focus();
      setEasing(false);
      // Belt and braces for the captured pointer: a shield over both frames, so a
      // move that crosses into an iframe cannot be swallowed by another document.
      if (shieldRef.current) shieldRef.current.style.pointerEvents = 'auto';
      document.body.style.cursor = 'col-resize';
      // No text selection, and — if this ever sits inside a device node — no
      // device drag starting underneath the handle.
      event.preventDefault();
      event.stopPropagation();
    },
    [setEasing],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      pendingXRef.current = event.clientX;
      // One write per frame however many moves the browser coalesces into it.
      if (rafRef.current === 0) rafRef.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;

      if (rafRef.current !== 0) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      // Land where the pointer actually left off, not one frame behind it.
      const clientX = pendingXRef.current;
      pendingXRef.current = null;
      if (clientX !== null) applySplit(((clientX - drag.left) / drag.width) * 100);

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (shieldRef.current) shieldRef.current.style.pointerEvents = 'none';
      document.body.style.cursor = '';
      setEasing(true);
      commit();
    },
    [applySplit, commit, setEasing],
  );

  /* --------------------------------------------------------------- keyboard */

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? BIG_STEP : STEP;
      let next: number;
      switch (event.key) {
        case 'ArrowLeft':
          next = splitRef.current - step;
          break;
        case 'ArrowRight':
          next = splitRef.current + step;
          break;
        case 'PageDown':
          next = splitRef.current - BIG_STEP;
          break;
        case 'PageUp':
          next = splitRef.current + BIG_STEP;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = 100;
          break;
        // The keyboard's double-click: back to an even split.
        case 'Enter':
          next = 50;
          break;
        default:
          return;
      }
      event.preventDefault();
      setEasing(true);
      applySplit(next);
      commit();
    },
    [applySplit, commit, setEasing],
  );

  const snapToCentre = useCallback(() => {
    setEasing(true);
    applySplit(50);
    commit();
  }, [applySplit, commit, setEasing]);

  /* Nothing left running if this unmounts mid-drag. */
  useEffect(
    () => () => {
      if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current);
      if (dragRef.current) document.body.style.cursor = '';
    },
    [],
  );

  /* ------------------------------------------------------ the frames' voice */

  const beforeId = before.frameId;
  const afterId = after.frameId;

  useEffect(() => {
    const ids = new Set([beforeId, afterId]);

    const onMessage = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (!isPreviewMessage(data)) return;
      // Same proof the studio uses: the nonce says which frame, `event.source`
      // proves it. A frame cannot answer for its neighbour.
      const frameId = previewRegistry.resolve(event.source, data.nonce);
      if (!frameId || !ids.has(frameId)) return;
      // Works standalone: inside the studio the shared listener has already done
      // this, and outside it nobody else would.
      previewRegistry.markReadyFromInbound(frameId);

      switch (data.type) {
        case 'preview:mounted':
          setMounted((current) => (current[frameId] ? current : { ...current, [frameId]: true }));
          setFrameErrors((current) => (current[frameId] ? { ...current, [frameId]: null } : current));
          break;

        case 'preview:error':
          // The app threw. Without this the half would sit on "Starting the app"
          // for ever, which is the one thing it must not do.
          setFrameErrors((current) => ({ ...current, [frameId]: data.message }));
          break;

        case 'preview:navigate':
          if (!syncNavigation) break;
          previewRegistry.post(frameId === beforeId ? afterId : beforeId, {
            type: 'host:navigate',
            route: data.route,
          });
          break;

        default:
          break;
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [beforeId, afterId, syncNavigation]);

  const beforeMounted = mounted[beforeId] ?? false;
  const afterMounted = mounted[afterId] ?? false;

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Studio chrome, outside the viewport: it follows the studio theme, and it
          never covers either app. Far-left names the leftmost half and far-right
          the rightmost one, whatever the divider is doing between them. */}
      <div className="mb-1.5 flex items-end gap-2" style={{ width }}>
        <SideTag eyebrow="Before" label={before.label} hint={before.hint ?? null} align="left" />
        <span aria-hidden="true" className="mb-[5px] h-px w-3 shrink-0 bg-paper-200" />
        <SideTag eyebrow="After" label={after.label} hint={after.hint ?? null} align="right" />
      </div>

      <div
        ref={rootRef}
        data-testid="compare-slider"
        className="relative"
        style={
          {
            width,
            height,
            ...SCREEN_TOKENS,
            [SPLIT_VAR]: `${committed}%`,
            [EASE_VAR]: `${EASE_MS}ms`,
          } as VarStyle
        }
      >
        <div
          ref={viewportRef}
          className="absolute inset-0 overflow-hidden bg-paper-100"
          style={{ borderRadius: radius }}
        >
          {/* Order is paint order: "after" underneath, "before" clipped on top.
              Both are mounted for the lifetime of this component and neither is
              ever keyed, re-ordered or re-parented. */}
          <SideLayer
            side={after}
            clip={CLIP_AFTER}
            width={width}
            height={height}
            frameMounted={afterMounted}
            frameError={frameErrors[afterId] ?? null}
            align="right"
          />
          <SideLayer
            side={before}
            clip={CLIP_BEFORE}
            width={width}
            height={height}
            frameMounted={beforeMounted}
            frameError={frameErrors[beforeId] ?? null}
            align="left"
          />
        </div>

        {/* Inert until a drag starts. */}
        <div
          ref={shieldRef}
          aria-hidden="true"
          className="absolute inset-0 z-20"
          style={{ pointerEvents: 'none', cursor: 'col-resize' }}
        />

        {/* One full-width layer moved by a percentage translate, so the divider
            and the clips read the same variable. Transform only — no layout. */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 z-30 w-full"
          style={{
            transform: `translateX(var(${SPLIT_VAR}))`,
            transition: `transform var(${EASE_VAR}) var(--ease-out-quint)`,
          }}
        >
          {/* The hairline. Whole pixels, and its own colours rather than tokens:
              it is drawn over somebody's app, which may be any colour at all. */}
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 w-[2px]"
            style={{
              transform: 'translateX(-1px)',
              background: 'rgb(255 255 255 / 0.92)',
              boxShadow: '0 0 0 1px rgb(16 20 26 / 0.18)',
            }}
          />

          <div
            ref={handleRef}
            role="separator"
            aria-orientation="vertical"
            aria-label={`Comparison divider between ${before.label} and ${after.label}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(committed)}
            aria-valuetext={valueText(committed)}
            aria-controls={`${beforeId}-pane ${afterId}-pane`}
            tabIndex={0}
            title="Drag to compare · double-click to centre · arrow keys to nudge"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            // Last resort: if capture is lost some other way, the drag still ends
            // and the shield is still taken back off the apps. Idempotent — the
            // guard in `endDrag` makes the second call a no-op.
            onLostPointerCapture={endDrag}
            onDoubleClick={snapToCentre}
            onKeyDown={onKeyDown}
            className={cn(
              'pointer-events-auto absolute left-0 top-1/2 flex h-9 w-6 items-center justify-center',
              'rounded-full border border-paper-300 bg-paper-0 text-paper-600 shadow-float',
              'cursor-col-resize select-none',
            )}
            style={{ transform: 'translate(-50%, -50%)', touchAction: 'none' }}
          >
            <ChevronLeft size={11} strokeWidth={2.4} className="-mr-[3px]" />
            <ChevronRight size={11} strokeWidth={2.4} className="-ml-[3px]" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* One half                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Memoised, and every prop it takes is stable: the clip is a constant string
 * naming a variable, so moving the divider does not re-render either half — and
 * the frame inside is never asked to reconcile while you drag.
 */
const SideLayer = memo(function SideLayer({
  side,
  clip,
  width,
  height,
  frameMounted,
  frameError,
  align,
}: {
  side: CompareSide;
  clip: string;
  width: number;
  height: number;
  frameMounted: boolean;
  frameError: string | null;
  align: 'left' | 'right';
}) {
  const { frameId, label, bundle, context } = side;
  const code = bundle?.code ?? null;
  const hash = bundle?.hash ?? null;

  /*
   * `host:init` once, then `host:context` on every later change. Both are queued
   * by the registry until the frame announces itself, so this does not have to
   * know anything about frame lifecycle — and the queue preserves order, which is
   * why the load effect below is declared second: a `host:load` that arrives
   * before a context is dropped by the runtime.
   */
  const initialised = useRef(false);
  useEffect(() => {
    if (!initialised.current) {
      initialised.current = true;
      previewRegistry.post(frameId, { type: 'host:init', context, shared: {} });
      return;
    }
    previewRegistry.post(frameId, { type: 'host:context', context });
  }, [frameId, context]);

  useEffect(() => {
    if (!code) return;
    previewRegistry.post(frameId, { type: 'host:load', code, hash: hash ?? '' });
  }, [frameId, code, hash]);

  const reload = useCallback(() => {
    if (!code) return;
    previewRegistry.post(frameId, { type: 'host:init', context, shared: {} });
    previewRegistry.post(frameId, { type: 'host:load', code, hash: hash ?? '' });
  }, [frameId, context, code, hash]);

  const phase = deriveBuildPhase(bundle ?? undefined, frameMounted);
  const presence = derivePreviewPresence(bundle ?? undefined, frameMounted);

  /*
   * Which overlay this half gets, in priority order.
   *
   * A frame error only earns the card when it is the reason nothing is on screen
   * — an app that threw before it could mount. Once an app *is* running, an
   * unhandled rejection is a note, not a blackout: `preview:error` also carries
   * replay assertions and stray promise rejections, and covering a working app
   * over one of those would be the overstatement this project exists to avoid.
   */
  const blocked = frameError !== null && presence === 'none';

  return (
    <div
      id={`${frameId}-pane`}
      data-testid={`compare-pane-${frameId}`}
      className="absolute inset-0"
      // The whole mechanism, in one declaration. See the header comment.
      style={{
        clipPath: clip,
        transition: `clip-path var(${EASE_VAR}) var(--ease-out-quint)`,
      }}
    >
      <PreviewFrame deviceId={frameId} width={width} height={height} title={`${label} preview`} />

      {phase === 'failed' && bundle ? (
        <SideFailure label={label} bundle={bundle} presence={presence} onRetry={side.onRetry} />
      ) : blocked && frameError ? (
        <SideFailure
          label={label}
          runtimeError={frameError}
          presence={presence}
          onReload={code ? reload : undefined}
        />
      ) : presence === 'none' ? (
        <SidePlaceholder phase={phase} label={label} />
      ) : frameError ? (
        <SideStrip align={align} tone="danger">
          {frameError}
        </SideStrip>
      ) : phase === 'compiling' || phase === 'stale' ? (
        <SideStrip align={align}>{BUILD_PHASE_LABELS[phase]}</SideStrip>
      ) : null}
    </div>
  );
});

/**
 * Nothing on this side yet.
 *
 * The phase label is the same sentence a phone would show, and it is the only
 * claim made: no percentage, no step list, no estimate.
 */
function SidePlaceholder({ phase, label }: { phase: BuildPhase; label: string }) {
  const busy = phase === 'compiling' || phase === 'queued' || phase === 'loading';
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center p-3">
      <div className="flex max-w-full flex-col items-center gap-1 text-center">
        <div className="flex items-center gap-1.5 rounded-full border border-paper-200 bg-paper-0 px-2 py-[3px] text-[11px] font-medium text-paper-700">
          {busy ? (
            <span aria-hidden="true" className="size-[6px] animate-pulse rounded-full bg-azure-400" />
          ) : null}
          {BUILD_PHASE_LABELS[phase]}
        </div>
        <span className="max-w-full truncate text-[10.5px] text-paper-500">{label}</span>
      </div>
    </div>
  );
}

/**
 * A quiet note over an app that is on screen. Never covers it, and it sits on
 * the outer edge of its own half so the divider does not cut through it first.
 */
function SideStrip({
  align,
  tone = 'neutral',
  children,
}: {
  align: 'left' | 'right';
  tone?: 'neutral' | 'danger';
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        // Pointer-transparent throughout: this half's app keeps every tap,
        // including the ones that land in this corner.
        'pointer-events-none absolute bottom-2 flex max-w-[calc(100%-1rem)]',
        align === 'left' ? 'left-2' : 'right-2',
      )}
    >
      <span
        className={cn(
          'truncate rounded-full border px-1.5 py-[2px] text-[10.5px] font-medium',
          tone === 'danger'
            ? 'border-danger-200 bg-paper-0/92 text-danger-700'
            : 'border-paper-200 bg-paper-0/92 text-paper-600',
        )}
      >
        {children}
      </span>
    </div>
  );
}

/**
 * What a half shows when it did not compile — or compiled and then threw.
 *
 * The same shape and the same voice as `build-error-card.tsx`, minus the actions
 * that need the studio store, plus the one thing that card never has to say:
 * *which version* this is. It is clipped with its own side, so it appears over
 * the broken half and nowhere else.
 */
function SideFailure({
  label,
  bundle,
  runtimeError,
  presence,
  onRetry,
  onReload,
}: {
  label: string;
  bundle?: BundleState;
  runtimeError?: string;
  presence: PreviewPresence;
  onRetry?: (() => void) | undefined;
  onReload?: (() => void) | undefined;
}) {
  const primary: BundleDiagnostic | null =
    bundle?.diagnostics.find((entry) => entry.severity === 'error') ?? null;
  const transport = primary?.source === 'transport';

  // Where it broke, in the terms of the thing that actually failed.
  const step = runtimeError
    ? 'Running the app'
    : transport
      ? 'Reaching the build service'
      : primary?.source === 'runtime'
        ? 'Running the app'
        : 'Compiling';

  const file = primary?.file ?? null;
  const message = (
    runtimeError ??
    primary?.message ??
    bundle?.error ??
    'The build did not complete.'
  ).trim();
  const shortMessage = message.length > 200 ? `${message.slice(0, 197)}…` : message;

  return (
    <div
      className="absolute inset-0 z-[55] flex items-end p-2.5"
      // A scrim, not a blackout: whatever is running underneath stays legible, so
      // it is obvious what has and has not survived on this side.
      style={{
        background:
          'linear-gradient(to bottom, rgb(16 20 26 / 0.10) 0%, rgb(16 20 26 / 0.42) 55%, rgb(16 20 26 / 0.62) 100%)',
      }}
    >
      <div className="w-full overflow-hidden rounded-[12px] border border-danger-200 bg-paper-0 shadow-float">
        <div className="flex items-start gap-2 border-b border-paper-150 px-2.5 py-2">
          <span className="mt-[1px] grid size-5 shrink-0 place-items-center rounded-md bg-danger-50 text-danger-600">
            <FileWarning size={12} strokeWidth={2.2} />
          </span>
          <div className="min-w-0">
            <div className="text-[12px] font-semibold leading-tight text-paper-900">
              {step} failed
            </div>
            <div className="mt-0.5 truncate text-[10.5px] text-paper-500">{label}</div>
          </div>
        </div>

        {file ? (
          <div className="truncate border-b border-paper-150 px-2.5 py-1 font-mono text-[10px] text-paper-500">
            {file}
            {primary?.line ? `:${primary.line}` : ''}
          </div>
        ) : bundle && !runtimeError ? (
          <div className="border-b border-paper-150 px-2.5 py-1 text-[10px] text-paper-500">
            {transport ? 'No compiler output — the request itself failed.' : 'No file reported.'}
          </div>
        ) : null}

        <p className="max-h-[80px] overflow-auto px-2.5 py-1.5 font-mono text-[10px] leading-[1.5] text-paper-700">
          {shortMessage}
        </p>

        <p className="px-2.5 pb-1.5 text-[10.5px] leading-snug text-paper-500">
          {presence === 'none'
            ? 'Nothing is running on this side.'
            : runtimeError
              ? 'The app is on screen; this is what it reported.'
              : bundle?.recoveredFrom
                ? `Still running ${bundle.recoveredFrom} — the last version that compiled.`
                : 'Still running the last version that compiled.'}
        </p>

        {/* Only drawn when it can actually do something. */}
        {onRetry || onReload ? (
          <div className="flex flex-wrap gap-1 border-t border-paper-150 bg-paper-50 px-2 py-1.5">
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1 rounded-md border border-paper-200 bg-paper-0 px-1.5 py-[3px] text-[10.5px] font-medium text-paper-700 transition-colors hover:border-paper-300 hover:bg-paper-100 hover:text-paper-900"
              >
                <RotateCcw size={11} strokeWidth={2} />
                Rebuild this side
              </button>
            ) : null}
            {onReload ? (
              <button
                type="button"
                onClick={onReload}
                className="inline-flex items-center gap-1 rounded-md border border-paper-200 bg-paper-0 px-1.5 py-[3px] text-[10.5px] font-medium text-paper-700 transition-colors hover:border-paper-300 hover:bg-paper-100 hover:text-paper-900"
              >
                <RotateCcw size={11} strokeWidth={2} />
                Reload this side
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Which version a half is running. Studio chrome — it sits above the viewport. */
function SideTag({
  eyebrow,
  label,
  hint,
  align,
}: {
  eyebrow: string;
  label: string;
  hint: string | null;
  align: 'left' | 'right';
}) {
  return (
    <div
      className={cn(
        // `min-w-0` and `flex-1` together are what keep two long version names
        // inside a narrow viewport instead of pushing each other off it.
        'flex min-w-0 flex-1 flex-col',
        align === 'right' ? 'items-end text-right' : 'items-start',
      )}
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-paper-500">
        {eyebrow}
      </span>
      <span className="max-w-full truncate text-[12.5px] font-semibold tracking-[-0.008em] text-paper-800">
        {label}
      </span>
      {hint ? <span className="max-w-full truncate text-[11px] text-paper-500">{hint}</span> : null}
    </div>
  );
}
