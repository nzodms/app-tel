import { useState } from 'react';
import { notify, useAppEvent, useDevice, useFlag, useRouter, useSharedState } from '@phonelab/app';
import type { Booking } from '../lib/types';
import { Calendar, Court, Users } from '../ui/icons';
import { TabBar } from '../ui/TabBar';
import { CourtsScreen } from './screens/Courts';
import { CourtDetailScreen } from './screens/CourtDetail';
import { InviteScreen } from './screens/Invite';
import { ReviewScreen } from './screens/Review';
import { StatusScreen } from './screens/Status';
import { MyBookingsScreen } from './screens/MyBookings';

export interface BookingDraft {
  courtId: string | null;
  slotId: string | null;
  friendIds: string[];
  note: string;
}

const EMPTY_DRAFT: BookingDraft = { courtId: null, slotId: null, friendIds: [], note: '' };

/**
 * The player-facing app.
 *
 * Booking state lives in PhoneLab shared state, so the club phone on the same
 * canvas sees the same list. Cross-device notifications arrive through
 * `useAppEvent`.
 */
export default function PlayerApp() {
  const device = useDevice();
  const router = useRouter();
  const [bookings, setBookings] = useSharedState<Booking[]>('padelflow:bookings', []);
  const [draft, setDraft] = useState<BookingDraft>(EMPTY_DRAFT);
  const [tab, setTab] = useState('discover');
  const suspended = useFlag('user-suspended');

  const mine = bookings.filter((booking) => booking.requestedBy === (device.userLabel ?? 'Guest'));

  useAppEvent('booking.accepted', (event) => {
    const payload = event.payload as { bookingId: string; courtName: string };
    notify({
      title: 'Booking confirmed',
      body: `${payload.courtName} is reserved for you.`,
      kind: 'success',
      island: 'activity',
      islandLabel: 'Court confirmed',
    });
  });

  useAppEvent('booking.declined', (event) => {
    const payload = event.payload as { courtName: string; reason: string };
    notify({
      title: 'Booking declined',
      body: `${payload.courtName}: ${payload.reason}`,
      kind: 'error',
      island: 'notification',
    });
  });

  const updateDraft = (patch: Partial<BookingDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const body = () => {
    if (tab === 'bookings' && router.route === '/') {
      return <MyBookingsScreen bookings={mine} onOpen={(id) => router.navigate('/status', { bookingId: id })} />;
    }

    switch (router.route) {
      case '/court':
        return (
          <CourtDetailScreen
            courtId={router.params.courtId ?? draft.courtId ?? ''}
            draft={draft}
            suspended={suspended}
            onBack={router.back}
            onPickSlot={(slotId) => {
              updateDraft({ slotId });
              router.navigate('/invite');
            }}
          />
        );
      case '/invite':
        return (
          <InviteScreen
            draft={draft}
            onBack={router.back}
            onChange={updateDraft}
            onContinue={() => router.navigate('/review')}
          />
        );
      case '/review':
        return (
          <ReviewScreen
            draft={draft}
            onBack={router.back}
            onBooked={(booking) => {
              setBookings((current) => [booking, ...current]);
              setDraft(EMPTY_DRAFT);
              router.navigate('/status', { bookingId: booking.id });
            }}
          />
        );
      case '/status':
        return (
          <StatusScreen
            booking={bookings.find((entry) => entry.id === router.params.bookingId) ?? mine[0] ?? null}
            onBrowse={() => {
              setTab('discover');
              router.reset('/');
            }}
          />
        );
      default:
        return (
          <CourtsScreen
            suspended={suspended}
            onOpenCourt={(courtId) => {
              updateDraft({ courtId, slotId: null });
              router.navigate('/court', { courtId });
            }}
          />
        );
    }
  };

  const showTabs = router.route === '/' || router.route === '/status';

  return (
    <div className="pf-root">
      {body()}
      {showTabs ? (
        <TabBar
          active={router.route === '/status' ? 'bookings' : tab}
          onSelect={(id) => {
            setTab(id);
            router.reset('/');
          }}
          items={[
            { id: 'discover', label: 'Courts', icon: <Court size={21} /> },
            {
              id: 'bookings',
              label: 'Bookings',
              icon: <Calendar size={21} />,
              badge: mine.filter((booking) => booking.status === 'pending').length,
            },
            { id: 'players', label: 'Players', icon: <Users size={21} /> },
          ]}
        />
      ) : null}
    </div>
  );
}
