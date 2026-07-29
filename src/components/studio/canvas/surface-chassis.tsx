'use client';

import type { CSSProperties } from 'react';
import {
  BROWSER_ADDRESS_BAR,
  WINDOW_TITLE_BAR,
  deviceGeometry,
  type DevicePreset,
} from '@/lib/devices/presets';
import { chassisStyle } from './chassis';

/**
 * The devices that are not phones: tablet slabs, laptops, and the two window
 * formats (a desktop app window and a browser window).
 *
 * Built the way `phone.tsx` is built, and for the same reasons. Every line here
 * comes out of the preset's numbers, drawn with CSS — gradients, radii, one
 * clip-path — so there are no device images, no vendor assets and no logos in
 * PhoneLab. A laptop is a lid, a hinge and a deck seen edge-on; a window is a
 * frame, a title bar and three plain dots. Nothing identifies a manufacturer, and
 * nothing is drawn that the format does not have: a laptop has no cutout, no
 * status bar and no gesture bar, so none of those are rendered rather than being
 * faked at zero size.
 *
 * Like `phone.tsx`, this draws the object and not the display: the screen is one
 * element owned by `device-chassis.tsx`, positioned from `geometry.screenOrigin`
 * and sized from `geometry.screen`, and shared by every family so that switching
 * format never re-parents the preview iframe. Nothing here renders `children`,
 * and nothing here is drawn above the display.
 *
 * Depth, radii and motion are the phone's, deliberately: the shared device
 * elevation tokens (`--pl-shadow-device`, `--pl-shadow-device-lift`), a lift layer
 * cross-faded on selection instead of colour painted around the object, and one
 * flat azure contour to name the selected device. Nothing here animates anything
 * but `opacity`.
 *
 * Zoom stability follows the same rules `phone.tsx` documents at length: every
 * structural length is a whole pixel, every hairline is 1px (never 0.5px, which
 * disappears below 100%), and the selection ring sits at an even offset. All of
 * it holds from 50% to 125%.
 */

/* -------------------------------------------------------------------------- */
/* Depth and motion                                                            */
/* -------------------------------------------------------------------------- */

/** Contour + contact + ambient, in paint order. See globals.css. */
const RESTING_SHADOW = 'var(--pl-shadow-device)';

/** Additive layer, cross-faded on selection: one composited opacity change. */
const LIFT_SHADOW = 'var(--pl-shadow-device-lift)';

const LIFT_FADE = 'opacity 180ms var(--ease-out-quint)';
const SELECTION_FADE = 'opacity 140ms var(--ease-out-quint)';

/** Gap between chassis and selection ring. Even, so it stays on integers. */
const SELECTION_GAP = 4;

/* -------------------------------------------------------------------------- */
/* Window chrome                                                               */
/* -------------------------------------------------------------------------- */

/**
 * OS chrome is not a material — it is interface — so the window families are
 * drawn from the studio palette rather than from a chassis gradient, and they
 * follow the device's own theme the way a real window follows the system
 * appearance.
 */
interface WindowPalette {
  shell: string;
  frame: string;
  hairline: string;
  dot: string;
  field: string;
  fieldRing: string;
}

const LIGHT_WINDOW: WindowPalette = {
  shell: 'var(--color-paper-100)',
  frame: 'var(--color-paper-300)',
  hairline: 'var(--color-paper-200)',
  dot: 'var(--color-paper-400)',
  field: 'var(--color-paper-0)',
  fieldRing: 'var(--color-paper-200)',
};

const DARK_WINDOW: WindowPalette = {
  shell: 'var(--color-slate-code-0)',
  frame: 'var(--color-slate-code-300)',
  hairline: 'var(--color-slate-code-200)',
  dot: 'var(--color-slate-code-400)',
  field: 'var(--color-slate-code-100)',
  fieldRing: 'var(--color-slate-code-300)',
};

/** Window buttons: three plain circles. Shape only — no colour, no glyphs. */
const DOT_SIZE = 10;
const DOT_GAP = 8;
/** Left margin of the dot row, and of the address field below it. */
const CHROME_MARGIN = 14;
const FIELD_HEIGHT = 24;

/* -------------------------------------------------------------------------- */
/* Shared parts                                                                */
/* -------------------------------------------------------------------------- */

/** An absolutely-positioned rectangle in chassis coordinates. Whole pixels. */
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Shadow casters. Empty and painted before the body, so the shadow falls behind
 * the object rather than over it — an outer box-shadow is never painted under its
 * own border box, so the opaque body on top covers the same rect exactly.
 */
function Casters({
  box,
  radius,
  selected,
}: {
  box: Box;
  radius: CSSProperties['borderRadius'];
  selected: boolean;
}) {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{ ...box, borderRadius: radius, boxShadow: RESTING_SHADOW }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          ...box,
          borderRadius: radius,
          boxShadow: LIFT_SHADOW,
          opacity: selected ? 1 : 0,
          transition: LIFT_FADE,
        }}
      />
    </>
  );
}

function SideButtons({
  preset,
  body,
  landscape,
  fill,
}: {
  preset: DevicePreset;
  body: Box;
  landscape: boolean;
  fill: string;
}) {
  if (preset.buttons.length === 0) return null;

  return (
    <div aria-hidden="true" className="absolute" style={body}>
      {preset.buttons.map((button) => {
        const along = landscape
          ? { left: button.top, width: button.length, height: button.thickness }
          : { top: button.top, height: button.length, width: button.thickness };
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
            className="absolute"
            style={{
              ...along,
              ...edge,
              background: fill,
              borderRadius: landscape
                ? '2px 2px 0 0'
                : button.side === 'left'
                  ? '2px 0 0 2px'
                  : '0 2px 2px 0',
              boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.35), 0 1px 2px rgba(10,12,16,0.28)',
            }}
          />
        );
      })}
    </div>
  );
}

/** One flat azure contour, offset off the body so it never touches it. */
function SelectionRing({
  radius,
  selected,
}: {
  radius: CSSProperties['borderRadius'];
  selected: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute"
      style={{
        inset: -SELECTION_GAP,
        borderRadius: radius,
        boxShadow: 'inset 0 0 0 2px var(--color-azure-500)',
        opacity: selected ? 1 : 0,
        transition: SELECTION_FADE,
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Families                                                                    */
/* -------------------------------------------------------------------------- */

export interface SurfaceChassisProps {
  preset: DevicePreset;
  orientation: 'portrait' | 'landscape';
  theme: 'light' | 'dark';
  selected: boolean;
}

export function SurfaceChassis(props: SurfaceChassisProps) {
  switch (props.preset.family) {
    case 'laptop':
      return <Laptop {...props} />;
    case 'desktop':
    case 'browser':
      return <Window {...props} />;
    default:
      return <Slab {...props} />;
  }
}

/**
 * Tablet. A phone's construction at a tablet's proportions: one uniform bezel all
 * the way round, generous corners, side buttons, no cutout and no keyboard.
 */
function Slab({ preset, orientation, selected }: SurfaceChassisProps) {
  const geometry = deviceGeometry(preset, orientation);
  const material = chassisStyle(preset.material);
  const body: Box = {
    left: 0,
    top: 0,
    width: geometry.chassis.width,
    height: geometry.chassis.height,
  };

  return (
    <>
      <Casters box={body} radius={geometry.outerRadius} selected={selected} />

      <SideButtons
        preset={preset}
        body={body}
        landscape={geometry.landscape}
        fill={material.button}
      />

      {/* Rail: metal and its own machined hairlines. Depth lives on the casters. */}
      <div
        className="absolute inset-0"
        style={{
          borderRadius: geometry.outerRadius,
          background: material.rail,
          boxShadow: material.railRing,
        }}
      />

      {/* Bezel. The two 1px rings are the machined lip — a bright line on the
          metal side, black immediately inside it — which is what keeps the
          rail/bezel step readable at 50%. */}
      <div
        className="absolute"
        style={{
          inset: preset.rail,
          borderRadius: geometry.screenRadius + preset.bezel,
          background: material.bezel,
          boxShadow: '0 0 0 1px rgb(255 255 255 / 0.12), inset 0 0 0 1px rgb(0 0 0 / 0.85)',
        }}
      />

      <SelectionRing radius={geometry.outerRadius + SELECTION_GAP} selected={selected} />
    </>
  );
}

/**
 * Laptop. A lid with a thin bezel, the hinge line under it, and the base seen
 * head-on: the deck foreshortened into a trapezoid that widens toward the viewer,
 * a suggestion of the key area inside it, and the front lip with its finger
 * recess. That is all — no keys, no trackpad outline, nothing that would turn into
 * mush at 50% or invite you to read a brand off it.
 *
 * The deck's flare (`chrome.left`/`chrome.right`) and the base height
 * (`chrome.bottom`) come from the geometry, so the drawn object is exactly the
 * footprint the canvas lays out and hit-tests against.
 */
function Laptop({ preset, orientation, selected }: SurfaceChassisProps) {
  const geometry = deviceGeometry(preset, orientation);
  const material = chassisStyle(preset.material);
  const { chassis, chrome, inset } = geometry;

  const lid: Box = {
    left: chrome.left,
    top: 0,
    width: geometry.screen.width + inset * 2,
    height: geometry.screen.height + inset * 2,
  };
  const base: Box = { left: 0, top: lid.height, width: chassis.width, height: chrome.bottom };

  // The deck takes the upper half of the base and the front lip the rest.
  const deckHeight = Math.round(base.height * 0.55);
  const lipHeight = base.height - deckHeight;
  const frontRadius = Math.min(8, Math.round(base.height * 0.3));
  const keyInset = Math.round(base.width * 0.17);
  const recessWidth = Math.round(base.width * 0.12);

  // The plate runs up *behind* the lid by its corner radius, so the lid's rounded
  // bottom corners show base metal behind them instead of a notch of canvas. It
  // changes nothing about the footprint: the visible base is still `base`.
  const plate: Box = {
    left: base.left,
    top: base.top - geometry.outerRadius,
    width: base.width,
    height: base.height + geometry.outerRadius,
  };

  return (
    <>
      <Casters
        box={base}
        radius={`2px 2px ${frontRadius}px ${frontRadius}px`}
        selected={selected}
      />

      {/* Base plate. Same metal as the lid, lit from above. */}
      <div
        className="absolute"
        style={{
          ...plate,
          background: material.rail,
          borderRadius: `2px 2px ${frontRadius}px ${frontRadius}px`,
          boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.28), inset 0 -1px 0 rgb(10 12 16 / 0.28)',
        }}
      />

      {/* Deck, receding: as wide as the lid at the hinge, as wide as the plate at
          the front. One clip-path, no image, and it scales with the format. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          left: base.left,
          top: base.top,
          width: base.width,
          height: deckHeight,
          background:
            'linear-gradient(180deg, rgb(10 12 16 / 0.44) 0%, rgb(10 12 16 / 0.16) 62%, ' +
            'rgb(10 12 16 / 0.06) 100%)',
          clipPath: `polygon(${chrome.left}px 0, ${base.width - chrome.right}px 0, 100% 100%, 0 100%)`,
        }}
      />

      {/* Key area: a single quiet band. Suggestion, not a keyboard. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          left: keyInset,
          top: base.top + Math.round(deckHeight * 0.26),
          width: base.width - keyInset * 2,
          height: Math.max(2, Math.round(deckHeight * 0.42)),
          borderRadius: 2,
          background: 'rgb(10 12 16 / 0.17)',
        }}
      />

      {/* Finger recess in the front lip. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          left: Math.round((base.width - recessWidth) / 2),
          top: base.top + deckHeight + Math.round(lipHeight * 0.3),
          width: recessWidth,
          height: Math.max(2, Math.round(lipHeight * 0.4)),
          borderRadius: 999,
          background: 'rgb(10 12 16 / 0.16)',
        }}
      />

      {/* Hinge: the dark gap the lid closes onto, only as wide as the lid. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          left: lid.left,
          top: base.top,
          width: lid.width,
          height: 2,
          background: 'rgb(10 12 16 / 0.55)',
        }}
      />

      <Casters box={lid} radius={geometry.outerRadius} selected={selected} />

      {/* Lid: rail, then bezel, then the panel. */}
      <div
        className="absolute"
        style={{
          ...lid,
          borderRadius: geometry.outerRadius,
          background: material.rail,
          boxShadow: material.railRing,
        }}
      />
      <div
        className="absolute"
        style={{
          left: lid.left + preset.rail,
          top: lid.top + preset.rail,
          width: lid.width - preset.rail * 2,
          height: lid.height - preset.rail * 2,
          borderRadius: geometry.screenRadius + preset.bezel,
          background: material.bezel,
          boxShadow: '0 0 0 1px rgb(255 255 255 / 0.12), inset 0 0 0 1px rgb(0 0 0 / 0.85)',
        }}
      />

      {/* Camera. In the bezel, where a laptop's is — never a hole in the display. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute rounded-full"
        style={{
          left: Math.round(lid.left + lid.width / 2) - 2,
          top: lid.top + preset.rail + Math.round((preset.bezel - 4) / 2),
          width: 4,
          height: 4,
          background: 'rgb(255 255 255 / 0.14)',
        }}
      />

      <SelectionRing
        radius={
          `${geometry.outerRadius + SELECTION_GAP}px ${geometry.outerRadius + SELECTION_GAP}px ` +
          `${frontRadius + SELECTION_GAP}px ${frontRadius + SELECTION_GAP}px`
        }
        selected={selected}
      />
    </>
  );
}

/**
 * Desktop and browser. A window: a 1px frame, a title bar with three plain
 * circles, and — for a browser — one address field under it. The dots are the
 * shape a window's buttons are and nothing more: no colour, no glyphs, no
 * vendor's rendering of them. The desktop window gets the frame and the title bar
 * and stops there.
 */
function Window({ preset, orientation, theme, selected }: SurfaceChassisProps) {
  const geometry = deviceGeometry(preset, orientation);
  const { chassis, chrome, inset } = geometry;
  const palette = theme === 'dark' ? DARK_WINDOW : LIGHT_WINDOW;
  const shell: Box = { left: 0, top: 0, width: chassis.width, height: chassis.height };

  const innerWidth = chassis.width - inset * 2;
  const dotTop = inset + Math.round((WINDOW_TITLE_BAR - DOT_SIZE) / 2);
  const fieldTop = inset + WINDOW_TITLE_BAR + Math.round((BROWSER_ADDRESS_BAR - FIELD_HEIGHT) / 2);

  return (
    <>
      <Casters box={shell} radius={geometry.outerRadius} selected={selected} />

      {/* Shell: the chrome surface and the frame, in one element. */}
      <div
        className="absolute inset-0"
        style={{
          borderRadius: geometry.outerRadius,
          background: palette.shell,
          boxShadow: `inset 0 0 0 1px ${palette.frame}`,
        }}
      />

      {[0, 1, 2].map((index) => (
        <div
          key={index}
          aria-hidden="true"
          className="pointer-events-none absolute rounded-full"
          style={{
            left: inset + CHROME_MARGIN + index * (DOT_SIZE + DOT_GAP),
            top: dotTop,
            width: DOT_SIZE,
            height: DOT_SIZE,
            background: palette.dot,
          }}
        />
      ))}

      {preset.family === 'browser' ? (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute"
            style={{
              left: inset + CHROME_MARGIN,
              top: fieldTop,
              width: innerWidth - CHROME_MARGIN * 2,
              height: FIELD_HEIGHT,
              borderRadius: 999,
              background: palette.field,
              boxShadow: `inset 0 0 0 1px ${palette.fieldRing}`,
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute rounded-full"
            style={{
              left: inset + CHROME_MARGIN + 10,
              top: fieldTop + Math.round((FIELD_HEIGHT - 8) / 2),
              width: 8,
              height: 8,
              background: palette.dot,
            }}
          />
        </>
      ) : null}

      {/* Where the chrome ends and the app begins. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          left: inset,
          top: inset + chrome.top - 1,
          width: innerWidth,
          height: 1,
          background: palette.hairline,
        }}
      />

      <SelectionRing radius={geometry.outerRadius + SELECTION_GAP} selected={selected} />
    </>
  );
}
