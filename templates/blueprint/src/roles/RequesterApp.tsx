import { useEffect, useState } from 'react';
import {
  formatMoney,
  formatTime,
  logEvent,
  notify,
  sendEvent,
  useAppEvent,
  useDevice,
  useFlag,
  useNetwork,
  useSharedState,
} from '@phonelab/app';
import { config } from '../lib/config';
import {
  initialsOf,
  statusLabel,
  statusTone,
  type CatalogItem,
  type DemandRecord,
} from '../lib/types';
import {
  AvatarStack,
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  LoadingList,
  Pill,
  Screen,
  SectionTitle,
  TabBar,
} from '../ui/kit';

/**
 * The requester side — the person who asks for something.
 *
 * Browse, open an item, send a request, then watch its status change when the
 * other side responds. The vocabulary comes from `src/lib/config.ts`.
 */
export default function RequesterApp() {
  const device = useDevice();
  const network = useNetwork();
  const [records, setRecords] = useSharedState<DemandRecord[]>(config.sharedStateKey, []);

  const [tab, setTab] = useState('browse');
  const [screen, setScreen] = useState<'list' | 'detail' | 'review' | 'status'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const emptyList = useFlag('empty-list');
  const serverError = useFlag('server-error');
  const soldOut = useFlag('sold-out');
  const longText = useFlag('long-text');
  const suspended = useFlag('user-suspended');
  const paymentDeclined = useFlag('payment-declined');
  const sessionExpired = useFlag('session-expired');

  const me = device.userLabel ?? 'Guest';
  const mine = records.filter((record) => record.requestedBy === me);

  useEffect(() => {
    let cancelled = false;
    network
      .request(() => {
        if (serverError) throw new Error(`The ${config.serviceName} is unavailable (500).`);
        if (emptyList) return [] as CatalogItem[];
        return config.items.map((item) => ({
          ...item,
          title: longText ? `${item.title} — ${config.longTitleSuffix}` : item.title,
          available: soldOut ? false : item.available,
        }));
      })
      .then((result) => {
        if (!cancelled) {
          setItems(result);
          setLoadError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(cause instanceof Error ? cause.message : 'Something failed.');
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, network.condition, emptyList, serverError, soldOut, longText]);

  useAppEvent(config.events.accepted, (event) => {
    const payload = event.payload as { itemTitle: string };
    notify({
      title: `${config.requestNoun} confirmed`,
      body: `${payload.itemTitle} is confirmed.`,
      kind: 'success',
      island: 'activity',
      islandLabel: `${config.requestNoun} confirmed`,
    });
  });

  useAppEvent(config.events.declined, (event) => {
    const payload = event.payload as { itemTitle: string; reason: string };
    notify({
      title: `${config.requestNoun} declined`,
      body: `${payload.itemTitle}: ${payload.reason}`,
      kind: 'error',
      island: 'notification',
    });
  });

  const selected = (items ?? []).find((item) => item.id === selectedId) ?? null;
  const activeRecord = records.find((record) => record.id === activeRecordId) ?? mine[0] ?? null;

  const submit = async () => {
    if (!selected) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await network.request(() => {
        if (sessionExpired) throw new Error('Your session expired. Sign in again to continue.');
        if (paymentDeclined) throw new Error('Payment was declined by your bank.');
        return true;
      });

      const record: DemandRecord = {
        id: `rq_${Date.now().toString(36)}`,
        itemId: selected.id,
        itemTitle: selected.title,
        quantity,
        totalCents: selected.priceCents * quantity,
        status: 'pending',
        requestedBy: me,
        requestedAt: new Date().toISOString(),
        decidedAt: null,
        note: note.trim() === '' ? null : note.trim(),
        declineReason: null,
        participants: [{ id: 'me', name: me, initials: initialsOf(me) }],
      };

      setRecords((current) => [record, ...current]);
      sendEvent(config.events.requested, record, { to: config.fulfillerRole });
      logEvent(`${config.requestNoun} sent for ${selected.title}`);
      notify({
        title: `${config.requestNoun} sent`,
        body: config.waitingLabel,
        island: 'activity',
        islandLabel: config.waitingLabel,
      });

      setActiveRecordId(record.id);
      setScreen('status');
      setTab('activity');
      setNote('');
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'Could not send.');
    } finally {
      setSubmitting(false);
    }
  };

  const body = () => {
    if (tab === 'activity' && screen !== 'status') {
      return (
        <Screen title={config.requestPlural} subtitle={`${mine.length} total`} tabbed>
          {mine.length === 0 ? (
            <EmptyState
              title={`No ${config.requestPlural.toLowerCase()} yet`}
              body={`Anything you ${config.actionVerb.toLowerCase()} shows up here with live status.`}
            />
          ) : (
            <div style={{ marginTop: 12 }}>
              {mine.map((record) => (
                <Card
                  key={record.id}
                  testId={`record-${record.id}`}
                  onClick={() => {
                    setActiveRecordId(record.id);
                    setScreen('status');
                  }}
                >
                  <div className="bp-court-head">
                    <div className="bp-court-name">{record.itemTitle}</div>
                    <div className="bp-price">{formatMoney(record.totalCents)}</div>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <Pill tone={statusTone(record.status)}>
                      {statusLabel(record.status, config.waitingLabel)}
                    </Pill>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Screen>
      );
    }

    if (screen === 'status') {
      if (!activeRecord) {
        return (
          <Screen title={config.requestNoun} tabbed>
            <EmptyState
              title="Nothing here yet"
              body={`${config.actionVerb} something and its status will appear here.`}
              action={
                <Button
                  variant="secondary"
                  testId="browse"
                  onClick={() => {
                    setTab('browse');
                    setScreen('list');
                  }}
                >
                  {config.browseTitle}
                </Button>
              }
            />
          </Screen>
        );
      }
      return (
        <Screen title={config.requestNoun} tabbed>
          <div className="bp-hero">
            <div className="bp-hero-status">
              {statusLabel(activeRecord.status, config.waitingLabel)}
            </div>
            <div className="bp-hero-title">{activeRecord.itemTitle}</div>
            <div className="bp-hero-sub">
              {activeRecord.quantity} × {config.unitNoun} · {formatMoney(activeRecord.totalCents)}
            </div>
            <div
              style={{
                marginTop: 14,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <AvatarStack people={activeRecord.participants} />
              <Pill tone={statusTone(activeRecord.status)}>
                {statusLabel(activeRecord.status, config.waitingLabel)}
              </Pill>
            </div>
          </div>

          {activeRecord.declineReason ? (
            <Banner tone="danger">{activeRecord.declineReason}</Banner>
          ) : null}

          <SectionTitle>Progress</SectionTitle>
          <Card>
            <div className="bp-steps">
              <div className="bp-step" data-state="done">
                <span className="bp-step-dot" />
                <div>
                  <div className="bp-step-title">{config.requestNoun} sent</div>
                  <div className="bp-step-time">{formatTime(activeRecord.requestedAt)}</div>
                </div>
              </div>
              <div className="bp-step" data-state={activeRecord.status === 'pending' ? 'active' : 'done'}>
                <span className="bp-step-dot" />
                <div>
                  <div className="bp-step-title">
                    {activeRecord.status === 'pending' ? config.waitingLabel : `${config.fulfillerLabel} responded`}
                  </div>
                  <div className="bp-step-time">
                    {activeRecord.decidedAt ? formatTime(activeRecord.decidedAt) : 'Usually quick'}
                  </div>
                </div>
              </div>
              <div className="bp-step" data-state={activeRecord.status === 'accepted' ? 'done' : 'idle'}>
                <span className="bp-step-dot" />
                <div>
                  <div className="bp-step-title">{config.completionLabel}</div>
                  <div className="bp-step-time">
                    {activeRecord.status === 'accepted' ? 'Confirmed' : 'Waiting'}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </Screen>
      );
    }

    if (screen === 'review' && selected) {
      return (
        <Screen
          title={`Review & ${config.actionVerb.toLowerCase()}`}
          onBack={() => setScreen('detail')}
          footer={
            <>
              <div className="bp-footer-summary">
                <span>
                  {quantity} × {config.unitNoun}
                </span>
                <span className="bp-footer-total">
                  {formatMoney(selected.priceCents * quantity)}
                </span>
              </div>
              <Button onClick={submit} disabled={submitting} testId="confirm">
                {submitting ? 'Sending…' : config.confirmLabel}
              </Button>
            </>
          }
        >
          <Card>
            <div className="bp-court-head">
              <div className="bp-court-name">{selected.title}</div>
              <div className="bp-price">{formatMoney(selected.priceCents)}</div>
            </div>
            <div className="bp-court-meta">{selected.subtitle}</div>
          </Card>

          <SectionTitle>Details</SectionTitle>
          <Field
            label={`Note to the ${config.fulfillerLabel.toLowerCase()}`}
            value={note}
            placeholder={config.notePlaceholder}
            onChange={setNote}
            testId="note"
          />

          {submitError ? <Banner tone="danger">{submitError}</Banner> : null}
        </Screen>
      );
    }

    if (screen === 'detail' && selected) {
      return (
        <Screen
          title={selected.title}
          subtitle={selected.subtitle}
          onBack={() => setScreen('list')}
          footer={
            <Button
              onClick={() => setScreen('review')}
              disabled={!selected.available || suspended}
              testId="continue"
            >
              {selected.available ? `${config.actionVerb} · ${formatMoney(selected.priceCents * quantity)}` : config.unavailableLabel}
            </Button>
          }
        >
          <Card>
            <div className="bp-court-meta">
              {selected.tags.map((tag) => (
                <Pill key={tag}>{tag}</Pill>
              ))}
            </div>
          </Card>

          <SectionTitle>{config.quantityLabel}</SectionTitle>
          <Card>
            <div className="bp-row" style={{ borderBottom: 0 }}>
              <div className="bp-row-main">
                <div className="bp-row-title">{config.quantityLabel}</div>
                <div className="bp-row-sub">
                  {quantity} × {formatMoney(selected.priceCents)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {[1, 2, 3, 4].map((value) => (
                  <button
                    key={value}
                    className="bp-slot"
                    style={{ padding: '6px 11px', minWidth: 0 }}
                    data-selected={quantity === value ? 'true' : 'false'}
                    data-pl-id={`qty-${value}`}
                    onClick={() => setQuantity(value)}
                  >
                    <span className="bp-slot-time">{value}</span>
                  </button>
                ))}
              </div>
            </div>
          </Card>

          {suspended ? <Banner tone="danger">This account is suspended.</Banner> : null}
        </Screen>
      );
    }

    return (
      <Screen
        title={config.browseTitle}
        subtitle={device.userLabel ? `Hi ${device.userLabel.split(' ')[0]}` : null}
        tabbed
      >
        {suspended ? (
          <Banner tone="danger">
            <strong>Account suspended.</strong> You cannot {config.actionVerb.toLowerCase()} right now.
          </Banner>
        ) : null}

        {loadError ? (
          <EmptyState
            title={`Couldn’t load ${config.itemPlural.toLowerCase()}`}
            body={loadError}
            action={
              <Button variant="secondary" testId="retry" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </Button>
            }
          />
        ) : items === null ? (
          <LoadingList rows={3} />
        ) : items.length === 0 ? (
          <EmptyState
            title={`No ${config.itemPlural.toLowerCase()} available`}
            body={config.emptyStateBody}
          />
        ) : (
          <div style={{ marginTop: 12 }}>
            {items.map((item) => (
              <Card
                key={item.id}
                testId={`item-${item.id}`}
                onClick={() => {
                  setSelectedId(item.id);
                  setScreen('detail');
                }}
              >
                <div className="bp-court-head">
                  <div className="bp-court-name">{item.title}</div>
                  <div className="bp-price">{formatMoney(item.priceCents)}</div>
                </div>
                <div className="bp-court-meta">
                  {item.tags.slice(0, 2).map((tag) => (
                    <Pill key={tag}>{tag}</Pill>
                  ))}
                  {item.available ? null : <Pill tone="warning">{config.unavailableLabel}</Pill>}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Screen>
    );
  };

  const showTabs = screen === 'list' || screen === 'status';

  return (
    <div className="bp-root">
      {body()}
      {showTabs ? (
        <TabBar
          active={screen === 'status' ? 'activity' : tab}
          onSelect={(id) => {
            setTab(id);
            setScreen('list');
          }}
          items={[
            { id: 'browse', label: config.itemPlural, icon: 'grid' },
            {
              id: 'activity',
              label: config.requestPlural,
              icon: 'list',
              badge: mine.filter((record) => record.status === 'pending').length,
            },
            { id: 'profile', label: 'Profile', icon: 'users' },
          ]}
        />
      ) : null}
    </div>
  );
}
