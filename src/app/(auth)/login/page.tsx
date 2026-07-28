import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/auth-form';
import { Wordmark } from '@/components/brand/logo';
import { Card } from '@/components/ui/primitives';
import { readSessionUser } from '@/server/http/session';
import { landingPathFor } from '@/server/services/onboarding';

export const metadata: Metadata = { title: 'Sign in' };

/** `next` carries the destination through the OAuth consent flow. */
function safeNext(value: string | undefined): string {
  if (!value) return '/dashboard';
  return value.startsWith('/') && !value.startsWith('//') ? value : '/dashboard';
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);

  const user = await readSessionUser();
  // Onboarding wins over `next` for someone who has never seen it — otherwise a
  // bookmarked studio URL would quietly skip it forever.
  if (user) redirect(user.onboardingCompletedAt ? next : landingPathFor(user));

  return (
    <main className="grid min-h-dvh place-items-center bg-paper-50 px-4 py-10">
      <div className="w-full max-w-[352px]">
        <div className="mb-5 flex justify-center">
          <Wordmark />
        </div>
        <Card className="p-5">
          <h1 className="text-[17px] font-semibold tracking-[-0.018em] text-paper-900">
            Sign in to PhoneLab
          </h1>
          <p className="mt-1 mb-4 text-[12.5px] leading-relaxed text-paper-500">
            Your projects, canvases and Claude connections.
          </p>
          <AuthForm mode="login" next={next} />
        </Card>
      </div>
    </main>
  );
}
