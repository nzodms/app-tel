import type { NextConfig } from 'next';

/**
 * PhoneLab keeps two very different security postures in one app:
 *
 *  - the studio (`/`, `/app`, `/studio/*`) is a normal first-party surface;
 *  - `/preview/host` is the document that runs *user code*. It is always loaded
 *    inside `<iframe sandbox="allow-scripts">`, which gives it an opaque origin,
 *    so it cannot touch our cookies or DOM. On top of that we lock it down with a
 *    CSP that permits exactly what the preview bootstrap needs: its own inline
 *    bootstrap and `blob:` module URLs (how the compiled bundle is evaluated).
 *
 * Everything user-authored is compiled server-side by esbuild (parse/transform
 * only — never executed in our process) and handed to that iframe.
 */
const PREVIEW_CSP = [
  "default-src 'none'",
  // 'unsafe-inline' covers the bootstrap <script> in the host document; blob: is
  // how the compiled project bundle is imported as an ES module.
  "script-src 'unsafe-inline' blob:",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // esbuild ships a native binary; it must be required at runtime rather than
  // pulled into the bundle graph. It is only ever imported by server code.
  serverExternalPackages: ['esbuild'],
  experimental: {
    // Monaco is large; keep it out of the initial studio chunk graph.
    optimizePackageImports: ['lucide-react'],
  },
  async headers() {
    return [
      {
        source: '/preview/host',
        headers: [
          { key: 'Content-Security-Policy', value: PREVIEW_CSP },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
