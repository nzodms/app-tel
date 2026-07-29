import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEVICE_PRESETS,
  DEFAULT_PRESET_ID,
  deviceGeometry,
  getPreset,
  isPresetId,
  isRotatable,
} from '@/lib/devices/presets';

/**
 * The device catalogue, and the one structural rule that keeps a preview alive.
 *
 * A sandboxed `<iframe>` reloads the instant the browser re-parents it. The
 * studio therefore renders exactly one screen element for every device family and
 * puts the preview in that — the chassis components draw the object around it and
 * nothing else. It is an easy invariant to break by accident (adding `children`
 * to a chassis reads like an improvement), and breaking it is invisible in the
 * type system and nearly invisible on screen: the app just quietly restarts when
 * you change format. So it is asserted here, against the source.
 */

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

describe('the chassis / display split', () => {
  it('keeps every chassis component free of children', () => {
    for (const file of ['components/studio/canvas/phone.tsx', 'components/studio/canvas/surface-chassis.tsx']) {
      const source = read(file);
      // Prose may discuss it; code may not use it.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, `${file} must not render children — the display is not its to hold`).not.toMatch(
        /\bchildren\b/,
      );
    }
  });

  it('puts the preview in exactly one component, whatever the family', () => {
    const node = read('components/studio/canvas/device-node.tsx');
    // One chassis element in the tree, and the preview goes through it.
    expect(node).toContain('<DeviceChassis');
    expect(node).not.toContain('<Phone');
    expect(node).not.toContain('<SurfaceChassis');

    // Slot 0 swaps by family; slot 1 is always DeviceScreen, so React keeps it —
    // asserted inside the component body, not against the header's diagram.
    const chassis = read('components/studio/canvas/device-chassis.tsx');
    const body = chassis.slice(chassis.indexOf('export function DeviceChassis('));
    const artAt = body.indexOf('isHandheld(preset) ? (');
    const screenAt = body.indexOf('<DeviceScreen');
    expect(artAt, 'the art slot').toBeGreaterThan(-1);
    expect(screenAt, 'the display slot').toBeGreaterThan(artAt);
  });

  it('renders the share page through the same component', () => {
    const reviewer = read('components/share/reviewer.tsx');
    expect(reviewer).toContain('<DeviceChassis');
    // A shared MacBook used to come out as a bezel-less phone slab.
    expect(reviewer).not.toContain('<Phone');
  });
});

describe('the preset catalogue', () => {
  it('covers every family the picker offers', () => {
    const families = new Set(DEVICE_PRESETS.map((preset) => preset.family));
    expect([...families].sort()).toEqual(['browser', 'desktop', 'laptop', 'phone', 'tablet']);
  });

  it('keeps the default a phone, and keeps it resolvable', () => {
    expect(isPresetId(DEFAULT_PRESET_ID)).toBe(true);
    expect(getPreset(DEFAULT_PRESET_ID).family).toBe('phone');
  });

  it('has unique ids and non-empty names', () => {
    const ids = DEVICE_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of DEVICE_PRESETS) {
      expect(preset.name.trim().length).toBeGreaterThan(0);
      expect(preset.viewport.width).toBeGreaterThan(0);
      expect(preset.viewport.height).toBeGreaterThan(0);
    }
  });

  it('turns handhelds and only handhelds', () => {
    for (const preset of DEVICE_PRESETS) {
      const handheld = preset.family === 'phone' || preset.family === 'tablet';
      expect(isRotatable(preset), `${preset.id}`).toBe(handheld);
    }
  });

  it('never claims system chrome a format does not have', () => {
    for (const preset of DEVICE_PRESETS) {
      if (preset.family === 'phone' || preset.family === 'tablet') continue;
      // A laptop with a clock and a battery meter drawn on it would be a lie,
      // and a notch cut out of a monitor would be a stranger one.
      expect(preset.statusBar, `${preset.id} status bar`).toBe('none');
      expect(preset.cutout.kind, `${preset.id} cutout`).toBe('none');
      expect(preset.homeIndicator, `${preset.id} home indicator`).toBe(false);
      expect(preset.buttons, `${preset.id} side buttons`).toEqual([]);
    }
  });
});

describe('geometry, for every preset and both orientations', () => {
  const cases = DEVICE_PRESETS.flatMap((preset) =>
    (['portrait', 'landscape'] as const).map((orientation) => ({ preset, orientation })),
  );

  it('keeps the display inside the object holding it', () => {
    for (const { preset, orientation } of cases) {
      const geometry = deviceGeometry(preset, orientation);
      const label = `${preset.id}/${orientation}`;
      expect(geometry.screenOrigin.x, `${label} left`).toBeGreaterThanOrEqual(0);
      expect(geometry.screenOrigin.y, `${label} top`).toBeGreaterThanOrEqual(0);
      expect(
        geometry.screenOrigin.x + geometry.screen.width,
        `${label} right`,
      ).toBeLessThanOrEqual(geometry.chassis.width);
      expect(
        geometry.screenOrigin.y + geometry.screen.height,
        `${label} bottom`,
      ).toBeLessThanOrEqual(geometry.chassis.height);
    }
  });

  it('gives the app exactly the viewport its preset promises', () => {
    for (const { preset, orientation } of cases) {
      const geometry = deviceGeometry(preset, orientation);
      const turned = orientation === 'landscape' && isRotatable(preset);
      const expected = turned
        ? { width: preset.viewport.height, height: preset.viewport.width }
        : preset.viewport;
      expect(geometry.screen, `${preset.id}/${orientation}`).toEqual(expected);
    }
  });

  it('ignores orientation on the formats that do not turn', () => {
    for (const preset of DEVICE_PRESETS.filter((entry) => !isRotatable(entry))) {
      expect(deviceGeometry(preset, 'landscape')).toEqual(deviceGeometry(preset, 'portrait'));
    }
  });

  it('leaves the handheld presets exactly where they were', () => {
    // Adding four families must not have moved a single existing phone: these are
    // the chassis sizes the canvas laid out against before the change.
    const before: Record<string, string> = {
      'iphone-17-pro': '427x899',
      'iphone-17-pro-max': '465x981',
      'iphone-compact': '399x836',
      'android-compact': '382x802',
      'android-large': '433x936',
      tablet: '866x1226',
    };
    for (const [id, size] of Object.entries(before)) {
      const geometry = deviceGeometry(getPreset(id), 'portrait');
      expect(`${geometry.chassis.width}x${geometry.chassis.height}`, id).toBe(size);
    }
  });
});
