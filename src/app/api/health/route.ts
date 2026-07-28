import { NextResponse } from 'next/server';
import { TABLE_NAMES } from '@/server/db/schema';
import { getStore, storeResolution } from '@/server/db';
import { describeError, log } from '@/server/core/logging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `/api/health` — is this deployment actually able to work?
 *
 * Built because the answer used to require reading source and guessing. It
 * reports the driver that is really live, whether the database answers, and
 * whether the migrations that the current code needs have been applied.
 *
 * It never returns a URL, a key, or any environment *value* — only whether each
 * required name is set. That distinction is the whole design: enough to
 * diagnose, nothing to steal.
 */

/** Tables the sign-up path touches. If one is missing, sign-up cannot work. */
const SIGNUP_TABLES = ['users', 'workspaces', 'workspaceMembers', 'sessions'] as const;

/** Columns added by 0002. Their absence is the "migrations behind" signal. */
const MIGRATION_0002_PROBE = 'onboardingCompletedAt';

export async function GET(): Promise<NextResponse> {
  const startedAt = Date.now();
  const resolution = storeResolution();

  type Status = 'ok' | 'degraded' | 'error';
  const checks: Record<string, unknown> = {};
  let status: Status = 'ok';
  const problems: string[] = [];
  /** Never downgrade a reported severity. */
  const worsen = (next: Status) => {
    if (status === 'error') return;
    if (next === 'error' || status === 'ok') status = next;
  };

  /* ---------------------------------------------------------------- config */

  const appUrlConfigured = Boolean(process.env.PHONELAB_BASE_URL?.trim());
  if (!appUrlConfigured && resolution.environment === 'production') {
    // Derivable from forwarded headers, so not fatal — but the MCP resource
    // identifier and OAuth issuer are steadier when it is pinned.
    worsen('degraded');
    problems.push('PHONELAB_BASE_URL is not set; the MCP connector URL is derived per request.');
  }

  if (resolution.driver === null) {
    log('error', 'health.storage_unavailable', {
      reason: resolution.reason,
      missing: resolution.missing,
    });
    return NextResponse.json(
      {
        status: 'error',
        environment: resolution.environment,
        vercelEnv: process.env.VERCEL_ENV ?? null,
        databaseConnected: false,
        storageDriver: null,
        migrationsCurrent: false,
        authConfigured: false,
        appUrlConfigured,
        missingEnvVars: resolution.missing,
        problems: [resolution.reason],
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
        checkedInMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }

  /* -------------------------------------------------------------- database */

  let databaseConnected = false;
  let migrationsCurrent = false;

  try {
    const store = getStore();

    // A cheap read that proves the connection, the credentials and the table.
    await store.count('users', {});
    databaseConnected = true;

    const missingTables: string[] = [];
    for (const table of SIGNUP_TABLES) {
      try {
        await store.count(table, {});
      } catch {
        missingTables.push(table);
      }
    }
    checks.signupTables = missingTables.length === 0 ? 'present' : `missing: ${missingTables.join(', ')}`;

    // Probing a column added by 0002 is how we detect a database that is one
    // migration behind the code — the failure mode that looks like a bug.
    let schemaCurrent = missingTables.length === 0;
    try {
      await store.select('users', {
        where: [{ col: MIGRATION_0002_PROBE, op: 'isNull' }],
        limit: 1,
      });
    } catch (error) {
      schemaCurrent = false;
      checks.migration0002 = describeError(error).message;
    }
    migrationsCurrent = schemaCurrent;

    if (missingTables.length > 0) {
      worsen('error');
      problems.push(
        `Tables missing: ${missingTables.join(', ')}. Apply supabase/migrations/0001_init.sql.`,
      );
    } else if (!migrationsCurrent) {
      worsen('error');
      problems.push('The schema is behind the code. Apply supabase/migrations/0002_onboarding.sql.');
    }

    if (resolution.driver === 'local' && resolution.environment !== 'development') {
      worsen('degraded');
      problems.push('The file-backed driver is live outside development; data will not persist.');
    }
  } catch (error) {
    databaseConnected = false;
    worsen('error');
    const described = describeError(error);
    problems.push(described.message);
    log('error', 'health.database_check_failed', { error: described });
  }

  const body = {
    status,
    environment: resolution.environment,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    databaseConnected,
    storageDriver: resolution.driver === 'supabase' ? 'postgres' : resolution.driver,
    storageReason: resolution.reason,
    migrationsCurrent,
    // "Configured" here means the deployment can sign someone in and out: it has
    // a working store for sessions. PhoneLab is its own auth, so there is no
    // third-party auth provider to check.
    authConfigured: databaseConnected,
    appUrlConfigured,
    tables: TABLE_NAMES.length,
    checks,
    ...(problems.length > 0 ? { problems } : {}),
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    checkedInMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    status: status === 'ok' ? 200 : status === 'degraded' ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}
