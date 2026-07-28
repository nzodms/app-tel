import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../core/errors';
import type { Row, TableName } from './schema';
import type { Predicate, Query, Store } from './store';

/** Postgres SQLSTATEs that mean "the migrations have not been applied here". */
const MISSING_TABLE_SQLSTATES = new Set([
  '42P01', // undefined_table
  '3F000', // invalid_schema_name
  'PGRST205', // PostgREST: table not found in schema cache
]);

/** A missing *column* is a different repair from a missing table — 0002, not 0001. */
const MISSING_COLUMN_SQLSTATES = new Set([
  '42703', // undefined_column
  'PGRST204', // PostgREST: column not found in schema cache
]);

interface PostgrestLikeError {
  code?: string | null;
  message: string;
  details?: string | null;
  hint?: string | null;
}

/**
 * Turns a driver error into one the API layer can classify.
 *
 * The distinction that matters in production is "the database is not there" vs
 * "the database is there but this table is not" — the first is an outage, the
 * second means someone deployed without running the migrations. Both used to
 * arrive as an anonymous `Error` and come out as a 500 saying nothing.
 */
export function translateStoreError(
  operation: string,
  table: string,
  error: PostgrestLikeError | Error,
): AppError {
  const code = 'code' in error ? (error.code ?? undefined) : undefined;
  const message = error.message ?? String(error);

  if (code && MISSING_TABLE_SQLSTATES.has(code)) {
    return new AppError(
      'schema_missing',
      `The database is reachable but table "${table}" does not exist. Apply supabase/migrations/0001_init.sql and 0002_onboarding.sql, then retry.`,
      { operation, table, sqlstate: code },
    );
  }

  // A table that exists but is missing a column added by a later migration.
  if ((code && MISSING_COLUMN_SQLSTATES.has(code)) || /column .* does not exist/i.test(message)) {
    return new AppError(
      'schema_missing',
      `The database schema is behind the code (${message}). Apply the pending migrations in supabase/migrations/, then retry.`,
      { operation, table },
    );
  }

  // A reference to a row that is not there. Ours to fix, and only ever a
  // symptom of writing rows in the wrong order — so it must not be reported as
  // an outage, which would tell the caller to retry something that can only fail
  // the same way. This is the class that broke every production sign-up:
  // users.active_workspace_id → workspaces.id written before the workspace.
  if (code === '23503' || /violates foreign key constraint/i.test(message)) {
    const constraint = /constraint "([^"]+)"/.exec(message)?.[1];
    return new AppError(
      'foreign_key_violation',
      `${operation} ${table} referenced a row that does not exist${constraint ? ` (${constraint})` : ''}.`,
      { operation, table, sqlstate: '23503', ...(constraint ? { constraint } : {}) },
    );
  }

  // A duplicate on a unique index. Also ours, and usually means a caller should
  // have checked first or should be treating the write as idempotent.
  if (code === '23505' || /duplicate key value violates unique constraint/i.test(message)) {
    const constraint = /constraint "([^"]+)"/.exec(message)?.[1];
    return new AppError('conflict', `That ${table.replace(/_/g, ' ')} already exists.`, {
      operation,
      table,
      sqlstate: '23505',
      ...(constraint ? { constraint } : {}),
    });
  }

  // supabase-js surfaces connectivity problems as a plain TypeError from fetch.
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network|socket hang up|getaddrinfo/i.test(message)) {
    return new AppError(
      'storage_unavailable',
      'The database is not reachable from this deployment. Check SUPABASE_URL and that the project is not paused.',
      { operation, table },
    );
  }

  if (code === '401' || code === '403' || /JWT|invalid api key|Invalid API key/i.test(message)) {
    return new AppError(
      'configuration_error',
      'The database rejected our credentials. Check SUPABASE_SERVICE_ROLE_KEY in this environment.',
      { operation, table },
    );
  }

  return new AppError('storage_unavailable', `${operation} ${table}: ${message}`, {
    operation,
    table,
    ...(code ? { sqlstate: code } : {}),
  });
}

/**
 * Postgres driver, via Supabase.
 *
 * Uses the service-role key and therefore runs *behind* our own authorisation
 * checks in `src/server/services/*` — never call it from the browser. Row Level
 * Security is still enabled in the migration so that the anon/authenticated keys
 * cannot read across tenants if you ever expose them.
 *
 * Naming: TypeScript rows are camelCase, Postgres columns are snake_case. The
 * conversion is algorithmic (no per-table maps), so adding a field to
 * `schema.ts` + the migration is all that is needed.
 *
 * Transactions: the REST API has no multi-statement transaction. `transaction()`
 * therefore runs the callback directly. Invariants that must hold regardless are
 * expressed as constraints in the migration (unique keys, FK cascades) rather
 * than relying on client-side atomicity.
 */
export class SupabaseStore implements Store {
  readonly kind = 'supabase' as const;

  private readonly client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-application-name': 'phonelab' } },
    });
  }

  private table(name: TableName): string {
    return camelToSnake(name);
  }

  private build<T extends TableName>(table: T, query: Query<Row<T>> | undefined, select: string) {
    let builder = this.client.from(this.table(table)).select(select);

    if (query?.match) {
      for (const [key, value] of Object.entries(query.match)) {
        builder =
          value === null
            ? builder.is(camelToSnake(key), null)
            : builder.eq(camelToSnake(key), value as never);
      }
    }

    for (const predicate of query?.where ?? []) {
      builder = applyPredicate(builder, predicate as Predicate<Record<string, unknown>>);
    }

    for (const { col, dir } of query?.orderBy ?? []) {
      builder = builder.order(camelToSnake(col), { ascending: dir !== 'desc' });
    }

    const offset = query?.offset ?? 0;
    if (query?.limit !== undefined) {
      builder = builder.range(offset, offset + query.limit - 1);
    } else if (offset > 0) {
      // Supabase requires an upper bound; use a generous one.
      builder = builder.range(offset, offset + 100_000);
    }

    return builder;
  }

  async select<T extends TableName>(table: T, query?: Query<Row<T>>): Promise<Row<T>[]> {
    const { data, error } = await this.build(table, query, '*');
    if (error) throw translateStoreError('select', this.table(table), error);
    return (data ?? []).map(
      (row) => keysToCamel(row as unknown as Record<string, unknown>) as unknown as Row<T>,
    );
  }

  async find<T extends TableName>(table: T, query?: Query<Row<T>>): Promise<Row<T> | null> {
    const [row] = await this.select(table, { ...query, limit: 1 });
    return row ?? null;
  }

  async count<T extends TableName>(table: T, query?: Query<Row<T>>): Promise<number> {
    const { count, error } = await this.build(table, query, 'id').then((res) => ({
      count: (res.data ?? []).length,
      error: res.error,
    }));
    if (error) throw translateStoreError('count', this.table(table), error);
    return count;
  }

  async insert<T extends TableName>(table: T, row: Row<T>): Promise<Row<T>> {
    const [inserted] = await this.insertMany(table, [row]);
    if (!inserted) throw new Error(`insert ${table}: no row returned`);
    return inserted;
  }

  async insertMany<T extends TableName>(table: T, rows: readonly Row<T>[]): Promise<Row<T>[]> {
    if (rows.length === 0) return [];
    const payload = rows.map((row) => keysToSnake(row as unknown as Record<string, unknown>));
    const { data, error } = await this.client.from(this.table(table)).insert(payload).select('*');
    if (error) throw translateStoreError('insert', this.table(table), error);
    return (data ?? []).map(
      (row) => keysToCamel(row as unknown as Record<string, unknown>) as unknown as Row<T>,
    );
  }

  async update<T extends TableName>(
    table: T,
    id: string,
    patch: Partial<Row<T>>,
  ): Promise<Row<T>> {
    const { data, error } = await this.client
      .from(this.table(table))
      .update(keysToSnake(patch as unknown as Record<string, unknown>))
      .eq('id', id)
      .select('*');
    if (error) throw translateStoreError('update', this.table(table), error);
    const row = (data ?? [])[0];
    if (!row) throw new Error(`No ${table} row with id ${id}`);
    return keysToCamel(row as unknown as Record<string, unknown>) as unknown as Row<T>;
  }

  async updateWhere<T extends TableName>(
    table: T,
    query: Query<Row<T>>,
    patch: Partial<Row<T>>,
  ): Promise<number> {
    // Resolve ids first so the same predicate vocabulary works for updates.
    const rows = await this.select(table, { ...query, orderBy: undefined });
    if (rows.length === 0) return 0;
    const { error } = await this.client
      .from(this.table(table))
      .update(keysToSnake(patch as unknown as Record<string, unknown>))
      .in(
        'id',
        rows.map((row) => (row as { id: string }).id),
      );
    if (error) throw translateStoreError('updateWhere', this.table(table), error);
    return rows.length;
  }

  async remove<T extends TableName>(table: T, id: string): Promise<boolean> {
    const { data, error } = await this.client
      .from(this.table(table))
      .delete()
      .eq('id', id)
      .select('id');
    if (error) throw translateStoreError('remove', this.table(table), error);
    return (data ?? []).length > 0;
  }

  async removeWhere<T extends TableName>(table: T, query: Query<Row<T>>): Promise<number> {
    const rows = await this.select(table, { ...query, orderBy: undefined });
    if (rows.length === 0) return 0;
    const { error } = await this.client
      .from(this.table(table))
      .delete()
      .in(
        'id',
        rows.map((row) => (row as { id: string }).id),
      );
    if (error) throw translateStoreError('removeWhere', this.table(table), error);
    return rows.length;
  }

  transaction<R>(fn: (tx: Store) => Promise<R>): Promise<R> {
    return fn(this);
  }
}

/* -------------------------------------------------------------------------- */
/* Naming helpers                                                              */
/* -------------------------------------------------------------------------- */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyPredicate(builder: any, predicate: Predicate<Record<string, unknown>>) {
  const col = camelToSnake(predicate.col);
  switch (predicate.op) {
    case 'eq':
      return predicate.value === null ? builder.is(col, null) : builder.eq(col, predicate.value);
    case 'neq':
      return builder.neq(col, predicate.value);
    case 'gt':
      return builder.gt(col, predicate.value);
    case 'gte':
      return builder.gte(col, predicate.value);
    case 'lt':
      return builder.lt(col, predicate.value);
    case 'lte':
      return builder.lte(col, predicate.value);
    case 'in':
      return builder.in(col, predicate.value);
    case 'contains':
      return builder.ilike(col, `%${escapeLike(predicate.value)}%`);
    case 'isNull':
      return builder.is(col, null);
    case 'notNull':
      return builder.not(col, 'is', null);
  }
}

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, (char) => `\\${char}`);
}

export function camelToSnake(input: string): string {
  return input.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}

export function snakeToCamel(input: string): string {
  return input.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}

function keysToSnake(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) out[camelToSnake(key)] = value;
  return out;
}

function keysToCamel(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) out[snakeToCamel(key)] = value;
  return out;
}
