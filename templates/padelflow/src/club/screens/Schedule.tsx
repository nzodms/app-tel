import { useDevice } from '@phonelab/app';
import { listCourts, listSlots } from '../../data/courts';
import { slotLabel, type Booking } from '../../lib/types';
import { Card, Screen, SectionTitle } from '../../ui/Chrome';
import { Pill } from '../../ui/Feedback';

/** Today's grid, with accepted bookings overlaid on the club's own availability. */
export function ScheduleScreen({ bookings }: { bookings: Booking[] }) {
  const device = useDevice();
  const courts = listCourts({ longText: false });
  const confirmed = new Set(
    bookings.filter((booking) => booking.status === 'accepted').map((booking) => booking.slotId),
  );

  return (
    <Screen title="Schedule" subtitle="Today" tabbed>
      {courts.map((court) => (
        <div key={court.id}>
          <SectionTitle>{court.name}</SectionTitle>
          <Card>
            {listSlots(court.id, { soldOut: false }).map((slot) => {
              const booked = confirmed.has(slot.id);
              return (
                <div className="pf-row" key={slot.id}>
                  <div className="pf-row-main">
                    <div className="pf-row-title">
                      {slotLabel(slot.startsAt, slot.durationMinutes, device.locale)}
                    </div>
                    <div className="pf-row-sub">{booked ? 'Reserved via PadelFlow' : slot.available ? 'Open' : 'Blocked'}</div>
                  </div>
                  <Pill tone={booked ? 'positive' : slot.available ? 'neutral' : 'warning'}>
                    {booked ? 'Booked' : slot.available ? 'Free' : 'Closed'}
                  </Pill>
                </div>
              );
            })}
          </Card>
        </div>
      ))}
    </Screen>
  );
}
