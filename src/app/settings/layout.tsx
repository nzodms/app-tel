import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppHeader } from '@/components/app-shell/app-header';
import { readSessionUser } from '@/server/http/session';
import { SettingsNav } from '@/components/settings/settings-nav';

export const dynamic = 'force-dynamic';

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const user = await readSessionUser();
  if (!user) redirect('/login?next=%2Fsettings');

  return (
    <div className="min-h-dvh bg-paper-50">
      <AppHeader user={user} active="settings" maxWidth={980} />

      <main className="mx-auto max-w-[980px] px-5 py-7">
        <h1 className="text-[21px] font-semibold tracking-[-0.022em] text-paper-900">Settings</h1>
        <p className="mb-6 mt-1 text-[13px] text-paper-600">
          Your account, the Claude connections you have authorised, and your workspace.
        </p>

        <div className="grid gap-6 sm:grid-cols-[172px_1fr]">
          <SettingsNav />
          <div className="min-w-0">{children}</div>
        </div>

        <p className="mt-10 text-[11.5px] text-paper-400">
          Need the walkthrough again?{' '}
          <Link href="/onboarding?again=1" className="underline underline-offset-2">
            Revisit onboarding
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
