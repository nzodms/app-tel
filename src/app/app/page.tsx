import { redirect } from 'next/navigation';
import { readSessionUser } from '@/server/http/session';
import { landingPathFor } from '@/server/services/onboarding';

export const dynamic = 'force-dynamic';

/**
 * `/app` was the dashboard before there was an onboarding to route around.
 *
 * Kept as a redirect rather than deleted: it is in browser histories, in the
 * README and quite possibly in a bookmark, and a 404 there would look like the
 * product broke.
 */
export default async function LegacyAppPage() {
  const user = await readSessionUser();
  if (!user) redirect('/login?next=%2Fdashboard');
  redirect(landingPathFor(user));
}
