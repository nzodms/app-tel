/**
 * Domain types for a generated project.
 *
 * The *shape* is fixed; the vocabulary comes from `src/lib/config.ts`, which
 * PhoneLab generates from the brief you gave during onboarding. Rename anything
 * here — it is your code now.
 */

export type RequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface Participant {
  id: string;
  name: string;
  initials: string;
}

/** A thing the requester browses and asks for: a court, a listing, a meal, a slot. */
export interface CatalogItem {
  id: string;
  title: string;
  subtitle: string;
  tags: string[];
  priceCents: number;
  rating: number;
  available: boolean;
}

/** What one side asks for and the other side answers. */
export interface DemandRecord {
  id: string;
  itemId: string;
  itemTitle: string;
  quantity: number;
  totalCents: number;
  status: RequestStatus;
  requestedBy: string;
  requestedAt: string;
  decidedAt: string | null;
  note: string | null;
  declineReason: string | null;
  participants: Participant[];
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function statusLabel(status: RequestStatus, waitingLabel: string): string {
  switch (status) {
    case 'pending':
      return waitingLabel;
    case 'accepted':
      return 'Confirmed';
    case 'declined':
      return 'Declined';
    case 'cancelled':
      return 'Cancelled';
  }
}

export function statusTone(status: RequestStatus): 'positive' | 'warning' | 'danger' {
  if (status === 'accepted') return 'positive';
  if (status === 'declined' || status === 'cancelled') return 'danger';
  return 'warning';
}
