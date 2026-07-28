'use client';

import type { ReactNode } from 'react';
import { deviceGeometry, type DevicePreset } from '@/lib/devices/presets';
import type { PreviewNotification } from '@/lib/preview/protocol';
import { GLASS_SHEEN, chassisStyle } from './chassis';
import { DeviceCutout, type IslandContent } from './dynamic-island';
import {
  KeyboardLayer,
  NotificationLayer,
  SystemSheetLayer,
  type SystemSheet,
} from './overlays';
import { HomeIndicator, StatusBar, type StatusBarState } from './status-bar';

/**
 * The phone.
 *
 * Everything is drawn from the preset's numbers with CSS and SVG — the chassis,
 * the machined edge, the bezel, the buttons, the glass highlight. There are no
 * device images anywhere in PhoneLab, and nothing here is tied to a manufacturer's
 * branding; presets name a *viewport format* so you know what you are testing.
 *
 * The screen is a real, interactive preview: `children` is the sandboxed iframe.
 * Overlays (status bar, cutout, banners, sheets, keyboard) sit above it inside the
 * same clipped rounded rect, so they crop exactly like they would on the device.
 *
 * Depth is drawn in three parts: a contour that stops the silhouette dissolving
 * into the canvas, a tight contact shadow that grounds the phone on the surface,
 * and a wide ambient one that gives it height. Selection adds a fourth — the phone
 * lifts — instead of painting colour around it.
 */

/* -------------------------------------------------------------------------- */
/* Depth                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Zoom stability — why every structural length in this file is a whole pixel.
 *
 * The canvas zooms by scaling one wrapper with `transform`, so everything here is
 * multiplied by the zoom before it is rasterised. The levels people actually work
 * at are 50%, 67%, 75%, 100% and 125%.
 *
 * Zoom-stable:
 *  - Whole-pixel, zero-blur lines (1px and 2px rings). A 1px line rasterises at
 *    0.5 / 0.67 / 0.75 / 1 / 1.25 px. None of those round to nothing, so the line
 *    is always painted — a half-covered grey at 50%, solid at 100%, 1.25px at
 *    125%. It never vanishes and it never doubles into a band.
 *  - Even offsets. The selection ring sits at -4px, which is an integer at 50%,
 *    75% and 125% (2, 3, 5). The old -5px landed on a half pixel at 50% and 75%
 *    and crawled while you pinched.
 *  - Blurred shadows at any size. A soft edge has no pixel grid to miss, so blur
 *    and spread scale cleanly; that they shrink with the phone is exactly right.
 *
 * Not zoom-stable, and therefore not used here any more:
 *  - Sub-pixel hairlines. A 0.5px line rasterises at 0.25 / 0.33 / 0.37 px below
 *    100% zoom; browsers collapse coverage that low to almost nothing, so the
 *    edge disappears precisely when you are zoomed out looking at the whole
 *    canvas. (`chassisStyle().railRing` still specifies 0.5px lines — that file
 *    is not mine to change, so the 1px contour below carries the silhouette on
 *    its own and the material ring is left as decoration on top of it.)
 */

/** Silhouette. One flat pixel, so a pale chassis still cuts out of a pale canvas. */
const CHASSIS_CONTOUR = '0 0 0 1px rgb(10 12 16 / 0.16)';

/** Contact: tight and close. This is the layer that says "resting on something". */
const CONTACT_SHADOW = '0 1px 1px rgb(10 12 16 / 0.20), 0 2px 4px -1px rgb(10 12 16 / 0.16)';

/** Ambient: wide, soft, low. This is the layer that says "held above something". */
const AMBIENT_SHADOW =
  '0 12px 22px -10px rgb(10 12 16 / 0.18), 0 30px 56px -20px rgb(10 12 16 / 0.24)';

const RESTING_SHADOW = `${CHASSIS_CONTOUR}, ${CONTACT_SHADOW}, ${AMBIENT_SHADOW}`;

/**
 * Selection = the phone lifts. Added on its own layer and cross-faded, so picking
 * a phone costs one composited opacity change, not a repaint of a 56px blur.
 */
const LIFT_SHADOW =
  '0 20px 34px -14px rgb(10 12 16 / 0.16), 0 44px 80px -26px rgb(10 12 16 / 0.20)';

/** Gap between chassis and selection ring. Even, so it stays on integers. */
const SELECTION_GAP = 4;

export interface PhoneChromeState {
  status: StatusBarState;
  island: IslandContent;
  notifications: PreviewNotification[];
  sheet: SystemSheet | null;
  keyboardOpen: boolean;
}

export function Phone({
  preset,
  orientation,
  theme,
  chrome,
  selected,
  dimmed,
  children,
  onDismissNotification,
  onResolveSheet,
}: {
  preset: DevicePreset;
  orientation: 'portrait' | 'landscape';
  theme: 'light' | 'dark';
  chrome: PhoneChromeState;
  selected: boolean;
  dimmed?: boolean;
  children: ReactNode;
  onDismissNotification: (id: string) => void;
  onResolveSheet: (sheetId: string, allowed: boolean) => void;
}) {
  const geometry = deviceGeometry(preset, orientation);
  const material = chassisStyle(preset.material);
  const landscape = geometry.landscape;
  const keyboardHeight = Math.round(geometry.screen.height * 0.42);

  return (
    <div
      className="relative"
      style={{
        width: geometry.chassis.width,
        height: geometry.chassis.height,
      }}
    >
      {/* Shadow casters, before the buttons so the shadow falls *behind* them
          rather than washing over the nubs. Both are empty: an outer box-shadow
          is never painted under its own border box, so the opaque rail on top
          covers the same rect with nothing showing through. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ borderRadius: geometry.outerRadius, boxShadow: RESTING_SHADOW }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          borderRadius: geometry.outerRadius,
          boxShadow: LIFT_SHADOW,
          opacity: selected ? 1 : 0,
          transition: 'opacity 180ms var(--ease-out-quint)',
        }}
      />

      {/* Side buttons sit behind the body so they read as protruding from under it. */}
      {preset.buttons.map((button) => {
        const along = landscape ? { left: button.top, width: button.length, height: button.thickness } : { top: button.top, height: button.length, width: button.thickness };
        const edge = landscape
          ? button.side === 'left'
            ? { bottom: -button.thickness + 0.5 }
            : { top: -button.thickness + 0.5 }
          : button.side === 'left'
            ? { left: -button.thickness + 0.5 }
            : { right: -button.thickness + 0.5 };

        return (
          <div
            key={button.id}
            aria-hidden="true"
            className="absolute"
            style={{
              ...along,
              ...edge,
              background: material.button,
              borderRadius: landscape ? '2px 2px 0 0' : button.side === 'left' ? '2px 0 0 2px' : '0 2px 2px 0',
              boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.35), 0 1px 2px rgba(10,12,16,0.28)',
            }}
          />
        );
      })}

      {/* Chassis rail. Depth now lives on the casters above, so this element only
          has to paint metal and its own machined hairlines. */}
      <div
        className="absolute inset-0"
        style={{
          borderRadius: geometry.outerRadius,
          background: material.rail,
          boxShadow: material.railRing,
        }}
      />

      {/* Bezel: the black band between rail and glass. The two 1px rings are the
          machined lip — a bright line on the metal side, black immediately inside
          it — which is what keeps the rail/bezel step readable when the bezel is
          only 4.5px wide and the zoom is 50%. */}
      <div
        className="absolute"
        style={{
          inset: preset.rail,
          borderRadius: geometry.screenRadius + preset.bezel,
          background: material.bezel,
          boxShadow: '0 0 0 1px rgb(255 255 255 / 0.12), inset 0 0 0 1px rgb(0 0 0 / 0.85)',
        }}
      />

      {/* Screen. Everything inside is clipped to the display radius.
          No inset ring here: an inset shadow paints under an element's children,
          so the iframe hid it the moment the preview mounted. The display edge is
          drawn above the app instead, at the bottom of this block. */}
      <div
        className="absolute overflow-hidden"
        style={{
          inset: geometry.inset,
          borderRadius: geometry.screenRadius,
          background: theme === 'dark' ? '#0e1116' : '#f5f6f8',
        }}
      >
        <div className="absolute inset-0">{children}</div>

        {preset.cutout.kind !== 'none' || preset.statusBar === 'android' ? (
          <StatusBar preset={preset} state={chrome.status} theme={theme} landscape={landscape} />
        ) : null}

        <DeviceCutout preset={preset} content={chrome.island} landscape={landscape} />

        <NotificationLayer
          notifications={chrome.notifications}
          preset={preset}
          theme={theme}
          onDismiss={onDismissNotification}
        />

        {chrome.keyboardOpen ? (
          <KeyboardLayer height={keyboardHeight} theme={theme} landscape={landscape} />
        ) : null}

        <SystemSheetLayer sheet={chrome.sheet} theme={theme} onResolve={onResolveSheet} />

        {preset.homeIndicator ? (
          <HomeIndicator theme={theme} width={geometry.screen.width} landscape={landscape} />
        ) : null}

        {/* Glass highlight, above the app but never interactive. Held at 0.75:
            the sweep peaks at 16% white, and on a large preset at 100–125% that
            is a visible haze over the top-left of the app rather than a highlight
            on a piece of glass. Dialled back it still reads as glass at 50%. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[60]"
          style={{ background: GLASS_SHEEN, borderRadius: geometry.screenRadius, opacity: 0.75 }}
        />

        {dimmed ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-[61]"
            style={{ background: 'rgba(10,12,16,0.35)' }}
          />
        ) : null}

        {/* Display edge: the glass catching light where it meets the bezel. Above
            everything, because it is the edge of the panel and not part of the
            picture on it. 1px, not the 0.5px this used to be, so it survives 50%;
            invisible over a light app, which is where the black bezel is already
            doing the separating. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[62]"
          style={{
            borderRadius: geometry.screenRadius,
            boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.07)',
          }}
        />
      </div>

      {/* Selection: one flat azure contour, offset off the metal so it never
          touches it, and no second translucent ring — the lift caster above
          carries the "this one" weight, this just names it. Outside the chassis
          so it never covers the screen. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          inset: -SELECTION_GAP,
          borderRadius: geometry.outerRadius + SELECTION_GAP,
          boxShadow: 'inset 0 0 0 2px var(--color-azure-500)',
          opacity: selected ? 1 : 0,
          transition: 'opacity 140ms var(--ease-out-quint)',
        }}
      />
    </div>
  );
}
