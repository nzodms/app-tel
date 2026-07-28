import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { IslandState, PreviewDeviceContext } from '../../lib/preview/protocol';
import { bridgeNonce, log, post } from './bridge';
import { runtimeState, type IncomingAppEvent } from './state';

/**
 * `@phonelab/app` — the SDK a PhoneLab project imports.
 *
 * This is the contract that makes a preview more than a static screen: the app
 * knows which role it is running as, can talk to the other phones on the canvas,
 * can raise real notifications on the device chrome, and can react to Edge Case
 * Studio flags. Everything here is a thin, honest wrapper over the bridge — no
 * hidden magic in the user's app.
 */

/* -------------------------------------------------------------------------- */
/* Reactivity                                                                  */
/* -------------------------------------------------------------------------- */

/** Re-renders the caller whenever any runtime state changes. */
function useRuntimeTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => runtimeState.subscribe(() => setTick((value) => value + 1)), []);
  return tick;
}

/* -------------------------------------------------------------------------- */
/* Device & environment                                                        */
/* -------------------------------------------------------------------------- */

export type DeviceInfo = PreviewDeviceContext;

/** Everything about the phone this instance of the app is running on. */
export function useDevice(): DeviceInfo {
  useRuntimeTick();
  return runtimeState.context;
}

/** True when the given Edge Case Studio flag is applied to this device. */
export function useFlag(flag: string): boolean {
  useRuntimeTick();
  return runtimeState.context.flags.includes(flag);
}

export function useFlags(): string[] {
  useRuntimeTick();
  return runtimeState.context.flags;
}

export function useTheme(): 'light' | 'dark' {
  useRuntimeTick();
  return runtimeState.context.theme;
}

export function useLocale(): string {
  useRuntimeTick();
  return runtimeState.context.locale;
}

/** Tiny translation helper: `t({ en: 'Book', fr: 'Réserver' })`. */
export function useTranslate(): (dict: Record<string, string>) => string {
  const locale = useLocale();
  return useCallback(
    (dict: Record<string, string>) => dict[locale] ?? dict.en ?? Object.values(dict)[0] ?? '',
    [locale],
  );
}

/* -------------------------------------------------------------------------- */
/* Routing                                                                     */
/* -------------------------------------------------------------------------- */

export interface Router {
  route: string;
  params: Record<string, string>;
  canGoBack: boolean;
  navigate(path: string, params?: Record<string, string>): void;
  back(): void;
  reset(path?: string): void;
}

export function useRouter(): Router {
  useRuntimeTick();
  const { path, params } = runtimeState.route;

  const navigate = useCallback((next: string, nextParams: Record<string, string> = {}) => {
    const previous = runtimeState.navigate(next, nextParams);
    if (previous) {
      post({
        type: 'preview:navigate',
        nonce: bridgeNonce(),
        route: next,
        from: previous.path,
        title: document.title || null,
      });
    }
  }, []);

  const back = useCallback(() => {
    const from = runtimeState.back();
    if (from) {
      post({
        type: 'preview:navigate',
        nonce: bridgeNonce(),
        route: runtimeState.route.path,
        from: from.path,
        title: document.title || null,
      });
    }
  }, []);

  const reset = useCallback((next = '/') => {
    runtimeState.reset(next);
    post({
      type: 'preview:navigate',
      nonce: bridgeNonce(),
      route: next,
      from: null,
      title: document.title || null,
    });
  }, []);

  return {
    route: path,
    params,
    canGoBack: runtimeState.history.length > 0,
    navigate,
    back,
    reset,
  };
}

/* -------------------------------------------------------------------------- */
/* Cross-device events                                                         */
/* -------------------------------------------------------------------------- */

export type AppEvent = IncomingAppEvent;

export interface SendEventOptions {
  /** A role slug (`club`), a device id, or `all`. Defaults to `all`. */
  to?: string;
}

/** Emits an event that PhoneLab routes to the other phones and the timeline. */
export function sendEvent(name: string, payload: unknown = null, options: SendEventOptions = {}): void {
  post({
    type: 'preview:emit',
    nonce: bridgeNonce(),
    name,
    payload,
    to: options.to ?? 'all',
  });
}

/** Subscribes to an inbound event. Pass `'*'` for every event. */
export function useAppEvent(name: string, handler: (event: AppEvent) => void): void {
  // The latest handler is kept in a ref so re-subscribing is not needed on every
  // render, and the ref is updated in an effect rather than during render.
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  }, [handler]);
  useEffect(() => runtimeState.onAppEvent(name, (event) => ref.current(event)), [name]);
}

/* -------------------------------------------------------------------------- */
/* Shared state — the "common backend" between phones                          */
/* -------------------------------------------------------------------------- */

/**
 * State shared by every device in the project.
 *
 * Writes are applied locally straight away and broadcast to the other phones
 * through PhoneLab, which keeps ordering deterministic (the host assigns the
 * sequence). This is a simulated backend, not a database — see docs/STATUS.md.
 */
export function useSharedState<T>(key: string, initial: T): [T, (next: T | ((previous: T) => T)) => void] {
  useRuntimeTick();
  const stored = runtimeState.shared[key];
  const value = (stored === undefined ? initial : stored) as T;

  // The initial value is only consulted before the first write. Holding it in a ref
  // keeps the setter identity stable across renders (so it can be passed to child
  // components freely) without capturing a stale value.
  const initialRef = useRef(initial);
  useEffect(() => {
    initialRef.current = initial;
  }, [initial]);

  const setValue = useCallback(
    (next: T | ((previous: T) => T)) => {
      const current = (runtimeState.shared[key] === undefined
        ? initialRef.current
        : runtimeState.shared[key]) as T;
      const resolved =
        typeof next === 'function' ? (next as (previous: T) => T)(current) : next;
      runtimeState.patchShared(key, resolved);
      post({ type: 'preview:shared-set', nonce: bridgeNonce(), key, value: resolved });
    },
    [key],
  );

  return [value, setValue];
}

/* -------------------------------------------------------------------------- */
/* Device chrome: notifications, Dynamic Island                                */
/* -------------------------------------------------------------------------- */

export interface NotifyInput {
  title: string;
  body?: string;
  kind?: 'default' | 'success' | 'warning' | 'error';
  /** Dynamic Island state to switch to. Defaults to `notification`. */
  island?: IslandState;
  /** Short text shown in the expanded island. */
  islandLabel?: string;
  durationMs?: number;
  /** Increments a navigation badge, e.g. `{ key: 'inbox', value: 1 }`. */
  badge?: { key: string; value: number };
}

let notificationCounter = 0;

/** Raises a notification on *this* device's chrome (banner + Dynamic Island). */
export function notify(input: NotifyInput): void {
  notificationCounter += 1;
  post({
    type: 'preview:notify',
    nonce: bridgeNonce(),
    notification: {
      id: `n${notificationCounter}_${Date.now().toString(36)}`,
      title: input.title,
      body: input.body ?? null,
      kind: input.kind ?? 'default',
      island: input.island ?? 'notification',
      islandLabel: input.islandLabel ?? null,
      duration: input.durationMs ?? 4200,
      badge: input.badge ?? null,
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Network simulation                                                          */
/* -------------------------------------------------------------------------- */

export class OfflineError extends Error {
  constructor(message = 'You appear to be offline.') {
    super(message);
    this.name = 'OfflineError';
  }
}

export interface NetworkApi {
  condition: 'fast' | 'slow' | 'offline';
  online: boolean;
  slow: boolean;
  /** Latency the current condition adds to a request, in ms. */
  latency: number;
  /**
   * Wraps an async operation with the simulated network condition: adds latency
   * on `slow`, rejects with `OfflineError` on `offline`.
   */
  request<T>(operation: () => Promise<T> | T): Promise<T>;
}

const LATENCY: Record<'fast' | 'slow' | 'offline', number> = {
  fast: 120,
  slow: 2200,
  offline: 0,
};

export function useNetwork(): NetworkApi {
  useRuntimeTick();
  const condition = runtimeState.context.network;
  const latency = LATENCY[condition];

  const request = useCallback(
    async <T,>(operation: () => Promise<T> | T): Promise<T> => {
      const current = runtimeState.context.network;
      if (current === 'offline') {
        await delay(300);
        throw new OfflineError();
      }
      await delay(LATENCY[current]);
      return operation();
    },
    [],
  );

  return {
    condition,
    online: condition !== 'offline',
    slow: condition === 'slow',
    latency,
    request,
  };
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* -------------------------------------------------------------------------- */
/* Logging                                                                     */
/* -------------------------------------------------------------------------- */

/** Writes a line to the PhoneLab Logs panel and the timeline. */
export function logEvent(message: string, level: 'debug' | 'info' | 'warn' | 'error' = 'info'): void {
  log(level, message);
}

/** Formats a currency amount for the device locale. */
export function formatMoney(amountCents: number, currency = 'EUR'): string {
  const locale = runtimeState.context.locale === 'fr' ? 'fr-FR' : 'en-GB';
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amountCents / 100);
}

export function formatTime(iso: string): string {
  const locale = runtimeState.context.locale === 'fr' ? 'fr-FR' : 'en-GB';
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}
