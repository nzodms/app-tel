import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import {
  OnboardingFlow,
  type OnboardingDraftShape,
} from '@/components/onboarding/onboarding-flow';
import { getStore } from '@/server/db';
import { requestOrigin } from '@/server/http/origin';
import { readSessionUser } from '@/server/http/session';
import { mcpResourceUri } from '@/server/oauth/urls';
import { getOnboardingState } from '@/server/services/onboarding';
import { PROJECT_CATEGORIES } from '@/server/services/scaffold';

export const metadata: Metadata = { title: 'Get started' };
export const dynamic = 'force-dynamic';

/**
 * `/onboarding`.
 *
 * Reachable at any time. Someone who has already finished it is sent to the
 * dashboard unless they asked to see it again (`?again=1`, which is what the
 * profile menu links to), so the URL is never a dead end and never a loop.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ again?: string }>;
}) {
  const user = await readSessionUser();
  if (!user) redirect('/login?next=%2Fonboarding');

  const { again } = await searchParams;
  const revisiting = again === '1';

  const [state, origin] = await Promise.all([
    getOnboardingState(getStore(), user.id),
    requestOrigin(),
  ]);

  if (state.completed && !revisiting) redirect('/dashboard');

  return (
    <OnboardingFlow
      userName={user.name}
      initialStep={revisiting ? 0 : state.step}
      initialDraft={state.draft as OnboardingDraftShape}
      categories={[...PROJECT_CATEGORIES]}
      connectorEndpoint={mcpResourceUri(origin)}
      revisiting={revisiting}
    />
  );
}
