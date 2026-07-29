'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { UserPreferences } from '@/lib/preferences';

/**
 * Applying the account's theme to the document.
 *
 * The whole theme is CSS: globals.css declares one set of token names twice, and
 * `data-theme` on <html> picks which set is live. So the only job here is to get
 * that attribute right, keep it right when the system appearance changes under
 * a 'system' preference, and get it right *before the first paint*.
 *
 * ---------------------------------------------------------------------------
 * Not flashing the wrong theme
 * ---------------------------------------------------------------------------
 * The flash is a race between the browser's first paint and React's first
 * effect. The HTML streams with no `data-theme`, which is the light theme, so an
 * effect-only implementation paints light chrome and then corrects it — one
 * frame of white for someone who asked for dark.
 *
 * `<ThemeScript>` closes that race the only way it can be closed on a
 * server-rendered page: a synchronous inline script. The parser runs it the
 * moment it reaches it, before anything after it is painted. It has everything
 * it needs — the preference lives on the account, so the server already knows
 * it, and 'system' is one `matchMedia` call away.
 *
 * The limits, precisely, because they matter for where it gets mounted:
 *
 *  - It only protects what comes *after* it. As the first child of <body> (or in
 *    the layout's <head>) nothing can flash. Mounted halfway down the studio,
 *    whatever was painted above it may have been painted light. Where it goes is
 *    the wiring step's call; this file just provides it.
 *  - It does not run on a client-side navigation into the studio: React does not
 *    execute inline scripts it inserts into the DOM. That case is covered by
 *    `<StudioTheme>`/`useStudioTheme` — and there is nothing to flash there
 *    anyway, because the attribute set on the previous page is still on <html>.
 *  - The attribute is not in the server-rendered HTML, so at hydration it is an
 *    extra attribute on <html>. React logs a development-only warning about that
 *    unless <html> carries `suppressHydrationWarning`. Rendering is correct
 *    either way; app/layout.tsx belongs to another step.
 *
 * There is deliberately no transition on the switch. Cross-fading a theme means
 * animating colour on every element in the document, which is a full repaint per
 * frame and cannot be composited — the studio's motion budget does not have room
 * for it, and a theme change is a settings action, not a gesture.
 *
 * Nothing here touches a preview. `data-theme` on the studio's <html> cannot
 * cross into an <iframe> (a separate document), the frames carry their own
 * `data-theme` driven by `DeviceRow.theme`, and globals.css pins iframes and the
 * device chassis back to the light tokens so not even the inherited colour
 * scheme leaks in.
 */

export type ThemePreference = UserPreferences['theme'];
export type ResolvedTheme = 'light' | 'dark';

/** The attribute globals.css keys the dark palette off. */
export const THEME_ATTRIBUTE = 'data-theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * One MediaQueryList for the process. `useSyncExternalStore` calls the snapshot
 * on every render, and `matchMedia()` allocates a new list each time it is
 * called; caching keeps that to one object and one listener.
 *
 * `undefined` means "not looked up yet", `null` means "no matchMedia here" —
 * which covers the server and old test environments.
 */
let cachedQuery: MediaQueryList | null | undefined;

function darkQuery(): MediaQueryList | null {
  if (cachedQuery === undefined) {
    cachedQuery =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(DARK_QUERY)
        : null;
  }
  return cachedQuery;
}

function readSystemTheme(): ResolvedTheme {
  return darkQuery()?.matches ? 'dark' : 'light';
}

/**
 * The server cannot know the system appearance, and guessing would produce
 * markup that disagrees with the client. 'light' matches DEFAULT_PREFERENCES and
 * matches the tokens on `:root`, so the HTML and the CSS agree; `ThemeScript`
 * corrects it before paint on the client.
 */
function serverSystemTheme(): ResolvedTheme {
  return 'light';
}

function subscribeToSystem(onChange: () => void): () => void {
  const query = darkQuery();
  if (!query) return () => {};
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function noSubscription(): () => void {
  return () => {};
}

/** 'system' asks the OS; the other two answer for themselves. */
export function resolveTheme(
  preference: ThemePreference,
  system: ResolvedTheme = readSystemTheme(),
): ResolvedTheme {
  return preference === 'system' ? system : preference;
}

/** Writes the attribute. Safe to call from anywhere, including before hydration. */
export function applyTheme(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute(THEME_ATTRIBUTE, theme);
}

/**
 * The live system appearance, and updates to it.
 *
 * Only subscribes when the preference actually depends on it — someone who has
 * chosen 'light' should not be re-rendered because their OS went dark at sunset.
 */
export function useSystemTheme(follow: boolean): ResolvedTheme {
  const subscribe = useCallback(
    (onChange: () => void) => (follow ? subscribeToSystem(onChange) : noSubscription()),
    [follow],
  );
  return useSyncExternalStore(subscribe, readSystemTheme, serverSystemTheme);
}

/**
 * Applies `preference` to the document and returns what it resolved to.
 *
 * The effect is a correction, not the mechanism: on a fresh load `ThemeScript`
 * has already put the right value on <html>, so this writes the same string it
 * finds. It earns its keep afterwards — when the preference changes in Settings,
 * when the OS flips under a 'system' preference, and on a client-side navigation
 * where no script ran.
 */
export function useStudioTheme(preference: ThemePreference): ResolvedTheme {
  const system = useSystemTheme(preference === 'system');
  const theme = resolveTheme(preference, system);

  useEffect(() => {
    applyTheme(theme);
    // No cleanup: the theme belongs to the account, not to this page. Leaving
    // the studio for the dashboard must not drop it back to light.
  }, [theme]);

  return theme;
}

/**
 * Mountable form of the hook, for callers that only want the side effect.
 * Renders nothing, so its re-renders cost nothing.
 */
export function StudioTheme({ preference }: { preference: ThemePreference }): null {
  useStudioTheme(preference);
  return null;
}

/** Anything not one of the three known values is treated as the default. */
function normalisePreference(preference: string): ThemePreference {
  return preference === 'dark' || preference === 'system' ? preference : 'light';
}

/**
 * The pre-paint script. See the note at the top of this file for what it does
 * and does not cover.
 *
 * The interpolated value is `normalisePreference`'d down to one of three string
 * literals before it reaches the source, so there is nothing user-controlled in
 * the script text.
 */
export function ThemeScript({ preference }: { preference: ThemePreference }) {
  const chosen = JSON.stringify(normalisePreference(preference));
  const source =
    `(function(){try{var p=${chosen};` +
    `var d=p==='dark'||(p==='system'&&window.matchMedia&&` +
    `window.matchMedia('${DARK_QUERY}').matches);` +
    `document.documentElement.setAttribute('${THEME_ATTRIBUTE}',d?'dark':'light')}` +
    `catch(e){}})()`;

  // suppressHydrationWarning: the script has already mutated <html> by the time
  // React looks at this subtree.
  return <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: source }} />;
}
