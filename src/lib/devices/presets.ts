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
 *
 * A preset's `family` says what shape it is, and therefore which component draws
 * it: handhelds are drawn by `phone.tsx`, and the larger formats — tablet slabs,
 * laptops, desktop and browser windows — by `surface-chassis.tsx`. Both read the
 * same geometry from `deviceGeometry()`, so a preview is the same logical size
 * whichever one is holding it.
 */

/**
 * Form factor — the shape of the thing, never its operating system.
 *
 * This is what decides which chassis draws the format: `phone` and `tablet` are
 * objects with a rail, a bezel and side buttons (`phone.tsx`); `laptop` has a lid
 * and a base; `desktop` and `browser` are windows with a title bar
 * (`surface-chassis.tsx`). Which system chrome a format runs is a separate
 * question, answered by `statusBar`.
 */
export type DeviceFamily = 'phone' | 'tablet' | 'laptop' | 'desktop' | 'browser';
export type CutoutKind = 'dynamic-island' | 'notch' | 'punch-hole' | 'none';
export type ChassisMaterial = 'titanium' | 'aluminium' | 'graphite' | 'ceramic';

/**
 * Which mobile status bar the format shows. `none` is the honest answer for a
 * laptop or a window — they have no status bar to simulate, and claiming `ios`
 * would put a clock and a battery meter on a MacBook.
 */
export type StatusBarStyle = 'ios' | 'android' | 'none';

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
  /** Corner radius of the display itself. On a window, the radius of its frame. */
  screenRadius: number;
  /** Black border between display and rail. `0` on a window: it has no bezel. */
  bezel: number;
  /** Metal/plastic rail thickness outside the bezel; on a window, its frame. */
  rail: number;
  /**
   * Insets the system reserves at the top and bottom of the *display*. A format
   * with nothing reserved — every laptop, every window — says `0`, rather than
   * borrowing a phone's 44/34 and pushing the app around for no reason.
   */
  safeArea: { top: number; bottom: number };
  /**
   * Camera cutout. A format that has none — every tablet, every laptop, every
   * window — sets `kind: 'none'` with zero dimensions, and that is the whole
   * mechanism: nothing anywhere invents an island for a device without one.
   */
  cutout: {
    kind: CutoutKind;
    width: number;
    height: number;
    /** Distance from the top edge of the *display*. */
    top: number;
    radius: number;
  };
  /** Gesture bar at the bottom of the display. False on laptops and windows. */
  homeIndicator: boolean;
  /**
   * Finish of the drawn chassis. Read by the families that *have* a chassis
   * (phone, tablet, laptop); the window families draw OS chrome from the palette
   * instead and never look at it.
   */
  material: ChassisMaterial;
  /** Physical side buttons. Empty on every family that has none to draw. */
  buttons: DeviceButton[];
  statusBar: StatusBarStyle;
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
  family: 'phone',
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
  family: 'phone',
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
  family: 'phone',
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
  family: 'phone',
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
  family: 'phone',
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

/**
 * Large tablet — 1024 × 1366 pt at 2×.
 *
 * The 12.9"/13" iPad format, unchanged across every generation of it: 2732×2048
 * native at 2×, so 1024×1366 points. It earns its place next to the 820-point
 * `TABLET` above because in landscape it is 1366 wide — the first format in this
 * list where a two-column back office lays out the way it will on a laptop.
 * 24/20pt safe areas, gesture bar, and no cutout of any kind.
 */
const TABLET_LARGE: DevicePreset = {
  id: 'ipad-pro-13',
  name: 'iPad Pro 13"',
  formatNote: '13" · 1024 × 1366 pt · no cutout',
  family: 'tablet',
  viewport: { width: 1024, height: 1366 },
  pixelRatio: 2,
  screenRadius: 20,
  bezel: 14,
  rail: 6,
  safeArea: { top: 24, bottom: 20 },
  cutout: { kind: 'none', width: 0, height: 0, top: 0, radius: 0 },
  homeIndicator: true,
  material: 'aluminium',
  buttons: [
    { id: 'power', side: 'right', top: 46, length: 64, thickness: 2, label: 'Power' },
    { id: 'volume', side: 'right', top: 150, length: 108, thickness: 2, label: 'Volume' },
  ],
  statusBar: 'ios',
};

/**
 * Laptop — 1440 × 900 pt at 2×.
 *
 * The default "looks like" resolution macOS ships on the 13" MacBook Air and the
 * 13" MacBook Pro (2560×1600 panel, rendered at 2× and scaled), and one of the
 * most common laptop viewports on the web. It is deliberately the notch-free
 * generation of that format: the later 14"/16" machines put a camera housing in
 * the menu-bar strip, and the honest way to say "this lid has no cutout" is to
 * pick a format that has none rather than to draw one and pretend.
 *
 * Nothing here is phone furniture — no cutout, no gesture bar, no status bar, no
 * side buttons, and no reserved safe area. A laptop app owns all 900 points.
 */
const LAPTOP: DevicePreset = {
  id: 'macbook-air-13',
  name: 'MacBook Air 13"',
  formatNote: '13" · 1440 × 900 pt · no cutout',
  family: 'laptop',
  viewport: { width: 1440, height: 900 },
  pixelRatio: 2,
  screenRadius: 4,
  bezel: 8,
  rail: 5,
  safeArea: { top: 0, bottom: 0 },
  cutout: { kind: 'none', width: 0, height: 0, top: 0, radius: 0 },
  homeIndicator: false,
  material: 'aluminium',
  buttons: [],
  statusBar: 'none',
};

/**
 * Desktop — 1920 × 1080 px at 1×.
 *
 * 16:9, and the most common desktop display resolution there is; at the 100%
 * scaling those monitors ship with, the logical viewport is the panel. Drawn as a
 * maximised application window, so `viewport` is the app's content area and the
 * title bar is chassis, not screen.
 */
const DESKTOP: DevicePreset = {
  id: 'desktop',
  name: 'Desktop',
  formatNote: '1920 × 1080 px · 16:9 · app window',
  family: 'desktop',
  viewport: { width: 1920, height: 1080 },
  pixelRatio: 1,
  screenRadius: 10,
  bezel: 0,
  rail: 1,
  safeArea: { top: 0, bottom: 0 },
  cutout: { kind: 'none', width: 0, height: 0, top: 0, radius: 0 },
  homeIndicator: false,
  material: 'graphite',
  buttons: [],
  statusBar: 'none',
};

/**
 * Browser window — 1280 × 720 px at 1×.
 *
 * A window, not a screen: 1280×720 is the default viewport Playwright and the
 * common headless runners use, and it is what a browser occupies when it is not
 * filling a 1080p display. Two thirds the width of `DESKTOP`, which is the point
 * — it is the format that catches a layout that only survives at full width.
 */
const BROWSER: DevicePreset = {
  id: 'browser-window',
  name: 'Browser window',
  formatNote: '1280 × 720 px · windowed',
  family: 'browser',
  viewport: { width: 1280, height: 720 },
  pixelRatio: 1,
  screenRadius: 10,
  bezel: 0,
  rail: 1,
  safeArea: { top: 0, bottom: 0 },
  cutout: { kind: 'none', width: 0, height: 0, top: 0, radius: 0 },
  homeIndicator: false,
  material: 'graphite',
  buttons: [],
  statusBar: 'none',
};

export const DEVICE_PRESETS: readonly DevicePreset[] = [
  IPHONE_17_PRO,
  IPHONE_17_PRO_MAX,
  IPHONE_COMPACT,
  ANDROID_COMPACT,
  ANDROID_LARGE,
  TABLET,
  TABLET_LARGE,
  LAPTOP,
  DESKTOP,
  BROWSER,
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

/**
 * Chassis furniture that is neither bezel nor rail: a window's title bar, a
 * browser's address bar, a laptop's base and the flare of its deck past the lid.
 * Measured outward from the bezel+rail box, and zero on every handheld — which is
 * why adding it changed no phone or tablet by a pixel.
 */
export interface ChassisChrome {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const NO_CHROME: ChassisChrome = { top: 0, right: 0, bottom: 0, left: 0 };

/** Plain window title bar: tall enough for a 10px dot row and nothing else. */
export const WINDOW_TITLE_BAR = 28;
/** The strip a browser adds under the title bar for its address field. */
export const BROWSER_ADDRESS_BAR = 38;

/**
 * The laptop base, as a share of the lid width, clamped so an unusually small or
 * large format still reads as a laptop. Proportional rather than fixed because
 * the deck has to stay in scale with the lid it belongs to; rounded to whole
 * pixels because every structural length on the canvas is (see `phone.tsx` on
 * zoom stability).
 */
const LAPTOP_BASE_RATIO = 0.028;
const LAPTOP_FLARE_RATIO = 0.012;

function clampRound(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)));
}

/**
 * Families that can be rotated. A phone and a tablet turn; a laptop, a monitor
 * and a browser window do not, so asking for landscape on one of those returns
 * its native format rather than an imaginary portrait MacBook.
 */
const ROTATABLE: Record<DeviceFamily, boolean> = {
  phone: true,
  tablet: true,
  laptop: false,
  desktop: false,
  browser: false,
};

export function isRotatable(preset: DevicePreset): boolean {
  return ROTATABLE[preset.family];
}

function chassisChrome(preset: DevicePreset, bodyWidth: number): ChassisChrome {
  switch (preset.family) {
    case 'laptop':
      return {
        top: 0,
        right: clampRound(bodyWidth * LAPTOP_FLARE_RATIO, 8, 22),
        bottom: clampRound(bodyWidth * LAPTOP_BASE_RATIO, 18, 44),
        left: clampRound(bodyWidth * LAPTOP_FLARE_RATIO, 8, 22),
      };
    case 'desktop':
      return { top: WINDOW_TITLE_BAR, right: 0, bottom: 0, left: 0 };
    case 'browser':
      return { top: WINDOW_TITLE_BAR + BROWSER_ADDRESS_BAR, right: 0, bottom: 0, left: 0 };
    default:
      return NO_CHROME;
  }
}

export interface DeviceGeometry {
  /** Logical viewport handed to the preview, after orientation. */
  screen: { width: number; height: number };
  /** Full chassis footprint including bezel, rail and any chrome. */
  chassis: { width: number; height: number };
  inset: number;
  outerRadius: number;
  screenRadius: number;
  /**
   * Top-left of the screen box inside the chassis box. `inset` on both axes for
   * a phone or a tablet — which is exactly what `phone.tsx` positions the preview
   * with — and offset by the title bar or the deck flare on the other families.
   * Every renderer must place the preview here, at `screen.width × screen.height`,
   * or the app is laid out at the wrong size.
   */
  screenOrigin: { x: number; y: number };
  chrome: ChassisChrome;
  safeArea: { top: number; bottom: number };
  landscape: boolean;
}

/**
 * Resolves a preset + orientation into the numbers a chassis component draws
 * with. Rotating swaps the viewport and moves the safe areas: in landscape the
 * cutout sits on a side, so the top inset collapses to the status-bar height.
 */
export function deviceGeometry(
  preset: DevicePreset,
  orientation: 'portrait' | 'landscape',
): DeviceGeometry {
  const landscape = orientation === 'landscape' && isRotatable(preset);
  const screen = landscape
    ? { width: preset.viewport.height, height: preset.viewport.width }
    : { width: preset.viewport.width, height: preset.viewport.height };

  const inset = preset.bezel + preset.rail;
  // iOS hides the status bar when a *phone* is turned, so the top inset goes to
  // nothing; Android keeps its bar and a tablet keeps its inset. Same rule as
  // before the family split — it just names the reason now.
  const hidesStatusBarInLandscape = preset.statusBar === 'ios' && preset.family === 'phone';
  const safeArea = landscape
    ? {
        top: hidesStatusBarInLandscape ? 0 : preset.safeArea.top,
        bottom: preset.homeIndicator ? 21 : 0,
      }
    : { top: preset.safeArea.top, bottom: preset.safeArea.bottom };

  const chrome = chassisChrome(preset, screen.width + inset * 2);

  return {
    screen,
    chassis: {
      width: screen.width + inset * 2 + chrome.left + chrome.right,
      height: screen.height + inset * 2 + chrome.top + chrome.bottom,
    },
    inset,
    outerRadius: preset.screenRadius + inset,
    screenRadius: preset.screenRadius,
    screenOrigin: { x: inset + chrome.left, y: inset + chrome.top },
    chrome,
    safeArea,
    landscape,
  };
}
