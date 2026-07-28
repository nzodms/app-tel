import type { ChassisMaterial } from '@/lib/devices/presets';

/**
 * Chassis materials, drawn entirely with CSS gradients.
 *
 * These are original approximations of brushed metal and coated aluminium: a
 * multi-stop diagonal gradient for the body, a bright hairline for the machined
 * outer edge, and a dark inner line where the rail meets the glass. No vendor
 * assets, textures or images are involved anywhere in PhoneLab.
 */

export interface ChassisStyle {
  /** Background of the rail (the metal band around the display). */
  rail: string;
  /** Outer/inner hairlines that read as machined metal. */
  railRing: string;
  /** Side-button fill. */
  button: string;
  /** Colour of the bezel between rail and display. */
  bezel: string;
}

const TITANIUM: ChassisStyle = {
  rail:
    'linear-gradient(142deg, #d5d3ce 0%, #8d8b86 14%, #b6b4ae 27%, #6e6c67 43%, ' +
    '#9c9a94 58%, #5f5d59 74%, #a8a6a0 88%, #79776f 100%)',
  railRing:
    'inset 0 0 0 0.5px rgba(255,255,255,0.5), inset 0 0 0 1.5px rgba(24,24,26,0.22), ' +
    '0 0 0 0.5px rgba(20,20,22,0.35)',
  button:
    'linear-gradient(180deg, #7c7a75 0%, #a9a7a1 28%, #6d6b66 72%, #8e8c86 100%)',
  bezel: '#07080a',
};

const ALUMINIUM: ChassisStyle = {
  rail:
    'linear-gradient(142deg, #eceae6 0%, #b3b1ac 15%, #dcdad5 30%, #9a9893 46%, ' +
    '#cfcdc8 60%, #8d8b86 76%, #d6d4cf 90%, #a5a39d 100%)',
  railRing:
    'inset 0 0 0 0.5px rgba(255,255,255,0.68), inset 0 0 0 1.5px rgba(30,30,32,0.18), ' +
    '0 0 0 0.5px rgba(24,24,26,0.3)',
  button: 'linear-gradient(180deg, #a6a49f 0%, #d3d1cc 30%, #9b9994 70%, #bebcb7 100%)',
  bezel: '#0a0b0d',
};

const GRAPHITE: ChassisStyle = {
  rail:
    'linear-gradient(142deg, #4a4d52 0%, #2a2c30 16%, #3f4247 32%, #23252a 48%, ' +
    '#3a3d42 62%, #1f2126 78%, #41444a 92%, #2b2d32 100%)',
  railRing:
    'inset 0 0 0 0.5px rgba(255,255,255,0.14), inset 0 0 0 1.5px rgba(0,0,0,0.5), ' +
    '0 0 0 0.5px rgba(0,0,0,0.55)',
  button: 'linear-gradient(180deg, #33363b 0%, #4d5056 30%, #2b2e33 70%, #3d4046 100%)',
  bezel: '#050607',
};

const CERAMIC: ChassisStyle = {
  rail:
    'linear-gradient(142deg, #fbfaf8 0%, #dedcd7 18%, #f4f2ee 34%, #cfcdc8 52%, ' +
    '#eeece8 68%, #d6d4cf 84%, #f7f5f1 100%)',
  railRing:
    'inset 0 0 0 0.5px rgba(255,255,255,0.9), inset 0 0 0 1.5px rgba(40,40,42,0.12), ' +
    '0 0 0 0.5px rgba(30,30,32,0.22)',
  button: 'linear-gradient(180deg, #d8d6d1 0%, #f1efeb 30%, #cbc9c4 70%, #e4e2dd 100%)',
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
 * The glass highlight. A single wide, very low-opacity sweep — enough to read as
 * glass, not enough to interfere with the app underneath.
 */
export const GLASS_SHEEN =
  'linear-gradient(128deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.05) 18%, ' +
  'rgba(255,255,255,0) 34%, rgba(255,255,255,0) 66%, rgba(255,255,255,0.035) 84%, ' +
  'rgba(255,255,255,0.09) 100%)';
