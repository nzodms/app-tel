'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2 } from 'lucide-react';
import { api, errorText } from '@/lib/api-client';
import { Avatar, Badge, Button, Card, Field, Input } from '@/components/ui/primitives';

export interface WorkspaceView {
  id: string;
  name: string;
  slug: string;
  role: string;
  memberCount: number;
  projectCount: number;
  isActive: boolean;
  createdAt: string;
}

export function WorkspaceSettings({
  workspaces,
  ownerName,
  ownerHue,
}: {
  workspaces: WorkspaceView[];
  ownerName: string;
  ownerHue: number;
}) {
  return (
    <div className="space-y-5">
      {workspaces.map((workspace) => (
        <WorkspaceCard
          key={workspace.id}
          workspace={workspace}
          ownerName={ownerName}
          ownerHue={ownerHue}
        />
      ))}

      <Card className="p-4">
        <div className="flex items-center gap-2">
          <h2 className="text-[14px] font-semibold tracking-[-0.012em] text-paper-900">
            Inviting people
          </h2>
          <Badge tone="neutral">not built</Badge>
        </div>
        <p className="mt-1 max-w-[560px] text-[12.5px] leading-relaxed text-paper-600">
          The permission model behind this is real — owner, admin, editor and viewer roles are
          enforced on every route and every MCP tool call. What does not exist yet is the invitation
          flow: there is no way to add a second person to a workspace from the UI.
        </p>
        <p className="mt-2 max-w-[560px] text-[12.5px] leading-relaxed text-paper-600">
          To get someone else&rsquo;s eyes on a project today, use a share link from the studio. A
          reviewer can open it and leave comments anchored to a spot on the screen without an
          account.
        </p>
      </Card>
    </div>
  );
}

function WorkspaceCard({
  workspace,
  ownerName,
  ownerHue,
}: {
  workspace: WorkspaceView;
  ownerName: string;
  ownerHue: number;
}) {
  const router = useRouter();
  const [name, setName] = useState(workspace.name);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRename = workspace.role === 'owner' || workspace.role === 'admin';

  const rename = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/workspaces/${workspace.id}`, { method: 'PATCH', body: { name: name.trim() } });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      router.refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-[14px] font-semibold tracking-[-0.012em] text-paper-900">
          {workspace.name}
        </h2>
        {workspace.isActive ? <Badge tone="accent">active</Badge> : null}
        <Badge tone="neutral">{workspace.role}</Badge>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-paper-500">
        <span>{workspace.projectCount} projects</span>
        <span>
          {workspace.memberCount} member{workspace.memberCount === 1 ? '' : 's'}
        </span>
        <span className="font-mono">{workspace.slug}</span>
        <span>Created {new Date(workspace.createdAt).toLocaleDateString()}</span>
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-[12.5px] text-danger-700"
        >
          {error}
        </div>
      ) : null}

      <div className="mt-4">
        <Field
          label="Workspace name"
          hint={canRename ? undefined : 'Only an owner or admin can rename a workspace.'}
        >
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              disabled={!canRename}
              data-testid="workspace-name"
            />
            <Button
              size="md"
              onClick={() => void rename()}
              disabled={busy || !canRename || name.trim().length === 0 || name === workspace.name}
            >
              {busy ? <Loader2 size={13} className="animate-spin" strokeWidth={2} /> : null}
              Save
            </Button>
          </div>
        </Field>
        {saved ? (
          <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-positive-700">
            <Check size={12} strokeWidth={2.4} />
            Saved
          </div>
        ) : null}
      </div>

      <div className="mt-4">
        <div className="text-[12px] font-medium text-paper-700">Members</div>
        <div className="mt-1.5 flex items-center gap-2">
          <Avatar name={ownerName} hue={ownerHue} size={24} />
          <span className="text-[12.5px] text-paper-800">{ownerName}</span>
          <Badge tone="neutral">owner</Badge>
        </div>
      </div>
    </Card>
  );
}
