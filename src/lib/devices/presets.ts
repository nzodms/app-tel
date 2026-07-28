/**
 * Device presets.
 *
 * These describe *test formats*, not products. Every frame in PhoneLab is drawn
 * from these numbers with CSS and SVG — there are no vendor assets, logos or
 * marketing images anywhere in this repo, and PhoneLab is not affiliated with or
 * endorsed by any device manufacturer. Preset names identify the viewport format
 * so you know what you are testing against; `formatNote` is surfaced in the UI.
 *
 * All lengths are in CSS pixels at 1× zoom, matching the logical (point) size of
 * the format, so a preview laid out at `viewport.width` is laid out exactly as it
 * would be on the real screen.
 */

export type DeviceFamily = 'ios' | 'android' | 'tablet';
export type CutoutKind = 'dynamic-island' | 'notch' | 'punch-hole' | 'none';
export type ChassisMaterial = 'titanium' | 'aluminium' | 'graphite' | 'ceramic';

export interface DeviceButton {
  id: string;
  side: 'left' | 'right';
  /** Distance from the top of the *chassis*. */
  top: number;
  length: number;
  /** How far the button protrudes past the rail. */
  thickness: number;
  label: string;
}

export interface DevicePreset {
  id: string;
  name: string;
  /** Short "what is this for" line shown next to the name. */
  formatNote: string;
  family: DeviceFamily;
  /** Logical viewport, portrait. */
  viewport: { width: number; height: number };
  /** Native pixels per logical pixel — reported to the app, not used for layout. */
  pixelRatio: number;
  /** Corner radius of the display itself. */
  screenRadius: number;
  /** Black border between display and rail. */
  bezel: number;
  /** Metal/plastic rail thickness outside the bezel. */
  rail: number;
  safeArea: { top: number; bottom: number };
  cutout: {
    kind: CutoutKind;
    width: number;
    height: number;
    /** Distance from the top edge of the *display*. */
    top: number;
    radius: number;
  };
  homeIndicator: boolean;
  material: ChassisMaterial;
  buttons: DeviceButton[];
  statusBar: 'ios' | 'android';
}

/* -------------------------------------------------------------------------- */

/**
 * iPhone 17 Pro — the reference preset, and the one tuned most carefully:
 * 402×874 logical points at 3×, 62pt display radius, Dynamic Island 125×36.5pt
 * sitting 11pt below the top of the display, 59/34pt safe areas.
 */
const IPHONE_17_PRO: DevicePreset = {
  id: 'iphone-17-pro',
  name: 'iPhone 17 Pro',
  formatNote: '6.3" · 402 × 874 pt · Dynamic Island',
  family: 'ios',
  viewport: { width: 402, height: 874 },
  pixelRatio: 3,
  screenRadius: 62,
  bezel: 4.5,
  rail: 8,
  safeArea: { top: 59, bottom: 34 },
  cutout: { kind: 'dynamic-island', width: 125, height: 36.5, top: 11, radius: 18.25 },
  homeIndicator: true,
  material: 'titanium',
  buttons: [
    { id: 'action', side: 'left', top: 168, length: 32, thickness: 2.5, label: 'Action' },
    { id: 'volume-up', side: 'left', top: 228, length: 64, thickness: 2.5, label: 'Volume up' },
    { id: 'volume-down', side: 'left', top: 304, length: 64, thickness: 2.5, label: 'Volume down' },
    { id: 'side', side: 'right', top: 236, length: 100, thickness: 2.5, label: 'Side' },
    { id: 'camera', side: 'right', top: 386, length: 44, thickness: 2.5, label: 'Camera control' },
  ],
  statusBar: 'ios',
};

const IPHONE_17_PRO_MAX: DevicePreset = {
  id: 'iphone-17-pro-max',
  name: 'iPhone 17 Pro Max',
  formatNote: '6.9" · 440 × 956 pt · Dynamic Island',
  family: 'ios',
  viewport: { width: 440, height: 956 },
  pixelRatio: 3,
  screenRadius: 66,
  bezel: 4.5,
  rail: 8,
  safeArea: { top: 62, bottom: 34 },
  cutout: { kind: 'dynamic-island', width: 125, height: 36.5, top: 11, radius: 18.25 },
  homeIndicator: true,
  material: 'titanium',
  buttons: [
    { id: 'action', side: 'left', top: 180, length: 32, thickness: 2.5, label: 'Action' },
    { id: 'volume-up', side: 'left', top: 244, length: 68, thickness: 2.5, label: 'Volume up' },
    { id: 'volume-down', side: 'left', top: 324, length: 68, thickness: 2.5, label: 'Volume down' },
    { id: 'side', side: 'right', top: 254, length: 108, thickness: 2.5, label: 'Side' },
    { id: 'camera', side: 'right', top: 416, length: 46, thickness: 2.5, label: 'Camera control' },
  ],
  statusBar: 'ios',
};

const IPHONE_COMPACT: DevicePreset = {
  id: 'iphone-compact',
  name: 'Compact iPhone',
  formatNote: '5.4"–5.8" · 375 × 812 pt · notch',
  family: 'ios',
  viewport: { width: 375, height: 812 },
  pixelRatio: 3,
  screenRadius: 44,
  bezel: 5,
  rail: 7,
  safeArea: { top: 44, bottom: 34 },
  cutout: { kind: 'notch', width: 209, height: 30, top: 0, radius: 20 },
  homeIndicator: true,
  material: 'aluminium',
  buttons: [
    { id: 'mute', side: 'left', top: 150, length: 24, thickness: 2, label: 'Mute' },
    { id: 'volume-up', side: 'left', top: 196, length: 56, thickness: 2, label: 'Volume up' },
    { id: 'volume-down', side: 'left', top: 262, length: 56, thickness: 2, label: 'Volume down' },
    { id: 'side', side: 'right', top: 208, length: 86, thickness: 2, label: 'Side' },
  ],
  statusBar: 'ios',
};

const ANDROID_COMPACT: DevicePreset = {
  id: 'android-compact',
  name: 'Android compact',
  formatNote: '6.1" · 360 × 780 dp · punch-hole',
  family: 'android',
  viewport: { width: 360, height: 780 },
  pixelRatio: 3,
  screenRadius: 34,
  bezel: 5,
  rail: 6,
  safeArea: { top: 28, bottom: 22 },
  cutout: { kind: 'punch-hole', width: 22, height: 22, top: 12, radius: 11 },
  homeIndicator: true,
  material: 'graphite',
  buttons: [
    { id: 'power', side: 'right', top: 200, length: 52, thickness: 2.5, label: 'Power' },
    { id: 'volume', side: 'right', top: 268, length: 92, thickness: 2.5, label: 'Volume' },
  ],
  statusBar: 'android',
};

const ANDROID_LARGE: DevicePreset = {
  id: 'android-large',
  name: 'Android large',
  formatNote: '6.8" · 412 × 915 dp · punch-hole',
  family: 'android',
  viewport: { width: 412, height: 915 },
  pixelRatio: 2.625,
  screenRadius: 38,
  bezel: 4.5,
  rail: 6,
  safeArea: { top: 30, bottom: 24 },
  cutout: { kind: 'punch-hole', width: 24, height: 24, top: 13, radius: 12 },
  homeIndicator: true,
  material: 'graphite',
  buttons: [
    { id: 'power', side: 'right', top: 232, length: 54, thickness: 2.5, label: 'Power' },
    { id: 'volume', side: 'right', top: 302, length: 100, thickness: 2.5, label: 'Volume' },
  ],
  statusBar: 'android',
};

const TABLET: DevicePreset = {
  id: 'tablet',
  name: 'Tablet',
  formatNote: '11" · 820 × 1180 pt · no cutout',
  family: 'tablet',
  viewport: { width: 820, height: 1180 },
  pixelRatio: 2,
  screenRadius: 22,
  bezel: 16,
  rail: 7,
  safeArea: { top: 24, bottom: 20 },
  cutout: { kind: 'none', width: 0, height: 0, top: 0, radius: 0 },
  homeIndicator: true,
  material: 'aluminium',
  buttons: [
    { id: 'power', side: 'right', top: 40, length: 60, thickness: 2, label: 'Power' },
    { id: 'volume', side: 'right', top: 130, length: 100, thickness: 2, label: 'Volume' },
  ],
  statusBar: 'ios',
};

export const DEVICE_PRESETS: readonly DevicePreset[] = [
  IPHONE_17_PRO,
  IPHONE_17_PRO_MAX,
  IPHONE_COMPACT,
  ANDROID_COMPACT,
  ANDROID_LARGE,
  TABLET,
];

export const DEFAULT_PRESET_ID = IPHONE_17_PRO.id;

const BY_ID = new Map(DEVICE_PRESETS.map((preset) => [preset.id, preset]));

export function getPreset(id: string): DevicePreset {
  return BY_ID.get(id) ?? IPHONE_17_PRO;
}

export function isPresetId(id: string): boolean {
  return BY_ID.has(id);
}

/* -------------------------------------------------------------------------- */
/* Derived geometry                                                            */
/* -------------------------------------------------------------------------- */

export interface DeviceGeometry {
  /** Logical viewport handed to the preview, after orientation. */
  screen: { width: number; height: number };
  /** Full chassis footprint including bezel and rail. */
  chassis: { width: number; height: number };
  inset: number;
  outerRadius: number;
  screenRadius: number;
  safeArea: { top: number; bottom: number };
  landscape: boolean;
}

/**
 * Resolves a preset + orientation into the numbers the phone component draws
 * with. Rotating swaps the viewport and moves the safe areas: in landscape the
 * cutout sits on a side, so the top inset collapses to the status-bar height.
 */
export function deviceGeometry(
  preset: DevicePreset,
  orientation: 'portrait' | 'landscape',
): DeviceGeometry {
  const landscape = orientation === 'landscape';
  const screen = landscape
    ? { width: preset.viewport.height, height: preset.viewport.width }
    : { width: preset.viewport.width, height: preset.viewport.height };

  const inset = preset.bezel + preset.rail;
  const safeArea = landscape
    ? { top: preset.family === 'ios' ? 0 : preset.safeArea.top, bottom: preset.homeIndicator ? 21 : 0 }
    : { top: preset.safeArea.top, bottom: preset.safeArea.bottom };

  return {
    screen,
    chassis: { width: screen.width + inset * 2, height: screen.height + inset * 2 },
    inset,
    outerRadius: preset.screenRadius + inset,
    screenRadius: preset.screenRadius,
    safeArea,
    landscape,
  };
}
