import { useState } from 'react';
import {
  formatMoney,
  formatTime,
  notify,
  sendEvent,
  useAppEvent,
  useDevice,
  useFlag,
  useNetwork,
  useSharedState,
} from '@phonelab/app';
import { config } from '../lib/config';
import { statusLabel, statusTone, type DemandRecord } from '../lib/types';
import {
  AvatarStack,
  Banner,
  Button,
  Card,
  EmptyState,
  Pill,
  Screen,
  SectionTitle,
  TabBar,
} from '../ui/kit';

/**
 * The fulfiller side — the person who answers.
 *
 * Receives requests from the other phone, shows a notification, and writes the
 * decision back into shared state so the requester's screen updates.
 */
export default function FulfillerApp() {
  const device = useDevice();
  const network = useNetwork();
  const [records, setRecords] = useSharedState<DemandRecord[]>(config.sharedStateKey, []);
  const [tab, setTab] = useState('inbox');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const serverError = useFlag('server-error');
  const offline = useFlag('offline');

  const pending = records.filter((record) => record.status === 'pending');
  const handled = records.filter((record) => record.status !== 'pending');
  const open = records.find((record) => record.id === openId) ?? null;

  useAppEvent(config.events.requested, (event) => {
    const record = event.payload as DemandRecord;
    notify({
      title: `New ${config.requestNoun.toLowerCase()}`,
      body: `${record.requestedBy} · ${record.itemTitle}`,
      island: 'notification',
      islandLabel: `New ${config.requestNoun.toLowerCase()}`,
      badge: { key: 'inbox', value: 1 },
    });
  });

  const decide = async (status: 'accepted' | 'declined') => {
    if (!open) return;
    setBusy(status === 'accepted' ? 'accept' : 'decline');
    setError(null);
    try {
      await network.request(() => {
        if (serverError) throw new Error(`Could not reach the ${config.serviceName}. Try again.`);
        return true;
      });

      const reason = status === 'declined' ? config.declineReason : null;
      setRecords((current) =>
        current.map((record) =>
          record.id === open.id
            ? { ...record, status, decidedAt: new Date().toISOString(), declineReason: reason }
            : record,
        ),
      );

      sendEvent(
        status === 'accepted' ? config.events.accepted : config.events.declined,
        { recordId: open.id, itemTitle: open.itemTitle, reason },
        { to: config.requesterRole },
      );

      if (status === 'accepted') {
        notify({
          title: `${config.requestNoun} confirmed`,
          body: `${open.itemTitle} · ${open.requestedBy}`,
          kind: 'success',
          island: 'payment',
          islandLabel: config.completionLabel,
        });
      }
      setOpenId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  if (open) {
    const decided = open.status !== 'pending';
    return (
      <div className="bp-root">
        <Screen
          title={open.requestedBy}
          subtitle={open.itemTitle}
          onBack={() => setOpenId(null)}
          footer={
            decided ? null : (
              <>
                <Button onClick={() => decide('accepted')} disabled={busy !== null} testId="accept">
                  {busy === 'accept' ? 'Confirming…' : config.acceptLabel}
                </Button>
                <Button
                  variant="danger"
                  onClick={() => decide('declined')}
                  disabled={busy !== null}
                  testId="decline"
                >
                  {busy === 'decline' ? 'Declining…' : 'Decline'}
                </Button>
              </>
            )
          }
        >
          <Card>
            <div className="bp-court-head">
              <div className="bp-court-name">{open.itemTitle}</div>
              <div className="bp-price">{formatMoney(open.totalCents)}</div>
            </div>
            <div className="bp-court-meta">
              <span>
                {open.quantity} × {config.unitNoun}
              </span>
              <span className="bp-dot" />
              <span>{formatTime(open.requestedAt)}</span>
            </div>
          </Card>

          <SectionTitle>Requested by</SectionTitle>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <AvatarStack people={open.participants} />
              <span className="bp-row-sub">{open.requestedBy}</span>
            </div>
          </Card>

          {open.note ? (
            <>
              <SectionTitle>Note</SectionTitle>
              <Card>
                <div className="bp-row-sub">{open.note}</div>
              </Card>
            </>
          ) : null}

          {decided ? (
            <Banner tone={open.status === 'accepted' ? 'info' : 'warning'}>
              Already {open.status === 'accepted' ? 'accepted' : 'declined'}.
            </Banner>
          ) : null}
          {error ? <Banner tone="danger">{error}</Banner> : null}
        </Screen>
      </div>
    );
  }

  return (
    <div className="bp-root">
      {tab === 'overview' ? (
        <Screen title="Overview" subtitle={device.userLabel ?? undefined} tabbed>
          <SectionTitle>Today</SectionTitle>
          <Card>
            <div className="bp-row">
              <div className="bp-row-main">
                <div className="bp-row-title">{pending.length}</div>
                <div className="bp-row-sub">Waiting for you</div>
              </div>
            </div>
            <div className="bp-row">
              <div className="bp-row-main">
                <div className="bp-row-title">
                  {records.filter((record) => record.status === 'accepted').length}
                </div>
                <div className="bp-row-sub">Confirmed</div>
              </div>
            </div>
            <div className="bp-row">
              <div className="bp-row-main">
                <div className="bp-row-title">
                  {formatMoney(
                    records
                      .filter((record) => record.status === 'accepted')
                      .reduce((sum, record) => sum + record.totalCents, 0),
                  )}
                </div>
                <div className="bp-row-sub">Confirmed value</div>
              </div>
            </div>
          </Card>
        </Screen>
      ) : (
        <Screen title={config.inboxTitle} subtitle={device.userLabel ?? undefined} tabbed>
          {offline ? (
            <Banner tone="warning">
              <strong>Offline.</strong> New {config.requestPlural.toLowerCase()} will appear when the
              connection returns.
            </Banner>
          ) : null}

          {records.length === 0 ? (
            <EmptyState
              title={`No ${config.requestPlural.toLowerCase()}`}
              body={`When someone ${config.actionVerb.toLowerCase()}s, it lands here.`}
            />
          ) : null}

          {pending.length > 0 ? (
            <>
              <SectionTitle>Waiting for you</SectionTitle>
              {pending.map((record) => (
                <Card key={record.id} testId={`request-${record.id}`} onClick={() => setOpenId(record.id)}>
                  <div className="bp-court-head">
                    <div className="bp-court-name">{record.requestedBy}</div>
                    <div className="bp-price">{formatMoney(record.totalCents)}</div>
                  </div>
                  <div className="bp-court-meta">
                    <span>{record.itemTitle}</span>
                    <span className="bp-dot" />
                    <span>
                      {record.quantity} × {config.unitNoun}
                    </span>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <Pill tone="warning">Sent {formatTime(record.requestedAt)}</Pill>
                  </div>
                </Card>
              ))}
            </>
          ) : null}

          {handled.length > 0 ? (
            <>
              <SectionTitle>Handled</SectionTitle>
              {handled.map((record) => (
                <Card key={record.id} testId={`request-${record.id}`} onClick={() => setOpenId(record.id)}>
                  <div className="bp-court-head">
                    <div className="bp-court-name">{record.requestedBy}</div>
                    <Pill tone={statusTone(record.status)}>
                      {statusLabel(record.status, config.waitingLabel)}
                    </Pill>
                  </div>
                  <div className="bp-court-meta">{record.itemTitle}</div>
                </Card>
              ))}
            </>
          ) : null}
        </Screen>
      )}

      <TabBar
        active={tab}
        onSelect={setTab}
        items={[
          { id: 'inbox', label: config.inboxTitle, icon: 'inbox', badge: pending.length },
          { id: 'overview', label: 'Overview', icon: 'chart' },
        ]}
      />
    </div>
  );
}
