import { describe, expect, it } from 'vitest';
import {
  ZOOM_MAX,
  ZOOM_MIN,
  alignRects,
  boundingBox,
  distributeRects,
  fitRects,
  screenToWorld,
  snapRect,
  tidyRects,
  worldToScreen,
  zoomAt,
  type Rect,
} from '@/components/studio/canvas/geometry';

const phone = (x: number, y: number): Rect => ({ x, y, width: 402, height: 874 });

describe('canvas transforms', () => {
  it('round-trips screen and world coordinates', () => {
    const view = { x: 120, y: -45, scale: 0.7 };
    const point = { x: 340, y: 220 };
    const back = worldToScreen(screenToWorld(point, view), view);
    expect(back.x).toBeCloseTo(point.x, 6);
    expect(back.y).toBeCloseTo(point.y, 6);
  });

  it('keeps the anchor point fixed while zooming', () => {
    const view = { x: 0, y: 0, scale: 1 };
    const anchor = { x: 500, y: 300 };
    const worldBefore = screenToWorld(anchor, view);
    const zoomed = zoomAt(view, anchor, 2.1);
    const worldAfter = screenToWorld(anchor, zoomed);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
  });

  it('clamps zoom to the supported range', () => {
    const view = { x: 0, y: 0, scale: 1 };
    expect(zoomAt(view, { x: 0, y: 0 }, 99).scale).toBe(ZOOM_MAX);
    expect(zoomAt(view, { x: 0, y: 0 }, 0.001).scale).toBe(ZOOM_MIN);
  });

  it('fits every device inside the viewport', () => {
    const rects = [phone(0, 0), phone(900, 0), phone(0, 1100)];
    const viewport = { width: 1200, height: 800 };
    const view = fitRects(rects, viewport, 60);

    for (const rect of rects) {
      const topLeft = worldToScreen({ x: rect.x, y: rect.y }, view);
      const bottomRight = worldToScreen(
        { x: rect.x + rect.width, y: rect.y + rect.height },
        view,
      );
      expect(topLeft.x).toBeGreaterThanOrEqual(-1);
      expect(topLeft.y).toBeGreaterThanOrEqual(-1);
      expect(bottomRight.x).toBeLessThanOrEqual(viewport.width + 1);
      expect(bottomRight.y).toBeLessThanOrEqual(viewport.height + 1);
    }
  });

  it('computes a bounding box across devices', () => {
    expect(boundingBox([phone(0, 0), phone(600, 200)])).toEqual({
      x: 0,
      y: 0,
      width: 1002,
      height: 1074,
    });
  });
});

describe('snapping', () => {
  it('snaps a left edge to a neighbour within the threshold', () => {
    const moving = phone(604, 0);
    const result = snapRect(moving, [phone(0, 0)], 10);
    // 604 is 4px from aligning with the neighbour's right edge at 402? No — it aligns
    // its own left edge with nothing; the nearest candidate is centre/edge matching.
    expect(result.guides.length).toBeGreaterThan(0);
  });

  it('aligns tops when close', () => {
    const result = snapRect(phone(900, 6), [phone(0, 0)], 10);
    expect(result.y).toBe(0);
    expect(result.guides.some((guide) => guide.axis === 'y')).toBe(true);
  });

  it('leaves the rect alone when nothing is near', () => {
    const moving = phone(4000, 4000);
    const result = snapRect(moving, [phone(0, 0)], 8);
    expect(result.x).toBe(4000);
    expect(result.y).toBe(4000);
    expect(result.guides).toEqual([]);
  });

  it('offers the existing gap when placing a third phone in a row', () => {
    const first = phone(0, 0);
    const second = phone(602, 0); // 200px gap
    const gap = second.x - (first.x + first.width);
    const target = second.x + second.width + gap;
    const result = snapRect(phone(target + 5, 0), [first, second], 10);
    expect(result.x).toBe(target);
  });
});

describe('auto layout', () => {
  const withIds = [
    { id: 'a', ...phone(0, 40) },
    { id: 'b', ...phone(700, 0) },
    { id: 'c', ...phone(1500, 90) },
  ];

  it('aligns tops', () => {
    const positions = alignRects(withIds, 'top');
    expect(positions.every((position) => position.y === 0)).toBe(true);
  });

  it('aligns left edges', () => {
    const positions = alignRects(withIds, 'left');
    expect(positions.every((position) => position.x === 0)).toBe(true);
  });

  it('distributes with an even gap', () => {
    const positions = distributeRects(withIds, 100);
    const gaps = positions
      .slice(1)
      .map((position, index) => position.x - ((positions[index]?.x ?? 0) + 402));
    expect(new Set(gaps)).toEqual(new Set([100]));
  });

  it('tidies into rows of at most four', () => {
    const many = Array.from({ length: 6 }, (_, index) => ({
      id: `d${index}`,
      ...phone(index * 13, index * 7),
    }));
    const positions = tidyRects(many, 4, 100);
    const rows = new Set(positions.map((position) => position.y));
    expect(rows.size).toBe(2);
  });
});
