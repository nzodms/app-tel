import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { WorkspaceSettings } from '@/components/settings/workspace-settings';
import { getStore } from '@/server/db';
import { readSessionUser } from '@/server/http/session';
import { listWorkspacesForUser } from '@/server/services/profile';

export const metadata: Metadata = { title: 'Workspace' };
export const dynamic = 'force-dynamic';

export default async function WorkspaceSettingsPage() {
  const user = await readSessionUser();
  if (!user) redirect('/login?next=%2Fsettings%2Fworkspace');

  const workspaces = await listWorkspacesForUser(getStore(), user.id);

  return (
    <WorkspaceSettings
      workspaces={workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        role: workspace.role,
        memberCount: workspace.memberCount,
        projectCount: workspace.projectCount,
        isActive: workspace.isActive,
        createdAt: workspace.createdAt,
      }))}
      ownerName={user.name}
      ownerHue={user.avatarHue}
    />
  );
}
