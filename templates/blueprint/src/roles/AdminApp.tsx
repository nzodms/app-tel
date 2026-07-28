import { formatMoney, formatTime, useDevice, useSharedState } from '@phonelab/app';
import { config } from '../lib/config';
import { statusLabel, statusTone, type DemandRecord } from '../lib/types';
import { Card, EmptyState, Pill, Screen, SectionTitle } from '../ui/kit';

/**
 * The back-office view: everything, across everyone.
 *
 * Reads the same shared state as the other phones, so it updates live while the
 * other two talk to each other.
 */
export default function AdminApp() {
  const device = useDevice();
  const [records] = useSharedState<DemandRecord[]>(config.sharedStateKey, []);

  const confirmed = records.filter((record) => record.status === 'accepted');
  const value = confirmed.reduce((sum, record) => sum + record.totalCents, 0);

  return (
    <div className="bp-root">
      <Screen title="Operations" subtitle={device.userLabel ?? undefined}>
        <div className="bp-hero">
          <div className="bp-hero-status">Live</div>
          <div className="bp-hero-title">{records.length} {config.requestPlural.toLowerCase()}</div>
          <div className="bp-hero-sub">
            {confirmed.length} confirmed · {formatMoney(value)}
          </div>
        </div>

        <SectionTitle>All {config.requestPlural.toLowerCase()}</SectionTitle>
        {records.length === 0 ? (
          <EmptyState
            title="Nothing yet"
            body={`Every ${config.requestNoun.toLowerCase()} across the workspace appears here in real time.`}
          />
        ) : (
          records.map((record) => (
            <Card key={record.id}>
              <div className="bp-court-head">
                <div className="bp-court-name">{record.itemTitle}</div>
                <Pill tone={statusTone(record.status)}>
                  {statusLabel(record.status, config.waitingLabel)}
                </Pill>
              </div>
              <div className="bp-court-meta">
                <span>{record.requestedBy}</span>
                <span className="bp-dot" />
                <span>{formatTime(record.requestedAt)}</span>
                <span className="bp-dot" />
                <span>{formatMoney(record.totalCents)}</span>
              </div>
            </Card>
          ))
        )}
      </Screen>
    </div>
  );
}
