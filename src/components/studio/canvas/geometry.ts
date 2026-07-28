/**
 * Canvas geometry: pure functions, no DOM.
 *
 * Kept separate from the React layer for two reasons — it is the part worth unit
 * testing, and the drag path calls it on every pointer move, so it must not touch
 * state or allocate more than it has to.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewTransform {
  /** Pan, in screen pixels. */
  x: number;
  y: number;
  scale: number;
}

export const ZOOM_MIN = 0.15;
export const ZOOM_MAX = 2.5;

export function clampZoom(scale: number): number {
  return Math.min(Math.max(scale, ZOOM_MIN), ZOOM_MAX);
}

/** Screen (viewport-relative) point → world coordinates. */
export function screenToWorld(point: Point, view: ViewTransform): Point {
  return { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale };
}

export function worldToScreen(point: Point, view: ViewTransform): Point {
  return { x: point.x * view.scale + view.x, y: point.y * view.scale + view.y };
}

/**
 * Zooms about a fixed screen point (the cursor), which is what makes trackpad
 * pinch and ⌘-scroll feel anchored instead of drifting.
 */
export function zoomAt(view: ViewTransform, anchor: Point, nextScale: number): ViewTransform {
  const scale = clampZoom(nextScale);
  const world = screenToWorld(anchor, view);
  return {
    scale,
    x: anchor.x - world.x * scale,
    y: anchor.y - world.y * scale,
  };
}

/** Fits every rect into the viewport with padding, centred. */
export function fitRects(
  rects: readonly Rect[],
  viewport: { width: number; height: number },
  padding = 96,
): ViewTransform {
  if (rects.length === 0) return { x: 0, y: 0, scale: 1 };

  const bounds = boundingBox(rects);
  const available = {
    width: Math.max(viewport.width - padding * 2, 80),
    height: Math.max(viewport.height - padding * 2, 80),
  };
  const scale = clampZoom(
    Math.min(available.width / bounds.width, available.height / bounds.height, ZOOM_MAX),
  );

  return {
    scale,
    x: (viewport.width - bounds.width * scale) / 2 - bounds.x * scale,
    y: (viewport.height - bounds.height * scale) / 2 - bounds.y * scale,
  };
}

export function boundingBox(rects: readonly Rect[]): Rect {
  const first = rects[0];
  if (!first) return { x: 0, y: 0, width: 0, height: 0 };

  let minX = first.x;
  let minY = first.y;
  let maxX = first.x + first.width;
  let maxY = first.y + first.height;

  for (const rect of rects.slice(1)) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/* -------------------------------------------------------------------------- */
/* Snapping                                                                    */
/* -------------------------------------------------------------------------- */

export interface SnapGuide {
  axis: 'x' | 'y';
  /** World coordinate of the guide line. */
  position: number;
  /** World-space extent to draw, so guides do not span the whole canvas. */
  from: number;
  to: number;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

/**
 * Aligns a dragged rect to its neighbours: left/centre/right and
 * top/middle/bottom edges, plus the *even spacing* case (matching the gap that
 * already exists between two other phones).
 *
 * Intentionally weak — `threshold` is in screen pixels and divided by the zoom, so
 * snapping never fights the pointer at high zoom, and it releases as soon as you
 * move away. No grid lock-in.
 */
export function snapRect(
  moving: Rect,
  others: readonly Rect[],
  threshold: number,
): SnapResult {
  let bestX: { delta: number; guide: SnapGuide } | null = null;
  let bestY: { delta: number; guide: SnapGuide } | null = null;

  const movingEdgesX = [moving.x, moving.x + moving.width / 2, moving.x + moving.width];
  const movingEdgesY = [moving.y, moving.y + moving.height / 2, moving.y + moving.height];

  for (const other of others) {
    const otherEdgesX = [other.x, other.x + other.width / 2, other.x + other.width];
    const otherEdgesY = [other.y, other.y + other.height / 2, other.y + other.height];

    for (const movingEdge of movingEdgesX) {
      for (const otherEdge of otherEdgesX) {
        const delta = otherEdge - movingEdge;
        if (Math.abs(delta) > threshold) continue;
        if (bestX === null || Math.abs(delta) < Math.abs(bestX.delta)) {
          bestX = {
            delta,
            guide: {
              axis: 'x',
              position: otherEdge,
              from: Math.min(moving.y, other.y) - 40,
              to: Math.max(moving.y + moving.height, other.y + other.height) + 40,
            },
          };
        }
      }
    }

    for (const movingEdge of movingEdgesY) {
      for (const otherEdge of otherEdgesY) {
        const delta = otherEdge - movingEdge;
        if (Math.abs(delta) > threshold) continue;
        if (bestY === null || Math.abs(delta) < Math.abs(bestY.delta)) {
          bestY = {
            delta,
            guide: {
              axis: 'y',
              position: otherEdge,
              from: Math.min(moving.x, other.x) - 40,
              to: Math.max(moving.x + moving.width, other.x + other.width) + 40,
            },
          };
        }
      }
    }
  }

  // Even spacing: if two neighbours share a gap, offer the same gap here.
  const spacing = snapToEvenSpacing(moving, others, threshold);
  if (spacing && (bestX === null || Math.abs(spacing.delta) < Math.abs(bestX.delta))) {
    bestX = spacing;
  }

  const guides: SnapGuide[] = [];
  if (bestX) guides.push(bestX.guide);
  if (bestY) guides.push(bestY.guide);

  return {
    x: moving.x + (bestX?.delta ?? 0),
    y: moving.y + (bestY?.delta ?? 0),
    guides,
  };
}

function snapToEvenSpacing(
  moving: Rect,
  others: readonly Rect[],
  threshold: number,
): { delta: number; guide: SnapGuide } | null {
  // Only consider phones on roughly the same row.
  const row = others
    .filter((other) => Math.abs(other.y - moving.y) < Math.max(moving.height, other.height) * 0.6)
    .sort((a, b) => a.x - b.x);
  if (row.length < 2) return null;

  for (let index = 0; index < row.length - 1; index += 1) {
    const left = row[index] as Rect;
    const right = row[index + 1] as Rect;
    const gap = right.x - (left.x + left.width);
    if (gap <= 0) continue;

    // Place after the rightmost of the pair with the same gap.
    const target = right.x + right.width + gap;
    const delta = target - moving.x;
    if (Math.abs(delta) <= threshold) {
      return {
        delta,
        guide: {
          axis: 'x',
          position: target,
          from: Math.min(moving.y, right.y) - 40,
          to: Math.max(moving.y + moving.height, right.y + right.height) + 40,
        },
      };
    }

    // …or before the leftmost.
    const targetLeft = left.x - gap - moving.width;
    const deltaLeft = targetLeft - moving.x;
    if (Math.abs(deltaLeft) <= threshold) {
      return {
        delta: deltaLeft,
        guide: {
          axis: 'x',
          position: targetLeft,
          from: Math.min(moving.y, left.y) - 40,
          to: Math.max(moving.y + moving.height, left.y + left.height) + 40,
        },
      };
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Auto layout                                                                 */
/* -------------------------------------------------------------------------- */

export type AlignMode = 'left' | 'center-x' | 'right' | 'top' | 'middle-y' | 'bottom';

export function alignRects(
  rects: readonly (Rect & { id: string })[],
  mode: AlignMode,
): { id: string; x: number; y: number }[] {
  if (rects.length < 2) return [];
  const bounds = boundingBox(rects);

  return rects.map((rect) => {
    switch (mode) {
      case 'left':
        return { id: rect.id, x: bounds.x, y: rect.y };
      case 'right':
        return { id: rect.id, x: bounds.x + bounds.width - rect.width, y: rect.y };
      case 'center-x':
        return { id: rect.id, x: bounds.x + (bounds.width - rect.width) / 2, y: rect.y };
      case 'top':
        return { id: rect.id, x: rect.x, y: bounds.y };
      case 'bottom':
        return { id: rect.id, x: rect.x, y: bounds.y + bounds.height - rect.height };
      case 'middle-y':
        return { id: rect.id, x: rect.x, y: bounds.y + (bounds.height - rect.height) / 2 };
    }
  });
}

/** Lays phones out in a row with an even gap, aligned to the topmost one. */
export function distributeRects(
  rects: readonly (Rect & { id: string })[],
  gap = 120,
): { id: string; x: number; y: number }[] {
  if (rects.length < 2) return [];
  const sorted = [...rects].sort((a, b) => a.x - b.x);
  const startX = sorted[0]?.x ?? 0;
  const top = Math.min(...sorted.map((rect) => rect.y));

  let cursor = startX;
  return sorted.map((rect) => {
    const position = { id: rect.id, x: Math.round(cursor), y: Math.round(top) };
    cursor += rect.width + gap;
    return position;
  });
}

/** Grid layout used by "tidy up": rows of at most `perRow`. */
export function tidyRects(
  rects: readonly (Rect & { id: string })[],
  perRow = 4,
  gap = 120,
): { id: string; x: number; y: number }[] {
  if (rects.length === 0) return [];
  const columnWidth = Math.max(...rects.map((rect) => rect.width)) + gap;
  const rowHeight = Math.max(...rects.map((rect) => rect.height)) + gap;
  const origin = boundingBox(rects);

  return rects.map((rect, index) => ({
    id: rect.id,
    x: Math.round(origin.x + (index % perRow) * columnWidth),
    y: Math.round(origin.y + Math.floor(index / perRow) * rowHeight),
  }));
}
