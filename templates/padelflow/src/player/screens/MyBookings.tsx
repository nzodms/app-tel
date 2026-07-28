import { formatMoney, useDevice } from '@phonelab/app';
import { dayLabel, slotLabel, statusLabel, type Booking } from '../../lib/types';
import { Card, Screen } from '../../ui/Chrome';
import { EmptyState, Pill } from '../../ui/Feedback';
import { Calendar } from '../../ui/icons';

export function MyBookingsScreen({
  bookings,
  onOpen,
}: {
  bookings: Booking[];
  onOpen: (bookingId: string) => void;
}) {
  const device = useDevice();

  return (
    <Screen title="Bookings" subtitle={`${bookings.length} total`} tabbed>
      {bookings.length === 0 ? (
        <EmptyState
          icon={<Calendar size={22} />}
          title="Nothing booked yet"
          body="Your reservations and their live status will appear here."
        />
      ) : (
        <div style={{ marginTop: 12 }}>
          {bookings.map((booking) => (
            <Card key={booking.id} onClick={() => onOpen(booking.id)} testId={`booking-${booking.id}`}>
              <div className="pf-court-head">
                <div className="pf-court-name">{booking.courtName}</div>
                <div className="pf-price">{formatMoney(booking.totalCents)}</div>
              </div>
              <div className="pf-court-meta">
                <span>{dayLabel(booking.startsAt, device.locale)}</span>
                <span className="pf-dot" />
                <span>{slotLabel(booking.startsAt, booking.durationMinutes, device.locale)}</span>
              </div>
              <div style={{ marginTop: 10 }}>
                <Pill
                  tone={
                    booking.status === 'accepted'
                      ? 'positive'
                      : booking.status === 'declined'
                        ? 'danger'
                        : 'warning'
                  }
                >
                  {statusLabel(booking.status)}
                </Pill>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Screen>
  );
}
