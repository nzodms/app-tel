import type { Court, Slot } from '../lib/types';

/**
 * Demo data for PadelFlow.
 *
 * Deliberately fixed rather than random so journeys replay identically and two
 * versions can be compared side by side. Slot times are generated relative to a
 * fixed reference hour of *today*, which keeps the UI sensible without making
 * runs non-deterministic within a session.
 */

const LONG_SUFFIX =
  ' — Centre Sportif Municipal Jean-Baptiste de la Vallée Verte (entrée côté parking nord)';

export function listCourts(options: { longText: boolean }): Court[] {
  const courts: Court[] = [
    {
      id: 'c1',
      name: 'Court Central',
      surface: 'Panoramic',
      indoor: true,
      pricePerHourCents: 3200,
      rating: 4.8,
      distanceKm: 1.2,
    },
    {
      id: 'c2',
      name: 'Court 2 · Glass',
      surface: 'Glass',
      indoor: true,
      pricePerHourCents: 2800,
      rating: 4.6,
      distanceKm: 1.2,
    },
    {
      id: 'c3',
      name: 'Court Terrasse',
      surface: 'Outdoor',
      indoor: false,
      pricePerHourCents: 2200,
      rating: 4.3,
      distanceKm: 2.8,
    },
  ];

  if (!options.longText) return courts;
  return courts.map((court) => ({ ...court, name: court.name + LONG_SUFFIX }));
}

/** 18:00 today, local time — the reference hour all demo slots hang off. */
function referenceHour(): Date {
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0, 0);
  return base;
}

export function listSlots(courtId: string, options: { soldOut: boolean }): Slot[] {
  const base = referenceHour();
  const offsets = [0, 90, 180, 270];
  // Fixed availability pattern per court so the demo is reproducible.
  const patterns: Record<string, boolean[]> = {
    c1: [true, false, true, true],
    c2: [true, true, false, true],
    c3: [false, true, true, false],
  };
  const pattern = patterns[courtId] ?? [true, true, true, true];

  return offsets.map((minutes, index) => ({
    id: `${courtId}-s${index}`,
    courtId,
    startsAt: new Date(base.getTime() + minutes * 60_000).toISOString(),
    durationMinutes: 90,
    available: options.soldOut ? false : (pattern[index] ?? true),
  }));
}

export const SUGGESTED_FRIENDS = [
  { id: 'p2', name: 'Tom Rivière' },
  { id: 'p3', name: 'Inès Cortes' },
  { id: 'p4', name: 'Marc Delaunay' },
  { id: 'p5', name: 'Sofia Haddad' },
];
