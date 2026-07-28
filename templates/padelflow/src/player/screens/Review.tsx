import { useState } from 'react';
import {
  formatMoney,
  logEvent,
  notify,
  sendEvent,
  useDevice,
  useFlag,
  useNetwork,
} from '@phonelab/app';
import { SUGGESTED_FRIENDS, listCourts, listSlots } from '../../data/courts';
import { initialsOf, slotLabel, type Booking, type Player } from '../../lib/types';
import type { BookingDraft } from '../PlayerApp';
import { Card, Screen, SectionTitle } from '../../ui/Chrome';
import { Button } from '../../ui/Controls';
import { Banner, EmptyState } from '../../ui/Feedback';
import { AvatarStack } from '../../ui/Avatars';
import { Clock } from '../../ui/icons';

/**
 * Review and pay.
 *
 * This is where the cross-device story starts: on success the booking is written
 * to shared state by the caller and `booking.requested` is emitted to the club
 * phone, which is what makes its Dynamic Island expand.
 */
export function ReviewScreen({
  draft,
  onBack,
  onBooked,
  onEditPlayers,
}: {
  draft: BookingDraft;
  onBack: () => void;
  onBooked: (booking: Booking) => void;
  /** Provided by the one-step flow, where players are chosen before this screen. */
  onEditPlayers?: () => void;
}) {
  const device = useDevice();
  const network = useNetwork();
  const paymentDeclined = useFlag('payment-declined');
  const sessionExpired = useFlag('session-expired');
  const longText = useFlag('long-text');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const court = listCourts({ longText }).find((entry) => entry.id === draft.courtId);
  const slot = court ? listSlots(court.id, { soldOut: false }).find((entry) => entry.id === draft.slotId) : undefined;

  if (!court || !slot) {
    return (
      <Screen title="Review" onBack={onBack}>
        <EmptyState icon={<Clock size={22} />} title="Nothing to review" body="Pick a court and a time first." />
      </Screen>
    );
  }

  const organiser: Player = {
    id: 'me',
    name: device.userLabel ?? 'Guest',
    initials: initialsOf(device.userLabel ?? 'Guest'),
  };
  const friends: Player[] = SUGGESTED_FRIENDS.filter((friend) => draft.friendIds.includes(friend.id)).map(
    (friend) => ({ id: friend.id, name: friend.name, initials: initialsOf(friend.name) }),
  );
  const players = [organiser, ...friends];
  const total = Math.round((court.pricePerHourCents * slot.durationMinutes) / 60);
  const perPlayer = Math.round(total / players.length);

  const confirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await network.request(() => {
        if (sessionExpired) throw new Error('Your session expired. Sign in again to finish booking.');
        if (paymentDeclined) throw new Error('Card declined by your bank. Try another payment method.');
        return true;
      });

      const booking: Booking = {
        id: `bk_${Date.now().toString(36)}`,
        courtId: court.id,
        courtName: court.name,
        slotId: slot.id,
        startsAt: slot.startsAt,
        durationMinutes: slot.durationMinutes,
        players,
        totalCents: total,
        status: 'pending',
        requestedBy: organiser.name,
        requestedAt: new Date().toISOString(),
        decidedAt: null,
        note: draft.note.trim() === '' ? null : draft.note.trim(),
        declineReason: null,
      };

      // Tell the club phone. PhoneLab routes this to every device with the
      // `provider` role and records it on the timeline.
      sendEvent('booking.requested', booking, { to: 'provider' });
      logEvent(`Booking request sent for ${court.name}`);
      notify({
        title: 'Request sent',
        body: 'Waiting for the club to confirm.',
        island: 'activity',
        islandLabel: 'Awaiting club',
        kind: 'default',
      });
      onBooked(booking);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Payment failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen
      title="Review & pay"
      onBack={onBack}
      footer={
        <>
          <div className="pf-footer-summary">
            <span>
              {players.length} player{players.length === 1 ? '' : 's'} · {formatMoney(perPlayer)} each
            </span>
            <span className="pf-footer-total">{formatMoney(total)}</span>
          </div>
          <Button onClick={confirm} disabled={submitting} testId="confirm-booking">
            {submitting ? 'Confirming…' : 'Confirm and pay'}
          </Button>
        </>
      }
    >
      <Card>
        <div className="pf-court-head">
          <div className="pf-court-name">{court.name}</div>
        </div>
        <div className="pf-court-meta">
          <Clock size={13} />
          {slotLabel(slot.startsAt, slot.durationMinutes, device.locale)}
        </div>
      </Card>

      <SectionTitle>Players</SectionTitle>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <AvatarStack players={players} />
          {onEditPlayers ? (
            <button className="pf-btn pf-btn--ghost" style={{ width: 'auto' }} onClick={onEditPlayers} data-pl-id="edit-players">
              Edit players
            </button>
          ) : (
            <span className="pf-row-sub">Split evenly</span>
          )}
        </div>
      </Card>

      {draft.note.trim() !== '' ? (
        <>
          <SectionTitle>Note to the club</SectionTitle>
          <Card>
            <div className="pf-row-sub">{draft.note}</div>
          </Card>
        </>
      ) : null}

      {error ? <Banner tone="danger">{error}</Banner> : null}
    </Screen>
  );
}
