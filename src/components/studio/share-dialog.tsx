'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, X } from 'lucide-react';
import { api, errorText } from '@/lib/api-client';
import type { PublicShareLink } from '@/server/services/shares';
import { Badge, Button, Card, Field, IconButton, Input } from '@/components/ui/primitives';
import { useStudio } from './context';

type ShareWithUrl = PublicShareLink & { url: string };

/**
 * Share a version with an associate or beta tester.
 *
 * The link points at a *pinned version* by default: a reviewer must see the build
 * you asked them to look at. The reviewer surface serves the compiled bundle and
 * nothing else — no file tree, no code, no project metadata beyond the name.
 */
export function ShareDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const projectId = useStudio((state) => state.snapshot.project.id);
  const versions = useStudio((state) => state.versions);
  const roles = useStudio((state) => state.roles);
  const notify = useStudio((state) => state.notify);

  const [links, setLinks] = useState<ShareWithUrl[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const [label, setLabel] = useState('');
  const [versionId, setVersionId] = useState<string>(versions[0]?.id ?? 'working');
  const [access, setAccess] = useState<'read' | 'comment'>('comment');
  const [visibility, setVisibility] = useState<'public' | 'password'>('public');
  const [password, setPassword] = useState('');
  const [allowCompare, setAllowCompare] = useState(false);
  const [allowedRoles, setAllowedRoles] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api<{ shares: ShareWithUrl[] }>(`/api/projects/${projectId}/shares`)
      .then((result) => {
        if (cancelled) return;
        setLinks(result.shares);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorText(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  if (!open) return null;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ share: ShareWithUrl; url: string }>(
        `/api/projects/${projectId}/shares`,
        {
          body: {
            label,
            versionId: versionId === 'working' ? null : versionId,
            access,
            visibility,
            ...(visibility === 'password' ? { password } : {}),
            allowedRoles,
            allowVersionCompare: allowCompare,
            allowJourneys: true,
            expiresInDays: null,
          },
        },
      );
      setLinks((current) => [result.share, ...current]);
      setLabel('');
      setPassword('');
      await navigator.clipboard.writeText(result.url).catch(() => undefined);
      notify('success', 'Share link created and copied to your clipboard.');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (shareId: string) => {
    try {
      await api(`/api/projects/${projectId}/shares?shareId=${encodeURIComponent(shareId)}`, {
        method: 'DELETE',
      });
      setLinks((current) =>
        current.map((link) =>
          link.id === shareId ? { ...link, revokedAt: new Date().toISOString() } : link,
        ),
      );
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-paper-950/28 p-4 backdrop-blur-[2px]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <Card className="max-h-[86vh] w-full max-w-[520px] overflow-hidden">
        <div className="flex h-11 items-center border-b border-paper-200 px-3.5">
          <h2 className="text-[13.5px] font-semibold tracking-[-0.012em] text-paper-900">
            Share for review
          </h2>
          <IconButton label="Close" className="ml-auto" onClick={onClose}>
            <X size={14} strokeWidth={2} />
          </IconButton>
        </div>

        <div className="pl-scroll max-h-[calc(86vh-44px)] overflow-y-auto p-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="What is this link for?" className="sm:col-span-2">
              <Input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="V2 booking flow — feedback wanted"
              />
            </Field>

            <Field label="Version" hint="Pin a snapshot so reviewers see a stable build.">
              <select
                value={versionId}
                onChange={(event) => setVersionId(event.target.value)}
                className="h-9 w-full rounded-lg border border-paper-300 bg-paper-0 px-2 text-[13px] text-paper-800"
              >
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.label}
                  </option>
                ))}
                <option value="working">Working tree (changes as you edit)</option>
              </select>
            </Field>

            <Field label="They can">
              <select
                value={access}
                onChange={(event) => setAccess(event.target.value as 'read' | 'comment')}
                className="h-9 w-full rounded-lg border border-paper-300 bg-paper-0 px-2 text-[13px] text-paper-800"
              >
                <option value="comment">Use the app and leave comments</option>
                <option value="read">Use the app only</option>
              </select>
            </Field>

            <Field label="Protection">
              <select
                value={visibility}
                onChange={(event) => setVisibility(event.target.value as 'public' | 'password')}
                className="h-9 w-full rounded-lg border border-paper-300 bg-paper-0 px-2 text-[13px] text-paper-800"
              >
                <option value="public">Anyone with the link</option>
                <option value="password">Password required</option>
              </select>
            </Field>

            {visibility === 'password' ? (
              <Field label="Password" hint="At least 6 characters.">
                <Input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="text"
                  placeholder="padel2026"
                />
              </Field>
            ) : (
              <div />
            )}

            <div className="sm:col-span-2">
              <span className="mb-1 block text-[12px] font-medium text-paper-700">
                Roles they may switch between
              </span>
              <div className="flex flex-wrap gap-1.5">
                {roles.map((role) => {
                  const active = allowedRoles.includes(role.slug);
                  return (
                    <button
                      key={role.slug}
                      onClick={() =>
                        setAllowedRoles((current) =>
                          active
                            ? current.filter((entry) => entry !== role.slug)
                            : [...current, role.slug],
                        )
                      }
                      className={
                        active
                          ? 'rounded-md border border-azure-300 bg-azure-50 px-2 py-1 text-[12px] font-medium text-azure-700'
                          : 'rounded-md border border-paper-200 bg-paper-0 px-2 py-1 text-[12px] text-paper-600 hover:bg-paper-100'
                      }
                    >
                      {role.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-[11.5px] text-paper-500">
                {allowedRoles.length === 0
                  ? 'None selected — the reviewer may use every role this project defines.'
                  : `${allowedRoles.length} role(s) allowed.`}
              </p>
            </div>

            <label className="flex items-center gap-2 text-[12.5px] text-paper-700 sm:col-span-2">
              <input
                type="checkbox"
                checked={allowCompare}
                onChange={(event) => setAllowCompare(event.target.checked)}
                className="size-3.5"
              />
              Let them compare this version with the previous one
            </label>
          </div>

          {error ? (
            <div className="mt-3 rounded-lg border border-danger-200 bg-danger-50 px-2.5 py-2 text-[12.5px] text-danger-700">
              {error}
            </div>
          ) : null}

          <Button variant="primary" size="md" className="mt-3 w-full" disabled={busy} onClick={() => void create()}>
            {busy ? 'Creating…' : 'Create share link'}
          </Button>

          {links.length > 0 ? (
            <div className="mt-5">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-paper-500">
                Existing links
              </div>
              <div className="overflow-hidden rounded-[var(--radius-panel)] border border-paper-200">
                {links.map((link) => (
                  <div
                    key={link.id}
                    className="flex items-center gap-2 border-b border-paper-100 px-2.5 py-2 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[12.5px] font-medium text-paper-800">
                          {link.label}
                        </span>
                        {link.revokedAt ? (
                          <Badge tone="danger">revoked</Badge>
                        ) : (
                          <Badge tone={link.access === 'comment' ? 'accent' : 'neutral'}>
                            {link.access}
                          </Badge>
                        )}
                        {link.hasPassword ? <Badge tone="neutral">password</Badge> : null}
                      </div>
                      <div className="truncate font-mono text-[10.5px] text-paper-400">{link.url}</div>
                      <div className="text-[10.5px] text-paper-400">
                        {link.viewCount} view{link.viewCount === 1 ? '' : 's'}
                        {link.versionId ? ' · pinned version' : ' · live working tree'}
                      </div>
                    </div>
                    {link.revokedAt ? null : (
                      <>
                        <IconButton
                          label="Copy link"
                          size="xs"
                          onClick={async () => {
                            await navigator.clipboard.writeText(link.url);
                            setCopied(link.id);
                            window.setTimeout(
                              () => setCopied((current) => (current === link.id ? null : current)),
                              1600,
                            );
                          }}
                        >
                          {copied === link.id ? (
                            <Check size={12} strokeWidth={2.4} />
                          ) : (
                            <Copy size={12} strokeWidth={1.9} />
                          )}
                        </IconButton>
                        <IconButton
                          label="Open link"
                          size="xs"
                          onClick={() => window.open(link.url, '_blank', 'noopener')}
                        >
                          <ExternalLink size={12} strokeWidth={1.9} />
                        </IconButton>
                        <Button size="xs" variant="ghost" onClick={() => void revoke(link.id)}>
                          Revoke
                        </Button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
