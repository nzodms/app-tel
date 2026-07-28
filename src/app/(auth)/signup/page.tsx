import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/auth-form';
import { Wordmark } from '@/components/brand/logo';
import { Card } from '@/components/ui/primitives';
import { readSessionUser } from '@/server/http/session';
import { landingPathFor } from '@/server/services/onboarding';

export const metadata: Metadata = { title: 'Create an account' };

/** A new account always goes to onboarding; `next` is honoured afterwards. */
function safeNext(value: string | undefined): string {
  if (!value) return '/onboarding';
  return value.startsWith('/') && !value.startsWith('//') ? value : '/onboarding';
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);

  const user = await readSessionUser();
  if (user) redirect(user.onboardingCompletedAt ? next : landingPathFor(user));

  return (
    <main className="grid min-h-dvh place-items-center bg-paper-50 px-4 py-10">
      <div className="w-full max-w-[352px]">
        <div className="mb-5 flex justify-center">
          <Wordmark />
        </div>
        <Card className="p-5">
          <h1 className="text-[17px] font-semibold tracking-[-0.018em] text-paper-900">
            Create your workspace
          </h1>
          <p className="mt-1 mb-4 text-[12.5px] leading-relaxed text-paper-500">
            You get a personal workspace straight away. Everything else is one click from there.
          </p>
          <AuthForm mode="signup" next={next} />
        </Card>
      </div>
    </main>
  );
}
