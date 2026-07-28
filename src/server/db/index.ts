import path from 'node:path';
import { LocalStore } from './local-store';
import { SupabaseStore } from './supabase-store';
import type { Store } from './store';

export type { Store, Query, Predicate, OrderBy } from './store';
export * from './schema';

/**
 * The driver is cached on `globalThis`, not in a module-level variable.
 *
 * Next.js evaluates server code in more than one module instance (route handlers,
 * server components, middleware), so a module-scoped cache would produce *several*
 * stores in one process — and with the file-backed driver that means several
 * in-memory copies drifting apart. One process, one store.
 */
const globalRef = globalThis as typeof globalThis & { __phonelabStore?: Store | null };

/**
 * Resolves the storage driver from the environment, once per process.
 *
 * - `PHONELAB_STORE=supabase` (or both Supabase vars present) → Postgres.
 * - otherwise → the file-backed local driver under `PHONELAB_DATA_DIR`.
 *
 * The choice is logged on first use so it is never a mystery which one is live.
 */
export function getStore(): Store {
  if (globalRef.__phonelabStore) return globalRef.__phonelabStore;

  const explicit = process.env.PHONELAB_STORE;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseConfigured = Boolean(url && serviceKey);

  if (explicit === 'supabase' || (explicit !== 'local' && supabaseConfigured)) {
    if (!url || !serviceKey) {
      throw new Error(
        'PHONELAB_STORE=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      );
    }
    globalRef.__phonelabStore = new SupabaseStore(url, serviceKey);
  } else {
    const dir = process.env.PHONELAB_DATA_DIR ?? path.join(process.cwd(), '.phonelab-data');
    globalRef.__phonelabStore = new LocalStore(dir);
  }

  if (process.env.NODE_ENV !== 'test') {
    console.info(`[phonelab] storage driver: ${globalRef.__phonelabStore.kind}`);
  }
  return globalRef.__phonelabStore;
}

/** Test seam: swap the driver (used by the unit tests). */
export function setStore(store: Store | null): void {
  globalRef.__phonelabStore = store;
}
