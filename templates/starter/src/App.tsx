import { useState } from 'react';
import {
  formatTime,
  notify,
  sendEvent,
  useAppEvent,
  useDevice,
  useFlag,
  useNetwork,
  useSharedState,
} from '@phonelab/app';
import css from './styles.css';

interface Item {
  id: string;
  title: string;
  author: string;
  createdAt: string;
}

/**
 * A deliberately small starting point that still demonstrates every PhoneLab
 * primitive: roles, shared state between phones, cross-device events, device
 * notifications, and simulated network conditions.
 */
export default function App() {
  const device = useDevice();
  const network = useNetwork();
  const emptyList = useFlag('empty-list');
  const [items, setItems] = useSharedState<Item[]>('starter:items', []);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = device.role === 'admin';
  const visible = emptyList ? [] : items;

  useAppEvent('item.created', (event) => {
    const item = event.payload as Item;
    notify({
      title: 'New entry',
      body: `${item.author}: ${item.title}`,
      island: 'notification',
      islandLabel: 'New entry',
    });
  });

  const submit = async () => {
    const title = draft.trim();
    if (title === '') return;
    setBusy(true);
    setError(null);
    try {
      await network.request(() => true);
      const item: Item = {
        id: `it_${Date.now().toString(36)}`,
        title,
        author: device.userLabel ?? 'Anonymous',
        createdAt: new Date().toISOString(),
      };
      setItems((current) => [item, ...current]);
      sendEvent('item.created', item, { to: 'admin' });
      setDraft('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="st-root">
      <style>{css}</style>
      <header className="st-head">
        <div className="st-title">{isAdmin ? 'All entries' : 'Your entries'}</div>
        <div className="st-sub">
          {device.userLabel ?? 'Not signed in'} · {device.role}
        </div>
      </header>

      <div className="st-body">
        {visible.length === 0 ? (
          <div className="st-empty">
            Nothing here yet. {isAdmin ? 'Entries created on other phones will show up live.' : 'Add your first entry below.'}
          </div>
        ) : (
          visible.map((item) => (
            <div className="st-card" key={item.id}>
              <div className="st-row">
                <div className="st-row-main">
                  <div className="st-item-title">{item.title}</div>
                  <div className="st-item-sub">
                    {item.author} · {formatTime(item.createdAt)}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
        {error ? <div className="st-empty" style={{ color: 'var(--app-danger)' }}>{error}</div> : null}
      </div>

      {isAdmin ? null : (
        <div className="st-foot">
          <input
            className="st-input"
            value={draft}
            placeholder="What needs doing?"
            aria-label="Entry title"
            data-pl-id="entry-title"
            onInput={(event) => setDraft((event.target as HTMLInputElement).value)}
          />
          <button className="st-btn" onClick={submit} disabled={busy || draft.trim() === ''} data-pl-id="add-entry">
            {busy ? 'Saving…' : 'Add entry'}
          </button>
        </div>
      )}
    </div>
  );
}
