/**
 * Which storage driver runs, and — more importantly — when we refuse to start.
 *
 * This module exists because of a real production failure. `getStore()` used to
 * end with an unconditional `else` that fell back to the file-backed driver
 * whenever Supabase was not configured. On Vercel that driver tries to write
 * `.phonelab-data/db.json` under `process.cwd()`, which is inside a read-only
 * Lambda bundle, so the first write of the first signup threw `EROFS` and the
 * route's catch-all turned it into "Something went wrong on our side." Every
 * write path in the product failed identically, and nothing in the response or
 * the logs said the word "storage".
 *
 * A silent fallback to a driver that cannot work is worse than no fallback. The
 * rules below are deliberately blunt:
 *
 *   development, no database   → local driver, fine
 *   development, database      → the database, so dev matches production
 *   production,  database      → the database
 *   production,  no database   → refuse, and name the missing variables
 *
 * The resolution is a pure function of the environment so it can be unit-tested
 * without a process, and so the health endpoint can report it without
 * constructing a driver.
 */

export type StoreDriverKind = 'local' | 'supabase';

export interface StoreResolution {
  driver: StoreDriverKind | null;
  /** Why this driver, in words, for the health endpoint and the boot log. */
  reason: string;
  /** Environment variables that would fix a refusal. Never their values. */
  missing: string[];
  /** True when the environment must not use the file-backed driver. */
  serverless: boolean;
  environment: 'development' | 'production' | 'test';
}

/** The two variables the Supabase driver needs. Referenced in the error text. */
export const SUPABASE_ENV_VARS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;

export interface StoreEnv {
  NODE_ENV?: string | undefined;
  VERCEL?: string | undefined;
  VERCEL_ENV?: string | undefined;
  PHONELAB_STORE?: string | undefined;
  PHONELAB_ALLOW_LOCAL_STORE?: string | undefined;
  SUPABASE_URL?: string | undefined;
  NEXT_PUBLIC_SUPABASE_URL?: string | undefined;
  SUPABASE_SERVICE_ROLE_KEY?: string | undefined;
}

/**
 * Trims a variable and treats an empty or quote-wrapped value as absent.
 *
 * Pasting into the Vercel dashboard is how these get set, and a trailing newline
 * or a pair of stray quotes is the most common way one arrives broken. Silently
 * accepting `"https://x.supabase.co"` — quotes included — produces a connection
 * failure much later, far from the cause.
 */
export function cleanEnv(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  let trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      trimmed = trimmed.slice(1, -1).trim();
    }
  }
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveStoreConfig(env: StoreEnv): StoreResolution {
  const environment: StoreResolution['environment'] =
    env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'development';

  // Running on Vercel means an ephemeral, read-only filesystem regardless of what
  // NODE_ENV happens to say — a preview deployment is just as unable to persist a
  // JSON file as production is.
  const serverless = cleanEnv(env.VERCEL) === '1' || Boolean(cleanEnv(env.VERCEL_ENV));
  const mustNotUseFiles = environment === 'production' || serverless;

  const url = cleanEnv(env.SUPABASE_URL) ?? cleanEnv(env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceKey = cleanEnv(env.SUPABASE_SERVICE_ROLE_KEY);
  const missing = [
    ...(url ? [] : ['SUPABASE_URL']),
    ...(serviceKey ? [] : ['SUPABASE_SERVICE_ROLE_KEY']),
  ];
  const configured = missing.length === 0;

  const explicit = cleanEnv(env.PHONELAB_STORE);

  if (explicit === 'supabase') {
    if (!configured) {
      return {
        driver: null,
        reason: `PHONELAB_STORE=supabase but ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not set.`,
        missing,
        serverless,
        environment,
      };
    }
    return { driver: 'supabase', reason: 'PHONELAB_STORE=supabase.', missing: [], serverless, environment };
  }

  if (explicit === 'local') {
    if (mustNotUseFiles && cleanEnv(env.PHONELAB_ALLOW_LOCAL_STORE) !== '1') {
      // Someone will try this to "get the deploy working". It gets the deploy
      // returning 200s and losing every account, which is worse than a 503.
      return {
        driver: null,
        reason:
          'PHONELAB_STORE=local is refused here: the file-backed driver writes to a filesystem ' +
          'that is read-only on Vercel and discarded between invocations, so accounts and ' +
          'projects would not survive. Configure Postgres, or set PHONELAB_ALLOW_LOCAL_STORE=1 ' +
          'if you genuinely want throwaway storage.',
        missing: SUPABASE_ENV_VARS.filter((name) => missing.includes(name)),
        serverless,
        environment,
      };
    }
    return { driver: 'local', reason: 'PHONELAB_STORE=local.', missing: [], serverless, environment };
  }

  if (configured) {
    return {
      driver: 'supabase',
      reason: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.',
      missing: [],
      serverless,
      environment,
    };
  }

  if (mustNotUseFiles) {
    return {
      driver: null,
      reason:
        `PhoneLab is running in ${serverless ? 'a serverless environment' : 'production'} with no ` +
        'database configured. The file-backed driver is not usable here — the filesystem is ' +
        'read-only and per-invocation, so nothing written would survive.',
      missing,
      serverless,
      environment,
    };
  }

  return {
    driver: 'local',
    reason: 'No database configured; using the file-backed driver for local development.',
    missing,
    serverless,
    environment,
  };
}

/** The message shown when we refuse to start. Names variables, never values. */
export function configurationErrorMessage(resolution: StoreResolution): string {
  const lines = [resolution.reason];
  if (resolution.missing.length > 0) {
    lines.push(
      `Set ${resolution.missing.join(' and ')} in your Vercel project (Settings → Environment Variables → Production), then redeploy. ` +
        'Adding a variable does not affect deployments that already exist.',
    );
  }
  lines.push('Migrations to apply: supabase/migrations/0001_init.sql, then 0002_onboarding.sql.');
  return lines.join(' ');
}
