import {
  PREVIEW_PROTOCOL_VERSION,
  type HostMessage,
  type PreviewMessage,
  type PreviewSnapshot,
  type ReplayStep,
  isHostMessage,
} from '../../lib/preview/protocol';
import { runtimeState } from './state';

/**
 * The only channel between user code and PhoneLab.
 *
 * Runs inside `<iframe sandbox="allow-scripts">`, so this frame has an opaque
 * origin: it has no access to PhoneLab cookies, storage, or DOM, and it cannot
 * make credentialed requests. Every message carries the nonce handed to this
 * frame in its URL; anything else is dropped on the floor.
 */

let nonce = '';
let inspectMode = false;
let currentHash = '';
let mounted = false;

export function bridgeNonce(): string {
  return nonce;
}

export function post(message: PreviewMessage): void {
  // The parent verifies `event.source`; targetOrigin must be '*' because this
  // frame's own origin is opaque.
  window.parent.postMessage(message, '*');
}

export function reportError(
  error: unknown,
  phase: 'mount' | 'render' | 'runtime',
): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? (error.stack ?? null) : null;
  post({ type: 'preview:error', nonce, message, stack, phase });
}

export function log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
  post({ type: 'preview:log', nonce, level, message });
}

/* -------------------------------------------------------------------------- */
/* Wiring                                                                      */
/* -------------------------------------------------------------------------- */

export interface BridgeHooks {
  /** Compile output arrived; evaluate it and mount. */
  onLoad(code: string, hash: string): void;
  onReset(): void;
}

export function initBridge(hooks: BridgeHooks): void {
  const params = new URLSearchParams(window.location.search);
  nonce = params.get('n') ?? '';

  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    // Only the embedding window may talk to us.
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!isHostMessage(data) || data.nonce !== nonce) return;
    handleHostMessage(data, hooks);
  });

  window.addEventListener('error', (event) => {
    reportError(event.error ?? event.message, mounted ? 'runtime' : 'mount');
  });

  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, 'runtime');
  });

  installInteractionTracking();
  installInspector();

  post({ type: 'preview:ready', nonce, protocol: PREVIEW_PROTOCOL_VERSION });
}

function handleHostMessage(message: HostMessage, hooks: BridgeHooks): void {
  switch (message.type) {
    case 'host:init':
      runtimeState.setContext(message.context);
      runtimeState.setShared(message.shared);
      break;
    case 'host:load':
      currentHash = message.hash;
      hooks.onLoad(message.code, message.hash);
      break;
    case 'host:context':
      runtimeState.setContext(message.context);
      break;
    case 'host:shared':
      runtimeState.setShared(message.shared);
      break;
    case 'host:event':
      runtimeState.dispatchAppEvent(message.event);
      break;
    case 'host:navigate':
      runtimeState.navigate(message.route, message.params ?? {});
      break;
    case 'host:inspect':
      inspectMode = message.enabled;
      document.documentElement.classList.toggle('pl-inspect', inspectMode);
      break;
    case 'host:highlight':
      highlight(message.sourceRef);
      break;
    case 'host:replay':
      void applyReplayStep(message.step);
      break;
    case 'host:snapshot':
      post({
        type: 'preview:snapshot',
        nonce,
        requestId: message.requestId,
        snapshot: takeSnapshot(),
      });
      break;
    case 'host:reset':
      runtimeState.reset();
      hooks.onReset();
      break;
  }
}

export function announceMounted(): void {
  mounted = true;
  post({ type: 'preview:mounted', nonce, route: runtimeState.route.path, hash: currentHash });
}

/* -------------------------------------------------------------------------- */
/* Interaction tracking — feeds journey recording and the timeline             */
/* -------------------------------------------------------------------------- */

function installInteractionTracking(): void {
  document.addEventListener(
    'click',
    (event) => {
      if (inspectMode) return;
      const element = closestInteractive(event.target);
      if (!element) return;
      post({
        type: 'preview:interaction',
        nonce,
        action: 'tap',
        label: readLabel(element),
        sourceRef: readSourceRef(element),
        target: element.getAttribute('data-pl-id'),
        route: runtimeState.route.path,
      });
    },
    true,
  );

  document.addEventListener(
    'change',
    (event) => {
      const element = event.target;
      if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
        if (!(element instanceof HTMLSelectElement)) return;
      }
      const field = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      post({
        type: 'preview:interaction',
        nonce,
        action: 'input',
        label: field.getAttribute('aria-label') ?? field.getAttribute('placeholder') ?? field.name,
        sourceRef: readSourceRef(field),
        target: field.getAttribute('data-pl-id'),
        route: runtimeState.route.path,
      });
    },
    true,
  );
}

function closestInteractive(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const selector =
    '[data-pl-id],button,a,[role="button"],input[type="submit"],[data-pl-track]';
  const found = target.closest(selector);
  return found instanceof HTMLElement ? found : null;
}

function readLabel(element: HTMLElement): string | null {
  const explicit = element.getAttribute('aria-label') ?? element.getAttribute('data-pl-label');
  if (explicit) return explicit.trim();
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text.slice(0, 80) : null;
}

function readSourceRef(element: Element): string | null {
  const holder = element.closest('[data-pl-src]');
  return holder?.getAttribute('data-pl-src') ?? null;
}

/* -------------------------------------------------------------------------- */
/* Inspector — click an element, get its file                                 */
/* -------------------------------------------------------------------------- */

function installInspector(): void {
  const style = document.createElement('style');
  style.textContent = `
    html.pl-inspect * { cursor: crosshair !important; }
    html.pl-inspect [data-pl-src]:hover {
      outline: 1.5px solid #2570e8 !important;
      outline-offset: -1px;
      background-color: rgba(37,112,232,0.06) !important;
    }
    .pl-highlight-flash {
      animation: pl-flash 900ms cubic-bezier(0.22,1,0.36,1);
    }
    @keyframes pl-flash {
      0% { box-shadow: inset 0 0 0 2px rgba(37,112,232,0.9); }
      100% { box-shadow: inset 0 0 0 2px rgba(37,112,232,0); }
    }
  `;
  document.head.appendChild(style);

  document.addEventListener(
    'click',
    (event) => {
      if (!inspectMode) return;
      event.preventDefault();
      event.stopPropagation();
      const target = event.target;
      if (!(target instanceof Element)) return;
      const holder = target.closest('[data-pl-src]');
      const rect = (holder ?? target).getBoundingClientRect();
      post({
        type: 'preview:inspect',
        nonce,
        sourceRef: holder?.getAttribute('data-pl-src') ?? null,
        label: holder instanceof HTMLElement ? readLabel(holder) : null,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      });
    },
    true,
  );
}

function highlight(sourceRef: string | null): void {
  for (const node of document.querySelectorAll('.pl-highlight-flash')) {
    node.classList.remove('pl-highlight-flash');
  }
  if (!sourceRef) return;
  const escaped = sourceRef.replace(/["\\]/g, '\\$&');
  const target = document.querySelector(`[data-pl-src="${escaped}"]`);
  if (!target) return;
  target.classList.add('pl-highlight-flash');
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/* -------------------------------------------------------------------------- */
/* Journey replay                                                              */
/* -------------------------------------------------------------------------- */

async function applyReplayStep(step: ReplayStep): Promise<void> {
  switch (step.kind) {
    case 'navigate':
      if (step.route) runtimeState.navigate(step.route);
      return;
    case 'event':
      if (step.eventName) {
        runtimeState.dispatchAppEvent({
          name: step.eventName,
          payload: step.payload,
          fromDeviceId: null,
          fromRole: null,
          at: new Date().toISOString(),
        });
      }
      return;
    case 'tap': {
      const element = findTarget(step);
      if (!element) {
        reportError(new Error(`Replay could not find "${step.target ?? step.label ?? '?'}"`), 'runtime');
        return;
      }
      element.scrollIntoView({ block: 'center' });
      element.click();
      return;
    }
    case 'input': {
      const element = findTarget(step);
      if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
        reportError(new Error(`Replay target is not a field: ${step.target ?? step.label ?? '?'}`), 'runtime');
        return;
      }
      element.value = step.value ?? '';
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    case 'assert': {
      const found = step.label
        ? [...document.querySelectorAll('*')].some((node) =>
            (node.textContent ?? '').includes(step.label as string),
          )
        : true;
      if (!found) reportError(new Error(`Assertion failed: "${step.label}" not on screen`), 'runtime');
      return;
    }
  }
}

function findTarget(step: ReplayStep): HTMLElement | null {
  if (step.target) {
    const escaped = step.target.replace(/["\\]/g, '\\$&');
    const byId = document.querySelector(`[data-pl-id="${escaped}"]`);
    if (byId instanceof HTMLElement) return byId;
  }
  if (step.label) {
    const needle = step.label.toLowerCase();
    const candidates = document.querySelectorAll(
      '[data-pl-id],button,a,[role="button"],input,textarea,select',
    );
    for (const node of candidates) {
      if (!(node instanceof HTMLElement)) continue;
      const label = (readLabel(node) ?? '').toLowerCase();
      if (label === needle) return node;
    }
    for (const node of candidates) {
      if (!(node instanceof HTMLElement)) continue;
      const label = (readLabel(node) ?? '').toLowerCase();
      if (label.includes(needle)) return node;
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Structural snapshot (what `capture_device` returns)                         */
/* -------------------------------------------------------------------------- */

function takeSnapshot(): PreviewSnapshot {
  const texts: string[] = [];
  const seen = new Set<string>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const value = (node.nodeValue ?? '').replace(/\s+/g, ' ').trim();
    const parent = node.parentElement;
    if (value.length > 0 && parent && isVisible(parent) && !seen.has(value)) {
      seen.add(value);
      texts.push(value);
    }
    node = walker.nextNode();
  }

  const actions: PreviewSnapshot['actions'] = [];
  for (const element of document.querySelectorAll('[data-pl-id],button,a,[role="button"]')) {
    if (!(element instanceof HTMLElement) || !isVisible(element)) continue;
    actions.push({
      label: readLabel(element) ?? '(no label)',
      target: element.getAttribute('data-pl-id'),
      sourceRef: readSourceRef(element),
    });
  }

  return {
    route: runtimeState.route.path,
    title: document.title || null,
    texts: texts.slice(0, 200),
    actions: actions.slice(0, 80),
    capturedAt: new Date().toISOString(),
  };
}

function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = window.getComputedStyle(element);
  return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
}
