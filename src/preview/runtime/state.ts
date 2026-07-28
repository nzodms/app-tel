import type { PreviewDeviceContext } from '../../lib/preview/protocol';

/**
 * The preview runtime's single source of truth.
 *
 * Lives inside the sandboxed iframe. Deliberately framework-agnostic (plain
 * subscriptions) so the SDK hooks stay tiny and so a future React Native Web
 * target can reuse it unchanged.
 */

export interface RouteState {
  path: string;
  params: Record<string, string>;
}

export type AppEventHandler = (event: IncomingAppEvent) => void;

export interface IncomingAppEvent {
  name: string;
  payload: unknown;
  fromDeviceId: string | null;
  fromRole: string | null;
  at: string;
}

const DEFAULT_CONTEXT: PreviewDeviceContext = {
  deviceId: 'unknown',
  deviceName: 'Device',
  role: 'guest',
  userLabel: null,
  theme: 'light',
  locale: 'en',
  network: 'fast',
  flags: [],
  versionLabel: null,
  viewport: { width: 393, height: 852 },
  safeArea: { top: 59, bottom: 34 },
};

class RuntimeState {
  context: PreviewDeviceContext = DEFAULT_CONTEXT;
  shared: Record<string, unknown> = {};
  route: RouteState = { path: '/', params: {} };
  history: RouteState[] = [];

  private readonly subscribers = new Set<() => void>();
  private readonly eventHandlers = new Map<string, Set<AppEventHandler>>();

  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  notifyChange(): void {
    for (const listener of [...this.subscribers]) {
      try {
        listener();
      } catch (error) {
        console.error('[phonelab-runtime] subscriber failed', error);
      }
    }
  }

  setContext(context: PreviewDeviceContext): void {
    this.context = context;
    this.notifyChange();
  }

  setShared(shared: Record<string, unknown>): void {
    this.shared = shared;
    this.notifyChange();
  }

  patchShared(key: string, value: unknown): void {
    this.shared = { ...this.shared, [key]: value };
    this.notifyChange();
  }

  navigate(path: string, params: Record<string, string> = {}): RouteState | null {
    if (this.route.path === path && shallowEqual(this.route.params, params)) return null;
    this.history = [...this.history, this.route];
    const previous = this.route;
    this.route = { path, params };
    this.notifyChange();
    return previous;
  }

  back(): RouteState | null {
    const previous = this.history[this.history.length - 1];
    if (!previous) return null;
    const from = this.route;
    this.history = this.history.slice(0, -1);
    this.route = previous;
    this.notifyChange();
    return from;
  }

  reset(path = '/'): void {
    this.history = [];
    this.route = { path, params: {} };
    this.notifyChange();
  }

  onAppEvent(name: string, handler: AppEventHandler): () => void {
    const set = this.eventHandlers.get(name) ?? new Set<AppEventHandler>();
    set.add(handler);
    this.eventHandlers.set(name, set);
    return () => {
      set.delete(handler);
      if (set.size === 0) this.eventHandlers.delete(name);
    };
  }

  dispatchAppEvent(event: IncomingAppEvent): void {
    for (const handler of this.eventHandlers.get(event.name) ?? []) safeCall(handler, event);
    for (const handler of this.eventHandlers.get('*') ?? []) safeCall(handler, event);
  }
}

function safeCall(handler: AppEventHandler, event: IncomingAppEvent): void {
  try {
    handler(event);
  } catch (error) {
    console.error(`[phonelab-runtime] handler for "${event.name}" threw`, error);
  }
}

function shallowEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => a[key] === b[key]);
}

export const runtimeState = new RuntimeState();
