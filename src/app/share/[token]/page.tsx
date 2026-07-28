import type { Metadata } from 'next';
import { Reviewer } from '@/components/share/reviewer';

export const metadata: Metadata = {
  title: 'Review',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * The reviewer entry point.
 *
 * Rendered as a thin client shell on purpose: the link may be password- or
 * email-gated, and nothing about the project should reach the browser until the gate
 * is satisfied. All access decisions happen in `/api/share/[token]/open`.
 */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <Reviewer token={token} />;
}
