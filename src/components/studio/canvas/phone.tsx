'use client';

import { deviceGeometry, type DevicePreset } from '@/lib/devices/presets';
import { chassisStyle } from './chassis';

/**
 * The phone's chassis.
 *
 * Everything is drawn from the preset's numbers with CSS and SVG — the chassis,
 * the machined edge, the bezel, the buttons. There are no
 * device images anywhere in PhoneLab, and nothing here is tied to a manufacturer's
 * branding; presets name a *viewport format* so you know what you are testing.
 *
 * This draws the *object* and nothing else — casters, side buttons, rail, bezel,
 * selection ring. The display and everything the system paints on it belong to
 * `device-chassis.tsx`, which renders one screen element for every family so that
 * switching format never re-parents the preview iframe (which would reload the
 * running app). Consequence, and it is load-bearing: nothing in here may render
 * `children`, and nothing in here may be drawn above the display.
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

export function PhoneChassis({
  preset,
  orientation,
  selected,
}: {
  preset: DevicePreset;
  orientation: 'portrait' | 'landscape';
  selected: boolean;
}) {
  const geometry = deviceGeometry(preset, orientation);
  const material = chassisStyle(preset.material);
  const landscape = geometry.landscape;

  return (
    <>
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
    </>
  );
}
