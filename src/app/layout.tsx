import type { Metadata, Viewport } from 'next';
import { SetupRequired } from '@/components/setup/setup-required';
import { ThemeScript } from '@/components/studio/theme';
import { DEFAULT_PREFERENCES } from '@/lib/preferences';
import { storeResolution } from '@/server/db';
import { readSessionUser } from '@/server/http/session';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'PhoneLab',
    template: '%s · PhoneLab',
  },
  description:
    'PhoneLab is the visual studio for Claude-built mobile apps: your code on the left, interactive phones on a canvas on the right.',
  applicationName: 'PhoneLab',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The browser's own UI follows the studio. One value per scheme, because a
  // fixed white bar above a dark app is worse than no theme colour at all.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8f9fb' },
    { media: '(prefers-color-scheme: dark)', color: '#191d24' },
  ],
};

/**
 * The stored theme, or the default if there is nobody to ask.
 *
 * Never allowed to be the reason a page fails: a share link is opened by people
 * with no account, and a database that is down must produce the setup page below
 * rather than a crash on the way to picking a colour.
 */
async function themePreference() {
  try {
    const user = await readSessionUser();
    return user?.preferences?.theme ?? DEFAULT_PREFERENCES.theme;
  } catch {
    return DEFAULT_PREFERENCES.theme;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // One gate for every page. `storeResolution()` is a pure read of the
  // environment and never throws, so this cannot itself become the failure.
  //
  // Without it, a deployment with no database renders Next's generic "This page
  // couldn't load" on every route — `getStore()` throws inside a server
  // component and nothing there catches it, unlike the API routes, whose wrapper
  // turns the same error into a classified 503. Same cause, two very different
  // amounts of help.
  const resolution = storeResolution();
  const preference = resolution.driver === null ? 'light' : await themePreference();

  return (
    // suppressHydrationWarning: ThemeScript puts `data-theme` on this element
    // before React ever sees it, which is an attribute the server HTML does not
    // carry. The markup is correct either way; without this React logs about it
    // in development.
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        {/* First thing in the body, so nothing has painted yet when it runs and
            there is no flash of the wrong theme. */}
        <ThemeScript preference={preference} />
        {resolution.driver === null ? <SetupRequired resolution={resolution} /> : children}
      </body>
    </html>
  );
}
