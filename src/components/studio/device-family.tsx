'use client';

import { AppWindow, Laptop, Monitor, Smartphone, Tablet } from 'lucide-react';
import type { DeviceFamily } from '@/lib/devices/presets';

/**
 * How a device family is named and drawn in menus.
 *
 * One module, because the format picker on a device and the "add a device" menu
 * in the toolbar must agree: if the toolbar groups tablets under "Tablet" and the
 * action bar calls the same thing "iPad", the catalogue reads as two catalogues.
 *
 * The labels describe *form factors*, never manufacturers — the same rule the
 * preset names follow, and the reason the note under every one of these menus can
 * say PhoneLab is not affiliated with anyone and mean it.
 */

export const FAMILY_ORDER: readonly DeviceFamily[] = [
  'phone',
  'tablet',
  'laptop',
  'desktop',
  'browser',
];

export const FAMILY_LABELS: Record<DeviceFamily, string> = {
  phone: 'Phone',
  tablet: 'Tablet',
  laptop: 'Laptop',
  desktop: 'Desktop',
  browser: 'Browser window',
};

const ICONS = {
  phone: Smartphone,
  tablet: Tablet,
  laptop: Laptop,
  desktop: Monitor,
  browser: AppWindow,
} as const satisfies Record<DeviceFamily, unknown>;

export function FamilyIcon({ family, size = 12 }: { family: DeviceFamily; size?: number }) {
  const Icon = ICONS[family];
  return <Icon size={size} strokeWidth={1.8} />;
}
