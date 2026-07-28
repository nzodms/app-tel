import { formatMoney, formatTime, useDevice } from '@phonelab/app';
import { slotLabel, statusLabel, type Booking } from '../../lib/types';
import { Card, Screen, SectionTitle } from '../../ui/Chrome';
import { Button } from '../../ui/Controls';
import { Banner, EmptyState, Pill } from '../../ui/Feedback';
import { AvatarStack } from '../../ui/Avatars';
import { Calendar, Clock } from '../../ui/icons';

/**
 * Booking status.
 *
 * Reads straight from shared state, so when the club phone accepts the request
 * this screen updates without any polling — the club's write is broadcast to
 * every device on the canvas.
 */
export function StatusScreen({ booking, onBrowse }: { booking: Booking | null; onBrowse: () => void }) {
  const device = useDevice();

  if (!booking) {
    return (
      <Screen title="Your booking" tabbed>
        <EmptyState
          icon={<Calendar size={22} />}
          title="No bookings yet"
          body="Reserve a court and it will show up here with live status."
          action={
            <button className="pf-btn pf-btn--secondary" onClick={onBrowse} data-pl-id="browse-courts">
              Browse courts
            </button>
          }
        />
      </Screen>
    );
  }

  const tone =
    booking.status === 'accepted' ? 'positive' : booking.status === 'declined' ? 'danger' : 'warning';

  return (
    <Screen title="Your booking" tabbed>
      <div className="pf-hero">
        <div className="pf-hero-status">{statusLabel(booking.status)}</div>
        <div className="pf-hero-title">{booking.courtName}</div>
        <div className="pf-hero-sub">
          {slotLabel(booking.startsAt, booking.durationMinutes, device.locale)} ·{' '}
          {formatMoney(booking.totalCents)}
        </div>
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <AvatarStack players={booking.players} />
          <Pill tone={tone}>{statusLabel(booking.status)}</Pill>
        </div>
      </div>

      {booking.status === 'declined' && booking.declineReason ? (
        <Banner tone="danger">{booking.declineReason}</Banner>
      ) : null}

      <SectionTitle>Progress</SectionTitle>
      <Card>
        <div className="pf-steps">
          <div className="pf-step" data-state="done">
            <span className="pf-step-dot" />
            <div>
              <div className="pf-step-title">Request sent</div>
              <div className="pf-step-time">{formatTime(booking.requestedAt)}</div>
            </div>
          </div>
          <div
            className="pf-step"
            data-state={booking.status === 'pending' ? 'active' : 'done'}
          >
            <span className="pf-step-dot" />
            <div>
              <div className="pf-step-title">
                {booking.status === 'pending' ? 'Club is reviewing' : 'Club responded'}
              </div>
              <div className="pf-step-time">
                {booking.decidedAt ? formatTime(booking.decidedAt) : 'Usually under a minute'}
              </div>
            </div>
          </div>
          <div className="pf-step" data-state={booking.status === 'accepted' ? 'done' : 'idle'}>
            <span className="pf-step-dot" />
            <div>
              <div className="pf-step-title">Court reserved</div>
              <div className="pf-step-time">
                {booking.status === 'accepted' ? 'Confirmed' : 'Waiting for confirmation'}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {booking.status === 'accepted' ? (
        <div style={{ marginTop: 14 }}>
          <Button variant="secondary" testId="add-to-calendar">
            <Clock size={16} /> Add to calendar
          </Button>
        </div>
      ) : null}
    </Screen>
  );
}
