import type { Metadata, Viewport } from 'next';
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
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
