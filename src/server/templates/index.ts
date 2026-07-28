import { TEMPLATE_SOURCES, type TemplateFileSource } from '@/generated/templates';
import { DEFAULT_PRESET_ID } from '@/lib/devices/presets';

/**
 * Project templates.
 *
 * A template is a real, runnable project: files, the roles it supports, and the
 * device layout that best demonstrates it. `sourceKey` points at a bundle in
 * `src/generated/templates.ts`, which mirrors `templates/<name>/` on disk.
 */

export interface TemplateRole {
  slug: string;
  label: string;
  user: string | null;
}

export interface TemplateDevice {
  name: string;
  role: string;
  presetId: string;
  userLabel: string | null;
  x: number;
  y: number;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  tagline: string;
  summary: string;
  entryFile: string;
  sourceKey: string;
  roles: TemplateRole[];
  devices: TemplateDevice[];
  /**
   * Optional bundle whose files are laid over the base to produce a second
   * version — used by the PadelFlow demo so version comparison has a real diff.
   */
  variantSourceKey?: string;
  variantLabel?: string;
  variantDescription?: string;
  /** Highlights shown on the template card. Facts about the template, not marketing. */
  highlights: string[];
  /** Journeys created with the project, so replay works from the first minute. */
  journeys?: TemplateJourney[];
}

export interface TemplateJourney {
  name: string;
  description: string;
  steps: {
    kind: 'open' | 'navigate' | 'tap' | 'input' | 'wait' | 'event' | 'notification' | 'assert' | 'note';
    label: string;
    deviceRole: string | null;
    payload: Record<string, unknown>;
    waitMs: number;
  }[];
}

/**
 * The demo journey from the PadelFlow brief: a new player books a court for four,
 * the club accepts, and the player's screen updates.
 *
 * Steps target devices by *role* rather than id, so the journey keeps working when
 * phones are added or removed, and elements by the stable `data-pl-id` the template
 * puts on its interactive components.
 */
const PADELFLOW_JOURNEY: TemplateJourney = {
  name: 'New player books a court for four',
  description:
    'The player picks Court Central, invites three regulars, pays, and the club accepts — ' +
    'which flips the player’s booking status to confirmed.',
  steps: [
    { kind: 'navigate', label: 'Open the courts list', deviceRole: 'customer', payload: { route: '/' }, waitMs: 300 },
    { kind: 'tap', label: 'Choose Court Central', deviceRole: 'customer', payload: { target: 'court-c1' }, waitMs: 700 },
    { kind: 'tap', label: 'Pick the 18:00 slot', deviceRole: 'customer', payload: { target: 'slot-c1-s0' }, waitMs: 700 },
    { kind: 'tap', label: 'Invite Tom Rivière', deviceRole: 'customer', payload: { target: 'friend-p2' }, waitMs: 450 },
    { kind: 'tap', label: 'Invite Inès Cortes', deviceRole: 'customer', payload: { target: 'friend-p3' }, waitMs: 400 },
    { kind: 'tap', label: 'Invite Marc Delaunay', deviceRole: 'customer', payload: { target: 'friend-p4' }, waitMs: 400 },
    { kind: 'tap', label: 'Continue to review', deviceRole: 'customer', payload: { target: 'continue-review' }, waitMs: 600 },
    { kind: 'tap', label: 'Confirm and pay', deviceRole: 'customer', payload: { target: 'confirm-booking' }, waitMs: 900 },
    { kind: 'tap', label: 'Open the request on the club phone', deviceRole: 'provider', payload: { label: 'Léa Martin' }, waitMs: 1400 },
    { kind: 'tap', label: 'Accept the booking', deviceRole: 'provider', payload: { target: 'accept-request' }, waitMs: 800 },
    { kind: 'assert', label: 'Confirmed', deviceRole: 'customer', payload: {}, waitMs: 900 },
  ],
};

export const PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
  {
    id: 'padelflow',
    name: 'PadelFlow',
    tagline: 'Booking marketplace · 2 roles',
    summary:
      'Padel court booking with a player app and a club app that talk to each other. Includes cross-device events, notifications and a recorded journey.',
    entryFile: 'src/App.tsx',
    sourceKey: 'padelflow',
    roles: [
      { slug: 'customer', label: 'Player', user: 'Léa Martin' },
      { slug: 'provider', label: 'Club', user: 'Padel Central' },
      { slug: 'guest', label: 'Visitor', user: null },
    ],
    devices: [
      { name: 'Player', role: 'customer', presetId: DEFAULT_PRESET_ID, userLabel: 'Léa Martin', x: 0, y: 0 },
      { name: 'Club', role: 'provider', presetId: DEFAULT_PRESET_ID, userLabel: 'Padel Central', x: 620, y: 0 },
    ],
    variantSourceKey: 'padelflow-v2',
    variantLabel: 'V2 · One-step booking',
    variantDescription:
      'Players are pre-invited from the regular squad, so picking a slot goes straight to review. The invite screen stays reachable from review.',
    highlights: [
      '2 roles, one codebase',
      'Cross-device booking events',
      'Handles 9 edge-case flags',
      'Ships with V1 and V2 to compare',
    ],
    journeys: [PADELFLOW_JOURNEY],
  },
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'Minimal · 2 roles',
    summary:
      'A small shared-list app. The shortest path to seeing shared state, events and notifications working across two phones.',
    entryFile: 'src/App.tsx',
    sourceKey: 'starter',
    roles: [
      { slug: 'customer', label: 'Customer', user: 'Alex Moreau' },
      { slug: 'admin', label: 'Admin', user: 'Ops team' },
    ],
    devices: [
      { name: 'Customer', role: 'customer', presetId: DEFAULT_PRESET_ID, userLabel: 'Alex Moreau', x: 0, y: 0 },
      { name: 'Admin', role: 'admin', presetId: DEFAULT_PRESET_ID, userLabel: 'Ops team', x: 620, y: 0 },
    ],
    highlights: ['3 files to read', 'Shared state between phones', 'Good starting point for Claude'],
  },
] as const;

const BY_ID = new Map(PROJECT_TEMPLATES.map((template) => [template.id, template]));

export function getTemplate(id: string): ProjectTemplate | undefined {
  return BY_ID.get(id);
}

export function templateFiles(sourceKey: string): TemplateFileSource[] {
  return TEMPLATE_SOURCES[sourceKey] ?? [];
}

export function templateIds(): string[] {
  return PROJECT_TEMPLATES.map((template) => template.id);
}
