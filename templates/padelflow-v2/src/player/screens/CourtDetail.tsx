import { formatMoney, useDevice, useFlag } from '@phonelab/app';
import { SUGGESTED_FRIENDS, listCourts, listSlots } from '../../data/courts';
import { dayLabel, slotLabel } from '../../lib/types';
import type { BookingDraft } from '../PlayerApp';
import { Card, Screen, SectionTitle } from '../../ui/Chrome';
import { Banner, EmptyState, Pill } from '../../ui/Feedback';
import { Clock, Users } from '../../ui/icons';

/**
 * V2 — court detail with the squad picked inline.
 *
 * The number of players is chosen here, so tapping a slot is the last step before
 * review. This is the change V2 exists to test.
 */
export function CourtDetailScreen({
  courtId,
  draft,
  suspended,
  onBack,
  onChange,
  onPickSlot,
}: {
  courtId: string;
  draft: BookingDraft;
  suspended: boolean;
  onBack: () => void;
  onChange: (patch: Partial<BookingDraft>) => void;
  onPickSlot: (slotId: string) => void;
}) {
  const device = useDevice();
  const soldOut = useFlag('sold-out');
  const longText = useFlag('long-text');

  const court = listCourts({ longText }).find((entry) => entry.id === courtId);
  const slots = court ? listSlots(court.id, { soldOut }) : [];
  const available = slots.filter((slot) => slot.available);
  const playerCount = draft.friendIds.length + 1;

  const setPlayerCount = (count: number) => {
    const friends = SUGGESTED_FRIENDS.slice(0, Math.max(0, count - 1)).map((friend) => friend.id);
    onChange({ friendIds: friends });
  };

  if (!court) {
    return (
      <Screen title="Court" onBack={onBack}>
        <EmptyState icon={<Clock size={22} />} title="Court unavailable" body="This court is no longer listed." />
      </Screen>
    );
  }

  return (
    <Screen title={court.name} subtitle={`${court.surface} · ${court.indoor ? 'Indoor' : 'Outdoor'}`} onBack={onBack}>
      <Card>
        <div className="pf-court-head">
          <div className="pf-court-name">{dayLabel(slots[0]?.startsAt ?? new Date().toISOString(), device.locale)}</div>
          <div className="pf-price">
            {formatMoney(court.pricePerHourCents)}
            <small>/h</small>
          </div>
        </div>
        <div className="pf-court-meta">
          <Pill tone="accent">90 min slots</Pill>
          <Pill>Rackets available</Pill>
        </div>
      </Card>

      <SectionTitle>Players</SectionTitle>
      <Card>
        <div className="pf-row" style={{ borderBottom: 0 }}>
          <span style={{ color: 'var(--app-fg-muted)' }}>
            <Users size={18} />
          </span>
          <div className="pf-row-main">
            <div className="pf-row-title">Your regular squad</div>
            <div className="pf-row-sub">
              {playerCount} player{playerCount === 1 ? '' : 's'} · invited automatically
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[2, 3, 4].map((count) => (
              <button
                key={count}
                className="pf-slot"
                style={{ padding: '6px 11px', minWidth: 0 }}
                data-selected={playerCount === count ? 'true' : 'false'}
                data-pl-id={`players-${count}`}
                onClick={() => setPlayerCount(count)}
              >
                <span className="pf-slot-time">{count}</span>
              </button>
            ))}
          </div>
        </div>
      </Card>

      <SectionTitle>Choose a time</SectionTitle>

      {available.length === 0 ? (
        <EmptyState
          icon={<Clock size={22} />}
          title="Fully booked"
          body="Every slot for this court is taken today. Try another court or another day."
        />
      ) : (
        <div className="pf-slots">
          {slots.map((slot) => (
            <button
              key={slot.id}
              className="pf-slot"
              disabled={!slot.available || suspended}
              data-selected={draft.slotId === slot.id ? 'true' : 'false'}
              data-pl-id={`slot-${slot.id}`}
              onClick={() => onPickSlot(slot.id)}
            >
              <div className="pf-slot-time">{slotLabel(slot.startsAt, slot.durationMinutes, device.locale)}</div>
              <div className="pf-slot-note">{slot.available ? `Book for ${playerCount}` : 'Taken'}</div>
            </button>
          ))}
        </div>
      )}

      {suspended ? <Banner tone="danger">Your account cannot make new bookings.</Banner> : null}
    </Screen>
  );
}
