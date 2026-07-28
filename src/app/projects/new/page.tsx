import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import { AppHeader } from '@/components/app-shell/app-header';
import { NewProjectForm } from '@/components/dashboard/new-project-form';
import { getStore } from '@/server/db';
import { readSessionUser } from '@/server/http/session';
import { listWorkspacesForUser } from '@/server/services/profile';
import { PROJECT_CATEGORIES } from '@/server/services/scaffold';
import { SELECTABLE_TEMPLATES } from '@/server/templates';

export const metadata: Metadata = { title: 'New project' };
export const dynamic = 'force-dynamic';

export default async function NewProjectPage() {
  const user = await readSessionUser();
  if (!user) redirect('/login?next=%2Fprojects%2Fnew');
  if (!user.onboardingCompletedAt) redirect('/onboarding');

  const workspaces = await listWorkspacesForUser(getStore(), user.id);

  return (
    <div className="min-h-dvh bg-paper-50">
      <AppHeader user={user} active="dashboard" maxWidth={880} />

      <main className="mx-auto max-w-[880px] px-5 py-7">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-[12.5px] text-paper-500 transition-colors hover:text-paper-800"
        >
          <ArrowLeft size={13} strokeWidth={2} />
          Projects
        </Link>

        <h1 className="mt-3 text-[21px] font-semibold tracking-[-0.022em] text-paper-900">
          New project
        </h1>
        <p className="mb-6 mt-1 max-w-[620px] text-[13px] leading-relaxed text-paper-600">
          Both routes produce a real project: files on disk, phones on the canvas, a first version
          snapshot and a recorded journey you can replay.
        </p>

        <NewProjectForm
          categories={[...PROJECT_CATEGORIES]}
          templates={SELECTABLE_TEMPLATES.map((template) => ({
            id: template.id,
            name: template.name,
            tagline: template.tagline,
            summary: template.summary,
            highlights: template.highlights,
          }))}
          workspaces={workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name }))}
        />
      </main>
    </div>
  );
}
