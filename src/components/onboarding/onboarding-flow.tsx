'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, Copy, Plus, X } from 'lucide-react';
import { Wordmark } from '@/components/brand/logo';
import { Badge, Button, Field, Input, Textarea } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

/**
 * Onboarding.
 *
 * Five steps, each one short. Answers are saved to the server as they are given, so
 * closing the tab and coming back resumes rather than restarts, and the last step
 * creates a real project through the same API the rest of the product uses.
 *
 * The progress bar counts real steps. There is no fake "setting up your
 * workspace…" sequence: the only wait is the project actually being created, and
 * that says so.
 */

export interface CategoryOption {
  id: string;
  label: string;
  hint: string;
  suggestedRoles: string[];
}

export interface OnboardingDraftShape {
  appName: string;
  category: string;
  summary: string;
  audience: string;
  roles: string[];
  connectorAcknowledged: boolean;
  startWith: 'generated' | 'padelflow' | 'starter' | 'empty';
  skipped: boolean;
}

export interface OnboardingFlowProps {
  userName: string;
  initialStep: number;
  initialDraft: OnboardingDraftShape;
  categories: CategoryOption[];
  connectorEndpoint: string;
  /** True when the person reopened onboarding after finishing it once. */
  revisiting: boolean;
}

const STEP_TITLES = [
  'Welcome',
  'What are you building',
  'Who uses it',
  'Connect Claude',
  'Your first project',
] as const;

export function OnboardingFlow({
  userName,
  initialStep,
  initialDraft,
  categories,
  connectorEndpoint,
  revisiting,
}: OnboardingFlowProps) {
  const router = useRouter();
  const [step, setStep] = useState(initialStep);
  const [draft, setDraft] = useState<OnboardingDraftShape>(initialDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const patch = useCallback((next: Partial<OnboardingDraftShape>) => {
    setDraft((current) => ({ ...current, ...next }));
  }, []);

  /* Persist quietly in the background. A failed save must not block the person —
     the final step sends the whole draft again. */
  const savedRef = useRef<string>('');
  useEffect(() => {
    const payload = JSON.stringify({ action: 'save', step, draft });
    if (payload === savedRef.current) return;
    savedRef.current = payload;
    const timer = setTimeout(() => {
      void fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
      }).catch(() => undefined);
    }, 400);
    return () => clearTimeout(timer);
  }, [step, draft]);

  const canContinue = useMemo(() => {
    if (step === 1) return draft.appName.trim().length > 0 && draft.category.length > 0;
    if (step === 2) return draft.roles.length >= 2;
    return true;
  }, [step, draft]);

  const finish = useCallback(async () => {
    setBusy(true);
    setError(null);
    setStatusMessage(
      draft.startWith === 'empty'
        ? 'Finishing up…'
        : 'Creating the project: files, devices and the first version snapshot.',
    );
    try {
      const response = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'complete', draft }),
      });
      const body = (await response.json()) as { redirectTo?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? 'Could not finish onboarding.');
      router.replace(body.redirectTo ?? '/dashboard');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.');
      setBusy(false);
      setStatusMessage(null);
    }
  }, [draft, router]);

  const skip = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'skip' }),
      });
      if (!response.ok) throw new Error('Could not skip onboarding.');
      router.replace('/dashboard');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.');
      setBusy(false);
    }
  }, [router]);

  const next = () => {
    if (step === STEP_TITLES.length - 1) {
      void finish();
      return;
    }
    setError(null);
    setStep((current) => Math.min(current + 1, STEP_TITLES.length - 1));
  };

  return (
    <div className="min-h-dvh bg-paper-50">
      <header className="border-b border-paper-200 bg-paper-0">
        <div className="mx-auto flex h-13 max-w-[720px] items-center px-5">
          <Wordmark />
          {revisiting ? (
            <Badge tone="neutral" className="ml-2.5">
              Revisiting
            </Badge>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-[12px] text-paper-500 sm:inline">
              Step {step + 1} of {STEP_TITLES.length}
            </span>
            <Button size="sm" variant="ghost" onClick={() => void skip()} disabled={busy}>
              {revisiting ? 'Close' : 'Skip for now'}
            </Button>
          </div>
        </div>
        <div className="h-[2px] w-full bg-paper-150" aria-hidden="true">
          <div
            className="h-full bg-azure-500 transition-[width] duration-[240ms] [transition-timing-function:var(--ease-out-quint)]"
            style={{ width: `${((step + 1) / STEP_TITLES.length) * 100}%` }}
          />
        </div>
      </header>

      <main className="mx-auto max-w-[720px] px-5 py-10">
        <ol className="mb-8 flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Onboarding steps">
          {STEP_TITLES.map((title, index) => (
            <li key={title} className="flex items-center gap-1.5">
              <span
                className={cn(
                  'grid size-4.5 place-items-center rounded-full text-[10px] font-semibold',
                  index < step
                    ? 'bg-positive-50 text-positive-700'
                    : index === step
                      ? 'bg-azure-500 text-white'
                      : 'bg-paper-150 text-paper-500',
                )}
              >
                {index < step ? <Check size={10} strokeWidth={2.6} /> : index + 1}
              </span>
              <button
                type="button"
                onClick={() => index <= step && setStep(index)}
                disabled={index > step || busy}
                className={cn(
                  'text-[12px] transition-colors',
                  index === step ? 'font-semibold text-paper-900' : 'text-paper-500',
                  index < step && 'hover:text-paper-800',
                  index > step && 'cursor-default',
                )}
              >
                {title}
              </button>
            </li>
          ))}
        </ol>

        {step === 0 ? <WelcomeStep userName={userName} /> : null}
        {step === 1 ? <ProductStep draft={draft} patch={patch} categories={categories} /> : null}
        {step === 2 ? <AudienceStep draft={draft} patch={patch} categories={categories} /> : null}
        {step === 3 ? (
          <ConnectStep draft={draft} patch={patch} endpoint={connectorEndpoint} />
        ) : null}
        {step === 4 ? <ProjectStep draft={draft} patch={patch} /> : null}

        {error ? (
          <div
            role="alert"
            className="mt-6 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-[12.5px] text-danger-700"
          >
            {error}
          </div>
        ) : null}

        {statusMessage ? (
          <div
            role="status"
            className="mt-6 rounded-lg border border-paper-200 bg-paper-0 px-3 py-2 text-[12.5px] text-paper-600"
          >
            {statusMessage}
          </div>
        ) : null}

        <div className="mt-8 flex items-center gap-2 border-t border-paper-200 pt-5">
          {step > 0 ? (
            <Button size="md" onClick={() => setStep((current) => current - 1)} disabled={busy}>
              <ArrowLeft size={14} strokeWidth={2} />
              Back
            </Button>
          ) : null}
          <Button
            size="md"
            variant="primary"
            onClick={next}
            disabled={busy || !canContinue}
            data-testid="onboarding-next"
          >
            {step === STEP_TITLES.length - 1
              ? busy
                ? 'Creating…'
                : draft.startWith === 'empty'
                  ? 'Go to the dashboard'
                  : 'Create the project'
              : 'Continue'}
            {busy ? null : <ArrowRight size={14} strokeWidth={2} />}
          </Button>
          {!canContinue ? (
            <span className="text-[12px] text-paper-500">
              {step === 1 ? 'Name it and pick a category.' : 'Add at least two roles.'}
            </span>
          ) : null}
        </div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ Steps -- */

function StepShell({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <section>
      <h1 className="text-[24px] font-semibold leading-[1.15] tracking-[-0.026em] text-paper-900">
        {title}
      </h1>
      <p className="mt-2 max-w-[560px] text-[13.5px] leading-relaxed text-paper-600">{body}</p>
      {children ? <div className="mt-6">{children}</div> : null}
    </section>
  );
}

function WelcomeStep({ userName }: { userName: string }) {
  return (
    <StepShell
      title={`Welcome, ${userName.split(' ')[0] ?? userName}.`}
      body="PhoneLab is a workshop for mobile app projects: your code on the left, real interactive phones on a canvas on the right. Claude connects to it and edits the same project you are looking at."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {WELCOME_POINTS.map((point) => (
          <div
            key={point.title}
            className="rounded-[var(--radius-panel)] border border-paper-200 bg-paper-0 p-3.5"
          >
            <div className="text-[13px] font-semibold text-paper-900">{point.title}</div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-paper-600">{point.body}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[12.5px] leading-relaxed text-paper-500">
        Four short questions and you are in. Nothing here is permanent — every answer is editable
        afterwards, and you can skip the whole thing.
      </p>
    </StepShell>
  );
}

const WELCOME_POINTS = [
  {
    title: 'Several phones at once',
    body: 'Give each phone a role. An action on one arrives on the other, for real.',
  },
  {
    title: 'Previews that run',
    body: 'Your project is compiled and executed in a sandboxed frame — real navigation and state.',
  },
  {
    title: 'Claude has the keys',
    body: 'Add PhoneLab as a connector in Claude with your own subscription, and it edits the project.',
  },
];

function ProductStep({
  draft,
  patch,
  categories,
}: {
  draft: OnboardingDraftShape;
  patch: (next: Partial<OnboardingDraftShape>) => void;
  categories: CategoryOption[];
}) {
  return (
    <StepShell
      title="What are you building?"
      body="This decides what the generated project calls things — items, requests, an inbox — and what demo data it starts with. All of it lives in one file you can rewrite."
    >
      <div className="space-y-5">
        <Field label="App name" hint="Shown on the phones and used for the project name.">
          <Input
            value={draft.appName}
            onChange={(event) => patch({ appName: event.target.value })}
            placeholder="PadelFlow, Rivet, Chantier…"
            maxLength={60}
            autoFocus
            data-testid="onboarding-app-name"
          />
        </Field>

        <div>
          <span className="mb-1.5 block text-[12px] font-medium text-paper-700">Category</span>
          <div className="grid gap-2 sm:grid-cols-3">
            {categories.map((category) => {
              const selected = draft.category === category.id;
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() =>
                    patch({
                      category: category.id,
                      roles: draft.roles.length > 0 ? draft.roles : category.suggestedRoles.slice(0, 2),
                    })
                  }
                  data-testid={`onboarding-category-${category.id}`}
                  aria-pressed={selected}
                  className={cn(
                    'rounded-lg border p-2.5 text-left transition-colors duration-[140ms]',
                    selected
                      ? 'border-azure-400 bg-azure-50 ring-2 ring-azure-100'
                      : 'border-paper-200 bg-paper-0 hover:border-paper-300 hover:bg-paper-50',
                  )}
                >
                  <div className="text-[12.5px] font-semibold text-paper-900">{category.label}</div>
                  <div className="mt-0.5 text-[11.5px] leading-snug text-paper-500">
                    {category.hint}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <Field
          label="In one sentence, what does it do?"
          hint="Optional. It becomes the project description and the tagline on the phones."
        >
          <Textarea
            rows={2}
            value={draft.summary}
            onChange={(event) => patch({ summary: event.target.value })}
            placeholder="Members book a padel court and the club confirms it."
            maxLength={400}
          />
        </Field>
      </div>
    </StepShell>
  );
}

function AudienceStep({
  draft,
  patch,
  categories,
}: {
  draft: OnboardingDraftShape;
  patch: (next: Partial<OnboardingDraftShape>) => void;
  categories: CategoryOption[];
}) {
  const [pending, setPending] = useState('');
  const suggested = useMemo(() => {
    const category = categories.find((entry) => entry.id === draft.category);
    return (category?.suggestedRoles ?? ['customer', 'provider', 'admin']).filter(
      (role) => !draft.roles.includes(role),
    );
  }, [categories, draft.category, draft.roles]);

  const addRole = (value: string) => {
    const slug = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24);
    if (!slug || draft.roles.includes(slug) || draft.roles.length >= 6) return;
    patch({ roles: [...draft.roles, slug] });
    setPending('');
  };

  return (
    <StepShell
      title="Who uses it?"
      body="Each role becomes a phone on your canvas running the same codebase from a different side. Two roles is the minimum — one asks, the other answers."
    >
      <div className="space-y-5">
        <div>
          <span className="mb-1.5 block text-[12px] font-medium text-paper-700">
            Roles ({draft.roles.length}/6)
          </span>
          <div className="flex flex-wrap items-center gap-1.5" data-testid="onboarding-roles">
            {draft.roles.map((role, index) => (
              <span
                key={role}
                className="inline-flex items-center gap-1 rounded-md border border-paper-200 bg-paper-0 py-1 pl-2 pr-1 text-[12.5px] text-paper-800"
              >
                <span className="font-medium">{role}</span>
                <span className="text-[11px] text-paper-400">
                  {index === 0 ? 'requests' : index === 1 ? 'responds' : 'observes'}
                </span>
                <button
                  type="button"
                  onClick={() => patch({ roles: draft.roles.filter((entry) => entry !== role) })}
                  aria-label={`Remove ${role}`}
                  className="ml-0.5 grid size-4 place-items-center rounded text-paper-400 hover:bg-paper-100 hover:text-paper-700"
                >
                  <X size={11} strokeWidth={2.2} />
                </button>
              </span>
            ))}
            {draft.roles.length === 0 ? (
              <span className="text-[12.5px] text-paper-500">No roles yet.</span>
            ) : null}
          </div>
        </div>

        {suggested.length > 0 && draft.roles.length < 6 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11.5px] text-paper-500">Suggested:</span>
            {suggested.map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => addRole(role)}
                data-testid={`onboarding-suggested-${role}`}
                className="inline-flex items-center gap-1 rounded-md border border-dashed border-paper-300 px-1.5 py-[3px] text-[12px] text-paper-600 transition-colors hover:border-paper-400 hover:bg-paper-100 hover:text-paper-900"
              >
                <Plus size={10} strokeWidth={2.4} />
                {role}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          <Field
            label="Add your own"
            hint="Lowercase, no spaces — it is the role slug your code reads."
            className="flex-1"
          >
            <Input
              value={pending}
              onChange={(event) => setPending(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addRole(pending);
                }
              }}
              placeholder="coach, courier, moderator…"
              maxLength={24}
            />
          </Field>
          <Button size="md" onClick={() => addRole(pending)} disabled={pending.trim().length === 0}>
            Add
          </Button>
        </div>

        <Field label="Who are they?" hint="Optional. Recorded in the project brief.">
          <Input
            value={draft.audience}
            onChange={(event) => patch({ audience: event.target.value })}
            placeholder="Club members and the front desk staff"
            maxLength={200}
          />
        </Field>
      </div>
    </StepShell>
  );
}

function ConnectStep({
  draft,
  patch,
  endpoint,
}: {
  draft: OnboardingDraftShape;
  patch: (next: Partial<OnboardingDraftShape>) => void;
  endpoint: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <StepShell
      title="Connect Claude"
      body="PhoneLab exposes an MCP server. You add it in Claude as a custom connector using your own Claude subscription — PhoneLab never sees your conversations, your cookies or your quota, and does not proxy a model API."
    >
      <div className="space-y-4">
        <div className="rounded-[var(--radius-panel)] border border-paper-200 bg-paper-0 p-4">
          <div className="text-[12px] font-medium text-paper-700">Connector URL</div>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-paper-200 bg-paper-50 px-2 py-1.5 font-mono text-[12px] text-paper-800">
              {endpoint}
            </code>
            <Button size="sm" onClick={() => void copy()}>
              {copied ? <Check size={12} strokeWidth={2.4} /> : <Copy size={12} strokeWidth={2} />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <ol className="mt-3.5 space-y-2">
            {CONNECT_STEPS.map((entry, index) => (
              <li key={entry} className="flex gap-2.5 text-[12.5px] leading-relaxed text-paper-600">
                <span className="mt-[1px] grid size-4.5 shrink-0 place-items-center rounded-full bg-paper-100 text-[10.5px] font-semibold text-paper-600">
                  {index + 1}
                </span>
                {entry}
              </li>
            ))}
          </ol>
        </div>

        <label className="flex items-start gap-2.5 rounded-lg border border-paper-200 bg-paper-0 p-3">
          <input
            type="checkbox"
            checked={draft.connectorAcknowledged}
            onChange={(event) => patch({ connectorAcknowledged: event.target.checked })}
            className="mt-[3px] size-3.5 accent-[var(--color-azure-500)]"
            data-testid="onboarding-connector-ack"
          />
          <span className="text-[12.5px] leading-relaxed text-paper-700">
            I have the connector URL. Remind me later rather than on every visit.
          </span>
        </label>

        <p className="text-[12px] leading-relaxed text-paper-500">
          You can do this any time from{' '}
          <Link href="/settings/connections" className="underline underline-offset-2">
            Settings → Connections
          </Link>
          , and the full walkthrough lives in the{' '}
          <Link href="/docs/mcp" className="underline underline-offset-2">
            MCP docs
          </Link>
          . Skipping it now changes nothing about the project you are about to create.
        </p>
      </div>
    </StepShell>
  );
}

const CONNECT_STEPS = [
  'In Claude, open Settings → Connectors → Add custom connector.',
  'Paste the URL above. Claude registers itself and opens PhoneLab’s consent screen.',
  'Choose which scopes to grant — read, write, run previews, manage sharing.',
  'Ask Claude to change your app. Every tool call it makes is written to an audit log you can read.',
];

function ProjectStep({
  draft,
  patch,
}: {
  draft: OnboardingDraftShape;
  patch: (next: Partial<OnboardingDraftShape>) => void;
}) {
  const options: {
    id: OnboardingDraftShape['startWith'];
    title: string;
    body: string;
    badge?: string;
  }[] = [
    {
      id: 'generated',
      title: draft.appName.trim() || 'Your app',
      body: `A working two-sided app using your roles and vocabulary: ${draft.roles.slice(0, 3).join(', ') || 'customer, provider'}. Files, devices, a first version and a recorded journey.`,
      badge: 'From your answers',
    },
    {
      id: 'padelflow',
      title: 'PadelFlow demo',
      body: 'The reference project: a player app and a club app that talk to each other, with V1 and V2 to compare and a recorded journey to replay.',
      badge: 'Demo',
    },
    {
      id: 'starter',
      title: 'Starter',
      body: 'Three files. The shortest path to seeing shared state, cross-device events and notifications work.',
    },
    {
      id: 'empty',
      title: 'Nothing yet',
      body: 'Go straight to the dashboard and create a project when you are ready.',
    },
  ];

  return (
    <StepShell
      title="Your first project"
      body="Whichever you pick is a real project: real files, real devices, a real version snapshot. You can create the others later from the dashboard."
    >
      <div className="space-y-2">
        {options.map((option) => {
          const selected = draft.startWith === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => patch({ startWith: option.id })}
              aria-pressed={selected}
              data-testid={`onboarding-start-${option.id}`}
              className={cn(
                'flex w-full gap-3 rounded-[var(--radius-panel)] border p-3.5 text-left transition-colors duration-[140ms]',
                selected
                  ? 'border-azure-400 bg-azure-50 ring-2 ring-azure-100'
                  : 'border-paper-200 bg-paper-0 hover:border-paper-300 hover:bg-paper-50',
              )}
            >
              <span
                className={cn(
                  'mt-[3px] grid size-4 shrink-0 place-items-center rounded-full border',
                  selected ? 'border-azure-500 bg-azure-500 text-white' : 'border-paper-300',
                )}
                aria-hidden="true"
              >
                {selected ? <Check size={10} strokeWidth={3} /> : null}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="text-[13.5px] font-semibold text-paper-900">{option.title}</span>
                  {option.badge ? <Badge tone="neutral">{option.badge}</Badge> : null}
                </span>
                <span className="mt-1 block text-[12.5px] leading-relaxed text-paper-600">
                  {option.body}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </StepShell>
  );
}
