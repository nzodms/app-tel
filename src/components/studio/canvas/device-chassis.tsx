'use client';

import type { CSSProperties, ReactNode } from 'react';
import { deviceGeometry, type DeviceGeometry, type DevicePreset } from '@/lib/devices/presets';
import type { PreviewNotification } from '@/lib/preview/protocol';
import { GLASS_SHEEN } from './chassis';
import { DeviceCutout, type IslandContent } from './dynamic-island';
import { KeyboardLayer, NotificationLayer, SystemSheetLayer, type SystemSheet } from './overlays';
import { HomeIndicator, StatusBar, type StatusBarState } from './status-bar';
import { PhoneChassis } from './phone';
import { SurfaceChassis } from './surface-chassis';
import { useDeviceMorph } from './use-device-morph';

/**
 * A device on the canvas: the object, and the display in it.
 *
 * **Why this file exists.** The chassis families are drawn by different
 * components — a phone is not a laptop — but the *display* must be the same
 * element for all of them, because a sandboxed `<iframe>` reloads the moment the
 * browser re-parents it. Rendering the preview inside each family's own component
 * meant that switching from a phone to a MacBook unmounted one subtree and
 * mounted another, and the running app was thrown away and booted again. That was
 * measurable: a marker set on the frame's `window` survived every phone-to-phone
 * and phone-to-tablet switch and vanished on the first cross-family one.
 *
 * So the skeleton here is fixed:
 *
 *     <div>                     ← chassis-sized box
 *       {outgoing art}          ← slot 0a, present only mid-morph
 *       {chassis art}           ← slot 0b, swaps freely; contains no iframe
 *       <DeviceScreen>          ← slot 2, ALWAYS this component
 *         {children}            ← the preview, never re-parented
 *
 * React reconciles children by position, and a JSX children list keeps its length
 * whether or not a slot is `null` — so only the art slots are ever torn down when
 * the family changes. The display keeps its instance, its DOM node, and the live
 * app.
 *
 * The rule that follows: **nothing in a chassis component may render `children`,
 * and no chassis may draw above the display.** Both hold today — every family's
 * art is casters, rail, bezel, buttons or window chrome, all of it behind the
 * screen box, plus a selection ring that sits outside the chassis rect entirely.
 *
 * **The morph.** Slot 0 holds two layers rather than one for the ~300ms it takes
 * one format to become another: the object being left and the object being
 * arrived at, each drawn at its own natural size and mapped onto the other with a
 * transform, cross-fading. The display is not part of that swap — it cannot be —
 * so it stays put and is moved, and clipped, around an app that resizes once. All
 * of the arithmetic and all of the timing is in `use-device-morph.ts`; this file
 * only spends it. Read that header before changing anything below.
 */

export interface DeviceChromeState {
  status: StatusBarState;
  island: IslandContent;
  notifications: PreviewNotification[];
  sheet: SystemSheet | null;
  keyboardOpen: boolean;
}

export interface DeviceChassisProps {
  preset: DevicePreset;
  orientation: 'portrait' | 'landscape';
  theme: 'light' | 'dark';
  chrome: DeviceChromeState;
  selected: boolean;
  dimmed?: boolean;
  children: ReactNode;
  /**
   * What the app inside is currently showing, for the families that have somewhere
   * to put it: a browser window's address field and a window's title bar.
   *
   * `route` is the preview's own report of where it navigated — the frame sends it
   * over postMessage — so the address bar follows the app rather than describing
   * it. `title` is the project's name. Both are optional and both render empty
   * when absent, because an address bar that invented a plausible URL would be the
   * most convincing lie on the canvas.
   */
  route?: string | null;
  title?: string | null;
  onDismissNotification: (id: string) => void;
  onResolveSheet: (sheetId: string, allowed: boolean) => void;
}

/** A phone and a tablet are one object at two sizes; the rest are not. */
export function isHandheld(preset: DevicePreset): boolean {
  return preset.family === 'phone' || preset.family === 'tablet';
}

/**
 * The display's corners.
 *
 * A window's display meets a title bar along a straight line at the top and the
 * shell's own corners at the bottom, so only the bottom two are rounded. Every
 * other family's display is rounded all the way round, like the object holding
 * it.
 *
 * Emitted as one CSS string rather than a number because it is used twice: as the
 * box's `border-radius`, and as the `round` of the `clip-path` that opens the
 * display's aperture during a morph. Those two have to agree, or a growing device
 * shows square corners on the sides that are still being revealed.
 */
function screenRadiusCss(preset: DevicePreset, geometry: DeviceGeometry): string {
  const radius = geometry.screenRadius;
  return preset.family === 'desktop' || preset.family === 'browser'
    ? `0px 0px ${radius}px ${radius}px`
    : `${radius}px`;
}

/**
 * Layers that belong to a *family* rather than to a device: the glass sheen a
 * window does not have, and the replay dim. Both are always mounted and carried
 * on opacity so they dissolve with the object instead of being dropped in one
 * frame; at opacity 0 a layer is not painted, so this costs nothing at rest.
 */
const LAYER_FADE = '200ms var(--ease-in-out-quad)';

export function DeviceChassis({
  preset,
  orientation,
  theme,
  chrome,
  selected,
  dimmed,
  children,
  route,
  title,
  onDismissNotification,
  onResolveSheet,
}: DeviceChassisProps) {
  const geometry = deviceGeometry(preset, orientation);
  const radius = screenRadiusCss(preset, geometry);
  const morph = useDeviceMorph({ preset, orientation, geometry, screenRadius: radius });

  return (
    <div
      className="relative"
      style={{ width: geometry.chassis.width, height: geometry.chassis.height }}
    >
      {/* Slot 0a — the object being left behind, drawn at its own size and scaled
          onto the new one as it fades. Only ever mounted mid-morph, inert while
          it is: it is a picture of a device that no longer exists, so it must not
          take a pointer. */}
      {morph.leaving ? (
        <div
          aria-hidden="true"
          // Marked so a browser probe can prove the cross-fade really happens.
          // "One device becoming another" is a claim about two layers overlapping
          // for ~300ms, and a claim like that should be checkable against the DOM.
          data-pl-morph="leaving"
          className="pointer-events-none absolute left-0 top-0"
          style={morph.leavingStyle}
        >
          {isHandheld(morph.leaving.preset) ? (
            <PhoneChassis
              preset={morph.leaving.preset}
              orientation={morph.leaving.orientation}
              selected={selected}
            />
          ) : (
            <SurfaceChassis
              preset={morph.leaving.preset}
              orientation={morph.leaving.orientation}
              theme={theme}
              selected={selected}
              address={route ?? null}
              title={title ?? null}
            />
          )}
        </div>
      ) : null}

      {/* Slot 0b — the object it is becoming. At rest this layer is the chassis
          box exactly, with no transform and no compositing hint of any kind. */}
      <div data-pl-morph="arriving" className="absolute left-0 top-0" style={morph.arrivingStyle}>
        {isHandheld(preset) ? (
          <PhoneChassis preset={preset} orientation={orientation} selected={selected} />
        ) : (
          <SurfaceChassis
            preset={preset}
            orientation={orientation}
            theme={theme}
            selected={selected}
            address={route ?? null}
            title={title ?? null}
          />
        )}
      </div>

      <DeviceScreen
        preset={preset}
        orientation={orientation}
        theme={theme}
        chrome={chrome}
        dimmed={Boolean(dimmed)}
        radius={radius}
        morphStyle={morph.screenStyle}
        onDismissNotification={onDismissNotification}
        onResolveSheet={onResolveSheet}
      >
        {children}
      </DeviceScreen>
    </div>
  );
}

/**
 * The display, and everything the system draws on top of the app.
 *
 * Positioned from `geometry.screenOrigin` and sized from `geometry.screen`, which
 * is the contract every family's art is built against — so this one element lands
 * in the lid of a laptop, under the address bar of a browser window and inside
 * the bezel of a phone without knowing which it is in.
 *
 * No inset ring on the box itself: an inset shadow paints *under* an element's
 * children, so the iframe would hide it the instant the preview mounted. The
 * display edge is drawn as its own layer above the app, at the bottom.
 *
 * `morphStyle` is the only thing a format change is allowed to do to this box, and
 * it is deliberately narrow: a translation and an aperture, both empty at rest.
 * Never a scale — an iframe under a scaling ancestor rasterises at the wrong
 * resolution and goes soft, and scaling the app would be a claim about its layout
 * that is not true. The width and the height here change in one frame, in the same
 * commit that hands the frame its new viewport, so the box and the app inside it
 * are never a different size from each other.
 */
function DeviceScreen({
  preset,
  orientation,
  theme,
  chrome,
  dimmed,
  radius,
  morphStyle,
  children,
  onDismissNotification,
  onResolveSheet,
}: {
  preset: DevicePreset;
  orientation: 'portrait' | 'landscape';
  theme: 'light' | 'dark';
  chrome: DeviceChromeState;
  dimmed: boolean;
  radius: string;
  morphStyle: CSSProperties;
  children: ReactNode;
  onDismissNotification: (id: string) => void;
  onResolveSheet: (sheetId: string, allowed: boolean) => void;
}) {
  const geometry = deviceGeometry(preset, orientation);
  const landscape = geometry.landscape;
  const handheld = isHandheld(preset);

  /**
   * Whether a status bar is drawn at all.
   *
   * This used to be "has a cutout, or is Android", which quietly excluded both
   * tablets: they declare `statusBar: 'ios'` and a 24pt top safe area, have no
   * cutout, and so got no clock, no wifi and no battery while the app was pushed
   * down by an inset nothing occupied.
   *
   * The landscape clause is the rule `deviceGeometry` already applies to the safe
   * area — iOS hides the bar on a *phone* turned sideways, iPadOS does not.
   * Drawing it anyway put a clock over a strip the app had been told it owns.
   */
  const iosPhoneLandscape = preset.statusBar === 'ios' && preset.family === 'phone' && landscape;
  const showStatusBar = preset.statusBar !== 'none' && !iosPhoneLandscape;

  return (
    <div
      // The display rect. Marked so a browser probe can measure what is drawn on
      // it: the status bar's alignment is a geometry claim, and geometry claims
      // should be checked against the DOM rather than against a screenshot.
      data-pl="screen"
      className="absolute overflow-hidden"
      style={{
        left: geometry.screenOrigin.x,
        top: geometry.screenOrigin.y,
        width: geometry.screen.width,
        height: geometry.screen.height,
        borderRadius: radius,
        background: theme === 'dark' ? '#0e1116' : '#f5f6f8',
        ...morphStyle,
      }}
    >
      <div className="absolute inset-0">{children}</div>

      {showStatusBar ? (
        <StatusBar preset={preset} state={chrome.status} theme={theme} landscape={landscape} />
      ) : null}

      <DeviceCutout preset={preset} content={chrome.island} landscape={landscape} />

      {/* A banner and a software keyboard are handheld chrome. On a laptop, a
          monitor or a browser window they are simply absent — the Edge Case
          Studio greys the matching switches and says why, rather than accepting
          a flag that would change nothing on screen. */}
      {handheld ? (
        <NotificationLayer
          notifications={chrome.notifications}
          preset={preset}
          theme={theme}
          island={chrome.island}
          onDismiss={onDismissNotification}
        />
      ) : null}

      {handheld && chrome.keyboardOpen ? (
        <KeyboardLayer
          height={Math.round(geometry.screen.height * 0.42)}
          theme={theme}
          landscape={landscape}
        />
      ) : null}

      {/* A permission prompt is real everywhere, including in a browser. */}
      <SystemSheetLayer sheet={chrome.sheet} theme={theme} onResolve={onResolveSheet} />

      {preset.homeIndicator ? (
        <HomeIndicator theme={theme} width={geometry.screen.width} landscape={landscape} />
      ) : null}

      {/* Glass, on the families that are a piece of glass. A window is not one.
          Held at 0.75: the sweep peaks at 16% white, and on a large preset at
          100–125% that is a visible haze over the top-left of the app rather than
          a highlight on glass. Dialled back it still reads as glass at 50%.

          Mounted for every family and carried on opacity, so that a phone
          becoming a MacBook loses its glass over the same beat as its bezel
          instead of in one frame. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[60]"
        style={{
          background: GLASS_SHEEN,
          borderRadius: radius,
          opacity: handheld ? 0.75 : 0,
          transition: `opacity ${LAYER_FADE}`,
        }}
      />

      {/* Replay: every device that is not the one being replayed steps back. Also
          a fade rather than a cut — the state is real, the switch into it is not
          an event worth a flash. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[61]"
        style={{
          background: 'rgba(10,12,16,0.35)',
          opacity: dimmed ? 1 : 0,
          transition: `opacity ${LAYER_FADE}`,
        }}
      />

      {/* Display edge: the panel catching light where it meets what holds it.
          Above everything, because it is the edge of the screen and not part of
          the picture on it. 1px, so it survives 50% zoom. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[62]"
        style={{ borderRadius: radius, boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.07)' }}
      />
    </div>
  );
}
