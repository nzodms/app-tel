import { describe, expect, it } from 'vitest';
import {
  cleanEnv,
  configurationErrorMessage,
  resolveStoreConfig,
  type StoreEnv,
} from '@/server/db/config';
import { describeError, redact } from '@/server/core/logging';
import { AppError } from '@/server/core/errors';
import { translateStoreError } from '@/server/db/supabase-store';
import { makeStore } from './helpers';
import { signUp } from '@/server/services/auth';
import { ensureUserBootstrap } from '@/server/services/bootstrap';

/**
 * The production failure these lock down:
 *
 * `getStore()` used to end in an unconditional fallback to the file-backed
 * driver. On Vercel that driver writes under `process.cwd()`, which is a
 * read-only Lambda bundle, so the first write of the first sign-up threw and the
 * route's catch-all returned "Something went wrong on our side." with no
 * indication that storage was involved.
 *
 * Every case below is one way that must not happen again.
 */

const BASE: StoreEnv = {};

describe('storage driver resolution', () => {
  it('uses the file driver in development with no database', () => {
    const resolution = resolveStoreConfig({ ...BASE, NODE_ENV: 'development' });
    expect(resolution.driver).toBe('local');
  });

  it('REFUSES to start in production with no database', () => {
    const resolution = resolveStoreConfig({ ...BASE, NODE_ENV: 'production' });
    expect(resolution.driver).toBeNull();
    expect(resolution.missing).toEqual(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  });

  it('REFUSES on Vercel even when NODE_ENV is not production', () => {
    // A preview deployment has the same read-only, per-invocation filesystem.
    const resolution = resolveStoreConfig({ ...BASE, NODE_ENV: 'development', VERCEL: '1' });
    expect(resolution.driver).toBeNull();
    expect(resolution.serverless).toBe(true);
  });

  it('REFUSES an operator who forces the file driver on Vercel', () => {
    const resolution = resolveStoreConfig({
      ...BASE,
      NODE_ENV: 'production',
      VERCEL: '1',
      PHONELAB_STORE: 'local',
    });
    expect(resolution.driver).toBeNull();
    expect(resolution.reason).toMatch(/read-only|not survive/i);
  });

  it('allows throwaway file storage only when asked for explicitly', () => {
    const resolution = resolveStoreConfig({
      ...BASE,
      NODE_ENV: 'production',
      VERCEL: '1',
      PHONELAB_STORE: 'local',
      PHONELAB_ALLOW_LOCAL_STORE: '1',
    });
    expect(resolution.driver).toBe('local');
  });

  it('uses Postgres in production when it is configured', () => {
    const resolution = resolveStoreConfig({
      ...BASE,
      NODE_ENV: 'production',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    });
    expect(resolution.driver).toBe('supabase');
    expect(resolution.missing).toEqual([]);
  });

  it('uses Postgres in development too, so dev matches production', () => {
    const resolution = resolveStoreConfig({
      ...BASE,
      NODE_ENV: 'development',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    });
    expect(resolution.driver).toBe('supabase');
  });

  it('names only the variable that is actually missing', () => {
    const resolution = resolveStoreConfig({
      ...BASE,
      NODE_ENV: 'production',
      SUPABASE_URL: 'https://project.supabase.co',
    });
    expect(resolution.driver).toBeNull();
    expect(resolution.missing).toEqual(['SUPABASE_SERVICE_ROLE_KEY']);
  });

  it('refuses PHONELAB_STORE=supabase without the keys rather than falling back', () => {
    const resolution = resolveStoreConfig({ ...BASE, PHONELAB_STORE: 'supabase' });
    expect(resolution.driver).toBeNull();
  });

  it('never reveals a value in the configuration message', () => {
    const secret = 'super-secret-service-role-key';
    const resolution = resolveStoreConfig({
      ...BASE,
      NODE_ENV: 'production',
      SUPABASE_SERVICE_ROLE_KEY: secret,
    });
    const message = configurationErrorMessage(resolution);
    expect(message).toContain('SUPABASE_URL');
    expect(message).not.toContain(secret);
  });
});

describe('environment values arriving mangled from a dashboard paste', () => {
  it('trims whitespace and newlines', () => {
    expect(cleanEnv('  https://project.supabase.co\n')).toBe('https://project.supabase.co');
  });

  it('strips wrapping quotes', () => {
    expect(cleanEnv('"https://project.supabase.co"')).toBe('https://project.supabase.co');
    expect(cleanEnv("'key'")).toBe('key');
  });

  it('treats an empty or whitespace-only value as unset', () => {
    expect(cleanEnv('   ')).toBeUndefined();
    expect(cleanEnv('')).toBeUndefined();
    expect(cleanEnv(undefined)).toBeUndefined();
  });

  it('so a variable set to whitespace still refuses in production', () => {
    const resolution = resolveStoreConfig({
      NODE_ENV: 'production',
      SUPABASE_URL: '  ',
      SUPABASE_SERVICE_ROLE_KEY: '\n',
    });
    expect(resolution.driver).toBeNull();
    expect(resolution.missing).toHaveLength(2);
  });
});

describe('database errors are classified, not swallowed', () => {
  it('a missing table means the migrations were never applied', () => {
    const error = translateStoreError('select', 'users', {
      code: '42P01',
      message: 'relation "users" does not exist',
    });
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('schema_missing');
    expect(error.message).toMatch(/0001_init\.sql/);
  });

  it('PostgREST reporting an unknown table means the same', () => {
    const error = translateStoreError('select', 'workspaces', {
      code: 'PGRST205',
      message: "Could not find the table 'public.workspaces' in the schema cache",
    });
    expect(error.code).toBe('schema_missing');
  });

  it('a missing column means the schema is behind the code', () => {
    const error = translateStoreError('select', 'users', {
      code: '42703',
      message: 'column users.onboarding_completed_at does not exist',
    });
    expect(error.code).toBe('schema_missing');
    expect(error.message).toMatch(/pending migrations/i);
  });

  it('an unreachable host is an outage, not a bug', () => {
    const error = translateStoreError('select', 'users', new TypeError('fetch failed'));
    expect(error.code).toBe('storage_unavailable');
    expect(error.message).toMatch(/SUPABASE_URL|not reachable/);
  });

  it('a rejected key is a configuration problem', () => {
    const error = translateStoreError('select', 'users', { message: 'Invalid API key' });
    expect(error.code).toBe('configuration_error');
    expect(error.message).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('all of these are 503, so a probe sees the instance as unhealthy', () => {
    expect(new AppError('configuration_error', 'x').status).toBe(503);
    expect(new AppError('storage_unavailable', 'x').status).toBe(503);
    expect(new AppError('schema_missing', 'x').status).toBe(503);
  });
});

describe('logging never leaks a secret', () => {
  it('redacts by key name, whatever the caller passes', () => {
    const out = redact({
      email: 'lea@example.com',
      password: 'hunter2000000',
      passwordHash: 'abc',
      sessionToken: 'tok_live_xyz',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      cookie: 'pl_session=abc',
      authorization: 'Bearer abc',
      nested: { apiKey: 'k', safe: 'visible' },
    }) as Record<string, unknown>;

    expect(out.email).toBe('lea@example.com');
    expect(out.password).toBe('[redacted]');
    expect(out.passwordHash).toBe('[redacted]');
    expect(out.sessionToken).toBe('[redacted]');
    expect(out.SUPABASE_SERVICE_ROLE_KEY).toBe('[redacted]');
    expect(out.cookie).toBe('[redacted]');
    expect(out.authorization).toBe('[redacted]');
    expect((out.nested as Record<string, unknown>).apiKey).toBe('[redacted]');
    expect((out.nested as Record<string, unknown>).safe).toBe('visible');
  });

  it('keeps the identifiers that make a log line useful', () => {
    const out = redact({ userId: 'usr_1', sessionId: 'ses_1', requestId: 'req_1' }) as Record<
      string,
      unknown
    >;
    expect(out.userId).toBe('usr_1');
    expect(out.requestId).toBe('req_1');
  });

  it('describes an errno error in the terms an operator needs', () => {
    const error = Object.assign(new Error("EROFS: read-only file system, mkdir '/var/task/.phonelab-data'"), {
      code: 'EROFS',
    });
    const described = describeError(error);
    expect(described.code).toBe('EROFS');
    expect(described.message).toMatch(/read-only file system/);
  });

  it('follows the cause chain, which is where the real reason lives', () => {
    const described = describeError(
      new Error('insert users failed', { cause: new Error('fetch failed') }),
    );
    expect(described.cause).toMatchObject({ message: 'fetch failed' });
  });
});

describe('ensureUserBootstrap', () => {
  it('is a no-op for an account that is already whole', async () => {
    const { store, cleanup } = await makeStore();
    try {
      const { user } = await signUp(
        store,
        { name: 'Léa Martin', email: 'lea@example.com', password: 'a-good-password' },
        null,
      );
      const first = await ensureUserBootstrap(store, user.id);
      expect(first.repaired).toEqual([]);

      const second = await ensureUserBootstrap(store, user.id);
      expect(second.repaired).toEqual([]);
      expect(second.workspaceId).toBe(first.workspaceId);

      // Repeated calls must not accumulate workspaces or memberships.
      expect(await store.count('workspaces', {})).toBe(1);
      expect(await store.count('workspaceMembers', {})).toBe(1);
    } finally {
      await cleanup();
    }
  });

  it('repairs a user whose workspace never got written', async () => {
    const { store, cleanup } = await makeStore();
    try {
      const { user } = await signUp(
        store,
        { name: 'Léa Martin', email: 'lea@example.com', password: 'a-good-password' },
        null,
      );
      // The state a driver without transactions can leave behind.
      await store.removeWhere('workspaceMembers', { match: { userId: user.id } });
      await store.removeWhere('workspaces', {});
      await store.update('users', user.id, { activeWorkspaceId: null });

      const result = await ensureUserBootstrap(store, user.id);
      expect(result.repaired).toContain('workspace');
      expect(result.repaired).toContain('membership');

      const membership = await store.find('workspaceMembers', { match: { userId: user.id } });
      expect(membership?.role).toBe('owner');
    } finally {
      await cleanup();
    }
  });

  it('repairs a workspace that exists without its owner membership', async () => {
    const { store, cleanup } = await makeStore();
    try {
      const { user, workspace } = await signUp(
        store,
        { name: 'Léa Martin', email: 'lea@example.com', password: 'a-good-password' },
        null,
      );
      await store.removeWhere('workspaceMembers', { match: { userId: user.id } });

      const result = await ensureUserBootstrap(store, user.id);
      expect(result.workspaceId).toBe(workspace.id);
      expect(result.repaired).toEqual(['membership']);
      // It reused the existing workspace rather than making a second one.
      expect(await store.count('workspaces', {})).toBe(1);
    } finally {
      await cleanup();
    }
  });

  it('backfills fields a later migration added', async () => {
    const { store, cleanup } = await makeStore();
    try {
      const { user } = await signUp(
        store,
        { name: 'Léa Martin', email: 'lea@example.com', password: 'a-good-password' },
        null,
      );
      // A row written before 0002 ran.
      await store.update('users', user.id, {
        preferences: null as never,
        activeWorkspaceId: null,
        onboardingDraft: null as never,
      });

      const result = await ensureUserBootstrap(store, user.id);
      expect(result.repaired).toContain('preferences');
      expect(result.repaired).toContain('activeWorkspace');

      const repaired = await store.find('users', { match: { id: user.id } });
      expect(repaired?.preferences?.leftPaneWidth).toBe(25);
      expect(repaired?.activeWorkspaceId).toBe(result.workspaceId);
    } finally {
      await cleanup();
    }
  });
});
