/**
 * Edge Case Studio.
 *
 * Every entry is a real switch with a real effect, applied per device:
 *
 *  - `network` flags change the device's simulated connection, which the SDK's
 *    `useNetwork().request()` honours (latency, or a rejected promise offline);
 *  - `chrome` flags are drawn by the phone chrome (keyboard, permission sheets);
 *  - `app` flags are read by the project through `useFlag()`, so the app decides
 *    what "payment declined" or "empty list" means for its own screens;
 *  - `device` flags change device configuration (theme, locale, preset).
 *
 * Nothing here is cosmetic-only. If a template does not handle an `app` flag, the
 * flag chip shows as "not handled by this project" instead of pretending.
 */

export type EdgeCaseChannel = 'network' | 'chrome' | 'app' | 'device';

export interface EdgeCaseDefinition {
  id: string;
  label: string;
  description: string;
  channel: EdgeCaseChannel;
  group: 'Connection' | 'Failures' | 'Data' | 'Permissions' | 'Presentation' | 'Account';
  /** Flags that cannot be active at the same time. */
  exclusiveWith?: readonly string[];
}

export const EDGE_CASES: readonly EdgeCaseDefinition[] = [
  {
    id: 'slow-network',
    label: 'Slow connection',
    description: 'Adds ~2.2s of latency to every simulated request.',
    channel: 'network',
    group: 'Connection',
    exclusiveWith: ['offline'],
  },
  {
    id: 'offline',
    label: 'Offline',
    description: 'Simulated requests reject with an offline error.',
    channel: 'network',
    group: 'Connection',
    exclusiveWith: ['slow-network'],
  },
  {
    id: 'server-error',
    label: 'Server error',
    description: 'The project’s data layer returns a 500-style failure.',
    channel: 'app',
    group: 'Failures',
  },
  {
    id: 'payment-declined',
    label: 'Payment declined',
    description: 'Payment attempts fail with a declined card.',
    channel: 'app',
    group: 'Failures',
  },
  {
    id: 'session-expired',
    label: 'Session expired',
    description: 'The signed-in session is treated as stale on the next action.',
    channel: 'app',
    group: 'Account',
  },
  {
    id: 'signed-out',
    label: 'Signed out',
    description: 'No user session at all — the app should show its public state.',
    channel: 'app',
    group: 'Account',
  },
  {
    id: 'user-suspended',
    label: 'Account suspended',
    description: 'The signed-in account is blocked from acting.',
    channel: 'app',
    group: 'Account',
  },
  {
    id: 'empty-list',
    label: 'No data',
    description: 'Collections come back empty so empty states are visible.',
    channel: 'app',
    group: 'Data',
  },
  {
    id: 'sold-out',
    label: 'Nothing available',
    description: 'Everything bookable/purchasable is unavailable.',
    channel: 'app',
    group: 'Data',
  },
  {
    id: 'long-text',
    label: 'Very long text',
    description: 'Names and descriptions use worst-case lengths.',
    channel: 'app',
    group: 'Data',
  },
  {
    id: 'gps-denied',
    label: 'Location denied',
    description: 'Location permission is refused; shows the app’s fallback.',
    channel: 'app',
    group: 'Permissions',
  },
  {
    id: 'camera-denied',
    label: 'Camera denied',
    description: 'Camera permission is refused.',
    channel: 'app',
    group: 'Permissions',
  },
  {
    id: 'notifications-disabled',
    label: 'Notifications off',
    description: 'The device chrome suppresses banners and Dynamic Island alerts.',
    channel: 'chrome',
    group: 'Permissions',
  },
  {
    id: 'keyboard-open',
    label: 'Keyboard open',
    description: 'Reserves the keyboard area and draws the keyboard over the app.',
    channel: 'chrome',
    group: 'Presentation',
  },
] as const;

const BY_ID = new Map(EDGE_CASES.map((entry) => [entry.id, entry]));

export function getEdgeCase(id: string): EdgeCaseDefinition | undefined {
  return BY_ID.get(id);
}

/** Applies a flag, removing anything it is exclusive with. */
export function toggleFlag(flags: readonly string[], id: string): string[] {
  if (flags.includes(id)) return flags.filter((flag) => flag !== id);
  const definition = BY_ID.get(id);
  const excluded = new Set(definition?.exclusiveWith ?? []);
  return [...flags.filter((flag) => !excluded.has(flag)), id];
}

export function edgeCaseGroups(): { group: string; entries: EdgeCaseDefinition[] }[] {
  const groups = new Map<string, EdgeCaseDefinition[]>();
  for (const entry of EDGE_CASES) {
    const list = groups.get(entry.group) ?? [];
    list.push(entry);
    groups.set(entry.group, list);
  }
  return [...groups.entries()].map(([group, entries]) => ({ group, entries }));
}

/** Flags that map onto the device's simulated network condition. */
export function networkFromFlags(flags: readonly string[]): 'fast' | 'slow' | 'offline' {
  if (flags.includes('offline')) return 'offline';
  if (flags.includes('slow-network')) return 'slow';
  return 'fast';
}
