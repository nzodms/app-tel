import { useState } from 'react';
import { formatMoney, sendEvent, useDevice, useFlag, useNetwork } from '@phonelab/app';
import { dayLabel, slotLabel, type Booking } from '../../lib/types';
import { Card, Screen, SectionTitle } from '../../ui/Chrome';
import { Button } from '../../ui/Controls';
import { Banner, EmptyState } from '../../ui/Feedback';
import { AvatarStack } from '../../ui/Avatars';
import { Inbox } from '../../ui/icons';

export function RequestDetailScreen({
  booking,
  onBack,
  onDecide,
}: {
  booking: Booking | null;
  onBack: () => void;
  onDecide: (bookingId: string, status: 'accepted' | 'declined', reason?: string) => void;
}) {
  const device = useDevice();
  const network = useNetwork();
  const serverError = useFlag('server-error');
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!booking) {
    return (
      <Screen title="Request" onBack={onBack}>
        <EmptyState icon={<Inbox size={22} />} title="Request not found" body="It may have been withdrawn." />
      </Screen>
    );
  }

  const respond = async (status: 'accepted' | 'declined') => {
    setBusy(status === 'accepted' ? 'accept' : 'decline');
    setError(null);
    try {
      await network.request(() => {
        if (serverError) throw new Error('Could not reach the booking service. Try again.');
        return true;
      });

      // Tell the player's phone. PhoneLab records this on the timeline too.
      sendEvent(
        status === 'accepted' ? 'booking.accepted' : 'booking.declined',
        {
          bookingId: booking.id,
          courtName: booking.courtName,
          reason: status === 'declined' ? 'The court was taken by another group.' : null,
        },
        { to: 'customer' },
      );
      onDecide(booking.id, status);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  const decided = booking.status !== 'pending';

  return (
    <Screen
      title={booking.requestedBy}
      subtitle={dayLabel(booking.startsAt, device.locale)}
      onBack={onBack}
      footer={
        decided ? null : (
          <>
            <Button onClick={() => respond('accepted')} disabled={busy !== null} testId="accept-request">
              {busy === 'accept' ? 'Confirming…' : 'Accept booking'}
            </Button>
            <Button
              variant="danger"
              onClick={() => respond('declined')}
              disabled={busy !== null}
              testId="decline-request"
            >
              {busy === 'decline' ? 'Declining…' : 'Decline'}
            </Button>
          </>
        )
      }
    >
      <Card>
        <div className="pf-court-head">
          <div className="pf-court-name">{booking.courtName}</div>
          <div className="pf-price">{formatMoney(booking.totalCents)}</div>
        </div>
        <div className="pf-court-meta">
          <span>{slotLabel(booking.startsAt, booking.durationMinutes, device.locale)}</span>
          <span className="pf-dot" />
          <span>{booking.durationMinutes} min</span>
        </div>
      </Card>

      <SectionTitle>Players</SectionTitle>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <AvatarStack players={booking.players} max={4} />
          <span className="pf-row-sub">
            {booking.players.length} of 4
          </span>
        </div>
        <div style={{ marginTop: 10 }}>
          {booking.players.map((player) => (
            <div className="pf-row" key={player.id}>
              <div className="pf-row-main">
                <div className="pf-row-title">{player.name}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {booking.note ? (
        <>
          <SectionTitle>Note from the player</SectionTitle>
          <Card>
            <div className="pf-row-sub">{booking.note}</div>
          </Card>
        </>
      ) : null}

      {decided ? (
        <Banner tone={booking.status === 'accepted' ? 'info' : 'warning'}>
          You already {booking.status === 'accepted' ? 'accepted' : 'declined'} this request.
        </Banner>
      ) : null}

      {error ? <Banner tone="danger">{error}</Banner> : null}
    </Screen>
  );
}
