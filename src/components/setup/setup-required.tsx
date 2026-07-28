import { Wordmark } from '@/components/brand/logo';
import type { StoreResolution } from '@/server/db';

/**
 * What a deployment shows when it cannot work yet.
 *
 * Before this existed, `getStore()` throwing in a server component produced
 * Next's generic "This page couldn't load — a server error occurred", which is
 * indistinguishable from a code bug and tells an operator nothing. API routes
 * were fine (their wrapper returns a classified 503); pages were not.
 *
 * So this is not an error page. It is the deployment reporting, in the terms the
 * person configuring it needs, exactly which variables are missing and what to do
 * next — without printing a single value.
 */
export function SetupRequired({ resolution }: { resolution: StoreResolution }) {
  const missing = resolution.missing;

  return (
    <div className="min-h-dvh bg-paper-50">
      <header className="border-b border-paper-200 bg-paper-0">
        <div className="mx-auto flex h-13 max-w-[720px] items-center px-5">
          <Wordmark />
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-caution-200 bg-caution-50 px-1.5 py-[1px] text-[11px] font-medium text-caution-700">
            Not configured
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-[720px] px-5 py-12">
        <h1 className="text-[24px] font-semibold leading-[1.15] tracking-[-0.026em] text-paper-900">
          This deployment has no database.
        </h1>
        <p className="mt-3 max-w-[600px] text-[13.5px] leading-relaxed text-paper-600">
          {resolution.reason}
        </p>
        <p className="mt-3 max-w-[600px] text-[13.5px] leading-relaxed text-paper-600">
          PhoneLab refuses to start rather than falling back to file storage. That fallback is what
          made an earlier deployment serve pages normally while being unable to create a single
          account — the filesystem it writes to is read-only here, and discarded between requests
          even where it is writable.
        </p>

        {missing.length > 0 ? (
          <section className="mt-8 rounded-[var(--radius-panel)] border border-paper-200 bg-paper-0 p-5">
            <h2 className="text-[13px] font-semibold tracking-[-0.012em] text-paper-900">
              Set {missing.length === 1 ? 'this variable' : 'these variables'}
            </h2>
            <ul className="mt-2.5 space-y-1.5">
              {missing.map((name) => (
                <li key={name} className="flex items-start gap-2">
                  <span className="mt-[7px] size-[4px] shrink-0 rounded-full bg-danger-400" />
                  <code className="font-mono text-[12.5px] text-paper-800">{name}</code>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12.5px] leading-relaxed text-paper-600">
              Both are required — the URL alone is not enough. On Vercel:{' '}
              <strong className="font-medium text-paper-800">
                Settings → Environment Variables → Production
              </strong>
              . Adding a variable does not change deployments that already exist, so{' '}
              <strong className="font-medium text-paper-800">redeploy</strong> afterwards.
            </p>
          </section>
        ) : null}

        <section className="mt-4 rounded-[var(--radius-panel)] border border-paper-200 bg-paper-0 p-5">
          <h2 className="text-[13px] font-semibold tracking-[-0.012em] text-paper-900">
            Then apply the migrations
          </h2>
          <pre className="mt-2.5 overflow-x-auto rounded-lg border border-paper-200 bg-paper-50 p-3 font-mono text-[12px] leading-relaxed text-paper-700">
{`psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
psql "$DATABASE_URL" -f supabase/migrations/0002_onboarding.sql`}
          </pre>
          <p className="mt-2.5 text-[12.5px] leading-relaxed text-paper-600">
            Both are additive and safe to re-run.
          </p>
        </section>

        <section className="mt-4 rounded-[var(--radius-panel)] border border-paper-200 bg-paper-0 p-5">
          <h2 className="text-[13px] font-semibold tracking-[-0.012em] text-paper-900">
            Then check it
          </h2>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-paper-600">
            <code className="font-mono">GET /api/health</code> reports the live driver, whether the
            database answers and whether the migrations are current. It returns 503 until this page
            goes away, and never returns a URL or a key.
          </p>
        </section>

        <p className="mt-8 text-[12px] leading-relaxed text-paper-500">
          Environment: {resolution.environment}
          {resolution.serverless ? ' · serverless' : ''}. Full checklist in{' '}
          <code className="font-mono">docs/VERCEL.md</code>.
        </p>
      </main>
    </div>
  );
}
