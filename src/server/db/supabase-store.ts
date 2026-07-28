import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Row, TableName } from './schema';
import type { Predicate, Query, Store } from './store';

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
    if (error) throw new Error(`select ${table}: ${error.message}`);
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
    if (error) throw new Error(`count ${table}: ${error.message}`);
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
    if (error) throw new Error(`insert ${table}: ${error.message}`);
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
    if (error) throw new Error(`update ${table}: ${error.message}`);
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
    if (error) throw new Error(`updateWhere ${table}: ${error.message}`);
    return rows.length;
  }

  async remove<T extends TableName>(table: T, id: string): Promise<boolean> {
    const { data, error } = await this.client
      .from(this.table(table))
      .delete()
      .eq('id', id)
      .select('id');
    if (error) throw new Error(`remove ${table}: ${error.message}`);
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
    if (error) throw new Error(`removeWhere ${table}: ${error.message}`);
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
