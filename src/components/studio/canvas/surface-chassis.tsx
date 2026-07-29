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
 * comes out of the preset's numbers, drawn with CSS and SVG — gradients, radii,
 * one clip-path, three stroked glyphs — so there are no device images, no vendor
 * assets and no logos in PhoneLab. A laptop is a lid, a hinge and a deck seen
 * edge-on; a window is a frame, a tab strip, a toolbar and three plain dots.
 * Nothing identifies a manufacturer, and nothing is drawn that the format does
 * not have: a laptop has no cutout, no status bar and no gesture bar, so none of
 * those are rendered rather than being faked at zero size.
 *
 * Like `phone.tsx`, this draws the object and not the display: the screen is one
 * element owned by `device-chassis.tsx`, positioned from `geometry.screenOrigin`
 * and sized from `geometry.screen`, and shared by every family so that switching
 * format never re-parents the preview iframe. Nothing here renders the display's
 * contents, and — the rule that follows from it — nothing here is drawn above the
 * display. That constraint shapes two things below, and both are called out where
 * they happen: a laptop's reflection lives on the bezel glass rather than over the
 * panel, and a browser's chrome/content boundary is shaded on the chrome side
 * because the content side is not ours to paint on.
 *
 * Depth, radii and motion are the phone's, deliberately: the shared device
 * elevation tokens (`--pl-shadow-device`, `--pl-shadow-device-lift`), a lift layer
 * cross-faded on selection instead of colour painted around the object, and one
 * flat azure contour to name the selected device. Nothing here animates anything
 * but `opacity`, and nothing here animates at all unless you select it.
 *
 * Zoom stability follows the same rules `phone.tsx` documents at length: every
 * structural length is a whole pixel, every hairline is 1px (never 0.5px, which
 * disappears below 100%), the hinge is three 1px bands rather than a 3px blur, and
 * the selection ring sits at an even offset. All of it holds from 50% to 125%.
 */

/* -------------------------------------------------------------------------- */
/* Depth and motion                                                            */
/* -------------------------------------------------------------------------- */

/** Contour + contact + ambient, in paint order. See globals.css. */
const RESTING_SHADOW = 'var(--pl-shadow-device)';

/**
 * What a lid casts. A lid is not lying on the bench — it stands up out of the
 * base — so it gets the silhouette that keeps it cut out of the canvas and the
 * tight seat where it meets the deck, and none of the wide ambient throw. That
 * layer belongs under the base, which is the part actually touching the surface;
 * it used to be under both, which is why a laptop looked like a lid floating over
 * a grey smudge. Composed from the same tokens, so it still inverts with the
 * studio theme — and it is one fewer 56px blur per laptop on the canvas.
 */
const LID_SHADOW = 'var(--pl-shadow-device-contour), var(--pl-shadow-device-contact)';

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
 * drawn as a small palette rather than from a chassis gradient, and it follows
 * the *device's* theme the way a real window follows the system appearance.
 *
 * Literals, not `var(--color-paper-*)`. These are two different things that
 * happen to look alike: the studio's chrome and a simulated window's chrome. The
 * moment the studio gained a dark theme, borrowing its tokens meant a
 * light-themed browser device sitting on a dark canvas grew dark window chrome —
 * its own `theme` field quietly stopped controlling it. The values below are the
 * light palette's, frozen at the point they were copied from it, so the two can
 * now move independently. Same reason `phone.tsx` does not read chrome tokens for
 * a bezel. Anything added here must stay a literal for the same reason, including
 * the two that are not flat colours (`edge`, `underside`).
 */
interface WindowPalette {
  /** The window's outer frame line. */
  frame: string;
  /** Tab strip: the deepest chrome surface, the one the tab sits *on*. */
  strip: string;
  /** Toolbar, title bar and the active tab — the layer that carries the field. */
  shell: string;
  /** Where the chrome ends and the app begins. */
  hairline: string;
  /** Window buttons, and the ink for glyphs that do nothing. */
  dot: string;
  /** Address field fill and its ring. */
  field: string;
  fieldRing: string;
  /** Text: an address, a tab label, a window title. */
  text: string;
  /** The chrome slab's lit top edge. */
  edge: string;
  /** Its shaded bottom edge, immediately above the boundary hairline. */
  underside: string;
}

const LIGHT_WINDOW: WindowPalette = {
  frame: '#d3d7de',
  strip: '#e4e7ec',
  shell: '#f2f3f6',
  hairline: '#e4e7ec',
  dot: '#a8aeb9',
  field: '#ffffff',
  fieldRing: '#e4e7ec',
  text: '#2b3037',
  edge: 'rgb(255 255 255 / 0.85)',
  underside: 'linear-gradient(180deg, rgb(16 20 26 / 0) 0%, rgb(16 20 26 / 0.06) 100%)',
};

const DARK_WINDOW: WindowPalette = {
  frame: '#2f353f',
  strip: '#13171c',
  shell: '#1b1f26',
  hairline: '#232830',
  dot: '#3d444f',
  field: '#0f1318',
  fieldRing: '#2f353f',
  text: '#dfe3ea',
  edge: 'rgb(255 255 255 / 0.06)',
  underside: 'linear-gradient(180deg, rgb(0 0 0 / 0) 0%, rgb(0 0 0 / 0.3) 100%)',
};

/** Window buttons: three plain circles. Shape only — no colour, no glyphs. */
const DOT_SIZE = 10;
const DOT_GAP = 8;
const DOT_ROW = DOT_SIZE * 3 + DOT_GAP * 2;
/** Left margin of the dot row, of the toolbar, and of the address field. */
const CHROME_MARGIN = 14;
const FIELD_HEIGHT = 24;

/** The one tab. Whole pixels; `TAB_MAX` is a tab's width, not the window's. */
const TAB_HEIGHT = 22;
const TAB_RADIUS = 7;
const TAB_MAX = 240;
const TAB_MIN = 72;
/** Leading mark on the tab, at the size a favicon is drawn at. */
const FAVICON_SIZE = 10;

/** Toolbar glyph box. Drawn in a 16-unit viewBox and rendered 1:1. */
const GLYPH_SIZE = 16;
const GLYPH_GAP = 10;
const GLYPH_ROW = GLYPH_SIZE * 3 + GLYPH_GAP * 2;

/** How far the chrome's shaded bottom edge reaches up from the boundary. */
const UNDERSIDE_HEIGHT = 4;

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
 *
 * `resting` and `lift` exist for the laptop, which is two objects at two depths:
 * the base is on the bench and casts the full stack, the lid stands on the base
 * and casts only its silhouette and its seat, and the selection lift is anchored
 * once, under the base.
 */
function Casters({
  box,
  radius,
  selected,
  resting = RESTING_SHADOW,
  lift = true,
}: {
  box: Box;
  radius: CSSProperties['borderRadius'];
  selected: boolean;
  resting?: string;
  lift?: boolean;
}) {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{ ...box, borderRadius: radius, boxShadow: resting }}
      />
      {lift ? (
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
      ) : null}
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
  /**
   * What the browser window's address field shows. The preview reports its route
   * as it navigates, so the field follows the app instead of describing it.
   * `null` — no route known yet, no preview running — draws the field empty,
   * which is the honest picture; an address bar that invented a plausible URL
   * would be the most convincing lie on the canvas. Ignored by every family that
   * has no address bar.
   */
  address?: string | null;
  /**
   * The document title: the tab's label on a browser window, the title bar's on a
   * desktop one. `null` leaves both blank rather than falling back to the preset
   * name, which would put the name of a *format* where a page's title goes.
   */
  title?: string | null;
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

/* -------------------------------------------------------------------------- */
/* Laptop                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The hinge, in three 1px bands: the slot the lid closes into, the lit crown of
 * the barrel, and the underside turning away from the light. Hard stops rather
 * than a soft gradient, because a 3px gradient is a 1.5px gradient at 50% zoom and
 * reads as a grey smear; three flat bands stay three bands all the way down.
 */
const HINGE_HEIGHT = 3;
const HINGE_BANDS =
  'linear-gradient(180deg, ' +
  'rgb(6 7 9 / 0.72) 0px, rgb(6 7 9 / 0.72) 1px, ' +
  'rgb(255 255 255 / 0.22) 1px, rgb(255 255 255 / 0.22) 2px, ' +
  'rgb(10 12 16 / 0.58) 2px, rgb(10 12 16 / 0.58) 3px)';

/**
 * The lid's contact shadow on the deck. Short and hard — a lid sits millimetres
 * off the deck, so its shadow has almost no penumbra — and it is the single
 * strongest cue that the lid and the base are two objects at different depths.
 */
const HINGE_CONTACT =
  'linear-gradient(180deg, rgb(8 10 13 / 0.5) 0%, rgb(8 10 13 / 0.26) 42%, ' +
  'rgb(8 10 13 / 0.08) 78%, rgb(8 10 13 / 0) 100%)';

/**
 * The deck, lit as a surface that recedes: brightest where it meets the hinge and
 * faces up into the light, rolling into shade as it comes toward the viewer and
 * turns over the front edge. The clip-path is what makes it a receding plane
 * rather than a rectangle — it is as wide as the lid at the hinge and as wide as
 * the base at the front.
 */
const DECK_LIGHT =
  'linear-gradient(180deg, rgb(255 255 255 / 0.2) 0%, rgb(255 255 255 / 0.07) 34%, ' +
  'rgb(10 12 16 / 0.1) 72%, rgb(10 12 16 / 0.26) 100%)';

/**
 * The front lip: the edge nearest the viewer, so it catches the most light. One
 * flat pixel along the roll-over where the deck turns into it, then the lit face,
 * then the shade under the overhang.
 */
const LIP_LIGHT =
  'linear-gradient(180deg, ' +
  'rgb(255 255 255 / 0.3) 0px, rgb(255 255 255 / 0.3) 1px, ' +
  'rgb(255 255 255 / 0.13) 1px, rgb(255 255 255 / 0.04) 52%, rgb(10 12 16 / 0.12) 100%)';

/**
 * The lid, tilted a few degrees back. There is no `transform` anywhere on it and
 * there must not be: the display is positioned by `device-chassis.tsx` from
 * `geometry.screenOrigin`, in this element's coordinate space, so rotating or
 * skewing the art would leave the running app behind, flat and offset. The tilt is
 * therefore *lit* rather than drawn — the top of the lid leans away from the
 * light, the bottom leans into it — which is as much perspective as an object can
 * have while the thing inside it stays a plain rectangle.
 */
const LID_TILT =
  'linear-gradient(180deg, rgb(10 12 16 / 0.07) 0%, rgb(255 255 255 / 0) 46%, ' +
  'rgb(255 255 255 / 0.07) 100%)';

/**
 * The reflection on the panel glass.
 *
 * Deliberately much quieter than `GLASS_SHEEN`, which is drawn on the handhelds:
 * a laptop panel is matte-r and enormously larger, and a sweep tuned to read as
 * glass across 402pt reads as fog across 1440pt. It is also drawn on the *bezel*
 * — the black band around the panel — and not over the display, because a chassis
 * component may not paint above the screen element (see the file header, and
 * `device-chassis.tsx` on why the display is one shared element). The bezel is the
 * same sheet of glass as the panel, so a highlight running across it is the
 * honest half of the reflection: the half that is ours to draw.
 */
const BEZEL_SHEEN =
  'linear-gradient(128deg, rgb(255 255 255 / 0.055) 0%, rgb(255 255 255 / 0.018) 22%, ' +
  'rgb(255 255 255 / 0) 46%, rgb(255 255 255 / 0) 74%, rgb(255 255 255 / 0.014) 88%, ' +
  'rgb(255 255 255 / 0.032) 100%)';

/**
 * Laptop. A lid with a thin bezel, the hinge under it, and the base seen head-on:
 * the deck foreshortened into a trapezoid that widens toward the viewer, a
 * suggestion of the key area inside it, and the front lip with its finger recess.
 * That is all — no keys, no trackpad outline, nothing that would turn into mush at
 * 50% or invite you to read a brand off it.
 *
 * What makes it read as an object rather than a diagram is the lighting, and the
 * lighting has one direction: from above and slightly in front. Every surface is
 * shaded from that one assumption — the hinge crown is lit and its underside is
 * not, the deck is bright at the back and shaded at the roll-over, the lip's top
 * edge is the brightest line on the whole object, and the lid drops a hard short
 * shadow onto the deck immediately below it.
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

  // How far the lid's shadow reaches down the deck. Proportional, so it stays in
  // scale with the base, and clamped to a whole pixel like everything else.
  const contactHeight = Math.max(2, Math.round(deckHeight * 0.4));
  const keyTop = base.top + Math.round(deckHeight * 0.44);
  const keyHeight = Math.max(2, Math.round(deckHeight * 0.36));

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
      {/* The whole object's cast shadow, anchored under the base. A laptop is
          wider than it is tall and stands on its deck, so this is where it meets
          the bench — and the selection lift is anchored here too, once, rather
          than under each half. */}
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
          background: DECK_LIGHT,
          clipPath: `polygon(${chrome.left}px 0, ${base.width - chrome.right}px 0, 100% 100%, 0 100%)`,
        }}
      />

      {/* Key area: a single quiet band, sunk into the deck — dark at its top edge
          where the light cannot reach, one bright pixel along its bottom where the
          deck rises back out of it. Suggestion, not a keyboard. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          left: keyInset,
          top: keyTop,
          width: base.width - keyInset * 2,
          height: keyHeight,
          borderRadius: 2,
          background:
            'linear-gradient(180deg, rgb(10 12 16 / 0.26) 0%, rgb(10 12 16 / 0.13) 100%)',
          boxShadow: '0 1px 0 rgb(255 255 255 / 0.14)',
        }}
      />

      {/* Front lip, lit as the nearest edge. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          left: base.left,
          top: base.top + deckHeight,
          width: base.width,
          height: lipHeight,
          borderRadius: `0 0 ${frontRadius}px ${frontRadius}px`,
          background: LIP_LIGHT,
        }}
      />

      {/* Finger recess: a cut into the lip, so it is dark at the top and returns a
          bright line where the metal comes back up at the bottom. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          left: Math.round((base.width - recessWidth) / 2),
          top: base.top + deckHeight + Math.round(lipHeight * 0.3),
          width: recessWidth,
          height: Math.max(2, Math.round(lipHeight * 0.4)),
          borderRadius: 999,
          background:
            'linear-gradient(180deg, rgb(10 12 16 / 0.3) 0%, rgb(10 12 16 / 0.1) 100%)',
          boxShadow: '0 1px 0 rgb(255 255 255 / 0.2)',
        }}
      />

      {/* The lid's own casters, before the lid and after the deck, so its seat
          falls on the deck and not on the canvas. */}
      <Casters box={lid} radius={geometry.outerRadius} selected={selected} resting={LID_SHADOW} lift={false} />

      {/* The lid's shadow on the deck. After the casters so it stays hard, before
          the hinge so the hinge bands sit on top of it. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          left: lid.left,
          top: base.top + HINGE_HEIGHT,
          width: lid.width,
          height: contactHeight,
          background: HINGE_CONTACT,
        }}
      />

      {/* Hinge: the slot, the lit crown of the barrel, the dark underside — only
          as wide as the lid, because that is what closes onto it. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          left: lid.left,
          top: base.top,
          width: lid.width,
          height: HINGE_HEIGHT,
          background: HINGE_BANDS,
        }}
      />

      {/* Lid: rail, the tilt shading on it, then bezel, then the sheen. */}
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
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{ ...lid, borderRadius: geometry.outerRadius, background: LID_TILT }}
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
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          left: lid.left + preset.rail,
          top: lid.top + preset.rail,
          width: lid.width - preset.rail * 2,
          height: lid.height - preset.rail * 2,
          borderRadius: geometry.screenRadius + preset.bezel,
          background: BEZEL_SHEEN,
        }}
      />

      {/* Camera. In the bezel, where a laptop's is — never a hole in the display.
          A lens, not a dot: bright at the top where it catches the light, dark at
          the bottom of the well. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute rounded-full"
        style={{
          left: Math.round(lid.left + lid.width / 2) - 2,
          top: lid.top + preset.rail + Math.round((preset.bezel - 4) / 2),
          width: 4,
          height: 4,
          background:
            'radial-gradient(circle at 50% 32%, rgb(255 255 255 / 0.26) 0%, ' +
            'rgb(255 255 255 / 0.1) 55%, rgb(0 0 0 / 0.3) 100%)',
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

/* -------------------------------------------------------------------------- */
/* Windows                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The three toolbar glyphs.
 *
 * Drawn from primitives — two chevrons and a circular arrow — rather than traced
 * from any browser's icon set, for the same reason nothing else here is traced.
 *
 * They are chrome: shape, not function. None of them is wired to anything, so
 * none of them may look pressable — no hit area, no hover, no cursor, no button
 * affordance of any kind. They are drawn in the same grey as the window buttons,
 * which is also what a real browser does to back and forward when there is no
 * history to move through, and there is none here: the preview is one app, not a
 * session. Reload is drawn at the same weight deliberately. It would be *true* to
 * a browser to draw it enabled, and false to PhoneLab to draw an enabled-looking
 * control that does nothing — the studio has a real reload, in the device action
 * bar, where it can actually be clicked.
 */
function NavGlyph({
  kind,
  left,
  top,
  ink,
}: {
  kind: 'back' | 'forward' | 'reload';
  left: number;
  top: number;
  ink: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute"
      style={{ left, top }}
      width={GLYPH_SIZE}
      height={GLYPH_SIZE}
      viewBox="0 0 16 16"
      fill="none"
    >
      {kind === 'reload' ? (
        <>
          <path
            d="M12.78 7.58 A4.8 4.8 0 1 1 9.24 3.36"
            stroke={ink}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path d="M11.37 3.93 L8.85 4.81 L9.63 1.91 Z" fill={ink} />
        </>
      ) : (
        <path
          d={kind === 'back' ? 'M10 3.6 L5.6 8 L10 12.4' : 'M6 3.6 L10.4 8 L6 12.4'}
          stroke={ink}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

/**
 * Desktop and browser. A window: a frame, a chrome slab across the top, and the
 * app underneath it.
 *
 * The chrome slab is a layer *above* the page, and it is drawn as one: rounded
 * where the window is rounded, square along the bottom where it meets the content,
 * a lit pixel along its top edge, its own bottom edge shaded, and a hairline where
 * it ends. That last pair is the one place the physics are compromised, on
 * purpose and unavoidably: a real toolbar drops its shadow *onto* the page, and
 * the page here is the display element, which belongs to `device-chassis.tsx` and
 * which no chassis component may paint over (see the file header). So the boundary
 * is shaded on the chrome's own side — the slab's underside turning away from the
 * light — which is a true edge rather than a fake shadow on somebody else's
 * surface.
 *
 * The dots are the shape a window's buttons are and nothing more: no colour, no
 * glyphs, no vendor's rendering of them. The desktop window gets the frame, the
 * title bar and its title, and stops there — it has no tabs and no address,
 * because an application window does not have them.
 */
function Window({ preset, orientation, theme, selected, address, title }: SurfaceChassisProps) {
  const geometry = deviceGeometry(preset, orientation);
  const { chassis, chrome, inset } = geometry;
  const palette = theme === 'dark' ? DARK_WINDOW : LIGHT_WINDOW;
  const browser = preset.family === 'browser';
  const shell: Box = { left: 0, top: 0, width: chassis.width, height: chassis.height };

  const innerWidth = chassis.width - inset * 2;
  // The slab is inset from the outer edge by the frame, so its corners are the
  // outer radius less that inset — which is exactly `screenRadius`.
  const slabRadius = geometry.screenRadius;
  const dotTop = inset + Math.round((WINDOW_TITLE_BAR - DOT_SIZE) / 2);
  const boundary = inset + chrome.top - 1;

  // Tab: after the window buttons, at a tab's own width rather than the window's,
  // and clamped so a narrow format shrinks it instead of overflowing.
  const tabLeft = inset + CHROME_MARGIN + DOT_ROW + 16;
  const tabWidth = Math.min(TAB_MAX, chassis.width - inset - CHROME_MARGIN - tabLeft);

  const glyphTop = inset + WINDOW_TITLE_BAR + Math.round((BROWSER_ADDRESS_BAR - GLYPH_SIZE) / 2);
  const fieldTop = inset + WINDOW_TITLE_BAR + Math.round((BROWSER_ADDRESS_BAR - FIELD_HEIGHT) / 2);
  const fieldLeft = inset + CHROME_MARGIN + GLYPH_ROW + 14;
  const fieldWidth = chassis.width - inset - CHROME_MARGIN - fieldLeft;

  return (
    <>
      <Casters box={shell} radius={geometry.outerRadius} selected={selected} />

      {/* Shell: the window surface and its frame, in one element. This is also the
          toolbar's colour and the active tab's, which is what makes those two read
          as one continuous layer. */}
      <div
        className="absolute inset-0"
        style={{
          borderRadius: geometry.outerRadius,
          background: palette.shell,
          boxShadow: `inset 0 0 0 1px ${palette.frame}`,
        }}
      />

      {/* Tab strip.
          Chrome, in both senses: it is drawn furniture, and nothing in it is
          wired to anything. There is exactly ONE tab because there is exactly one
          app being previewed in this window — a second tab would represent
          nothing, and a "+" would be a control that cannot open anything. One tab
          is the true picture, so one tab is what is drawn. It sits a step deeper
          than the toolbar, the way a strip does, and the tab itself is the
          toolbar's colour so the two join under it. */}
      {browser ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute"
          style={{
            left: inset,
            top: inset,
            width: innerWidth,
            height: WINDOW_TITLE_BAR,
            background: palette.strip,
            borderRadius: `${slabRadius}px ${slabRadius}px 0 0`,
          }}
        />
      ) : null}

      {/* The chrome slab's lit top edge, along the inside of the frame. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          left: inset + slabRadius,
          top: inset,
          width: Math.max(0, innerWidth - slabRadius * 2),
          height: 1,
          background: palette.edge,
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

      {browser && tabWidth >= TAB_MIN ? (
        <div
          className="pointer-events-none absolute flex items-center"
          style={{
            left: tabLeft,
            top: inset + WINDOW_TITLE_BAR - TAB_HEIGHT,
            width: tabWidth,
            height: TAB_HEIGHT,
            paddingLeft: 10,
            paddingRight: 10,
            gap: 8,
            overflow: 'hidden',
            background: palette.shell,
            borderRadius: `${TAB_RADIUS}px ${TAB_RADIUS}px 0 0`,
            boxShadow: `inset 0 1px 0 ${palette.edge}`,
          }}
        >
          {/* Where a favicon goes, at the size one is drawn at. Left as a plain
              disc: PhoneLab has no icon for the app it is previewing, and drawing
              a mark that stood for something would be inventing one. */}
          <span
            aria-hidden="true"
            className="shrink-0 rounded-full"
            style={{ width: FAVICON_SIZE, height: FAVICON_SIZE, background: palette.dot }}
          />
          {title ? (
            <span
              className="truncate"
              style={{
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: '-0.006em',
                color: palette.text,
              }}
            >
              {title}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Title bar of an application window: its title, centred, clear of the
          buttons on both sides so it stays optically centred in the window. */}
      {!browser && title ? (
        <div
          className="pointer-events-none absolute flex items-center justify-center"
          style={{
            left: inset,
            top: inset,
            width: innerWidth,
            height: WINDOW_TITLE_BAR,
            paddingLeft: CHROME_MARGIN + DOT_ROW + 12,
            paddingRight: CHROME_MARGIN + DOT_ROW + 12,
          }}
        >
          <span
            className="truncate"
            style={{
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: '-0.006em',
              color: palette.text,
            }}
          >
            {title}
          </span>
        </div>
      ) : null}

      {browser ? (
        <>
          <NavGlyph kind="back" left={inset + CHROME_MARGIN} top={glyphTop} ink={palette.dot} />
          <NavGlyph
            kind="forward"
            left={inset + CHROME_MARGIN + (GLYPH_SIZE + GLYPH_GAP)}
            top={glyphTop}
            ink={palette.dot}
          />
          <NavGlyph
            kind="reload"
            left={inset + CHROME_MARGIN + (GLYPH_SIZE + GLYPH_GAP) * 2}
            top={glyphTop}
            ink={palette.dot}
          />

          {/* Address field. It shows the route the preview is actually on, and
              nothing at all when there is no route to show. */}
          <div
            className="pointer-events-none absolute flex items-center"
            style={{
              left: fieldLeft,
              top: fieldTop,
              width: Math.max(0, fieldWidth),
              height: FIELD_HEIGHT,
              paddingLeft: 12,
              paddingRight: 12,
              overflow: 'hidden',
              borderRadius: 999,
              background: palette.field,
              boxShadow: `inset 0 0 0 1px ${palette.fieldRing}`,
            }}
          >
            {address ? (
              <span
                className="truncate"
                style={{ fontSize: 13, letterSpacing: '-0.006em', color: palette.text }}
              >
                {address}
              </span>
            ) : null}
          </div>
        </>
      ) : null}

      {/* The chrome's shaded bottom edge, and the hairline where it ends. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          left: inset,
          top: boundary - UNDERSIDE_HEIGHT,
          width: innerWidth,
          height: UNDERSIDE_HEIGHT,
          background: palette.underside,
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          left: inset,
          top: boundary,
          width: innerWidth,
          height: 1,
          background: palette.hairline,
        }}
      />

      <SelectionRing radius={geometry.outerRadius + SELECTION_GAP} selected={selected} />
    </>
  );
}
