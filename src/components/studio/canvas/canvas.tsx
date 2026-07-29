'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { cn } from '@/lib/cn';
import { deviceGeometry, getPreset } from '@/lib/devices/presets';
import { needsArrange } from '@/lib/devices/layout';
import type { DeviceRow } from '@/server/db';
import { useStudio, useStudioApi } from '../context';
import { canvasApi } from './canvas-api';
import { DeviceNode } from './device-node';
import {
  ZOOM_MAX,
  ZOOM_MIN,
  clampZoom,
  fitRects,
  snapRect,
  zoomAt,
  type Rect,
  type ViewTransform,
} from './geometry';

/**
 * The canvas.
 *
 * Performance rules, and why:
 *
 *  - Pan and zoom write `transform` on one wrapper element. All phones move
 *    together, in one composited layer, with no React render.
 *  - Dragging writes `transform` on the dragged nodes only, straight to the DOM,
 *    coalesced into a `requestAnimationFrame`. React state (and the server) hear
 *    about it once, on pointer-up.
 *  - The iframes are never touched by either, so a preview keeps its state and
 *    never reloads while you rearrange the canvas.
 *
 * Gestures follow the conventions people already have: two-finger scroll pans,
 * ⌘/ctrl-scroll (and pinch) zooms about the cursor, space or middle-drag pans from
 * anywhere, and dragging the chassis or the label above a phone moves it. The
 * screen itself belongs to the app — pointer events there go to the iframe.
 */

const SNAP_THRESHOLD_PX = 7;

/**
 * The opt-in dot grid: its pitch in world units, and how close two dots may get
 * on screen before the lattice thins out (see `applyView`). Nothing else on the
 * canvas is measured against these — the grid is surface texture, not a layout
 * rule, and dragging snaps to the edges of other devices rather than to a
 * lattice.
 */
const GRID_WORLD_PX = 24;
const GRID_MIN_SCREEN_PX = 12;

interface DragState {
  pointerId: number;
  startClient: { x: number; y: number };
  origins: Map<string, { x: number; y: number }>;
  primaryId: string;
  moved: boolean;
  latest: Map<string, { x: number; y: number }>;
  frame: number | null;
}

interface PanState {
  pointerId: number;
  startClient: { x: number; y: number };
  startView: { x: number; y: number };
}

export function Canvas() {
  const store = useStudioApi();
  const devices = useStudio((state) => state.devices);
  const selectedIds = useStudio((state) => state.selectedDeviceIds);
  const showGrid = useStudio((state) => state.preferences.canvasGrid);
  const snapEnabled = useStudio((state) => state.preferences.canvasSnap);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const guideXRef = useRef<HTMLDivElement | null>(null);
  const guideYRef = useRef<HTMLDivElement | null>(null);
  const nodesRef = useRef(new Map<string, HTMLDivElement>());

  const viewRef = useRef<ViewTransform>({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<DragState | null>(null);
  const panRef = useRef<PanState | null>(null);
  const spaceRef = useRef(false);
  const didInitialFit = useRef(false);
  // Read inside the pointermove handler, which must not re-subscribe mid-gesture.
  const snapEnabledRef = useRef(snapEnabled);
  useEffect(() => {
    snapEnabledRef.current = snapEnabled;
  }, [snapEnabled]);
  // Same reason: `applyView` runs on every pan and zoom frame and keeps an empty
  // dependency list, because recreating it would tear down and rebuild the wheel
  // listener and the whole imperative API. The effect that keeps this in sync
  // lives just under applyView, where it can also repaint on the toggle.
  const showGridRef = useRef(showGrid);

  /** World-space rect of a device, from its preset geometry. */
  const rectFor = useCallback((device: DeviceRow): Rect => {
    const preset = getPreset(device.presetId);
    const geometry = deviceGeometry(preset, device.orientation);
    return {
      x: device.x,
      y: device.y,
      width: geometry.chassis.width,
      height: geometry.chassis.height,
    };
  }, []);

  /** Handle of a running view ease, so a new one can cancel it mid-flight. */
  const viewEaseRef = useRef<number | null>(null);

  const applyView = useCallback(() => {
    const world = worldRef.current;
    const viewport = viewportRef.current;
    if (!world || !viewport) return;
    const { x, y, scale } = viewRef.current;
    world.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;

    // The canvas surface — tone, lighting, grain — is screen-space and static, so
    // with the grid off a pan writes one transform on one composited layer and
    // touches the viewport's own paint not at all. Only the opt-in grid is locked
    // to world space, and only it pays for that: two style writes per frame that
    // repaint the viewport's background.
    if (showGridRef.current) {
      // Thin the lattice out rather than let it turn into a wash: double the
      // pitch until the dots are at least GRID_MIN_SCREEN_PX apart. The `> 0`
      // guard is there so a degenerate scale can never spin this loop.
      let step = GRID_WORLD_PX * scale;
      while (step > 0 && step < GRID_MIN_SCREEN_PX) step *= 2;
      viewport.style.backgroundSize = `${step}px ${step}px`;
      // Half a step back, because the dot sits at the CENTRE of its tile: this
      // puts a dot on the world origin rather than half a cell off it. It is also
      // what makes the doubling above a true thinning — anchored this way every
      // dot of the doubled lattice is a dot of the base one, so crossing the
      // threshold mid-zoom drops every other dot and moves none of them. Anchor
      // the tile at `x, y` instead and each doubling slides the whole lattice by
      // half a cell, which reads as a pop. Keep this in step with the static
      // fallback on `.pl-canvas-grid` in globals.css.
      viewport.style.backgroundPosition = `${x - step / 2}px ${y - step / 2}px`;
    }
    canvasApi.publishZoom(scale);
  }, []);

  // Keep the ref in step, and repaint on the toggle: turning the grid on has to
  // place it at the current view immediately (the class's own background-size is
  // only right at scale 1, unpanned), and turning it off has to drop the inline
  // overrides along with the layer they were driving.
  useEffect(() => {
    showGridRef.current = showGrid;
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (showGrid) {
      applyView();
      return;
    }
    viewport.style.backgroundSize = '';
    viewport.style.backgroundPosition = '';
  }, [applyView, showGrid]);

  /**
   * Glides the viewport to a new pan/zoom.
   *
   * Driven by rAF rather than by a CSS transition. That was originally forced:
   * the grid was painted as the viewport's background and had to stay locked to
   * world space, and a CSS transition would have moved the phones while the
   * surface behind them stood still. It no longer is — the surface is drawn in
   * screen space now and the grid is a preference, so whenever it is switched off
   * there is nothing left to keep in step with the transform and a CSS transition
   * on the world element would do. Deliberately left alone: it is still
   * the correct path for the opt-in grid, it is the same write path a pointer pan
   * calls at 60fps and therefore already proven cheap, and swapping it for a
   * transition brings its own questions (cancelling mid-flight against a gesture,
   * cleaning the property up afterwards) that belong in their own change.
   *
   * Cancelled by the next gesture: a running ease is dropped the moment anyone
   * else writes the view, so the canvas never fights the pointer.
   */
  const easeViewTo = useCallback(
    (target: ViewTransform, durationMs = 260) => {
      const start = { ...viewRef.current };
      const reduced =
        typeof window !== 'undefined' &&
        (window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
          document.documentElement.dataset.reduceMotion === 'true');

      if (viewEaseRef.current !== null) cancelAnimationFrame(viewEaseRef.current);
      if (reduced || durationMs <= 0) {
        viewEaseRef.current = null;
        viewRef.current = target;
        applyView();
        return;
      }

      const began = performance.now();
      const step = (now: number) => {
        const t = Math.min((now - began) / durationMs, 1);
        // Quintic out — the same curve as --ease-out-quint, so an eased view and
        // an eased device move look like one motion.
        const eased = 1 - (1 - t) ** 5;
        viewRef.current = {
          x: start.x + (target.x - start.x) * eased,
          y: start.y + (target.y - start.y) * eased,
          scale: start.scale + (target.scale - start.scale) * eased,
        };
        applyView();
        viewEaseRef.current = t < 1 ? requestAnimationFrame(step) : null;
      };
      viewEaseRef.current = requestAnimationFrame(step);
    },
    [applyView],
  );

  /** Drops a running ease so a gesture always wins over an animation. */
  const cancelViewEase = useCallback(() => {
    if (viewEaseRef.current === null) return;
    cancelAnimationFrame(viewEaseRef.current);
    viewEaseRef.current = null;
  }, []);

  useEffect(() => () => cancelViewEase(), [cancelViewEase]);

  /* -------------------------------------------------------- imperative API */

  useEffect(() => {
    const fit = () => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rects = store.getState().devices.map(rectFor);
      if (rects.length === 0) {
        viewRef.current = { x: viewport.clientWidth / 2, y: 120, scale: 1 };
      } else {
        viewRef.current = fitRects(rects, {
          width: viewport.clientWidth,
          height: viewport.clientHeight,
        });
      }
      applyView();
    };

    canvasApi.set({
      zoomBy(factor) {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const anchor = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
        viewRef.current = zoomAt(viewRef.current, anchor, viewRef.current.scale * factor);
        applyView();
      },
      zoomTo(scale) {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const anchor = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
        viewRef.current = zoomAt(viewRef.current, anchor, scale);
        applyView();
      },
      fit,
      center: fit,
      animateTo(positions, durationMs = 260) {
        // Reduced motion is honoured by the CSS override in globals.css, which
        // collapses the duration; nothing here needs a second code path.
        const nodes = positions
          .map((position) => ({ position, node: nodesRef.current.get(position.id) }))
          .filter((entry): entry is { position: typeof entry.position; node: HTMLDivElement } =>
            Boolean(entry.node),
          );

        for (const { node } of nodes) {
          node.style.transition = `transform ${durationMs}ms var(--ease-out-quint)`;
        }
        // Next frame, so the browser has the starting transform before the
        // transition property applies — otherwise it jumps.
        requestAnimationFrame(() => {
          for (const { position, node } of nodes) {
            node.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
          }
        });
        window.setTimeout(() => {
          // Back to instant, so the next drag tracks the pointer exactly.
          for (const { node } of nodes) node.style.transition = '';
        }, durationMs + 40);
      },
      focusDevice(deviceId) {
        const viewport = viewportRef.current;
        const device = store.getState().devices.find((entry) => entry.id === deviceId);
        if (!viewport || !device) return;
        easeViewTo(
          fitRects(
            [rectFor(device)],
            { width: viewport.clientWidth, height: viewport.clientHeight },
            140,
          ),
        );
      },
      revealDevice(deviceId) {
        const viewport = viewportRef.current;
        const device = store.getState().devices.find((entry) => entry.id === deviceId);
        if (!viewport || !device) return;

        const view = viewRef.current;
        const rect = rectFor(device);
        const box = {
          left: rect.x * view.scale + view.x,
          top: rect.y * view.scale + view.y,
          right: (rect.x + rect.width) * view.scale + view.x,
          bottom: (rect.y + rect.height) * view.scale + view.y,
        };
        // The label strip and the action bar live just outside the chassis rect,
        // so "visible" has to mean visible with room around it.
        const margin = 28;
        const width = viewport.clientWidth;
        const height = viewport.clientHeight;

        const fits =
          box.right - box.left <= width - margin * 2 && box.bottom - box.top <= height - margin * 2;
        if (!fits) {
          easeViewTo(fitRects([rect], { width, height }, 96));
          return;
        }

        // It fits: pan the least distance that brings every edge inside.
        let dx = 0;
        let dy = 0;
        if (box.left < margin) dx = margin - box.left;
        else if (box.right > width - margin) dx = width - margin - box.right;
        if (box.top < margin) dy = margin - box.top;
        else if (box.bottom > height - margin) dy = height - margin - box.bottom;
        if (dx === 0 && dy === 0) return;

        easeViewTo({ ...view, x: view.x + dx, y: view.y + dy });
      },
      getZoom() {
        return viewRef.current.scale;
      },
      viewportAspect() {
        const viewport = viewportRef.current;
        if (!viewport || viewport.clientHeight === 0) return null;
        return viewport.clientWidth / viewport.clientHeight;
      },
    });

    return () => canvasApi.set(null);
  }, [applyView, easeViewTo, rectFor, store]);

  /**
   * Arrange once on open if the layout is degenerate, then fit.
   *
   * `needsArrange` is deliberately conservative: a layout someone has deliberately
   * spread out is left exactly as they left it. It only fires for the cases that
   * read as unset — devices stacked on the same point, overlapping, or flung far
   * wider than they need to be, which is what a freshly created project looks
   * like when its template positions do not suit the canvas.
   *
   * Nothing here remounts a preview: arranging writes transforms on the device
   * nodes and persists x/y, and fitting moves the single world wrapper.
   */
  useEffect(() => {
    if (didInitialFit.current) return;
    const viewport = viewportRef.current;
    if (!viewport || viewport.clientWidth === 0) return;
    const state = store.getState();
    if (state.devices.length === 0) return;
    didInitialFit.current = true;

    const rects = state.devices.map((device) => {
      const geometry = deviceGeometry(getPreset(device.presetId), device.orientation);
      return {
        id: device.id,
        role: device.role,
        x: device.x,
        y: device.y,
        width: geometry.chassis.width,
        height: geometry.chassis.height,
      };
    });

    if (needsArrange(rects)) {
      void state.arrangeDevices();
      return;
    }
    canvasApi.get()?.fit();
  }, [devices.length, store]);

  /* ------------------------------------------------------------------ zoom */

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // A gesture always wins over an animation.
      cancelViewEase();
      const rect = viewport.getBoundingClientRect();
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };

      if (event.ctrlKey || event.metaKey) {
        // Pinch on a trackpad arrives as ctrl+wheel; keep the factor gentle.
        const factor = Math.exp(-event.deltaY * 0.0085);
        viewRef.current = zoomAt(viewRef.current, anchor, viewRef.current.scale * factor);
      } else {
        viewRef.current = {
          ...viewRef.current,
          x: viewRef.current.x - event.deltaX,
          y: viewRef.current.y - event.deltaY,
        };
      }
      applyView();
    };

    // Non-passive: we need preventDefault to stop the page from scrolling/zooming.
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [applyView, cancelViewEase]);

  /* --------------------------------------------------------- space to pan  */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      spaceRef.current = true;
      if (viewportRef.current) viewportRef.current.style.cursor = 'grab';
      event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      spaceRef.current = false;
      if (viewportRef.current) viewportRef.current.style.cursor = '';
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  /* ------------------------------------------------------------------ pan  */

  const beginPan = useCallback(
    (event: React.PointerEvent) => {
      cancelViewEase();
      panRef.current = {
        pointerId: event.pointerId,
        startClient: { x: event.clientX, y: event.clientY },
        startView: { x: viewRef.current.x, y: viewRef.current.y },
      };
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      if (viewportRef.current) viewportRef.current.style.cursor = 'grabbing';
    },
    [cancelViewEase],
  );

  const onViewportPointerDown = useCallback(
    (event: React.PointerEvent) => {
      const isBackground = event.target === event.currentTarget || event.target === worldRef.current;
      if (event.button === 1 || spaceRef.current || (event.button === 0 && isBackground)) {
        if (event.button === 0 && isBackground && !spaceRef.current) {
          store.getState().selectDevice(null);
        }
        beginPan(event);
      }
    },
    [beginPan, store],
  );

  /* ----------------------------------------------------------------- drag  */

  const beginDrag = useCallback(
    (deviceId: string, event: React.PointerEvent) => {
      const state = store.getState();
      const additive = event.shiftKey || event.metaKey;
      if (!state.selectedDeviceIds.includes(deviceId) || additive) {
        state.selectDevice(deviceId, additive);
      }

      const selected = store.getState().selectedDeviceIds;
      const ids = selected.includes(deviceId) ? selected : [deviceId];
      const origins = new Map<string, { x: number; y: number }>();
      for (const id of ids) {
        const device = state.devices.find((entry) => entry.id === id);
        if (device) origins.set(id, { x: device.x, y: device.y });
      }

      cancelViewEase();
      dragRef.current = {
        pointerId: event.pointerId,
        startClient: { x: event.clientX, y: event.clientY },
        origins,
        primaryId: deviceId,
        moved: false,
        latest: new Map(origins),
        frame: null,
      };
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    },
    [cancelViewEase, store],
  );

  const paintDrag = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.frame = null;
    for (const [id, position] of drag.latest) {
      const node = nodesRef.current.get(id);
      if (node) node.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    }
  }, []);

  const drawGuides = useCallback((guides: ReturnType<typeof snapRect>['guides']) => {
    const nodeX = guideXRef.current;
    const nodeY = guideYRef.current;
    const guideX = guides.find((guide) => guide.axis === 'x');
    const guideY = guides.find((guide) => guide.axis === 'y');

    if (nodeX) {
      if (guideX) {
        nodeX.style.opacity = '1';
        nodeX.style.transform = `translate3d(${guideX.position}px, ${guideX.from}px, 0)`;
        nodeX.style.height = `${guideX.to - guideX.from}px`;
      } else {
        nodeX.style.opacity = '0';
      }
    }
    if (nodeY) {
      if (guideY) {
        nodeY.style.opacity = '1';
        nodeY.style.transform = `translate3d(${guideY.from}px, ${guideY.position}px, 0)`;
        nodeY.style.width = `${guideY.to - guideY.from}px`;
      } else {
        nodeY.style.opacity = '0';
      }
    }
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const pan = panRef.current;
      if (pan && pan.pointerId === event.pointerId) {
        viewRef.current = {
          ...viewRef.current,
          x: pan.startView.x + (event.clientX - pan.startClient.x),
          y: pan.startView.y + (event.clientY - pan.startClient.y),
        };
        applyView();
        return;
      }

      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      const scale = viewRef.current.scale;
      const dx = (event.clientX - drag.startClient.x) / scale;
      const dy = (event.clientY - drag.startClient.y) / scale;
      if (!drag.moved && Math.abs(dx) < 1.5 / scale && Math.abs(dy) < 1.5 / scale) return;
      drag.moved = true;

      const devices = store.getState().devices;
      const primary = devices.find((entry) => entry.id === drag.primaryId);
      const origin = drag.origins.get(drag.primaryId);
      if (!primary || !origin) return;

      const primaryRect = rectFor(primary);
      const proposed: Rect = { ...primaryRect, x: origin.x + dx, y: origin.y + dy };

      // Snapping is opt-out with alt (or off entirely in settings), and always
      // weak: the threshold is in screen pixels, so it never fights the pointer
      // when you are zoomed in.
      let snapped = { x: proposed.x, y: proposed.y, guides: [] as ReturnType<typeof snapRect>['guides'] };
      if (!event.altKey && snapEnabledRef.current) {
        const others = devices.filter((entry) => !drag.origins.has(entry.id)).map(rectFor);
        snapped = snapRect(proposed, others, SNAP_THRESHOLD_PX / scale);
      }

      const snapDx = snapped.x - proposed.x;
      const snapDy = snapped.y - proposed.y;

      for (const [id, start] of drag.origins) {
        drag.latest.set(id, {
          x: Math.round(start.x + dx + snapDx),
          y: Math.round(start.y + dy + snapDy),
        });
      }

      drawGuides(snapped.guides);
      if (drag.frame === null) drag.frame = requestAnimationFrame(paintDrag);
    },
    [applyView, drawGuides, paintDrag, rectFor, store],
  );


  const endGesture = useCallback(
    (event: React.PointerEvent) => {
      const pan = panRef.current;
      if (pan && pan.pointerId === event.pointerId) {
        panRef.current = null;
        if (viewportRef.current) {
          viewportRef.current.style.cursor = spaceRef.current ? 'grab' : '';
        }
        return;
      }

      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      if (drag.frame !== null) cancelAnimationFrame(drag.frame);
      drawGuides([]);

      if (!drag.moved) return;
      const positions = [...drag.latest.entries()].map(([id, position]) => ({
        id,
        x: position.x,
        y: position.y,
      }));
      void store.getState().commitPositions(positions);
    },
    [drawGuides, store],
  );

  /* --------------------------------------------------- keep nodes in sync  */

  // When positions change from elsewhere (auto-layout, another tab, MCP), push them
  // onto the DOM nodes; during a drag the drag owns them instead.
  useEffect(() => {
    if (dragRef.current) return;
    for (const device of devices) {
      const node = nodesRef.current.get(device.id);
      if (node) node.style.transform = `translate3d(${device.x}px, ${device.y}px, 0)`;
    }
  }, [devices]);

  const registerNode = useCallback((deviceId: string, node: HTMLDivElement | null) => {
    if (node) nodesRef.current.set(deviceId, node);
    else nodesRef.current.delete(deviceId);
  }, []);

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  return (
    <div
      ref={viewportRef}
      className={cn(
        // The surface is unconditional: bench tone, lighting and grain are what
        // the canvas *is*, and they were previously tied to the grid preference,
        // so switching the grid off left a flat slab of colour. The grid is the
        // only part that is opt-in, and it is one extra background layer on this
        // same element — see the contract on .pl-canvas-surface in globals.css.
        'pl-canvas-surface pl-no-select relative h-full w-full overflow-hidden',
        showGrid && 'pl-canvas-grid',
      )}
      onPointerDown={onViewportPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      role="application"
      aria-label="Device canvas"
    >
      <div
        ref={worldRef}
        className="pl-gpu absolute left-0 top-0"
        style={{ transformOrigin: '0 0' }}
      >
        {/* Alignment guides live in world space so they scale with the canvas. */}
        <div
          ref={guideXRef}
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 w-px opacity-0"
          style={{ background: 'var(--color-azure-400)', transition: 'opacity 90ms linear' }}
        />
        <div
          ref={guideYRef}
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 h-px opacity-0"
          style={{ background: 'var(--color-azure-400)', transition: 'opacity 90ms linear' }}
        />

        {devices.map((device) => (
          <DeviceNode
            key={device.id}
            device={device}
            selected={selected.has(device.id)}
            registerNode={registerNode}
            onDragStart={beginDrag}
          />
        ))}
      </div>

      {devices.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="max-w-[300px] text-center">
            <div className="text-[13.5px] font-semibold text-paper-700">No phones on the canvas</div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-paper-500">
              Add a device from the toolbar and pick a role. Two phones with different roles is where
              PhoneLab gets interesting.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export { ZOOM_MAX, ZOOM_MIN, clampZoom };
