import { formatMoney, useFlag } from '@phonelab/app';
import { listCourts } from '../data/courts';
import { Card, Screen, SectionTitle } from '../ui/Chrome';
import { Button } from '../ui/Controls';
import { Banner, Pill } from '../ui/Feedback';

/**
 * The signed-out experience.
 *
 * Rendered for the `guest` role and whenever the `signed-out` edge case is
 * applied to a device — which is how you check that nothing private leaks into
 * the public app.
 */
export default function GuestApp() {
  const longText = useFlag('long-text');
  const courts = listCourts({ longText });

  return (
    <div className="pf-root">
      <Screen title="PadelFlow" subtitle="Find and book a court">
        <Banner tone="info">Sign in to book a court and invite your regular players.</Banner>

        <SectionTitle>Courts near you</SectionTitle>
        {courts.map((court) => (
          <Card key={court.id}>
            <div className="pf-court-head">
              <div className="pf-court-name">{court.name}</div>
              <div className="pf-price">
                {formatMoney(court.pricePerHourCents)}
                <small>/h</small>
              </div>
            </div>
            <div className="pf-court-meta">
              <Pill>{court.surface}</Pill>
              <Pill tone={court.indoor ? 'accent' : 'neutral'}>{court.indoor ? 'Indoor' : 'Outdoor'}</Pill>
            </div>
          </Card>
        ))}

        <div style={{ marginTop: 18 }}>
          <Button testId="sign-in">Sign in to continue</Button>
        </div>
      </Screen>
    </div>
  );
}
