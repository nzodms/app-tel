import type { ChassisMaterial } from '@/lib/devices/presets';

/**
 * Chassis materials, drawn entirely with CSS gradients.
 *
 * These are original approximations of brushed metal and coated aluminium: a
 * multi-stop gradient for the body, a whole-pixel edge profile for the machined
 * outer chamfer, and a dark line where the rail meets the glass. No vendor
 * assets, textures or images are involved anywhere in PhoneLab.
 *
 * ---------------------------------------------------------------------------
 * THE LIGHT — one source, stated once, obeyed by everything below.
 * ---------------------------------------------------------------------------
 *
 * A large soft source, high above the bench and 45° to the left of straight up:
 * the studio equivalent of a window at ten o'clock. Everything a device draws is
 * derived from that one fact, and nothing may contradict it:
 *
 *   - `LIGHT_AWAY_DEG` (135°) is the CSS gradient angle pointing *away* from the
 *     light, so 0% of any gradient below is the corner nearest it (top-left) and
 *     100% is the corner furthest from it (bottom-right). Every gradient in this
 *     file uses it; so does the glass reflection.
 *   - The face of the object is brightest at the top-left and falls off to the
 *     bottom-right. The top rail is lighter than the bottom rail; the left rail
 *     is lighter than the right one at the same height.
 *   - An edge that curves *toward* the light gets a specular band; the same edge
 *     on the opposite side of the object curves away and gets a dark one. That is
 *     `railRing` below, and it is why it is not symmetric.
 *   - A step *down* into the object (rail → bezel → glass) inverts: the wall on
 *     the light's side faces away and goes dark, the far wall faces the light and
 *     catches the lip. `phone.tsx` draws that inversion on the bezel.
 *   - Cast shadows fall down and imperceptibly to the right. The device elevation
 *     tokens in globals.css use a zero x-offset, which is honest at their blur
 *     radii: a source 45° off vertical would move a 56px-blurred shadow by a
 *     couple of pixels, well under what that blur can show.
 *
 * The angle is fixed in *screen* space, not in the device's. Turning a phone to
 * landscape does not move the studio's light, so the same corner of the bench
 * stays the bright one — which is what makes two devices at different rotations
 * look like two objects under one lamp rather than two independent renders.
 */

/**
 * The CSS gradient angle that runs away from the light. Read the light source
 * documented above before changing it: every highlight in this file, in
 * `phone.tsx` and in `surface-chassis.tsx` is oriented by it.
 */
export const LIGHT_AWAY_DEG = 135;

export interface ChassisStyle {
  /** Background of the rail (the metal band around the display). */
  rail: string;
  /**
   * The machined outer edge, as whole-pixel bands laid over the rail's outermost
   * two pixels. See the note on `EDGE PROFILE` below.
   */
  railRing: string;
  /** Side-button fill. */
  button: string;
  /** Colour of the bezel between rail and display. */
  bezel: string;
}

/**
 * EDGE PROFILE — how `railRing` is built, and why it is three box-shadows.
 *
 * The rail's outer edge is a chamfer: it leaves the flat face, curves over, and
 * turns down out of sight toward the bench. Seen from above that reads as two
 * bands, and they are not the same on every side of the object:
 *
 *   band [0px, 1px)  the very outside, curving down and away from the viewer on
 *                    all four sides — dark everywhere. Also the crisp silhouette,
 *                    paired with `--pl-shadow-device-contour` just outside it.
 *   band [1px, 2px)  the crest of the chamfer. On the top and left it turns into
 *                    the light and throws a specular band; on the bottom and
 *                    right it turns out of the light and goes darker still.
 *
 * Both bands are whole pixels, so they hold from 50% to 125% zoom (see the zoom
 * note in `phone.tsx`). The previous version specified 0.5px lines, which
 * collapse to almost nothing below 100% — the edge disappeared exactly when you
 * zoomed out to look at the whole canvas.
 *
 * The mechanism: box-shadows paint first-listed on top, and an inset shadow fills
 * the gap between the padding box and its own rect. So a uniform `inset 0 0 0 1px`
 * listed first owns [0px, 1px) all round; an `inset 1px 1px 0 1px` listed under it
 * covers [0px, 2px) on the top and left only, and therefore shows through as
 * exactly [1px, 2px) there; `inset -1px -1px 0 1px` does the same for the bottom
 * and right. Three shadows, four correctly-lit sides, no extra elements.
 */
function edgeProfile(rim: string, crest: string, shade: string): string {
  return (
    `inset 0 0 0 1px ${rim}, ` +
    `inset 1px 1px 0 1px ${crest}, ` +
    `inset -1px -1px 0 1px ${shade}`
  );
}

/**
 * Body gradients.
 *
 * Seven stops along `LIGHT_AWAY_DEG`, and — unlike the eight alternating light
 * and dark bands this used to be — they describe one lighting event rather than a
 * stripe pattern: a monotone falloff from the lit corner, with a single lift near
 * 84% where the bench bounces light back onto the underside of the frame just
 * before its far edge turns fully into shade. The old alternation put the left
 * and right rails at opposite phases of the same stripe, which is why the metal
 * never resolved into an object under a lamp.
 *
 * Each material keeps its own hue: titanium and aluminium warm (blue channel
 * lowest), graphite cool (blue channel highest), ceramic warm and very light.
 */
const STOPS = '0%, 12%, 28%, 46%, 68%, 84%, 100%';

function body(...ramp: [string, string, string, string, string, string, string]): string {
  const positions = STOPS.split(', ');
  return `linear-gradient(${LIGHT_AWAY_DEG}deg, ${ramp
    .map((colour, index) => `${colour} ${positions[index]}`)
    .join(', ')})`;
}

const TITANIUM: ChassisStyle = {
  rail: body('#d6d4cf', '#c2c0bb', '#acaaa5', '#94928d', '#7c7a75', '#84827d', '#5e5c57'),
  railRing: edgeProfile(
    'rgb(16 16 18 / 0.42)',
    'rgb(255 255 255 / 0.42)',
    'rgb(14 14 16 / 0.24)',
  ),
  button: 'linear-gradient(180deg, #c0beb9 0%, #a3a19c 34%, #8b8984 70%, #6f6d68 100%)',
  bezel: '#07080a',
};

const ALUMINIUM: ChassisStyle = {
  rail: body('#f0eeea', '#dedcd8', '#cac8c4', '#b6b4b0', '#a09e9a', '#a8a6a2', '#84827e'),
  railRing: edgeProfile(
    'rgb(22 22 24 / 0.34)',
    'rgb(255 255 255 / 0.60)',
    'rgb(20 20 22 / 0.20)',
  ),
  button: 'linear-gradient(180deg, #e2e0dc 0%, #c8c6c2 34%, #b0aeaa 70%, #94928e 100%)',
  bezel: '#0a0b0d',
};

const GRAPHITE: ChassisStyle = {
  rail: body('#56595e', '#46494e', '#3a3d42', '#2e3136', '#24272c', '#2a2d32', '#1a1d22'),
  railRing: edgeProfile('rgb(0 0 0 / 0.55)', 'rgb(255 255 255 / 0.20)', 'rgb(0 0 0 / 0.34)'),
  button: 'linear-gradient(180deg, #52555b 0%, #42454b 34%, #34373d 70%, #26292f 100%)',
  bezel: '#050607',
};

const CERAMIC: ChassisStyle = {
  rail: body('#fefcf8', '#f4f2ee', '#eae8e4', '#e0deda', '#d4d2ce', '#dad8d4', '#c4c2be'),
  railRing: edgeProfile(
    'rgb(28 28 30 / 0.24)',
    'rgb(255 255 255 / 0.85)',
    'rgb(26 26 28 / 0.16)',
  ),
  button: 'linear-gradient(180deg, #f6f4f0 0%, #e6e4e0 34%, #d4d2ce 70%, #bebcb8 100%)',
  bezel: '#0c0d10',
};

const MATERIALS: Record<ChassisMaterial, ChassisStyle> = {
  titanium: TITANIUM,
  aluminium: ALUMINIUM,
  graphite: GRAPHITE,
  ceramic: CERAMIC,
};

export function chassisStyle(material: ChassisMaterial): ChassisStyle {
  return MATERIALS[material];
}

/**
 * The glass reflection.
 *
 * Three layers, one `background`, because `device-chassis.tsx` paints it on a
 * single element at 0.75 opacity and that element is above the app:
 *
 *   1. the source itself, reflected — a soft wash off the top-left corner along
 *      `LIGHT_AWAY_DEG`, plus the much fainter grazing return on the far corner;
 *   2. the top and bottom glass edges;
 *   3. the left and right glass edges.
 *
 * (2) and (3) are what turns a flat wash into curved glass. A phone's cover glass
 * rolls off in the last two or three millimetres before it meets the frame, and
 * that roll is a curved mirror: it gathers the whole room into a thin bright line
 * where the flat middle gathers almost nothing. The falloffs are therefore given
 * in absolute pixels rather than percentages — the glass edge is the same
 * physical width on a 360pt phone and a 1366pt tablet, so it must not scale with
 * the panel. The two edges facing the light get more than the two facing away,
 * which are only picking up bounce off the bench.
 *
 * It stays quiet on purpose. Peak white is ~0.16 before the host's 0.75, i.e.
 * ~0.12 on screen, and only in the outermost pixels of the lit corner; over the
 * app's content it is roughly a third of what it was, because the wash now decays
 * by 30% of the panel instead of 34% and starts lower. An app must always be
 * easier to read than the reflection is to notice.
 */
export const GLASS_SHEEN =
  `linear-gradient(${LIGHT_AWAY_DEG}deg, rgba(255,255,255,0.085) 0%, ` +
  'rgba(255,255,255,0.032) 14%, rgba(255,255,255,0) 30%, rgba(255,255,255,0) 68%, ' +
  'rgba(255,255,255,0.018) 86%, rgba(255,255,255,0.05) 100%), ' +
  'linear-gradient(to bottom, rgba(255,255,255,0.045) 0px, rgba(255,255,255,0) 14px, ' +
  'rgba(255,255,255,0) calc(100% - 10px), rgba(255,255,255,0.018) 100%), ' +
  'linear-gradient(to right, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0) 12px, ' +
  'rgba(255,255,255,0) calc(100% - 10px), rgba(255,255,255,0.016) 100%)';
