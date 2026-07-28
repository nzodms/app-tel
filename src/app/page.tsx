import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { Wordmark } from '@/components/brand/logo';
import { Badge, Button } from '@/components/ui/primitives';
import { readSessionUser } from '@/server/http/session';
import { landingPathFor } from '@/server/services/onboarding';

export const dynamic = 'force-dynamic';

/**
 * Entry page.
 *
 * Deliberately short and factual: what the product is, what is actually built, and
 * two links. No invented metrics, no testimonials, no decoration.
 *
 * A signed-in visitor is routed by `landingPathFor` — onboarding if they have
 * never seen it, the dashboard otherwise. Never straight into a project: opening
 * PhoneLab should show you your work, not whichever file you closed last.
 */
export default async function HomePage() {
  const user = await readSessionUser();
  if (user) redirect(landingPathFor(user));

  return (
    <div className="min-h-dvh bg-paper-50">
      <header className="border-b border-paper-200 bg-paper-0">
        <div className="mx-auto flex h-13 max-w-[1000px] items-center px-5">
          <Wordmark />
          <div className="ml-auto flex items-center gap-2">
            <Link href="/docs/mcp" className="text-[12.5px] font-medium text-paper-600 hover:text-paper-900">
              MCP docs
            </Link>
            <Link href="/login">
              <Button size="sm">Sign in</Button>
            </Link>
            <Link href="/signup">
              <Button size="sm" variant="primary">
                Create account
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1000px] px-5 py-14">
        <Badge tone="neutral">Model Context Protocol · revision 2025-11-25</Badge>
        <h1 className="mt-3 max-w-[720px] text-[38px] font-semibold leading-[1.08] tracking-[-0.032em] text-paper-900">
          Claude builds the app. PhoneLab is its workshop.
        </h1>
        <p className="mt-4 max-w-[620px] text-[15px] leading-relaxed text-paper-600">
          A desktop studio for mobile app projects: the code on the left, real interactive phones on
          a canvas on the right. Give a phone a role, watch an action on one device arrive on
          another, snapshot a version, share it for review — and let Claude edit the same project
          through a connector you add with your own subscription.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Link href="/signup">
            <Button variant="primary" size="md">
              Create your workspace
              <ArrowRight size={14} strokeWidth={2} />
            </Button>
          </Link>
          <Link href="/login">
            <Button size="md">I already have an account</Button>
          </Link>
        </div>

        <section className="mt-14 grid gap-6 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <div key={feature.title}>
              <h2 className="text-[14px] font-semibold tracking-[-0.012em] text-paper-900">
                {feature.title}
              </h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-paper-600">{feature.body}</p>
            </div>
          ))}
        </section>

        <section className="mt-14 rounded-[var(--radius-panel)] border border-paper-200 bg-paper-0 p-5">
          <h2 className="text-[14px] font-semibold tracking-[-0.012em] text-paper-900">
            How the Claude connection works
          </h2>
          <ol className="mt-2.5 space-y-2">
            {STEPS.map((step, index) => (
              <li key={step} className="flex gap-2.5 text-[13px] leading-relaxed text-paper-600">
                <span className="mt-[1px] grid size-5 shrink-0 place-items-center rounded-full bg-paper-100 text-[11px] font-semibold text-paper-600">
                  {index + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[12.5px] leading-relaxed text-paper-500">
            PhoneLab does not proxy a model API and never touches your Claude session, cookies,
            conversations or quota. It exposes tools; Claude decides when to call them, and every
            call is recorded in an audit log you can read.
          </p>
        </section>
      </main>

      <footer className="border-t border-paper-200 py-6">
        <div className="mx-auto max-w-[1000px] px-5 text-[11.5px] leading-relaxed text-paper-400">
          Device presets describe viewport formats for testing. PhoneLab is not affiliated with,
          endorsed by, or sponsored by any device manufacturer, and contains no vendor assets.
        </div>
      </footer>
    </div>
  );
}

const FEATURES = [
  {
    title: 'Several phones, several roles',
    body: 'Give each phone a role, a signed-in user, a pinned version and its own edge-case state. A booking made on the customer phone arrives on the provider phone, with a notification and a Dynamic Island state change.',
  },
  {
    title: 'A canvas that stays out of the way',
    body: 'Pan, zoom, drag, snap, align, fit. Moving a phone never reloads its preview, so the app keeps its state while you rearrange.',
  },
  {
    title: 'Previews that actually run',
    body: 'Your project is compiled server-side and executed in a sandboxed iframe: real navigation, real forms, real session state — never in PhoneLab’s own process.',
  },
  {
    title: 'Versions you can compare',
    body: 'Snapshot the working tree, restore it exactly, or run two versions side by side on two phones with the code diff next to them.',
  },
  {
    title: 'Reviews that point at code',
    body: 'Share a pinned version. A reviewer taps a spot on the screen and leaves a comment; the thread records the version, role, screen and the exact source location.',
  },
  {
    title: 'Journeys you can replay',
    body: 'Record a path through the app once — taps, entries, cross-device events — then replay it step by step at any speed, with a report you or Claude can read.',
  },
];

const STEPS = [
  'Create a project in PhoneLab (or import one later).',
  'Copy the connector URL and add it in Claude as a custom connector.',
  'Approve the scopes on PhoneLab’s consent screen — read, write, run previews, manage sharing. You choose.',
  'Ask Claude to change your app. It reads the project, patches files, builds the preview and snapshots a version.',
  'PhoneLab updates live: the tree, the editor, the phones, the logs and the timeline.',
];
