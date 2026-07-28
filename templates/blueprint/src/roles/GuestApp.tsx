import { formatMoney, useFlag } from '@phonelab/app';
import { config } from '../lib/config';
import { Banner, Button, Card, Pill, Screen, SectionTitle } from '../ui/kit';

/**
 * The signed-out experience.
 *
 * Rendered for the `guest` role and whenever the `signed-out` edge case is applied,
 * which is how you check that nothing private leaks into the public app.
 */
export default function GuestApp() {
  const longText = useFlag('long-text');

  return (
    <div className="bp-root">
      <Screen title={config.appName} subtitle={config.tagline}>
        <Banner tone="info">Sign in to {config.actionVerb.toLowerCase()}.</Banner>

        <SectionTitle>{config.itemPlural}</SectionTitle>
        {config.items.map((item) => (
          <Card key={item.id}>
            <div className="bp-court-head">
              <div className="bp-court-name">
                {longText ? `${item.title} — ${config.longTitleSuffix}` : item.title}
              </div>
              <div className="bp-price">{formatMoney(item.priceCents)}</div>
            </div>
            <div className="bp-court-meta">
              {item.tags.slice(0, 2).map((tag) => (
                <Pill key={tag}>{tag}</Pill>
              ))}
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
