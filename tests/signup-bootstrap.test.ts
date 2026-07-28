import { describe, expect, it } from 'vitest';
import { makeStore } from './helpers';
import { signIn, signUp, type SignUpStep } from '@/server/services/auth';
import { ensureUserBootstrap } from '@/server/services/bootstrap';
import { translateStoreError } from '@/server/db/supabase-store';
import type { Store } from '@/server/db';

/**
 * The production sign-up failure, and the ordering that fixes it.
 *
 * `users.active_workspace_id` is a foreign key to `workspaces.id`, and
 * `workspaces.owner_id` is a foreign key back to `users.id` — a cycle. Sign-up
 * used to insert the user with the workspace id already set, before the workspace
 * row existed, so Postgres rejected it:
 *
 *   insert or update on table "users" violates foreign key constraint
 *   "users_active_workspace_id_fkey"                          -- SQLSTATE 23503
 *
 * It never failed in development or in any test, because the JSON driver has no
 * foreign keys and accepted the dangling reference. These tests assert the write
 * *order* directly, so the driver's leniency can no longer hide it.
 */

describe('the sign-up write order', () => {
  it('inserts the user with active_workspace_id null, before any workspace exists', async () => {
    const { store, cleanup } = await makeStore();
    try {
      const writes: { operation: string; table: string; row: unknown }[] = [];
      const traced = traceStore(store, (operation, table, row) =>
        writes.push({ operation, table, row }),
      );

      await signUp(
        traced,
        { name: 'Léa Martin', email: 'lea@example.com', password: 'a-good-password' },
        null,
      );

      const userInsert = writes.find(
        (entry) => entry.operation === 'insert' && entry.table === 'users',
      );
      expect(userInsert, 'the user row must be inserted').toBeDefined();
      // 1. Null at insert — the whole fix.
      expect((userInsert!.row as { activeWorkspaceId: unknown }).activeWorkspaceId).toBeNull();

      // …and no workspace had been written at that point, which is why it must be.
      const workspaceInsertIndex = writes.findIndex(
        (entry) => entry.operation === 'insert' && entry.table === 'workspaces',
      );
      expect(writes.indexOf(userInsert!)).toBeLessThan(workspaceInsertIndex);
    } finally {
      await cleanup();
    }
  });

  it('creates the rows in the order the foreign keys require', async () => {
    const { store, cleanup } = await makeStore();
    try {
      const inserts: string[] = [];
      const traced = traceStore(store, (operation, table) => {
        if (operation === 'insert') inserts.push(table);
      });

      await signUp(
        traced,
        { name: 'Léa Martin', email: 'lea@example.com', password: 'a-good-password' },
        null,
      );

      // 2, 3: workspace after the user it is owned by; membership after both.
      expect(inserts.slice(0, 3)).toEqual(['users', 'workspaces', 'workspaceMembers']);
    } finally {
      await cleanup();
    }
  });

  it('sets active_workspace_id last, and to the workspace it created', async () => {
    const { store, cleanup } = await makeStore();
    try {
      const { user, workspace } = await signUp(
        store,
        { name: 'Léa Martin', email: 'lea@example.com', password: 'a-good-password' },
        null,
      );

      // 4. Updated at the end, and reflected in what the caller gets back.
      expect(user.activeWorkspaceId).toBe(workspace.id);

      const stored = await store.find('users', { match: { id: user.id } });
      expect(stored?.activeWorkspaceId).toBe(workspace.id);

      const membership = await store.find('workspaceMembers', { match: { userId: user.id } });
      expect(membership?.workspaceId).toBe(workspace.id);
      expect(membership?.role).toBe('owner');
    } finally {
      await cleanup();
    }
  });

  it('reports each step as it lands, in order', async () => {
    const { store, cleanup } = await makeStore();
    try {
      const steps: SignUpStep[] = [];
      await signUp(
        store,
        { name: 'Léa Martin', email: 'lea@example.com', password: 'a-good-password' },
        null,
        (step) => steps.push(step),
      );
      expect(steps).toEqual([
        'user_created',
        'workspace_created',
        'membership_created',
        'active_workspace_set',
        'session_created',
      ]);
    } finally {
      await cleanup();
    }
  });

  it('issues the session only after the workspace is set up', async () => {
    const { store, cleanup } = await makeStore();
    try {
      let sessionsWhenWorkspaceSet = -1;
      await signUp(
        store,
        { name: 'Léa Martin', email: 'lea@example.com', password: 'a-good-password' },
        null,
        (step) => {
          if (step === 'active_workspace_set') {
            void store.count('sessions', {}).then((count) => {
              sessionsWhenWorkspaceSet = count;
            });
          }
        },
      );
      // Nothing was signed in before the account was usable.
      expect(sessionsWhenWorkspaceSet).toBeLessThanOrEqual(0);
      expect(await store.count('sessions', {})).toBe(1);
    } finally {
      await cleanup();
    }
  });
});

describe('a sign-up that fails part-way', () => {
  it('leaves no partial state behind', async () => {
    const { store, cleanup } = await makeStore();
    try {
      // Fail exactly where the FK cycle used to bite: after the user is written.
      const broken = failingStore(store, 'workspaces');

      await expect(
        signUp(
          broken,
          { name: 'Léa Martin', email: 'lea@example.com', password: 'a-good-password' },
          null,
        ),
      ).rejects.toThrow();

      // 5. No orphan user holding the email address hostage, no orphan workspace,
      //    no membership, and nobody signed in.
      expect(await store.count('users', {})).toBe(0);
      expect(await store.count('workspaces', {})).toBe(0);
      expect(await store.count('workspaceMembers', {})).toBe(0);
      expect(await store.count('sessions', {})).toBe(0);

      // And the address is genuinely free again.
      const retry = await signUp(
        store,
        { name: 'Léa Martin', email: 'lea@example.com', password: 'a-good-password' },
        null,
      );
      expect(retry.user.email).toBe('lea@example.com');
    } finally {
      await cleanup();
    }
  });
});

describe('ensureUserBootstrap is idempotent', () => {
  it('creates nothing on repeated calls', async () => {
    const { store, cleanup } = await makeStore();
    try {
      const { user } = await signUp(
        store,
        { name: 'Léa Martin', email: 'lea@example.com', password: 'a-good-password' },
        null,
      );

      // 6. Ten times, still one of everything.
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const result = await ensureUserBootstrap(store, user.id);
        expect(result.repaired).toEqual([]);
      }
      expect(await store.count('workspaces', {})).toBe(1);
      expect(await store.count('workspaceMembers', {})).toBe(1);
    } finally {
      await cleanup();
    }
  });

  it('never writes a workspace pointer before the workspace exists', async () => {
    const { store, cleanup } = await makeStore();
    try {
      const { user } = await signUp(
        store,
        { name: 'Léa Martin', email: 'lea@example.com', password: 'a-good-password' },
        null,
      );
      await store.removeWhere('workspaceMembers', { match: { userId: user.id } });
      await store.removeWhere('workspaces', {});
      await store.update('users', user.id, { activeWorkspaceId: null });

      const order: string[] = [];
      const traced = traceStore(store, (operation, table) => order.push(`${operation}:${table}`));

      await ensureUserBootstrap(traced, user.id);

      const workspaceInsert = order.indexOf('insert:workspaces');
      const userUpdate = order.indexOf('update:users');
      expect(workspaceInsert).toBeGreaterThanOrEqual(0);
      expect(userUpdate).toBeGreaterThan(workspaceInsert);
    } finally {
      await cleanup();
    }
  });

  it('repairs a half-built account on the next sign-in', async () => {
    const { store, cleanup } = await makeStore();
    try {
      const { user } = await signUp(
        store,
        { name: 'Léa Martin', email: 'lea@example.com', password: 'a-good-password' },
        null,
      );
      await store.removeWhere('workspaceMembers', { match: { userId: user.id } });

      const signedIn = await signIn(
        store,
        { email: 'lea@example.com', password: 'a-good-password' },
        null,
      );
      expect(signedIn.user.id).toBe(user.id);

      const repaired = await ensureUserBootstrap(store, user.id);
      expect(repaired.repaired).toEqual([]);
      expect(await store.count('workspaceMembers', { match: { userId: user.id } })).toBe(1);
    } finally {
      await cleanup();
    }
  });
});

describe('SQLSTATE classification', () => {
  it('23503 is a foreign key violation, NOT a database outage', () => {
    const error = translateStoreError('insert', 'users', {
      code: '23503',
      message:
        'insert or update on table "users" violates foreign key constraint "users_active_workspace_id_fkey"',
    });
    // 8. The exact misclassification that made this look like an infrastructure
    //    problem: "database unavailable" invites a retry, and a bad write order
    //    fails identically on every retry, forever.
    expect(error.code).toBe('foreign_key_violation');
    expect(error.code).not.toBe('storage_unavailable');
    expect(error.status).toBe(500);
    expect(error.details).toMatchObject({
      sqlstate: '23503',
      constraint: 'users_active_workspace_id_fkey',
    });
  });

  it('23505 is a conflict, not an outage either', () => {
    const error = translateStoreError('insert', 'users', {
      code: '23505',
      message: 'duplicate key value violates unique constraint "users_email_key"',
    });
    expect(error.code).toBe('conflict');
    expect(error.status).toBe(409);
  });

  it('still treats a genuinely unreachable database as retryable', () => {
    const error = translateStoreError('select', 'users', new TypeError('fetch failed'));
    expect(error.code).toBe('storage_unavailable');
    expect(error.status).toBe(503);
  });
});

/* --------------------------------------------------------------- helpers -- */

/**
 * Wraps a store so writes are observed in order.
 *
 * Methods are bound to the real target: the drivers keep private state, and an
 * unbound method taken off a Proxy loses `this` and blows up inside the driver
 * rather than in the test.
 */
function traceStore(
  store: Store,
  onWrite: (operation: string, table: string, row: unknown) => void,
): Store {
  const wrap = (target: Store): Store =>
    new Proxy(target, {
      get(inner, property, receiver) {
        const value = Reflect.get(inner, property, receiver);

        if (property === 'insert' || property === 'update') {
          return (...args: unknown[]) => {
            onWrite(String(property), String(args[0]), args[1]);
            return (value as (...a: unknown[]) => unknown).apply(inner, args);
          };
        }

        if (property === 'transaction') {
          return (callback: (tx: Store) => Promise<unknown>) =>
            (value as (cb: (tx: Store) => Promise<unknown>) => unknown).call(inner, (tx) =>
              callback(wrap(tx)),
            );
        }

        return typeof value === 'function' ? (value as () => unknown).bind(inner) : value;
      },
    }) as Store;

  return wrap(store);
}

/** A store whose insert into `failTable` always throws. */
function failingStore(store: Store, failTable: string): Store {
  const wrap = (target: Store): Store =>
    new Proxy(target, {
      get(inner, property, receiver) {
        const value = Reflect.get(inner, property, receiver);

        if (property === 'insert') {
          return (...args: unknown[]) => {
            if (String(args[0]) === failTable) {
              return Promise.reject(new Error(`${failTable} insert failed`));
            }
            return (value as (...a: unknown[]) => unknown).apply(inner, args);
          };
        }

        if (property === 'transaction') {
          return (callback: (tx: Store) => Promise<unknown>) =>
            (value as (cb: (tx: Store) => Promise<unknown>) => unknown).call(inner, (tx) =>
              callback(wrap(tx)),
            );
        }

        return typeof value === 'function' ? (value as () => unknown).bind(inner) : value;
      },
    }) as Store;

  return wrap(store);
}
