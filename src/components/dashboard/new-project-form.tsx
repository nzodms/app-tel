'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Plus, X } from 'lucide-react';
import { api, errorText } from '@/lib/api-client';
import { Badge, Button, Card, Field, Input, Textarea } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import type { CategoryOption } from '@/components/onboarding/onboarding-flow';

/**
 * `/projects/new`.
 *
 * Two ways in, side by side: describe it and let PhoneLab generate the scaffold,
 * or take a template as-is. The generated route runs the same code as the last
 * onboarding step, so the two cannot drift apart.
 */
export interface TemplateOption {
  id: string;
  name: string;
  tagline: string;
  summary: string;
  highlights: string[];
}

export function NewProjectForm({
  categories,
  templates,
  workspaces,
}: {
  categories: CategoryOption[];
  templates: TemplateOption[];
  workspaces: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'describe' | 'template'>('describe');
  const [name, setName] = useState('');
  const [category, setCategory] = useState(categories[0]?.id ?? 'other');
  const [summary, setSummary] = useState('');
  const [audience, setAudience] = useState('');
  const [roles, setRoles] = useState<string[]>(categories[0]?.suggestedRoles.slice(0, 2) ?? []);
  const [pendingRole, setPendingRole] = useState('');
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addRole = (value: string) => {
    const slug = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24);
    if (!slug || roles.includes(slug) || roles.length >= 6) return;
    setRoles((current) => [...current, slug]);
    setPendingRole('');
  };

  const submitGenerated = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ project: { id: string } }>('/api/projects/generate', {
        body: {
          workspaceId: workspaceId || undefined,
          name: name.trim(),
          brief: { category, audience: audience.trim(), summary: summary.trim(), roles },
        },
      });
      router.push(`/studio/${result.project.id}`);
    } catch (cause) {
      setError(errorText(cause));
      setBusy(false);
    }
  };

  const submitTemplate = async (templateId: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ project: { id: string } }>('/api/projects', {
        body: {
          workspaceId: workspaceId || undefined,
          name: name.trim() || templates.find((entry) => entry.id === templateId)?.name || 'New project',
          templateId,
        },
      });
      router.push(`/studio/${result.project.id}`);
    } catch (cause) {
      setError(errorText(cause));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex gap-1 rounded-lg border border-paper-200 bg-paper-100 p-1">
        <ModeTab active={mode === 'describe'} onClick={() => setMode('describe')}>
          Describe it
        </ModeTab>
        <ModeTab active={mode === 'template'} onClick={() => setMode('template')}>
          Start from a template
        </ModeTab>
      </div>

      {workspaces.length > 1 ? (
        <Field label="Workspace">
          <select
            value={workspaceId}
            onChange={(event) => setWorkspaceId(event.target.value)}
            className="h-9 w-full rounded-lg border border-paper-300 bg-paper-0 px-2.5 text-[13.5px] text-paper-900 focus:border-azure-400 focus:outline-none focus:ring-2 focus:ring-azure-100"
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-[12.5px] text-danger-700"
        >
          {error}
        </div>
      ) : null}

      {mode === 'describe' ? (
        <Card className="space-y-5 p-4">
          <Field label="Project name">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Rivet, Chantier, Padel Nord…"
              maxLength={60}
              autoFocus
              data-testid="new-project-name"
            />
          </Field>

          <div>
            <span className="mb-1.5 block text-[12px] font-medium text-paper-700">Category</span>
            <div className="grid gap-2 sm:grid-cols-3">
              {categories.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    setCategory(option.id);
                    if (roles.length === 0) setRoles(option.suggestedRoles.slice(0, 2));
                  }}
                  aria-pressed={category === option.id}
                  data-testid={`new-project-category-${option.id}`}
                  className={cn(
                    'rounded-lg border p-2.5 text-left transition-colors duration-[140ms]',
                    category === option.id
                      ? 'border-azure-400 bg-azure-50 ring-2 ring-azure-100'
                      : 'border-paper-200 bg-paper-0 hover:border-paper-300 hover:bg-paper-50',
                  )}
                >
                  <div className="text-[12.5px] font-semibold text-paper-900">{option.label}</div>
                  <div className="mt-0.5 text-[11.5px] leading-snug text-paper-500">
                    {option.hint}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-[12px] font-medium text-paper-700">
              Roles ({roles.length}/6) — one phone each
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {roles.map((role) => (
                <span
                  key={role}
                  className="inline-flex items-center gap-1 rounded-md border border-paper-200 bg-paper-0 py-1 pl-2 pr-1 text-[12.5px] font-medium text-paper-800"
                >
                  {role}
                  <button
                    type="button"
                    onClick={() => setRoles((current) => current.filter((entry) => entry !== role))}
                    aria-label={`Remove ${role}`}
                    className="grid size-4 place-items-center rounded text-paper-400 hover:bg-paper-100 hover:text-paper-700"
                  >
                    <X size={11} strokeWidth={2.2} />
                  </button>
                </span>
              ))}
              <Input
                value={pendingRole}
                onChange={(event) => setPendingRole(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addRole(pendingRole);
                  }
                }}
                placeholder="add a role"
                maxLength={24}
                className="h-7.5 w-[132px] text-[12.5px]"
                aria-label="Add a role"
              />
            </div>
          </div>

          <Field label="What does it do?" hint="Optional. Becomes the description and the tagline.">
            <Textarea
              rows={2}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              maxLength={400}
            />
          </Field>

          <Field label="Who uses it?" hint="Optional. Recorded in the project brief.">
            <Input
              value={audience}
              onChange={(event) => setAudience(event.target.value)}
              maxLength={200}
            />
          </Field>

          <div className="flex items-center gap-2 border-t border-paper-200 pt-4">
            <Button
              variant="primary"
              size="md"
              onClick={() => void submitGenerated()}
              disabled={busy || name.trim().length === 0 || roles.length < 2}
              data-testid="new-project-create"
            >
              {busy ? (
                <Loader2 size={13} strokeWidth={2} className="animate-spin" />
              ) : (
                <Plus size={13} strokeWidth={2.2} />
              )}
              {busy ? 'Creating…' : 'Create project'}
            </Button>
            {name.trim().length === 0 ? (
              <span className="text-[12px] text-paper-500">Give it a name.</span>
            ) : roles.length < 2 ? (
              <span className="text-[12px] text-paper-500">Add at least two roles.</span>
            ) : null}
          </div>

          <p className="text-[12px] leading-relaxed text-paper-500">
            PhoneLab generates one file — <code className="font-mono">src/lib/config.ts</code> —
            holding your names, roles and demo data, and lays it over a complete two-sided app. No
            model is called: it is a deterministic scaffold you and Claude edit from there.
          </p>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {templates.map((template) => (
            <Card key={template.id} className="flex flex-col p-3.5">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold tracking-[-0.012em] text-paper-900">
                  {template.name}
                </span>
                <Badge tone="neutral">{template.tagline}</Badge>
              </div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-paper-600">{template.summary}</p>
              <ul className="mt-2.5 space-y-1">
                {template.highlights.map((highlight) => (
                  <li
                    key={highlight}
                    className="flex items-start gap-1.5 text-[12px] text-paper-600"
                  >
                    <Check
                      size={11}
                      strokeWidth={2.2}
                      className="mt-[3px] shrink-0 text-positive-600"
                    />
                    {highlight}
                  </li>
                ))}
              </ul>
              <Button
                variant="primary"
                size="md"
                className="mt-3.5 w-full"
                disabled={busy}
                onClick={() => void submitTemplate(template.id)}
                data-testid={`new-project-template-${template.id}`}
              >
                {busy ? (
                  <Loader2 size={13} strokeWidth={2} className="animate-spin" />
                ) : (
                  <Plus size={13} strokeWidth={2.2} />
                )}
                Create {template.name}
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex-1 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors duration-[140ms]',
        active ? 'bg-paper-0 text-paper-900 shadow-[0_1px_2px_rgb(16_20_26/0.06)]' : 'text-paper-600 hover:text-paper-900',
      )}
    >
      {children}
    </button>
  );
}
