/** Shared domain types for PadelFlow. Used by both the player and club apps. */

export type BookingStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface Player {
  id: string;
  name: string;
  initials: string;
}

export interface Court {
  id: string;
  name: string;
  surface: 'Glass' | 'Panoramic' | 'Outdoor';
  indoor: boolean;
  pricePerHourCents: number;
  rating: number;
  distanceKm: number;
}

export interface Slot {
  id: string;
  courtId: string;
  /** ISO timestamp of the slot start. */
  startsAt: string;
  durationMinutes: number;
  available: boolean;
}

export interface Booking {
  id: string;
  courtId: string;
  courtName: string;
  slotId: string;
  startsAt: string;
  durationMinutes: number;
  players: Player[];
  totalCents: number;
  status: BookingStatus;
  requestedBy: string;
  requestedAt: string;
  decidedAt: string | null;
  note: string | null;
  /** Set when the club declines, so the player sees a reason. */
  declineReason: string | null;
}

export function statusLabel(status: BookingStatus): string {
  switch (status) {
    case 'pending':
      return 'Awaiting the club';
    case 'accepted':
      return 'Confirmed';
    case 'declined':
      return 'Declined';
    case 'cancelled':
      return 'Cancelled';
  }
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function slotLabel(startsAt: string, durationMinutes: number, locale: string): string {
  const start = new Date(startsAt);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const formatter = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

export function dayLabel(startsAt: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(startsAt));
}
