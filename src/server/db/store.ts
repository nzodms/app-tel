import type { Row, TableName } from './schema';

/**
 * The storage contract. Deliberately small: enough to express every query the
 * domain services need, small enough that a second driver is ~250 lines.
 *
 * Domain services never import a driver directly — they take a `Store`.
 */

export type ComparisonOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';

export type Predicate<R> =
  | { col: keyof R & string; op: ComparisonOp; value: string | number | boolean | null }
  | { col: keyof R & string; op: 'in'; value: readonly (string | number)[] }
  /** Case-insensitive substring match. */
  | { col: keyof R & string; op: 'contains'; value: string }
  | { col: keyof R & string; op: 'isNull' }
  | { col: keyof R & string; op: 'notNull' };

export interface OrderBy<R> {
  col: keyof R & string;
  dir?: 'asc' | 'desc';
}

export interface Query<R> {
  /** Shorthand for a conjunction of `eq` predicates. */
  match?: Partial<R>;
  where?: readonly Predicate<R>[];
  orderBy?: readonly OrderBy<R>[];
  limit?: number;
  offset?: number;
}

export interface Store {
  readonly kind: 'local' | 'supabase';

  select<T extends TableName>(table: T, query?: Query<Row<T>>): Promise<Row<T>[]>;
  find<T extends TableName>(table: T, query?: Query<Row<T>>): Promise<Row<T> | null>;
  count<T extends TableName>(table: T, query?: Query<Row<T>>): Promise<number>;

  insert<T extends TableName>(table: T, row: Row<T>): Promise<Row<T>>;
  insertMany<T extends TableName>(table: T, rows: readonly Row<T>[]): Promise<Row<T>[]>;

  /** Patch by primary key. Rejects if the row does not exist. */
  update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>): Promise<Row<T>>;
  /** Patch every matching row; returns how many changed. */
  updateWhere<T extends TableName>(
    table: T,
    query: Query<Row<T>>,
    patch: Partial<Row<T>>,
  ): Promise<number>;

  remove<T extends TableName>(table: T, id: string): Promise<boolean>;
  removeWhere<T extends TableName>(table: T, query: Query<Row<T>>): Promise<number>;

  /**
   * Runs `fn` with exclusive access to the store.
   *
   * `LocalStore` gives real serialisability (single-threaded queue + atomic file
   * write at the end). `SupabaseStore` cannot offer that over the REST API, so it
   * runs `fn` directly — see the note on that driver. Multi-statement invariants
   * that must be atomic in production are enforced by SQL constraints in the
   * migration rather than by this method.
   */
  transaction<R>(fn: (tx: Store) => Promise<R>): Promise<R>;
}

/** Evaluate a query against in-memory rows. Shared by LocalStore and tests. */
export function applyQuery<R extends { id: string }>(
  rows: readonly R[],
  query: Query<R> | undefined,
): R[] {
  let out = rows.filter((row) => matchesQuery(row, query));

  const orderBy = query?.orderBy;
  if (orderBy && orderBy.length > 0) {
    out = [...out].sort((a, b) => {
      for (const { col, dir } of orderBy) {
        const cmp = compareValues(a[col as keyof R], b[col as keyof R]);
        if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
  }

  const offset = query?.offset ?? 0;
  const limit = query?.limit;
  return limit === undefined ? out.slice(offset) : out.slice(offset, offset + limit);
}

export function matchesQuery<R>(row: R, query: Query<R> | undefined): boolean {
  if (!query) return true;

  if (query.match) {
    for (const [key, expected] of Object.entries(query.match)) {
      if (!valuesEqual(row[key as keyof R], expected)) return false;
    }
  }

  for (const predicate of query.where ?? []) {
    if (!matchesPredicate(row, predicate)) return false;
  }
  return true;
}

function matchesPredicate<R>(row: R, predicate: Predicate<R>): boolean {
  const actual = row[predicate.col as keyof R];
  switch (predicate.op) {
    case 'eq':
      return valuesEqual(actual, predicate.value);
    case 'neq':
      return !valuesEqual(actual, predicate.value);
    case 'gt':
      return compareValues(actual, predicate.value) > 0;
    case 'gte':
      return compareValues(actual, predicate.value) >= 0;
    case 'lt':
      return compareValues(actual, predicate.value) < 0;
    case 'lte':
      return compareValues(actual, predicate.value) <= 0;
    case 'in':
      return predicate.value.some((candidate) => valuesEqual(actual, candidate));
    case 'contains':
      return typeof actual === 'string'
        ? actual.toLowerCase().includes(predicate.value.toLowerCase())
        : false;
    case 'isNull':
      return actual === null || actual === undefined;
    case 'notNull':
      return actual !== null && actual !== undefined;
  }
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Treat null and undefined as the same absence.
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => valuesEqual(item, b[i]));
  }
  return false;
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a) < String(b) ? -1 : 1;
}
