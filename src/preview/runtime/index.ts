import { Component, h, options, render, type ComponentChildren, type VNode } from 'preact';
import * as compat from 'preact/compat';
import * as jsxRuntime from 'preact/compat/jsx-runtime';
import * as jsxDevRuntime from 'preact/compat/jsx-dev-runtime';
import * as hooks from 'preact/hooks';
import { announceMounted, initBridge, reportError } from './bridge';
import * as sdk from './sdk';
import { runtimeState } from './state';

/**
 * Layer A of the preview: the runtime shell.
 *
 * Built ahead of time into `public/preview/runtime.js` by
 * `scripts/build-preview-runtime.mjs`. It ships React (via preact/compat), the
 * `@phonelab/app` SDK and the bridge — so the per-request compile only has to
 * handle the *user's* files, and the server needs no node_modules at runtime.
 *
 * The compiled project bundle arrives over postMessage and is evaluated as a
 * `blob:` script (permitted by the preview CSP, and scoped to this frame's
 * opaque origin).
 */

/* -------------------------------------------------------------------------- */
/* Module registry — what `require()` resolves to inside a project bundle       */
/* -------------------------------------------------------------------------- */

const react = { ...compat, default: compat };

const MODULES: Record<string, unknown> = {
  react,
  'react/jsx-runtime': jsxRuntime,
  'react/jsx-dev-runtime': jsxDevRuntime,
  'react-dom': compat,
  'react-dom/client': compat,
  preact: { h, render, Component, options },
  'preact/hooks': hooks,
  'preact/compat': react,
  '@phonelab/app': { ...sdk, default: sdk },
};

declare global {
  var __PHONELAB_REQUIRE__: (specifier: string) => unknown;
  var __PHONELAB_APP__: { default?: unknown } | undefined;
}

globalThis.__PHONELAB_REQUIRE__ = (specifier: string): unknown => {
  const found = MODULES[specifier];
  if (found) return found;
  throw new Error(
    `PhoneLab preview cannot resolve "${specifier}". ` +
      'Browser previews may import react, react-dom and @phonelab/app, plus any file in this project.',
  );
};

/* -------------------------------------------------------------------------- */
/* Source mapping: stamp every DOM element with its origin in the code          */
/* -------------------------------------------------------------------------- */

interface SourceLocation {
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
}

const previousVnodeHook = options.vnode;

options.vnode = (vnode: VNode & { __source?: SourceLocation }) => {
  // Only DOM elements: component vnodes would duplicate the attribute onto their
  // rendered root and confuse the inspector.
  if (typeof vnode.type === 'string' && vnode.__source) {
    const { fileName, lineNumber, columnNumber } = vnode.__source;
    if (fileName && lineNumber !== undefined) {
      const props = vnode.props as Record<string, unknown>;
      if (props['data-pl-src'] === undefined) {
        props['data-pl-src'] = `${fileName}:${lineNumber}:${columnNumber ?? 0}`;
      }
    }
  }
  previousVnodeHook?.(vnode);
};

/* -------------------------------------------------------------------------- */
/* Error boundary                                                              */
/* -------------------------------------------------------------------------- */

interface BoundaryState {
  error: Error | null;
}

class PreviewBoundary extends Component<{ children?: ComponentChildren }, BoundaryState> {
  override state: BoundaryState = { error: null };

  static override getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    reportError(error, 'render');
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return h(
      'div',
      { class: 'pl-runtime-error', role: 'alert' },
      h('div', { class: 'pl-runtime-error-title' }, 'This screen crashed'),
      h('pre', { class: 'pl-runtime-error-body' }, error.message),
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Chrome plumbing: theme, safe areas, simulated keyboard                       */
/* -------------------------------------------------------------------------- */

function applyContext(): void {
  const { theme, safeArea, viewport, flags, locale } = runtimeState.context;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.lang = locale;
  root.style.setProperty('--pl-safe-top', `${safeArea.top}px`);
  root.style.setProperty('--pl-safe-bottom', `${safeArea.bottom}px`);
  root.style.setProperty('--pl-viewport-width', `${viewport.width}px`);
  root.style.setProperty('--pl-viewport-height', `${viewport.height}px`);
  // The phone chrome draws the keyboard; the app only needs the space reserved.
  const keyboard = flags.includes('keyboard-open') ? Math.round(viewport.height * 0.42) : 0;
  root.style.setProperty('--pl-keyboard', `${keyboard}px`);
  root.dataset.plFlags = flags.join(' ');
}

/* -------------------------------------------------------------------------- */
/* Boot                                                                        */
/* -------------------------------------------------------------------------- */

function container(): HTMLElement {
  let node = document.getElementById('pl-root');
  if (!node) {
    node = document.createElement('div');
    node.id = 'pl-root';
    document.body.appendChild(node);
  }
  return node;
}

let currentScript: HTMLScriptElement | null = null;

function evaluateBundle(code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([code], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const script = document.createElement('script');
    script.src = url;
    script.onload = () => {
      URL.revokeObjectURL(url);
      currentScript?.remove();
      currentScript = script;
      resolve();
    };
    script.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The preview bundle could not be evaluated.'));
    };
    document.head.appendChild(script);
  });
}

function mount(): void {
  // The host document's placeholder covers the viewport; it must go the moment we
  // have something real to show, or it would swallow every tap.
  document.getElementById('pl-boot')?.remove();

  const exported = globalThis.__PHONELAB_APP__;
  const App = exported?.default;
  if (typeof App !== 'function') {
    reportError(
      new Error(
        'The project entry file must `export default` a component. ' +
          'Check the entry point in your project settings.',
      ),
      'mount',
    );
    return;
  }

  applyContext();
  // Full unmount first: a new bundle means new component identities, and we want
  // deterministic state rather than a half-reconciled tree.
  render(null, container());
  render(
    h(PreviewBoundary, null, h(App as () => VNode, {})),
    container(),
  );
  announceMounted();
}

runtimeState.subscribe(applyContext);

initBridge({
  onLoad(code) {
    void evaluateBundle(code)
      .then(() => mount())
      .catch((error: unknown) => reportError(error, 'mount'));
  },
  onReset() {
    if (globalThis.__PHONELAB_APP__) mount();
  },
});
