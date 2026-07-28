import { previewHostHtml } from '@/preview/host/document';

/**
 * The document loaded inside every phone's iframe.
 *
 * A route handler rather than a page so the response is exactly the HTML we
 * wrote — no framework bootstrap inside the frame that runs user code. Security
 * headers (including the preview CSP) are attached in `next.config.ts`.
 */
export const dynamic = 'force-static';

export function GET(): Response {
  return new Response(previewHostHtml(), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
