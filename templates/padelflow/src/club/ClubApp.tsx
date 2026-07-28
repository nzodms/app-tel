import { useState } from 'react';
import { notify, useAppEvent, useRouter, useSharedState } from '@phonelab/app';
import type { Booking } from '../lib/types';
import { Calendar, Inbox } from '../ui/icons';
import { TabBar } from '../ui/TabBar';
import { RequestsScreen } from './screens/Requests';
import { RequestDetailScreen } from './screens/RequestDetail';
import { ScheduleScreen } from './screens/Schedule';

/**
 * The club-facing app.
 *
 * Receives `booking.requested` from the player phone, raises a notification on
 * its own chrome, and writes decisions back into shared state — which the player
 * phone reads immediately.
 */
export default function ClubApp() {
  const router = useRouter();
  const [bookings, setBookings] = useSharedState<Booking[]>('padelflow:bookings', []);
  const [tab, setTab] = useState('requests');

  const pending = bookings.filter((booking) => booking.status === 'pending');

  useAppEvent('booking.requested', (event) => {
    const booking = event.payload as Booking;
    notify({
      title: 'New booking request',
      body: `${booking.requestedBy} · ${booking.courtName}`,
      kind: 'default',
      island: 'notification',
      islandLabel: 'New request',
      badge: { key: 'requests', value: 1 },
    });
  });

  const decide = (bookingId: string, status: 'accepted' | 'declined', reason?: string) => {
    const target = bookings.find((booking) => booking.id === bookingId);
    if (!target) return;

    setBookings((current) =>
      current.map((booking) =>
        booking.id === bookingId
          ? {
              ...booking,
              status,
              decidedAt: new Date().toISOString(),
              declineReason: status === 'declined' ? (reason ?? 'The court is no longer free.') : null,
            }
          : booking,
      ),
    );

    if (status === 'accepted') {
      notify({
        title: 'Booking confirmed',
        body: `${target.courtName} · ${target.requestedBy}`,
        kind: 'success',
        island: 'payment',
        islandLabel: 'Court reserved',
      });
    }

    router.reset('/');
  };

  const body = () => {
    if (tab === 'schedule') return <ScheduleScreen bookings={bookings} />;

    if (router.route === '/request') {
      const booking = bookings.find((entry) => entry.id === router.params.bookingId);
      return (
        <RequestDetailScreen
          booking={booking ?? null}
          onBack={router.back}
          onDecide={decide}
        />
      );
    }

    return (
      <RequestsScreen
        bookings={bookings}
        onOpen={(bookingId) => router.navigate('/request', { bookingId })}
      />
    );
  };

  return (
    <div className="pf-root">
      {body()}
      {router.route === '/' ? (
        <TabBar
          active={tab}
          onSelect={(id) => {
            setTab(id);
            router.reset('/');
          }}
          items={[
            { id: 'requests', label: 'Requests', icon: <Inbox size={21} />, badge: pending.length },
            { id: 'schedule', label: 'Schedule', icon: <Calendar size={21} /> },
          ]}
        />
      ) : null}
    </div>
  );
}
