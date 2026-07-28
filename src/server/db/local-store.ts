import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { TABLE_NAMES, type Row, type TableName } from './schema';
import { applyQuery, type Query, type Store } from './store';

/**
 * File-backed store for local development and single-node self-hosting.
 *
 * Everything lives in one JSON document under `.phonelab-data/`. All access is
 * funnelled through a promise queue, so operations are strictly serialised —
 * that is what makes `transaction()` genuinely atomic here (the snapshot is only
 * flushed to disk, via rename, once the callback resolves).
 *
 * This is a real driver, not a mock: restarting the server keeps your projects.
 * It is not appropriate for multi-instance deployments — use the Supabase driver
 * there.
 */

type Database = { [T in TableName]: Row<T>[] };

const EMPTY_DB = (): Database =>
  Object.fromEntries(TABLE_NAMES.map((name) => [name, []])) as unknown as Database;

export class LocalStore implements Store {
  readonly kind = 'local' as const;

  private readonly file: string;
  private db: Database | null = null;
  /** Serialises every operation; also the transaction lock. */
  private queue: Promise<unknown> = Promise.resolve();
  private dirty = false;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'phonelab.json');
  }

  /* -------------------------------------------------------------------- */

  private async load(): Promise<Database> {
    if (this.db) return this.db;
    const dir = path.dirname(this.file);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });

    if (existsSync(this.file)) {
      const raw = await readFile(this.file, 'utf8');
      try {
        const parsed = JSON.parse(raw) as Partial<Database>;
        const db = EMPTY_DB();
        for (const name of TABLE_NAMES) {
          const rows = parsed[name];
          if (Array.isArray(rows)) {
            // The cast is safe: we only ever write rows of the matching type.
            (db[name] as unknown[]) = rows as unknown[];
          }
        }
        this.db = db;
      } catch {
        throw new Error(
          `PhoneLab local store at ${this.file} is not valid JSON. ` +
            'Move or delete the file to start from a clean state.',
        );
      }
    } else {
      this.db = EMPTY_DB();
      this.dirty = true;
    }
    return this.db;
  }

  /** Atomic write: temp file + rename, so a crash never truncates the store. */
  private async flush(): Promise<void> {
    if (!this.dirty || !this.db) return;
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(this.db, null, 2), 'utf8');
    await rename(tmp, this.file);
    this.dirty = false;
  }

  /** Runs `fn` at the tail of the queue, then persists any mutation. */
  private run<R>(fn: (db: Database) => R | Promise<R>): Promise<R> {
    const task = this.queue.then(async () => {
      const db = await this.load();
      const result = await fn(db);
      await this.flush();
      return result;
    });
    // Keep the chain alive even when a task rejects.
    this.queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private rows<T extends TableName>(db: Database, table: T): Row<T>[] {
    return db[table] as Row<T>[];
  }

  /* -------------------------------------------------------------------- */

  select<T extends TableName>(table: T, query?: Query<Row<T>>): Promise<Row<T>[]> {
    return this.run((db) =>
      applyQuery(this.rows(db, table) as (Row<T> & { id: string })[], query).map(clone),
    );
  }

  async find<T extends TableName>(table: T, query?: Query<Row<T>>): Promise<Row<T> | null> {
    const [row] = await this.select(table, { ...query, limit: 1 });
    return row ?? null;
  }

  count<T extends TableName>(table: T, query?: Query<Row<T>>): Promise<number> {
    return this.run(
      (db) => applyQuery(this.rows(db, table) as (Row<T> & { id: string })[], query).length,
    );
  }

  insert<T extends TableName>(table: T, row: Row<T>): Promise<Row<T>> {
    return this.run((db) => {
      const rows = this.rows(db, table);
      if (rows.some((existing) => existing.id === row.id)) {
        throw new Error(`Duplicate id ${row.id} in ${table}`);
      }
      rows.push(clone(row));
      this.dirty = true;
      return clone(row);
    });
  }

  insertMany<T extends TableName>(table: T, incoming: readonly Row<T>[]): Promise<Row<T>[]> {
    return this.run((db) => {
      const rows = this.rows(db, table);
      const seen = new Set(rows.map((row) => row.id));
      for (const row of incoming) {
        if (seen.has(row.id)) throw new Error(`Duplicate id ${row.id} in ${table}`);
        seen.add(row.id);
        rows.push(clone(row));
      }
      this.dirty = true;
      return incoming.map(clone);
    });
  }

  update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>): Promise<Row<T>> {
    return this.run((db) => {
      const rows = this.rows(db, table);
      const index = rows.findIndex((row) => row.id === id);
      if (index === -1) throw new Error(`No ${table} row with id ${id}`);
      const current = rows[index] as Row<T>;
      const next = { ...current, ...clone(patch), id: current.id } as Row<T>;
      rows[index] = next;
      this.dirty = true;
      return clone(next);
    });
  }

  updateWhere<T extends TableName>(
    table: T,
    query: Query<Row<T>>,
    patch: Partial<Row<T>>,
  ): Promise<number> {
    return this.run((db) => {
      const rows = this.rows(db, table);
      const targets = new Set(
        applyQuery(rows as (Row<T> & { id: string })[], query).map((row) => row.id),
      );
      if (targets.size === 0) return 0;
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i] as Row<T>;
        if (targets.has(row.id)) {
          rows[i] = { ...row, ...clone(patch), id: row.id } as Row<T>;
        }
      }
      this.dirty = true;
      return targets.size;
    });
  }

  remove<T extends TableName>(table: T, id: string): Promise<boolean> {
    return this.run((db) => {
      const rows = this.rows(db, table);
      const index = rows.findIndex((row) => row.id === id);
      if (index === -1) return false;
      rows.splice(index, 1);
      this.dirty = true;
      return true;
    });
  }

  removeWhere<T extends TableName>(table: T, query: Query<Row<T>>): Promise<number> {
    return this.run((db) => {
      const rows = this.rows(db, table);
      const targets = new Set(
        applyQuery(rows as (Row<T> & { id: string })[], query).map((row) => row.id),
      );
      if (targets.size === 0) return 0;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const row = rows[i] as Row<T>;
        if (targets.has(row.id)) rows.splice(i, 1);
      }
      this.dirty = true;
      return targets.size;
    });
  }

  /**
   * Exclusive access. The callback receives a facade that bypasses the queue
   * (it already holds the lock) and operates on the live snapshot; the snapshot
   * is flushed once, after the callback resolves.
   */
  transaction<R>(fn: (tx: Store) => Promise<R>): Promise<R> {
    return this.run(async (db) => fn(new UnqueuedView(db, this)));
  }

  /** @internal used by {@link UnqueuedView} */
  markDirty(): void {
    this.dirty = true;
  }
}

/**
 * A `Store` view that operates directly on an already-locked snapshot. Only
 * created inside `LocalStore.transaction`.
 */
class UnqueuedView implements Store {
  readonly kind = 'local' as const;

  constructor(
    private readonly db: Record<string, unknown[]>,
    private readonly owner: LocalStore,
  ) {}

  private rows<T extends TableName>(table: T): Row<T>[] {
    return this.db[table] as Row<T>[];
  }

  async select<T extends TableName>(table: T, query?: Query<Row<T>>): Promise<Row<T>[]> {
    return applyQuery(this.rows(table) as (Row<T> & { id: string })[], query).map(clone);
  }

  async find<T extends TableName>(table: T, query?: Query<Row<T>>): Promise<Row<T> | null> {
    const [row] = await this.select(table, { ...query, limit: 1 });
    return row ?? null;
  }

  async count<T extends TableName>(table: T, query?: Query<Row<T>>): Promise<number> {
    return applyQuery(this.rows(table) as (Row<T> & { id: string })[], query).length;
  }

  async insert<T extends TableName>(table: T, row: Row<T>): Promise<Row<T>> {
    const rows = this.rows(table);
    if (rows.some((existing) => existing.id === row.id)) {
      throw new Error(`Duplicate id ${row.id} in ${table}`);
    }
    rows.push(clone(row));
    this.owner.markDirty();
    return clone(row);
  }

  async insertMany<T extends TableName>(table: T, incoming: readonly Row<T>[]): Promise<Row<T>[]> {
    for (const row of incoming) await this.insert(table, row);
    return incoming.map(clone);
  }

  async update<T extends TableName>(
    table: T,
    id: string,
    patch: Partial<Row<T>>,
  ): Promise<Row<T>> {
    const rows = this.rows(table);
    const index = rows.findIndex((row) => row.id === id);
    if (index === -1) throw new Error(`No ${table} row with id ${id}`);
    const current = rows[index] as Row<T>;
    const next = { ...current, ...clone(patch), id: current.id } as Row<T>;
    rows[index] = next;
    this.owner.markDirty();
    return clone(next);
  }

  async updateWhere<T extends TableName>(
    table: T,
    query: Query<Row<T>>,
    patch: Partial<Row<T>>,
  ): Promise<number> {
    const rows = this.rows(table);
    const targets = applyQuery(rows as (Row<T> & { id: string })[], query).map((row) => row.id);
    for (const id of targets) await this.update(table, id, patch);
    return targets.length;
  }

  async remove<T extends TableName>(table: T, id: string): Promise<boolean> {
    const rows = this.rows(table);
    const index = rows.findIndex((row) => row.id === id);
    if (index === -1) return false;
    rows.splice(index, 1);
    this.owner.markDirty();
    return true;
  }

  async removeWhere<T extends TableName>(table: T, query: Query<Row<T>>): Promise<number> {
    const rows = this.rows(table);
    const targets = applyQuery(rows as (Row<T> & { id: string })[], query).map((row) => row.id);
    for (const id of targets) await this.remove(table, id);
    return targets.length;
  }

  /** Already inside a transaction — just run it. */
  transaction<R>(fn: (tx: Store) => Promise<R>): Promise<R> {
    return fn(this);
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
