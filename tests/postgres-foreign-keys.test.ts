import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { makeStore } from './helpers';
import { signUp } from '@/server/services/auth';
import type { Store, TableName } from '@/server/db';

/**
 * Replays the rows sign-up really writes against a real Postgres.
 *
 * Every other test in this repo runs on the JSON driver, which has no foreign
 * keys. That is precisely why the production failure — `users.active_workspace_id`
 * pointing at a workspace that did not exist yet — passed every test and still
 * broke every sign-up on the deployed site.
 *
 * So this suite takes the actual rows, in the actual order, and runs them through
 * `psql` against a database with both migrations applied. If the order regresses,
 * this fails with the same SQLSTATE 23503 the deployment produced.
 *
 * It skips when no Postgres is reachable, so `npm test` still works anywhere.
 * Point it at one with PHONELAB_TEST_PG (a psql-style connection URL), or start
 * a throwaway instance the way scripts/snapshot-schema.mjs does.
 */

const PG_URL = process.env.PHONELAB_TEST_PG;

function psql(args: string[], database = 'phonelab_fk_test'): string {
  const target = PG_URL ? [PG_URL] : ['-h', '/var/tmp', '-p', '55440', '-U', 'postgres', '-d', database];
  return execFileSync('psql', [...target, '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function postgresAvailable(): boolean {
  try {
    psql(['-tc', 'select 1'], 'postgres');
    return true;
  } catch {
    return false;
  }
}

const available = postgresAvailable();
const describeIfPg = available ? describe : describe.skip;

if (!available) {
  console.warn(
    '[postgres-foreign-keys] no Postgres reachable — skipping. These are the only tests that ' +
      'exercise the foreign keys that broke production.',
  );
}

/* ------------------------------------------------------------- SQL helpers -- */

const toSnake = (value: string) => value.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function literal(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.length === 0 ? `'{}'` : `'{${value.map((e) => `"${String(e)}"`).join(',')}}'`;
  }
  if (typeof value === 'object') {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function insertStatement(table: string, row: Record<string, unknown>): string {
  const columns = Object.keys(row).map(toSnake);
  const values = Object.values(row).map(literal);
  return `insert into ${toSnake(table)} (${columns.join(', ')}) values (${values.join(', ')});`;
}

/** Records every write sign-up performs, in order, bound so the driver still works. */
function recordWrites(store: Store, log: { kind: 'insert' | 'update'; table: string; row: Record<string, unknown>; id?: string }[]): Store {
  const wrap = (target: Store): Store =>
    new Proxy(target, {
      get(inner, property, receiver) {
        const value = Reflect.get(inner, property, receiver);
        if (property === 'insert') {
          return (table: TableName, row: Record<string, unknown>) => {
            log.push({ kind: 'insert', table, row });
            return (value as (...a: unknown[]) => unknown).apply(inner, [table, row]);
          };
        }
        if (property === 'update') {
          return (table: TableName, id: string, patch: Record<string, unknown>) => {
            log.push({ kind: 'update', table, row: patch, id });
            return (value as (...a: unknown[]) => unknown).apply(inner, [table, id, patch]);
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

/* -------------------------------------------------------------------- tests */

describeIfPg('the rows sign-up writes are accepted by real Postgres', () => {
  it('replays the whole sequence without a foreign key violation', async () => {
    // A clean database with both migrations, so nothing leaks between runs.
    psql(['-c', 'drop database if exists phonelab_fk_test;'], 'postgres');
    psql(['-c', 'create database phonelab_fk_test;'], 'postgres');
    psql(['-f', 'supabase/migrations/0001_init.sql']);
    psql(['-f', 'supabase/migrations/0002_onboarding.sql']);

    const { store, cleanup } = await makeStore();
    try {
      const writes: {
        kind: 'insert' | 'update';
        table: string;
        row: Record<string, unknown>;
        id?: string;
      }[] = [];

      await signUp(
        recordWrites(store, writes),
        { name: 'Léa Martin', email: 'lea@example.com', password: 'a-good-password' },
        'vitest',
      );

      // Replay verbatim, in order, inside one transaction.
      const statements = writes.map((write) =>
        write.kind === 'insert'
          ? insertStatement(write.table, write.row)
          : `update ${toSnake(write.table)} set ${Object.entries(write.row)
              .map(([key, value]) => `${toSnake(key)} = ${literal(value)}`)
              .join(', ')} where id = ${literal(write.id)};`,
      );

      expect(statements.length).toBeGreaterThanOrEqual(5);
      psql(['-c', `begin; ${statements.join(' ')} commit;`]);

      // The account is whole, and the pointer resolves.
      const check = psql([
        '-tA',
        '-c',
        `select u.id, coalesce(u.active_workspace_id, 'NULL'), w.owner_id, m.role
           from users u
           join workspaces w on w.id = u.active_workspace_id
           join workspace_members m on m.workspace_id = w.id and m.user_id = u.id;`,
      ]).trim();

      const [userId, activeWorkspaceId, ownerId, role] = check.split('|');
      expect(activeWorkspaceId).not.toBe('NULL');
      expect(ownerId).toBe(userId);
      expect(role).toBe('owner');
    } finally {
      await cleanup();
    }
  });

  it('still rejects the old order, so this test is worth having', () => {
    psql(['-c', 'drop database if exists phonelab_fk_test;'], 'postgres');
    psql(['-c', 'create database phonelab_fk_test;'], 'postgres');
    psql(['-f', 'supabase/migrations/0001_init.sql']);
    psql(['-f', 'supabase/migrations/0002_onboarding.sql']);

    // Exactly what the code used to do: the pointer set on insert.
    expect(() =>
      psql([
        '-c',
        `insert into users (id, email, name, password_hash, password_salt, active_workspace_id)
         values ('usr_old', 'old@example.com', 'Old', 'h', 's', 'wsp_old');`,
      ]),
    ).toThrow(/violates foreign key constraint "users_active_workspace_id_fkey"/);
  });
});
