import { useEffect, useState } from 'react';
import { formatMoney, useDevice, useFlag, useNetwork } from '@phonelab/app';
import { listCourts } from '../../data/courts';
import type { Court as CourtModel } from '../../lib/types';
import { Card, Screen } from '../../ui/Chrome';
import { Banner, EmptyState, LoadingList, Pill } from '../../ui/Feedback';
import { Court as CourtIcon, Pin, Star } from '../../ui/icons';

/**
 * Court discovery.
 *
 * Loading goes through `useNetwork().request` so the Edge Case Studio's slow and
 * offline conditions are real: the skeleton is only visible while a request is
 * genuinely in flight, and offline produces an error state with a retry.
 */
export function CourtsScreen({
  onOpenCourt,
  suspended,
}: {
  onOpenCourt: (courtId: string) => void;
  suspended: boolean;
}) {
  const device = useDevice();
  const network = useNetwork();
  const emptyList = useFlag('empty-list');
  const serverError = useFlag('server-error');
  const longText = useFlag('long-text');
  const gpsDenied = useFlag('gps-denied');

  const [courts, setCourts] = useState<CourtModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setCourts(null);
    setError(null);

    network
      .request(() => {
        if (serverError) throw new Error('The booking service is unavailable (500).');
        return emptyList ? [] : listCourts({ longText });
      })
      .then((result) => {
        if (!cancelled) setCourts(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Something went wrong.');
      });

    return () => {
      cancelled = true;
    };
    // Re-runs whenever the simulated network or a data flag changes.
  }, [attempt, network.condition, emptyList, serverError, longText]);

  return (
    <Screen title="Book a court" subtitle={device.userLabel ? `Hi ${device.userLabel.split(' ')[0]}` : null} tabbed>
      {suspended ? (
        <Banner tone="danger">
          <strong>Account suspended.</strong> Contact the club to restore booking access.
        </Banner>
      ) : null}

      {gpsDenied ? (
        <Banner tone="warning">
          Location is off, so distances are hidden. Showing all partner clubs instead.
        </Banner>
      ) : null}

      {error ? (
        <EmptyState
          icon={<CourtIcon size={22} />}
          title="Couldn’t load courts"
          body={error}
          action={
            <button className="pf-btn pf-btn--secondary" data-pl-id="retry" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          }
        />
      ) : courts === null ? (
        <LoadingList rows={3} />
      ) : courts.length === 0 ? (
        <EmptyState
          icon={<CourtIcon size={22} />}
          title="No courts nearby"
          body="No partner club has published availability yet. Try another area or come back later."
        />
      ) : (
        <div style={{ marginTop: 12 }}>
          {courts.map((court) => (
            <Card key={court.id} onClick={() => onOpenCourt(court.id)} testId={`court-${court.id}`}>
              <div className="pf-court-head">
                <div className="pf-court-name">{court.name}</div>
                <div className="pf-price">
                  {formatMoney(court.pricePerHourCents)}
                  <small>/h</small>
                </div>
              </div>
              <div className="pf-court-meta">
                <Pill tone={court.indoor ? 'accent' : 'neutral'}>{court.indoor ? 'Indoor' : 'Outdoor'}</Pill>
                <Pill>{court.surface}</Pill>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <Star size={13} />
                  {court.rating.toFixed(1)}
                </span>
                {gpsDenied ? null : (
                  <>
                    <span className="pf-dot" />
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <Pin size={13} />
                      {court.distanceKm.toFixed(1)} km
                    </span>
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </Screen>
  );
}
