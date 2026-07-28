import { formatMoney, useDevice, useFlag } from '@phonelab/app';
import { listCourts, listSlots } from '../../data/courts';
import { dayLabel, slotLabel } from '../../lib/types';
import type { BookingDraft } from '../PlayerApp';
import { Card, Screen, SectionTitle } from '../../ui/Chrome';
import { Banner, EmptyState, Pill } from '../../ui/Feedback';
import { Clock } from '../../ui/icons';

export function CourtDetailScreen({
  courtId,
  draft,
  suspended,
  onBack,
  onPickSlot,
}: {
  courtId: string;
  draft: BookingDraft;
  suspended: boolean;
  onBack: () => void;
  onPickSlot: (slotId: string) => void;
}) {
  const device = useDevice();
  const soldOut = useFlag('sold-out');
  const longText = useFlag('long-text');

  const court = listCourts({ longText }).find((entry) => entry.id === courtId);
  const slots = court ? listSlots(court.id, { soldOut }) : [];
  const available = slots.filter((slot) => slot.available);

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
          <Pill>4 players</Pill>
          <Pill>Rackets available</Pill>
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
              <div className="pf-slot-note">{slot.available ? 'Available' : 'Taken'}</div>
            </button>
          ))}
        </div>
      )}

      {suspended ? <Banner tone="danger">Your account cannot make new bookings.</Banner> : null}
    </Screen>
  );
}
