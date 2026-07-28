'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { useStore, type StoreApi } from 'zustand';
import { createStudioStore, type StudioStore } from './store';
import type { StudioSnapshot } from './types';

const StudioContext = createContext<StoreApi<StudioStore> | null>(null);

export function StudioProvider({
  snapshot,
  children,
}: {
  snapshot: StudioSnapshot;
  children: ReactNode;
}) {
  // One store per mounted project, created by a lazy state initialiser so nothing
  // is written during render.
  const [store] = useState(() => createStudioStore(snapshot));
  return <StudioContext.Provider value={store}>{children}</StudioContext.Provider>;
}

export function useStudio<T>(selector: (state: StudioStore) => T): T {
  const store = useContext(StudioContext);
  if (!store) throw new Error('useStudio must be used inside <StudioProvider>.');
  return useStore(store, selector);
}

/** Imperative access, for event handlers that should not subscribe. */
export function useStudioApi(): StoreApi<StudioStore> {
  const store = useContext(StudioContext);
  if (!store) throw new Error('useStudioApi must be used inside <StudioProvider>.');
  return store;
}
