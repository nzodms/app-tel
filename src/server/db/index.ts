import path from 'node:path';
import { AppError } from '../core/errors';
import { log } from '../core/logging';
import { LocalStore } from './local-store';
import { SupabaseStore } from './supabase-store';
import {
  cleanEnv,
  configurationErrorMessage,
  resolveStoreConfig,
  type StoreResolution,
} from './config';
import type { Store } from './store';

export type { Store, Query, Predicate, OrderBy } from './store';
export * from './schema';
export {
  resolveStoreConfig,
  configurationErrorMessage,
  SUPABASE_ENV_VARS,
  type StoreResolution,
  type StoreDriverKind,
} from './config';

/**
 * The driver is cached on `globalThis`, not in a module-level variable.
 *
 * Next.js evaluates server code in more than one module instance (route handlers,
 * server components, middleware), so a module-scoped cache would produce *several*
 * stores in one process — and with the file-backed driver that means several
 * in-memory copies drifting apart. One process, one store.
 */
const globalRef = globalThis as typeof globalThis & {
  __phonelabStore?: Store | null;
  __phonelabStoreLogged?: boolean;
};

/** What the driver resolution decided, without building a driver. */
export function storeResolution(): StoreResolution {
  return resolveStoreConfig(process.env);
}

/**
 * Resolves the storage driver, or refuses.
 *
 * There is no silent fallback. If this environment cannot persist data, the
 * caller gets an `AppError` naming the variables that would fix it — see
 * `./config.ts` for why that matters more than it sounds.
 */
export function getStore(): Store {
  if (globalRef.__phonelabStore) return globalRef.__phonelabStore;

  const resolution = storeResolution();

  if (resolution.driver === null) {
    // Deliberately not cached: adding the variables and redeploying should be
    // enough, and a warm Lambda must not keep serving the refusal afterwards.
    log('error', 'storage.unavailable', {
      reason: resolution.reason,
      missing: resolution.missing,
      environment: resolution.environment,
      serverless: resolution.serverless,
    });
    throw new AppError('configuration_error', configurationErrorMessage(resolution), {
      missingEnvVars: resolution.missing,
    });
  }

  if (resolution.driver === 'supabase') {
    const url = cleanEnv(process.env.SUPABASE_URL) ?? cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL);
    const serviceKey = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
    if (!url || !serviceKey) {
      // resolveStoreConfig already guarantees this, but a driver that silently
      // constructs with an undefined key is exactly the class of bug we are here
      // to remove.
      throw new AppError(
        'configuration_error',
        configurationErrorMessage({ ...resolution, driver: null }),
      );
    }
    globalRef.__phonelabStore = new SupabaseStore(url, serviceKey);
  } else {
    const dir = cleanEnv(process.env.PHONELAB_DATA_DIR) ?? path.join(process.cwd(), '.phonelab-data');
    globalRef.__phonelabStore = new LocalStore(dir);
  }

  if (process.env.NODE_ENV !== 'test' && !globalRef.__phonelabStoreLogged) {
    globalRef.__phonelabStoreLogged = true;
    log('info', 'storage.selected', {
      driver: globalRef.__phonelabStore.kind,
      reason: resolution.reason,
      environment: resolution.environment,
      serverless: resolution.serverless,
    });
  }
  return globalRef.__phonelabStore;
}

/** Test seam: swap the driver (used by the unit tests). */
export function setStore(store: Store | null): void {
  globalRef.__phonelabStore = store;
  globalRef.__phonelabStoreLogged = false;
}
