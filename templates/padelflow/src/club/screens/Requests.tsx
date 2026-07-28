import { formatMoney, formatTime, useDevice, useFlag } from '@phonelab/app';
import { slotLabel, statusLabel, type Booking } from '../../lib/types';
import { Card, Screen, SectionTitle } from '../../ui/Chrome';
import { Banner, EmptyState, Pill } from '../../ui/Feedback';
import { AvatarStack } from '../../ui/Avatars';
import { Inbox } from '../../ui/icons';

export function RequestsScreen({
  bookings,
  onOpen,
}: {
  bookings: Booking[];
  onOpen: (bookingId: string) => void;
}) {
  const device = useDevice();
  const offlineFlag = useFlag('offline');

  const pending = bookings.filter((booking) => booking.status === 'pending');
  const decided = bookings.filter((booking) => booking.status !== 'pending');

  return (
    <Screen title="Requests" subtitle={device.userLabel ?? undefined} tabbed>
      {offlineFlag ? (
        <Banner tone="warning">
          <strong>Offline.</strong> New requests will appear when the connection returns.
        </Banner>
      ) : null}

      {pending.length === 0 && decided.length === 0 ? (
        <EmptyState
          icon={<Inbox size={22} />}
          title="No requests"
          body="When a player books one of your courts, the request lands here."
        />
      ) : null}

      {pending.length > 0 ? (
        <>
          <SectionTitle>Waiting for you</SectionTitle>
          {pending.map((booking) => (
            <Card key={booking.id} onClick={() => onOpen(booking.id)} testId={`request-${booking.id}`}>
              <div className="pf-court-head">
                <div className="pf-court-name">{booking.requestedBy}</div>
                <div className="pf-price">{formatMoney(booking.totalCents)}</div>
              </div>
              <div className="pf-court-meta">
                <span>{booking.courtName}</span>
                <span className="pf-dot" />
                <span>{slotLabel(booking.startsAt, booking.durationMinutes, device.locale)}</span>
              </div>
              <div
                style={{
                  marginTop: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <AvatarStack players={booking.players} max={4} />
                <Pill tone="warning">Sent {formatTime(booking.requestedAt)}</Pill>
              </div>
            </Card>
          ))}
        </>
      ) : null}

      {decided.length > 0 ? (
        <>
          <SectionTitle>Handled</SectionTitle>
          {decided.map((booking) => (
            <Card key={booking.id} onClick={() => onOpen(booking.id)} testId={`request-${booking.id}`}>
              <div className="pf-court-head">
                <div className="pf-court-name">{booking.requestedBy}</div>
                <Pill tone={booking.status === 'accepted' ? 'positive' : 'danger'}>
                  {statusLabel(booking.status)}
                </Pill>
              </div>
              <div className="pf-court-meta">
                <span>{booking.courtName}</span>
                <span className="pf-dot" />
                <span>{slotLabel(booking.startsAt, booking.durationMinutes, device.locale)}</span>
              </div>
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}
