import { describe, expect, it } from 'vitest';
import {
  LAYOUT_PRESETS,
  ROLE_JOURNEY_SEQUENCE,
  arrangeDevices,
  needsArrange,
  type DeviceRect,
  type DevicePosition,
  type LayoutPreset,
} from '@/lib/devices/layout';
import { deviceGeometry, getPreset } from '@/lib/devices/presets';
import { boundingBox, type Rect } from '@/components/studio/canvas/geometry';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const PHONE = deviceGeometry(getPreset('iphone-17-pro'), 'portrait').chassis;
const LANDSCAPE = deviceGeometry(getPreset('iphone-17-pro'), 'landscape').chassis;
const TABLET = deviceGeometry(getPreset('tablet'), 'portrait').chassis;

function device(id: string, role?: string, size = PHONE): DeviceRect {
  return role === undefined
    ? { id, width: size.width, height: size.height }
    : { id, role, width: size.width, height: size.height };
}

function phones(count: number): DeviceRect[] {
  return Array.from({ length: count }, (_, index) => device(`d${index}`));
}

/** Turns positions back into rects, using the sizes they were arranged from. */
function toRects(devices: readonly DeviceRect[], positions: readonly DevicePosition[]): Rect[] {
  const sizes = new Map(devices.map((entry) => [entry.id, entry]));
  return positions.map((position) => {
    const size = sizes.get(position.id);
    if (!size) throw new Error(`arrangeDevices returned an unknown id: ${position.id}`);
    return { x: position.x, y: position.y, width: size.width, height: size.height };
  });
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}

function expectNoOverlap(rects: readonly Rect[]): void {
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i];
      const b = rects[j];
      if (!a || !b) throw new Error('missing rect');
      expect(overlaps(a, b), `rect ${i} overlaps rect ${j}`).toBe(false);
    }
  }
}

function orderOf(positions: readonly DevicePosition[]): string[] {
  return [...positions].sort((a, b) => a.x - b.x || a.y - b.y).map((position) => position.id);
}

/** Positions are rounded to integers, so centres can land half a pixel off. */
function expectSameWithinRounding(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.5);
}

function at(positions: readonly DevicePosition[], id: string): DevicePosition {
  const found = positions.find((position) => position.id === id);
  if (!found) throw new Error(`no position for ${id}`);
  return found;
}

/* -------------------------------------------------------------------------- */

describe('layout presets catalogue', () => {
  it('lists every preset exactly once, with a label and a hint', () => {
    const ids = LAYOUT_PRESETS.map((preset) => preset.id);
    const expected: LayoutPreset[] = [
      'side-by-side',
      'user-journey',
      'grid',
      'compare',
      'roles',
      'free',
    ];
    expect([...ids].sort()).toEqual([...expected].sort());
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of LAYOUT_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.hint.length).toBeGreaterThan(0);
    }
  });
});

describe('default arrangement', () => {
  it('returns nothing for an empty canvas', () => {
    expect(arrangeDevices({ devices: [] })).toEqual([]);
  });

  it('centres a single device on the origin', () => {
    const devices = phones(1);
    const positions = arrangeDevices({ devices });
    expect(positions).toHaveLength(1);
    const only = at(positions, 'd0');
    expectSameWithinRounding(only.x + PHONE.width / 2, 0);
    expectSameWithinRounding(only.y + PHONE.height / 2, 0);
  });

  it('honours a custom origin', () => {
    const positions = arrangeDevices({ devices: phones(1), origin: { x: 1200, y: -400 } });
    const only = at(positions, 'd0');
    expectSameWithinRounding(only.x + PHONE.width / 2, 1200);
    expectSameWithinRounding(only.y + PHONE.height / 2, -400);
  });

  it.each([1, 2, 3, 4])('produces non-overlapping rects for %i devices', (count) => {
    const devices = phones(count);
    const positions = arrangeDevices({ devices });
    expect(positions).toHaveLength(count);
    expectNoOverlap(toRects(devices, positions));
  });

  it.each([5, 6, 7, 8, 12])('produces non-overlapping rects for %i devices', (count) => {
    const devices = phones(count);
    expectNoOverlap(toRects(devices, arrangeDevices({ devices })));
  });

  it('puts two devices side by side, vertically aligned', () => {
    const devices = phones(2);
    const positions = arrangeDevices({ devices });
    const [first, second] = orderOf(positions);
    expect(first).toBe('d0');
    expect(second).toBe('d1');
    expect(at(positions, 'd0').y).toBe(at(positions, 'd1').y);
  });

  it('separates a pair by a gap proportional to the device width', () => {
    for (const size of [PHONE, TABLET]) {
      const devices = [device('a', undefined, size), device('b', undefined, size)];
      const positions = arrangeDevices({ devices });
      const gap = at(positions, 'b').x - (at(positions, 'a').x + size.width);
      // Wide enough to read as two devices, tight enough to read as one pair.
      expect(gap).toBeGreaterThan(size.width * 0.15);
      expect(gap).toBeLessThan(size.width * 0.6);
    }
  });

  it('keeps three portrait phones on one row', () => {
    const devices = phones(3);
    const positions = arrangeDevices({ devices });
    expect(new Set(positions.map((position) => position.y)).size).toBe(1);
    expectNoOverlap(toRects(devices, positions));
  });

  it('falls back to a balanced triangle when a row of three would be too wide', () => {
    const devices = [
      device('customer', 'customer', LANDSCAPE),
      device('provider', 'provider', LANDSCAPE),
      device('admin', 'admin', LANDSCAPE),
    ];
    const positions = arrangeDevices({ devices });
    const rows = new Set(positions.map((position) => position.y));
    expect(rows.size).toBe(2);
    expectNoOverlap(toRects(devices, positions));

    // Two behind, the primary (first role along the journey) in front and centred.
    const back = positions.filter((position) => position.id !== 'customer');
    const front = at(positions, 'customer');
    expect(back).toHaveLength(2);
    expect(back[0]?.y).toBe(back[1]?.y);
    expect(front.y).toBeGreaterThan(back[0]?.y ?? 0);

    const backCentre =
      (Math.min(...back.map((position) => position.x)) +
        Math.max(...back.map((position) => position.x)) +
        LANDSCAPE.width) /
      2;
    expectSameWithinRounding(front.x + LANDSCAPE.width / 2, backCentre);
  });

  it('leads with the primary by a quarter of the row gap, never enough to overlap', () => {
    const devices = [
      device('a', 'guest', LANDSCAPE),
      device('b', 'admin', LANDSCAPE),
      device('c', 'customer', LANDSCAPE),
    ];
    const positions = arrangeDevices({ devices });
    const front = at(positions, 'c');
    const backBottom = (at(positions, 'a').y ?? 0) + LANDSCAPE.height;
    const rowGap = Math.max(40, Math.round(LANDSCAPE.height * 0.14));
    const clearance = front.y - backBottom;
    expect(clearance).toBeGreaterThan(0);
    expectSameWithinRounding(clearance, rowGap - Math.round(rowGap * 0.25));
  });

  it('grids four or more devices without turning into a long strip', () => {
    const devices = phones(12);
    const positions = arrangeDevices({ devices });
    const bounds = boundingBox(toRects(devices, positions));
    const aspect = bounds.width / bounds.height;
    expect(aspect).toBeGreaterThan(0.6);
    expect(aspect).toBeLessThan(3);
    expect(new Set(positions.map((position) => position.x)).size).toBe(6);
    expect(new Set(positions.map((position) => position.y)).size).toBe(2);
  });

  it('keeps constant spacing in the grid', () => {
    const devices = phones(8);
    const positions = arrangeDevices({ devices });
    const columns = [...new Set(positions.map((position) => position.x))].sort((a, b) => a - b);
    const gaps = columns.slice(1).map((x, index) => x - (columns[index] ?? 0));
    expect(new Set(gaps).size).toBe(1);
  });

  it('never overlaps when device sizes are mixed', () => {
    const devices = [
      device('a', 'customer', PHONE),
      device('b', 'provider', TABLET),
      device('c', 'admin', LANDSCAPE),
      device('d', 'support', PHONE),
      device('e', 'guest', TABLET),
    ];
    expectNoOverlap(toRects(devices, arrangeDevices({ devices })));
  });
});

describe('preset: side-by-side', () => {
  it('lays every device out on one row, vertically aligned', () => {
    const devices = phones(5);
    const positions = arrangeDevices({ devices, preset: 'side-by-side' });
    expect(new Set(positions.map((position) => position.y)).size).toBe(1);
    expect(orderOf(positions)).toEqual(['d0', 'd1', 'd2', 'd3', 'd4']);
    expectNoOverlap(toRects(devices, positions));
  });

  it('aligns vertical centres when heights differ', () => {
    const devices = [device('a', undefined, PHONE), device('b', undefined, LANDSCAPE)];
    const positions = arrangeDevices({ devices, preset: 'side-by-side' });
    const centreA = at(positions, 'a').y + PHONE.height / 2;
    const centreB = at(positions, 'b').y + LANDSCAPE.height / 2;
    expectSameWithinRounding(centreA, centreB);
  });
});

describe('preset: user-journey', () => {
  it('orders roles along the journey regardless of input order', () => {
    const devices = [
      device('s', 'support'),
      device('a', 'admin'),
      device('p', 'provider'),
      device('c', 'customer'),
    ];
    const positions = arrangeDevices({ devices, preset: 'user-journey' });
    expect(orderOf(positions)).toEqual(['c', 'p', 'a', 's']);
    expect(new Set(positions.map((position) => position.y)).size).toBe(1);
  });

  it('understands role names it has never seen, by stage keyword', () => {
    const devices = [
      device('ops', 'back-office'),
      device('rider', 'delivery-driver'),
      device('buyer', 'shopper'),
      device('watch', 'read-only-viewer'),
    ];
    const positions = arrangeDevices({ devices, preset: 'user-journey' });
    expect(orderOf(positions)).toEqual(['buyer', 'rider', 'ops', 'watch']);
  });

  it('resolves compound slugs by the most specific keyword', () => {
    const devices = [device('su', 'super-admin'), device('cu', 'customer')];
    const positions = arrangeDevices({ devices, preset: 'user-journey' });
    expect(orderOf(positions)).toEqual(['cu', 'su']);
  });

  it('appends unknown roles after known ones, in their original order', () => {
    const devices = [
      device('z', 'zorb'),
      device('y', 'wibble'),
      device('a', 'admin'),
      device('c', 'customer'),
      device('n'),
    ];
    const positions = arrangeDevices({ devices, preset: 'user-journey' });
    expect(orderOf(positions)).toEqual(['c', 'a', 'z', 'y', 'n']);
  });

  it('keeps devices of entirely custom roles in their original order', () => {
    const devices = [device('a', 'alpha'), device('b', 'beta'), device('c', 'gamma')];
    const positions = arrangeDevices({ devices, preset: 'user-journey' });
    expect(orderOf(positions)).toEqual(['a', 'b', 'c']);
  });

  it('lets a project declare its own role order', () => {
    const devices = [device('c', 'customer'), device('w', 'warehouse'), device('a', 'admin')];
    const positions = arrangeDevices({
      devices,
      preset: 'user-journey',
      roleOrder: ['warehouse', 'admin', 'customer'],
    });
    expect(orderOf(positions)).toEqual(['w', 'a', 'c']);
  });

  it('declares a journey sequence with no empty stages', () => {
    expect(ROLE_JOURNEY_SEQUENCE.length).toBeGreaterThan(1);
    for (const stage of ROLE_JOURNEY_SEQUENCE) expect(stage.length).toBeGreaterThan(0);
  });
});

describe('preset: compare', () => {
  it('uses exactly two columns', () => {
    const devices = phones(2);
    const positions = arrangeDevices({ devices, preset: 'compare' });
    expect(new Set(positions.map((position) => position.x)).size).toBe(2);
    expect(new Set(positions.map((position) => position.y)).size).toBe(1);
  });

  it('stacks extra devices below, staying in the same two columns', () => {
    const devices = phones(5);
    const positions = arrangeDevices({ devices, preset: 'compare' });
    const columns = new Set(positions.map((position) => position.x));
    expect(columns.size).toBe(2);
    expect(new Set(positions.map((position) => position.y)).size).toBe(3);
    expect(at(positions, 'd0').x).toBe(at(positions, 'd2').x);
    expect(at(positions, 'd1').x).toBe(at(positions, 'd3').x);
    expectNoOverlap(toRects(devices, positions));
  });

  it('does not invent a second column for a single device', () => {
    const positions = arrangeDevices({ devices: phones(1), preset: 'compare' });
    expect(positions).toHaveLength(1);
  });
});

describe('preset: roles', () => {
  it('gives each role its own column and stacks that role vertically', () => {
    const devices = [
      device('c1', 'customer'),
      device('p1', 'provider'),
      device('c2', 'customer'),
      device('p2', 'provider'),
      device('a1', 'admin'),
    ];
    const positions = arrangeDevices({ devices, preset: 'roles' });
    expect(new Set(positions.map((position) => position.x)).size).toBe(3);
    expect(at(positions, 'c1').x).toBe(at(positions, 'c2').x);
    expect(at(positions, 'p1').x).toBe(at(positions, 'p2').x);
    expect(at(positions, 'c1').x).toBeLessThan(at(positions, 'p1').x);
    expect(at(positions, 'p1').x).toBeLessThan(at(positions, 'a1').x);
    expect(at(positions, 'c2').y).toBeGreaterThan(at(positions, 'c1').y);
    expectNoOverlap(toRects(devices, positions));
  });

  it('treats different spellings of one role as one column', () => {
    const devices = [device('a', 'Customer'), device('b', 'customer'), device('c', 'admin')];
    const positions = arrangeDevices({ devices, preset: 'roles' });
    expect(at(positions, 'a').x).toBe(at(positions, 'b').x);
    expect(new Set(positions.map((position) => position.x)).size).toBe(2);
  });
});

describe('preset: grid', () => {
  it('grids any count, including small ones', () => {
    for (const count of [1, 2, 3, 6, 9]) {
      const devices = phones(count);
      const positions = arrangeDevices({ devices, preset: 'grid' });
      expect(positions).toHaveLength(count);
      expectNoOverlap(toRects(devices, positions));
    }
  });
});

describe('preset: free', () => {
  it('is a no-op whatever the devices are doing', () => {
    expect(arrangeDevices({ devices: phones(4), preset: 'free' })).toEqual([]);
    expect(
      arrangeDevices({
        devices: [
          { id: 'a', x: 0, y: 0, width: 100, height: 200 },
          { id: 'b', x: 0, y: 0, width: 100, height: 200 },
        ],
        preset: 'free',
      }),
    ).toEqual([]);
  });
});

describe('determinism', () => {
  it('is idempotent: arranging twice changes nothing', () => {
    const presets: (LayoutPreset | undefined)[] = [
      undefined,
      'side-by-side',
      'user-journey',
      'grid',
      'compare',
      'roles',
    ];
    const base = [
      device('c', 'customer'),
      device('p', 'provider'),
      device('a', 'admin'),
      device('g', 'guest'),
      device('x', 'mystery-role'),
    ];

    for (const preset of presets) {
      const first = preset ? arrangeDevices({ devices: base, preset }) : arrangeDevices({ devices: base });
      const moved = base.map((entry) => {
        const position = at(first, entry.id);
        return { ...entry, x: position.x, y: position.y };
      });
      const second = preset
        ? arrangeDevices({ devices: moved, preset })
        : arrangeDevices({ devices: moved });
      expect(second).toEqual(first);
    }
  });

  it('returns the same result for the same input, every time', () => {
    const devices = phones(7);
    const runs = Array.from({ length: 3 }, () => arrangeDevices({ devices }));
    expect(runs[1]).toEqual(runs[0]);
    expect(runs[2]).toEqual(runs[0]);
  });

  it('returns integer positions', () => {
    const devices = [device('a', 'customer', PHONE), device('b', 'provider', TABLET)];
    for (const position of arrangeDevices({ devices })) {
      expect(Number.isInteger(position.x)).toBe(true);
      expect(Number.isInteger(position.y)).toBe(true);
    }
  });
});

describe('needsArrange', () => {
  it('is false for nothing and for a lone device, wherever it sits', () => {
    expect(needsArrange([])).toBe(false);
    expect(needsArrange([{ id: 'a', x: 9000, y: -4000, ...PHONE }])).toBe(false);
  });

  it('is true when every device is stacked on the same point', () => {
    const stacked = phones(4).map((entry) => ({ ...entry, x: 0, y: 0 }));
    expect(needsArrange(stacked)).toBe(true);
  });

  it('is true when devices have never been positioned at all', () => {
    expect(needsArrange(phones(3))).toBe(true);
  });

  it('is true when devices overlap substantially', () => {
    expect(
      needsArrange([
        { id: 'a', x: 0, y: 0, ...PHONE },
        { id: 'b', x: 40, y: 30, ...PHONE },
      ]),
    ).toBe(true);
  });

  it('is false for a deliberate, spread-out layout', () => {
    const devices: DeviceRect[] = [
      { id: 'a', x: -1400, y: -600, ...PHONE },
      { id: 'b', x: 200, y: -600, ...PHONE },
      { id: 'c', x: -600, y: 900, ...PHONE },
    ];
    expect(needsArrange(devices)).toBe(false);
  });

  it('is false for a generously spaced row a person clearly chose', () => {
    const devices = phones(4).map((entry, index) => ({
      ...entry,
      x: index * (PHONE.width + 700),
      y: 0,
    }));
    expect(needsArrange(devices)).toBe(false);
  });

  it('is false for devices merely touching or barely overlapping', () => {
    expect(
      needsArrange([
        { id: 'a', x: 0, y: 0, ...PHONE },
        { id: 'b', x: PHONE.width, y: 0, ...PHONE },
      ]),
    ).toBe(false);
    expect(
      needsArrange([
        { id: 'a', x: 0, y: 0, ...PHONE },
        { id: 'b', x: PHONE.width - 6, y: 0, ...PHONE },
      ]),
    ).toBe(false);
  });

  it('is true when devices are scattered absurdly far apart', () => {
    expect(
      needsArrange([
        { id: 'a', x: 0, y: 0, ...PHONE },
        { id: 'b', x: 90_000, y: 0, ...PHONE },
      ]),
    ).toBe(true);
  });

  it('is true for positions that are not real numbers', () => {
    expect(
      needsArrange([
        { id: 'a', x: Number.NaN, y: 0, ...PHONE },
        { id: 'b', x: 800, y: 0, ...PHONE },
      ]),
    ).toBe(true);
  });

  it('is false again once the devices have been arranged', () => {
    for (const count of [2, 3, 4, 6, 9]) {
      const devices = phones(count).map((entry) => ({ ...entry, x: 0, y: 0 }));
      expect(needsArrange(devices)).toBe(true);
      const positions = arrangeDevices({ devices });
      const arranged = devices.map((entry) => {
        const position = at(positions, entry.id);
        return { ...entry, x: position.x, y: position.y };
      });
      expect(needsArrange(arranged), `count ${count}`).toBe(false);
    }
  });
});

describe('purity', () => {
  it('never mutates the devices it is given', () => {
    const devices: DeviceRect[] = [
      { id: 'a', role: 'support', x: 10, y: 20, width: PHONE.width, height: PHONE.height },
      { id: 'b', role: 'customer', x: 30, y: 40, width: PHONE.width, height: PHONE.height },
      { id: 'c', role: 'provider', x: 50, y: 60, width: TABLET.width, height: TABLET.height },
    ];
    const before = JSON.stringify(devices);
    const frozen = Object.freeze(devices.map((entry) => Object.freeze({ ...entry })));

    const presets: (LayoutPreset | undefined)[] = [
      undefined,
      'side-by-side',
      'user-journey',
      'grid',
      'compare',
      'roles',
      'free',
    ];
    for (const preset of presets) {
      if (preset) arrangeDevices({ devices: frozen, preset });
      else arrangeDevices({ devices: frozen });
    }
    needsArrange(frozen);

    expect(JSON.stringify(devices)).toBe(before);
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it('does not hand back the objects it was given', () => {
    const devices = phones(3);
    const positions = arrangeDevices({ devices });
    for (const position of positions) {
      expect(devices).not.toContain(position);
    }
  });

  it('leaves the input order alone even when it lays devices out in another', () => {
    const devices = [device('s', 'support'), device('c', 'customer')];
    const ids = devices.map((entry) => entry.id);
    arrangeDevices({ devices, preset: 'user-journey' });
    expect(devices.map((entry) => entry.id)).toEqual(ids);
  });
});
