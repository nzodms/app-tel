import type { Metadata, Viewport } from 'next';
import { SetupRequired } from '@/components/setup/setup-required';
import { storeResolution } from '@/server/db';
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
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // One gate for every page. `storeResolution()` is a pure read of the
  // environment and never throws, so this cannot itself become the failure.
  //
  // Without it, a deployment with no database renders Next's generic "This page
  // couldn't load" on every route — `getStore()` throws inside a server
  // component and nothing there catches it, unlike the API routes, whose wrapper
  // turns the same error into a classified 503. Same cause, two very different
  // amounts of help.
  const resolution = storeResolution();

  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        {resolution.driver === null ? <SetupRequired resolution={resolution} /> : children}
      </body>
    </html>
  );
}
