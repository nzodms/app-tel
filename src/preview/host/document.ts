import { PREVIEW_RUNTIME_SOURCE } from '@/generated/preview-runtime';

/**
 * The preview host document.
 *
 * Served as raw HTML (not a Next page) so the frame that runs user code contains
 * nothing but a reset, a token set, and the runtime shell — no framework runtime,
 * no app JS, no cookies within reach.
 *
 * The runtime is *inlined*. The frame is sandboxed without `allow-same-origin`, so
 * it lives on an opaque origin and cannot fetch a script from PhoneLab's origin —
 * and it should not be able to. Inlining lets the frame's CSP stay at
 * `script-src 'unsafe-inline' blob:` with `connect-src 'none'`: no network at all.
 */

const RESET_AND_TOKENS = `
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; }
html {
  -webkit-text-size-adjust: 100%;
  --pl-safe-top: 59px;
  --pl-safe-bottom: 34px;
  --pl-keyboard: 0px;
}
body {
  height: 100%;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
  font-size: 15px;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
  background: var(--app-bg);
  color: var(--app-fg);
  /* Text selection inside a phone reads as a bug during drags. */
  -webkit-user-select: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
input, textarea, select, button { font: inherit; color: inherit; }
input, textarea { -webkit-user-select: text; user-select: text; }
button { cursor: pointer; }
#pl-root { height: 100%; display: flex; flex-direction: column; }

/* App-facing design tokens. Projects style against these so light/dark and
   locale switching in PhoneLab actually changes the app. */
html[data-theme='light'] {
  --app-bg: #f5f6f8;
  --app-surface: #ffffff;
  --app-surface-2: #f0f1f4;
  --app-fg: #14181d;
  --app-fg-muted: #6b7280;
  --app-border: rgba(16, 20, 26, 0.09);
  --app-accent: #1f6feb;
  --app-accent-fg: #ffffff;
  --app-positive: #16884f;
  --app-warning: #b26a00;
  --app-danger: #c8352f;
  --app-shadow: 0 1px 2px rgba(16, 20, 26, 0.05), 0 6px 16px -6px rgba(16, 20, 26, 0.12);
}
html[data-theme='dark'] {
  --app-bg: #0e1116;
  --app-surface: #171b21;
  --app-surface-2: #1f242c;
  --app-fg: #eef1f5;
  --app-fg-muted: #96a0ad;
  --app-border: rgba(255, 255, 255, 0.1);
  --app-accent: #4d93fb;
  --app-accent-fg: #08111d;
  --app-positive: #3ec27f;
  --app-warning: #e0a33c;
  --app-danger: #f0655e;
  --app-shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 20px -8px rgba(0, 0, 0, 0.6);
}
html:not([data-theme]) { --app-bg: #f5f6f8; --app-fg: #14181d; }

::-webkit-scrollbar { width: 0; height: 0; }
* { scrollbar-width: none; }

/* Shown when a screen throws. Deliberately plain: it is a real error state, not
   a decorative placeholder. */
.pl-runtime-error {
  margin: auto;
  padding: 20px;
  max-width: 320px;
  text-align: left;
}
.pl-runtime-error-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--app-danger, #c8352f);
  margin-bottom: 8px;
}
.pl-runtime-error-body {
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 11.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--app-fg-muted, #6b7280);
  margin: 0;
}

/* Nothing has loaded yet. No fake spinner: the studio owns build feedback. */
#pl-boot {
  position: absolute;
  inset: 0;
  pointer-events: none;
  display: grid;
  place-items: center;
  font-size: 12px;
  color: #9aa2ad;
  letter-spacing: 0.01em;
}
`;

/** Keeps a `</script>` inside the bundle from terminating the inline block. */
function inlineSafe(source: string): string {
  return source.replace(/<\/script/gi, '<\\/script');
}

export function previewHostHtml(): string {
  return `<!doctype html>
<html data-theme="light">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>PhoneLab preview</title>
<style>${RESET_AND_TOKENS}</style>
</head>
<body>
<div id="pl-boot">Waiting for build…</div>
<script>${inlineSafe(PREVIEW_RUNTIME_SOURCE)}</script>
</body>
</html>`;
}
