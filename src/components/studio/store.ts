'use client';

import { create } from 'zustand';
import { ApiError, api, errorText } from '@/lib/api-client';
import { getPreset, deviceGeometry } from '@/lib/devices/presets';
import { EDGE_CASES } from '@/lib/devices/edge-cases';
import type { PreviewDeviceContext, PreviewMessage, PreviewNotification, ReplayStep } from '@/lib/preview/protocol';
// From `src/lib`, not the database barrel: importing values out of `@/server/db`
// pulls the local-store driver — and `node:fs` with it — into the client bundle.
import { DEFAULT_PREFERENCES, type UserPreferences } from '@/lib/preferences';
import type { DeviceEventRow, DeviceRow, Diagnostic, JourneyRow } from '@/server/db';
import type { FileSummary, TreeNode } from '@/server/services/files';
import type { VersionSummary } from '@/server/services/versions';
import type { ThreadWithComments } from '@/server/services/comments';
import type { ProjectRoleInfo } from '@/server/services/projects';
import { IDLE_ISLAND, type IslandContent } from './canvas/dynamic-island';
import type { SystemSheet } from './canvas/overlays';
import { DEFAULT_STATUS, type StatusBarState } from './canvas/status-bar';
import { previewRegistry } from './preview-registry';
import type {
  BundleRef,
  BundleState,
  CompareState,
  InspectorTarget,
  LeftTab,
  OpenFile,
  RecordedStep,
  StudioSnapshot,
} from './types';

/**
 * Studio state.
 *
 * Two rules keep this honest and fast:
 *
 *  1. Nothing that changes 60 times a second lives here. Drag positions and canvas
 *     pan/zoom are applied straight to the DOM and only committed to the store (and
 *     the server) when the gesture ends. That is what stops a phone's preview from
 *     re-rendering — or reloading — while you move it.
 *  2. Every mutation that the server owns goes through the API and is then
 *     reconciled from the realtime stream, so a change made by Claude over MCP and a
 *     change made in the UI take exactly the same path.
 */

export interface DeviceChrome {
  status: StatusBarState;
  island: IslandContent;
  notifications: PreviewNotification[];
  sheet: SystemSheet | null;
  route: string;
  /** Badge counters raised by the app, e.g. { requests: 2 }. */
  badges: Record<string, number>;
  mounted: boolean;
  lastError: string | null;
}

interface StudioState {
  snapshot: StudioSnapshot;

  /* server-owned collections */
  devices: DeviceRow[];
  files: FileSummary[];
  tree: TreeNode[];
  versions: VersionSummary[];
  journeys: JourneyRow[];
  roles: ProjectRoleInfo[];
  events: DeviceEventRow[];
  threads: ThreadWithComments[];
  diagnostics: Diagnostic[];
  buildStatus: 'idle' | 'building' | 'success' | 'error';
  buildDurationMs: number | null;

  /* client-only view state */
  leftTab: LeftTab;
  leftWidth: number;
  /** From the account, not the browser — see `UserPreferences`. */
  preferences: UserPreferences;
  openFiles: OpenFile[];
  activeFilePath: string | null;
  selectedDeviceIds: string[];
  inspectMode: boolean;
  inspector: InspectorTarget | null;
  timelineOpen: boolean;
  edgeCasesOpen: boolean;
  compare: CompareState;
  saving: boolean;
  toast: { kind: 'info' | 'success' | 'error'; message: string } | null;

  /* preview */
  bundles: Record<string, BundleState>;
  shared: Record<string, unknown>;
  chrome: Record<string, DeviceChrome>;

  /* journeys */
  recording: { active: boolean; startedAt: number; steps: RecordedStep[] } | null;
  replay: { runId: string | null; journeyId: string | null; step: number; total: number; playing: boolean; speed: number } | null;
}

interface StudioActions {
  setLeftTab: (tab: LeftTab) => void;
  setLeftWidth: (width: number) => void;
  /** Persists the current pane width to the account. Called on pointer-up only. */
  persistLeftWidth: () => void;
  notify: (kind: 'info' | 'success' | 'error', message: string) => void;
  dismissToast: () => void;

  /* files */
  openFile: (path: string) => Promise<void>;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  editDraft: (path: string, value: string) => void;
  saveFile: (path: string) => Promise<void>;
  createFile: (path: string, content?: string) => Promise<void>;
  renameFile: (from: string, to: string) => Promise<void>;
  deleteFile: (path: string) => Promise<void>;
  refreshTree: () => Promise<void>;

  /* devices */
  selectDevice: (deviceId: string | null, additive?: boolean) => void;
  addDevice: (input: Partial<DeviceRow>) => Promise<void>;
  patchDevice: (deviceId: string, patch: Partial<DeviceRow>) => Promise<void>;
  duplicateDevice: (deviceId: string) => Promise<void>;
  removeDevice: (deviceId: string) => Promise<void>;
  commitPositions: (positions: { id: string; x: number; y: number }[]) => Promise<void>;
  applyLocalPositions: (positions: { id: string; x: number; y: number }[]) => void;

  /* preview */
  ensureBundle: (ref: BundleRef, force?: boolean) => Promise<BundleState>;
  /** Restores the newest snapshot that compiles behind a failed build. */
  recoverLastWorking: (key: string) => Promise<void>;
  rebuildAll: (force?: boolean) => Promise<void>;
  reloadDevice: (deviceId: string) => void;
  resetDevices: (clearShared: boolean) => number;
  handlePreviewMessage: (deviceId: string, message: PreviewMessage) => void;
  dismissNotification: (deviceId: string, notificationId: string) => void;
  resolveSheet: (deviceId: string, sheetId: string, allowed: boolean) => void;
  contextFor: (device: DeviceRow) => PreviewDeviceContext;

  /* inspector */
  setInspectMode: (enabled: boolean) => void;
  clearInspector: () => void;

  /* versions & compare */
  createSnapshot: (label: string, description: string) => Promise<void>;
  restoreVersion: (versionId: string) => Promise<void>;
  setCompare: (patch: Partial<CompareState>) => void;
  refreshVersions: () => Promise<void>;
  refreshJourneys: () => Promise<void>;

  /* timeline & journeys */
  toggleTimeline: () => void;
  toggleEdgeCases: () => void;
  startRecording: () => void;
  cancelRecording: () => void;
  saveRecording: (name: string, description: string) => Promise<void>;
  runJourney: (journeyId: string, speed?: number) => Promise<void>;
  stopReplay: () => void;

  /* realtime */
  applyRealtime: (event: string, payload: unknown) => void;
  appendEvent: (event: DeviceEventRow) => void;
}

export type StudioStore = StudioState & StudioActions;

const MAX_EVENTS = 400;

/**
 * Replaces the diagnostics of one source, keeping the others.
 *
 * The store holds a single flat list that the Logs panel and the error counter
 * both read. A rebuild must clear the previous *compile* diagnostics without
 * discarding runtime exceptions the preview reported, and a failed request must
 * add itself without wiping either. Filtering by source is what keeps the count
 * truthful in all three cases.
 */
export function mergeDiagnostics(
  current: Diagnostic[],
  incoming: Diagnostic[],
  source: Diagnostic['source'],
): Diagnostic[] {
  return [...current.filter((entry) => entry.source !== source), ...incoming];
}

/** Errors by source, for a counter that can say what kind of error it means. */
export interface DiagnosticCounts {
  build: number;
  runtime: number;
  transport: number;
  total: number;
  warnings: number;
}

export function countDiagnostics(diagnostics: Diagnostic[]): DiagnosticCounts {
  const errors = diagnostics.filter((entry) => entry.severity === 'error');
  return {
    build: errors.filter((entry) => entry.source === 'esbuild').length,
    runtime: errors.filter((entry) => entry.source === 'runtime').length,
    transport: errors.filter((entry) => entry.source === 'transport').length,
    total: errors.length,
    warnings: diagnostics.filter((entry) => entry.severity === 'warning').length,
  };
}

function emptyChrome(): DeviceChrome {
  return {
    status: { ...DEFAULT_STATUS },
    island: IDLE_ISLAND,
    notifications: [],
    sheet: null,
    route: '/',
    badges: {},
    mounted: false,
    lastError: null,
  };
}

/** Permission sheets raised by the corresponding edge-case flags. */
const PERMISSION_SHEETS: Record<string, Omit<SystemSheet, 'id'>> = {
  'gps-denied': {
    title: '“{app}” would like to use your location',
    body: 'Your location is used to show courts near you.',
    primaryLabel: 'Allow Once',
    secondaryLabel: 'Don’t Allow',
    flag: 'gps-denied',
  },
  'camera-denied': {
    title: '“{app}” would like to access the camera',
    body: 'The camera is used to scan and share codes.',
    primaryLabel: 'OK',
    secondaryLabel: 'Don’t Allow',
    flag: 'camera-denied',
  },
};

export function createStudioStore(snapshot: StudioSnapshot) {
  return create<StudioStore>()((set, get) => ({
    snapshot,
    devices: snapshot.devices,
    files: snapshot.files,
    tree: snapshot.tree,
    versions: snapshot.versions,
    journeys: snapshot.journeys,
    roles: snapshot.roles,
    events: snapshot.events,
    threads: snapshot.threads,
    diagnostics: snapshot.diagnostics,
    buildStatus: snapshot.lastBuild?.status === 'error' ? 'error' : snapshot.lastBuild ? 'success' : 'idle',
    buildDurationMs: snapshot.lastBuild?.durationMs ?? null,

    leftTab: 'files',
    preferences: { ...DEFAULT_PREFERENCES, ...(snapshot.user.preferences ?? {}) },
    leftWidth: snapshot.user.preferences?.leftPaneWidth ?? DEFAULT_PREFERENCES.leftPaneWidth,
    openFiles: [],
    activeFilePath: null,
    selectedDeviceIds: snapshot.devices[0] ? [snapshot.devices[0].id] : [],
    inspectMode: false,
    inspector: null,
    timelineOpen: true,
    edgeCasesOpen: false,
    compare: {
      active: false,
      baseRef: snapshot.versions[snapshot.versions.length - 1]?.id ?? 'working',
      targetRef: 'working',
      syncNavigation: false,
      path: null,
    },
    saving: false,
    toast: null,

    bundles: {},
    shared: {},
    chrome: Object.fromEntries(snapshot.devices.map((device) => [device.id, emptyChrome()])),

    recording: null,
    replay: null,

    /* ------------------------------------------------------------------ ui */

    setLeftTab: (tab) => set({ leftTab: tab }),
    setLeftWidth: (width) => set({ leftWidth: Math.min(Math.max(width, 16), 62) }),
    persistLeftWidth: () => {
      // Fire and forget: a failed preference write is not worth interrupting anyone.
      void api('/api/me', {
        method: 'PATCH',
        body: { preferences: { leftPaneWidth: Math.round(get().leftWidth) } },
      }).catch(() => undefined);
    },
    notify: (kind, message) => {
      set({ toast: { kind, message } });
      window.setTimeout(() => {
        if (get().toast?.message === message) set({ toast: null });
      }, 4200);
    },
    dismissToast: () => set({ toast: null }),

    /* --------------------------------------------------------------- files */

    openFile: async (path) => {
      const existing = get().openFiles.find((file) => file.path === path);
      set({ leftTab: 'code', activeFilePath: path });
      if (existing && existing.content !== null) return;

      set((state) => ({
        openFiles: existing
          ? state.openFiles.map((file) => (file.path === path ? { ...file, loading: true, error: null } : file))
          : [...state.openFiles, { path, draft: null, content: null, baseUpdatedAt: null, loading: true, error: null }],
      }));

      try {
        const result = await api<{ path: string; content: string; updatedAt: string }>(
          `/api/projects/${get().snapshot.project.id}/files/content?path=${encodeURIComponent(path)}`,
        );
        set((state) => ({
          openFiles: state.openFiles.map((file) =>
            file.path === path
              ? { ...file, content: result.content, baseUpdatedAt: result.updatedAt, loading: false }
              : file,
          ),
        }));
      } catch (error) {
        set((state) => ({
          openFiles: state.openFiles.map((file) =>
            file.path === path ? { ...file, loading: false, error: errorText(error) } : file,
          ),
        }));
      }
    },

    closeFile: (path) =>
      set((state) => {
        const remaining = state.openFiles.filter((file) => file.path !== path);
        return {
          openFiles: remaining,
          activeFilePath:
            state.activeFilePath === path ? (remaining[remaining.length - 1]?.path ?? null) : state.activeFilePath,
        };
      }),

    setActiveFile: (path) => set({ activeFilePath: path, leftTab: 'code' }),

    editDraft: (path, value) =>
      set((state) => ({
        openFiles: state.openFiles.map((file) =>
          file.path === path ? { ...file, draft: value === file.content ? null : value } : file,
        ),
      })),

    saveFile: async (path) => {
      const file = get().openFiles.find((entry) => entry.path === path);
      if (!file || file.draft === null) return;
      set({ saving: true });
      try {
        const result = await api<{ file: FileSummary }>(
          `/api/projects/${get().snapshot.project.id}/files/content`,
          {
            method: 'PUT',
            body: { path, content: file.draft, expectedUpdatedAt: file.baseUpdatedAt },
          },
        );
        set((state) => ({
          openFiles: state.openFiles.map((entry) =>
            entry.path === path
              ? { ...entry, content: file.draft, draft: null, baseUpdatedAt: result.file.updatedAt }
              : entry,
          ),
          saving: false,
        }));
        await get().rebuildAll(true);
      } catch (error) {
        set({ saving: false });
        get().notify('error', errorText(error));
      }
    },

    createFile: async (path, content = '') => {
      try {
        await api(`/api/projects/${get().snapshot.project.id}/files`, {
          body: { path, content },
        });
        await get().refreshTree();
        await get().openFile(path);
        get().notify('success', `Created ${path}`);
      } catch (error) {
        get().notify('error', errorText(error));
      }
    },

    renameFile: async (from, to) => {
      try {
        await api(`/api/projects/${get().snapshot.project.id}/files`, {
          method: 'PATCH',
          body: { from, to },
        });
        set((state) => ({
          openFiles: state.openFiles.map((file) => (file.path === from ? { ...file, path: to } : file)),
          activeFilePath: state.activeFilePath === from ? to : state.activeFilePath,
        }));
        await get().refreshTree();
        await get().rebuildAll(true);
      } catch (error) {
        get().notify('error', errorText(error));
      }
    },

    deleteFile: async (path) => {
      try {
        await api(
          `/api/projects/${get().snapshot.project.id}/files?path=${encodeURIComponent(path)}`,
          { method: 'DELETE' },
        );
        get().closeFile(path);
        await get().refreshTree();
        await get().rebuildAll(true);
        get().notify('success', `Deleted ${path}`);
      } catch (error) {
        get().notify('error', errorText(error));
      }
    },

    refreshTree: async () => {
      try {
        const result = await api<{ files: FileSummary[]; tree: TreeNode[] }>(
          `/api/projects/${get().snapshot.project.id}/files`,
        );
        set({ files: result.files, tree: result.tree });
      } catch (error) {
        get().notify('error', errorText(error));
      }
    },

    /* ------------------------------------------------------------- devices */

    selectDevice: (deviceId, additive) =>
      set((state) => {
        if (!deviceId) return { selectedDeviceIds: [] };
        if (!additive) return { selectedDeviceIds: [deviceId] };
        return {
          selectedDeviceIds: state.selectedDeviceIds.includes(deviceId)
            ? state.selectedDeviceIds.filter((id) => id !== deviceId)
            : [...state.selectedDeviceIds, deviceId],
        };
      }),

    addDevice: async (input) => {
      try {
        const result = await api<{ device: DeviceRow }>(
          `/api/projects/${get().snapshot.project.id}/devices`,
          { body: input },
        );
        set((state) => ({
          devices: [...state.devices, result.device],
          chrome: { ...state.chrome, [result.device.id]: emptyChrome() },
          selectedDeviceIds: [result.device.id],
        }));
        await get().ensureBundle(result.device.versionId ?? 'working');
      } catch (error) {
        get().notify('error', errorText(error));
      }
    },

    patchDevice: async (deviceId, patch) => {
      const previous = get().devices.find((device) => device.id === deviceId);
      if (!previous) return;
      // Optimistic: the phone should react the instant you flip a switch.
      set((state) => ({
        devices: state.devices.map((device) => (device.id === deviceId ? { ...device, ...patch } : device)),
      }));

      const updated = get().devices.find((device) => device.id === deviceId);
      if (updated) {
        previewRegistry.post(deviceId, { type: 'host:context', context: get().contextFor(updated) });
        if (patch.versionId !== undefined) {
          void get()
            .ensureBundle(patch.versionId ?? 'working')
            .then(() => get().reloadDevice(deviceId));
        }
      }

      try {
        const result = await api<{ device: DeviceRow }>(
          `/api/projects/${get().snapshot.project.id}/devices/${deviceId}`,
          { method: 'PATCH', body: patch },
        );
        set((state) => ({
          devices: state.devices.map((device) => (device.id === deviceId ? result.device : device)),
        }));
      } catch (error) {
        set((state) => ({
          devices: state.devices.map((device) => (device.id === deviceId ? previous : device)),
        }));
        get().notify('error', errorText(error));
      }
    },

    duplicateDevice: async (deviceId) => {
      try {
        const result = await api<{ device: DeviceRow }>(
          `/api/projects/${get().snapshot.project.id}/devices/${deviceId}/duplicate`,
          { method: 'POST' },
        );
        set((state) => ({
          devices: [...state.devices, result.device],
          chrome: { ...state.chrome, [result.device.id]: emptyChrome() },
          selectedDeviceIds: [result.device.id],
        }));
      } catch (error) {
        get().notify('error', errorText(error));
      }
    },

    removeDevice: async (deviceId) => {
      const previous = get().devices;
      set((state) => ({
        devices: state.devices.filter((device) => device.id !== deviceId),
        selectedDeviceIds: state.selectedDeviceIds.filter((id) => id !== deviceId),
      }));
      try {
        await api(`/api/projects/${get().snapshot.project.id}/devices/${deviceId}`, {
          method: 'DELETE',
        });
        previewRegistry.unregister(deviceId);
      } catch (error) {
        set({ devices: previous });
        get().notify('error', errorText(error));
      }
    },

    applyLocalPositions: (positions) =>
      set((state) => {
        const map = new Map(positions.map((position) => [position.id, position]));
        return {
          devices: state.devices.map((device) => {
            const next = map.get(device.id);
            return next ? { ...device, x: next.x, y: next.y } : device;
          }),
        };
      }),

    commitPositions: async (positions) => {
      if (positions.length === 0) return;
      get().applyLocalPositions(positions);
      try {
        await api(`/api/projects/${get().snapshot.project.id}/devices/positions`, {
          method: 'PATCH',
          body: { positions },
        });
      } catch (error) {
        get().notify('error', errorText(error));
      }
    },

    /* ------------------------------------------------------------- preview */

    contextFor: (device) => {
      const preset = getPreset(device.presetId);
      const geometry = deviceGeometry(preset, device.orientation);
      const version = get().versions.find((entry) => entry.id === device.versionId);
      return {
        deviceId: device.id,
        deviceName: device.name,
        role: device.role,
        userLabel: device.userLabel,
        theme: device.theme,
        locale: device.locale,
        network: device.network,
        flags: device.stateFlags,
        versionLabel: version?.label ?? null,
        viewport: geometry.screen,
        safeArea: geometry.safeArea,
      };
    },

    ensureBundle: async (ref, force) => {
      const key = String(ref);
      const existing = get().bundles[key];
      if (!force && existing && (existing.status === 'ready' || existing.status === 'building')) {
        return existing;
      }

      set((state) => ({
        bundles: {
          ...state.bundles,
          [key]: {
            ref,
            status: 'building',
            // Keep showing whatever is on screen while the new bundle compiles.
            code: existing?.code ?? null,
            hash: existing?.hash ?? null,
            lastGoodCode: existing?.lastGoodCode ?? existing?.code ?? null,
            lastGoodHash: existing?.lastGoodHash ?? existing?.hash ?? null,
            stale: existing?.stale ?? false,
            diagnostics: [],
            durationMs: null,
            bytes: null,
            error: null,
          },
        },
        buildStatus: 'building',
      }));

      try {
        const result = await api<{
          ok: boolean;
          code: string;
          hash: string;
          diagnostics: Diagnostic[];
          durationMs: number;
          bytes: number;
        }>(`/api/projects/${get().snapshot.project.id}/preview/build`, {
          body: { ref: key, force: force ?? false },
        });

        const previous = get().bundles[key];

        const next: BundleState = {
          ref,
          status: result.ok ? 'ready' : 'error',
          // A failed compile keeps the last code that worked. The phone then shows
          // the previous app dimmed behind the error instead of going blank, which
          // is both less alarming and more useful: you can still see what you had.
          code: result.ok ? result.code : (previous?.lastGoodCode ?? previous?.code ?? null),
          hash: result.ok ? result.hash : (previous?.lastGoodHash ?? previous?.hash ?? null),
          lastGoodCode: result.ok ? result.code : (previous?.lastGoodCode ?? previous?.code ?? null),
          lastGoodHash: result.ok ? result.hash : (previous?.lastGoodHash ?? previous?.hash ?? null),
          diagnostics: result.diagnostics,
          durationMs: result.durationMs,
          bytes: result.bytes,
          error: result.ok ? null : (result.diagnostics[0]?.message ?? 'Build failed'),
          stale: !result.ok && Boolean(previous?.lastGoodCode ?? previous?.code),
        };

        set((state) => ({
          bundles: { ...state.bundles, [key]: next },
          diagnostics: mergeDiagnostics(state.diagnostics, result.diagnostics, 'esbuild'),
          buildStatus: result.ok ? 'success' : 'error',
          buildDurationMs: result.durationMs,
        }));

        // Nothing cached to fall back on — a cold load whose working tree is
        // broken. Compile the newest snapshot instead so the phone shows the last
        // version that *did* work rather than an empty screen. It is marked stale,
        // and the error card says so, so this is never mistaken for current code.
        if (!result.ok && !next.code && ref === 'working') {
          void get().recoverLastWorking(key);
        }

        if (next.status === 'ready' && next.code) {
          for (const device of get().devices) {
            if (String(device.versionId ?? 'working') !== key) continue;
            previewRegistry.post(device.id, {
              type: 'host:load',
              code: next.code,
              hash: next.hash ?? '',
            });
          }
        }
        return next;
      } catch (error) {
        const previous = get().bundles[key];
        const projectId = get().snapshot.project.id;

        /*
         * The request never reached the compiler — a 404, a 503, an offline
         * browser. This used to write `diagnostics: []` and leave the store's
         * top-level `diagnostics` untouched, so the toolbar read "0 error(s)"
         * while every phone showed "Build failed". A failure with nothing to
         * report is still a failure: it becomes a diagnostic of its own, naming
         * the request that failed so it is actually debuggable.
         */
        const detail =
          error instanceof ApiError
            ? `${error.status || 'network'} — ${error.message}`
            : errorText(error);

        const diagnostic: Diagnostic = {
          severity: 'error',
          message: `Could not reach the build service: ${detail} (POST /api/projects/${projectId}/preview/build)`,
          file: null,
          line: null,
          column: null,
          source: 'transport',
        };

        const failed: BundleState = {
          ref,
          status: 'error',
          // Same reasoning as above: keep whatever was last running.
          code: previous?.lastGoodCode ?? previous?.code ?? null,
          hash: previous?.lastGoodHash ?? previous?.hash ?? null,
          lastGoodCode: previous?.lastGoodCode ?? previous?.code ?? null,
          lastGoodHash: previous?.lastGoodHash ?? previous?.hash ?? null,
          diagnostics: [diagnostic],
          durationMs: null,
          bytes: null,
          error: diagnostic.message,
          stale: Boolean(previous?.lastGoodCode ?? previous?.code),
        };

        set((state) => ({
          bundles: { ...state.bundles, [key]: failed },
          diagnostics: mergeDiagnostics(state.diagnostics, [diagnostic], 'transport'),
          buildStatus: 'error',
        }));

        if (!failed.code && ref === 'working') void get().recoverLastWorking(key);
        return failed;
      }
    },

    /**
     * Puts the last version that compiled back on screen behind a failed build.
     *
     * Tries snapshots newest-first and stops at the first that compiles. Whatever
     * it finds is stored as `lastGoodCode` with `stale: true`, so the phone shows
     * a working app while the error card keeps saying the current sources are
     * broken — the project is visibly not lost, and nothing pretends to be fresh.
     *
     * Silent by design: this runs *because* something already failed, and a
     * failure to recover must not bury the error that caused it.
     */
    recoverLastWorking: async (key) => {
      // Newest first, by sequence — the array's order is not guaranteed, and
      // guessing it wrong silently restores the oldest snapshot instead of the
      // newest, which is worse than not restoring at all.
      const versions = [...get().versions].sort((a, b) => b.sequence - a.sequence);
      for (const version of versions.slice(0, 3)) {
        try {
          const result = await api<{ ok: boolean; code: string; hash: string }>(
            `/api/projects/${get().snapshot.project.id}/preview/build`,
            { body: { ref: version.id } },
          );
          if (!result.ok || !result.code) continue;

          /*
           * No status guard here. Two phones on the same ref each trigger a build,
           * so by the time this resolves the bundle may have flipped back to
           * `building` for the second attempt — and an over-strict guard silently
           * threw the recovery away, which is how this first shipped broken.
           *
           * Recording `lastGoodCode` is always right whatever the current status.
           * Only the visible `code` is conditional: a bundle that has since gone
           * green must not be overwritten with an older snapshot.
           */
          set((state) => {
            const current = state.bundles[key];
            if (!current) return state;
            const showRecovered = current.status !== 'ready';
            return {
              bundles: {
                ...state.bundles,
                [key]: {
                  ...current,
                  code: showRecovered ? result.code : current.code,
                  hash: showRecovered ? result.hash : current.hash,
                  lastGoodCode: result.code,
                  lastGoodHash: result.hash,
                  stale: showRecovered ? true : current.stale,
                  ...(showRecovered ? { recoveredFrom: version.label } : {}),
                },
              },
            };
          });

          if (get().bundles[key]?.status !== 'ready') {
            const state = get();
            for (const device of state.devices) {
              if (String(device.versionId ?? 'working') !== key) continue;
              // `host:init` first, exactly as the `preview:ready` path does. A
              // `host:load` that arrives without a context is dropped by the
              // runtime, which is why the recovered bundle compiled fine and the
              // phone still showed the boot placeholder.
              previewRegistry.post(device.id, {
                type: 'host:init',
                context: state.contextFor(device),
                shared: state.shared,
              });
              previewRegistry.post(device.id, {
                type: 'host:load',
                code: result.code,
                hash: result.hash,
              });
            }
          }
          return;
        } catch {
          // Try the next snapshot back.
        }
      }
    },

    rebuildAll: async (force) => {
      const refs = new Set<string>(['working']);
      for (const device of get().devices) refs.add(String(device.versionId ?? 'working'));
      if (get().compare.active) {
        refs.add(String(get().compare.baseRef));
        refs.add(String(get().compare.targetRef));
      }
      await Promise.all([...refs].map((ref) => get().ensureBundle(ref, force)));
    },

    reloadDevice: (deviceId) => {
      const device = get().devices.find((entry) => entry.id === deviceId);
      if (!device) return;
      const bundle = get().bundles[String(device.versionId ?? 'working')];
      if (bundle?.code) {
        previewRegistry.post(deviceId, { type: 'host:load', code: bundle.code, hash: bundle.hash ?? '' });
      }
    },

    resetDevices: (clearShared) => {
      if (clearShared) {
        set({ shared: {} });
        previewRegistry.broadcast({ type: 'host:shared', shared: {} });
      }
      const ids = get().devices.map((device) => device.id);
      for (const id of ids) {
        previewRegistry.post(id, { type: 'host:reset' });
        get().reloadDevice(id);
      }
      set((state) => ({
        chrome: Object.fromEntries(ids.map((id) => [id, { ...emptyChrome(), status: state.chrome[id]?.status ?? DEFAULT_STATUS }])),
      }));
      return ids.length;
    },

    handlePreviewMessage: (deviceId, message) => {
      const state = get();
      const device = state.devices.find((entry) => entry.id === deviceId);
      if (!device) return;
      const projectId = state.snapshot.project.id;

      switch (message.type) {
        case 'preview:ready': {
          previewRegistry.markReady(deviceId);
          previewRegistry.post(deviceId, {
            type: 'host:init',
            context: state.contextFor(device),
            shared: state.shared,
          });
          const bundle = state.bundles[String(device.versionId ?? 'working')];
          if (bundle?.code) {
            previewRegistry.post(deviceId, {
              type: 'host:load',
              code: bundle.code,
              hash: bundle.hash ?? '',
            });
          } else {
            void state.ensureBundle(device.versionId ?? 'working');
          }
          break;
        }

        case 'preview:mounted':
          set((current) => ({
            chrome: {
              ...current.chrome,
              [deviceId]: { ...(current.chrome[deviceId] ?? emptyChrome()), mounted: true, route: message.route },
            },
          }));
          maybeRaisePermissionSheet(deviceId, device.stateFlags, set, get);
          break;

        case 'preview:navigate': {
          set((current) => ({
            chrome: {
              ...current.chrome,
              [deviceId]: { ...(current.chrome[deviceId] ?? emptyChrome()), route: message.route },
            },
          }));
          void postEvent(projectId, {
            kind: 'navigation',
            name: `${device.name} → ${message.route}`,
            deviceId,
            screen: message.route,
            payload: { from: message.from, to: message.route },
          });
          recordStep(set, get, {
            kind: 'navigate',
            label: `${device.name}: go to ${message.route}`,
            deviceId,
            deviceRole: device.role,
            payload: { route: message.route },
          });
          if (state.compare.active && state.compare.syncNavigation) {
            for (const other of state.devices) {
              if (other.id === deviceId) continue;
              previewRegistry.post(other.id, { type: 'host:navigate', route: message.route });
            }
          }
          break;
        }

        case 'preview:interaction': {
          recordStep(set, get, {
            kind: message.action === 'input' ? 'input' : 'tap',
            label: `${device.name}: ${message.action === 'input' ? 'type into' : 'tap'} ${message.label ?? message.target ?? 'element'}`,
            deviceId,
            deviceRole: device.role,
            payload: {
              target: message.target,
              label: message.label,
              sourceRef: message.sourceRef,
            },
          });
          void postEvent(projectId, {
            kind: 'interaction',
            level: 'debug',
            name: `${device.name}: ${message.action} ${message.label ?? message.target ?? ''}`.trim(),
            deviceId,
            screen: message.route,
            payload: { sourceRef: message.sourceRef, target: message.target },
          });
          break;
        }

        case 'preview:emit': {
          const targets = resolveTargets(state.devices, deviceId, message.to);
          for (const target of targets) {
            previewRegistry.post(target.id, {
              type: 'host:event',
              event: {
                name: message.name,
                payload: message.payload,
                fromDeviceId: deviceId,
                fromRole: device.role,
                at: new Date().toISOString(),
              },
            });
          }
          void postEvent(projectId, {
            kind: 'device-event',
            name: message.name,
            deviceId,
            targetDeviceId: targets[0]?.id ?? null,
            payload: { to: message.to, recipients: targets.map((target) => target.name) },
          });
          recordStep(set, get, {
            kind: 'event',
            label: `${device.name} emits ${message.name}`,
            deviceId,
            deviceRole: device.role,
            payload: { eventName: message.name, payload: message.payload, to: message.to },
          });
          break;
        }

        case 'preview:notify': {
          const suppressed = device.stateFlags.includes('notifications-disabled');
          if (suppressed) {
            void postEvent(projectId, {
              kind: 'notification',
              level: 'warn',
              name: `Suppressed on ${device.name}: ${message.notification.title}`,
              deviceId,
              payload: { reason: 'notifications-disabled' },
            });
            break;
          }
          showNotification(deviceId, message.notification, set, get);
          void postEvent(projectId, {
            kind: 'notification',
            name: `${device.name}: ${message.notification.title}`,
            deviceId,
            payload: {
              body: message.notification.body,
              island: message.notification.island,
              kind: message.notification.kind,
            },
          });
          break;
        }

        case 'preview:shared-set': {
          const shared = { ...get().shared, [message.key]: message.value };
          set({ shared });
          // Broadcast to every *other* device: the sender already applied it.
          previewRegistry.broadcast(
            { type: 'host:shared', shared },
            get()
              .devices.map((entry) => entry.id)
              .filter((id) => id !== deviceId),
          );
          break;
        }

        case 'preview:log':
          void postEvent(projectId, {
            kind: 'runtime',
            level: message.level,
            name: `${device.name}: ${message.message}`,
            deviceId,
            payload: {},
          });
          break;

        case 'preview:error': {
          /*
           * A runtime exception is a real error and has to be counted as one.
           * This used to write only `chrome.lastError`, so the error counter's
           * runtime bucket was structurally always zero — it reported a
           * distinction it could never actually make.
           */
          const runtimeDiagnostic: Diagnostic = {
            severity: 'error',
            message: message.message,
            file: message.phase ? `${device.name} · ${message.phase}` : device.name,
            line: null,
            column: null,
            source: 'runtime',
          };

          set((current) => ({
            chrome: {
              ...current.chrome,
              [deviceId]: { ...(current.chrome[deviceId] ?? emptyChrome()), lastError: message.message },
            },
            // Keyed by device so a second exception on the same phone replaces the
            // first rather than piling up, while other phones keep theirs.
            diagnostics: [
              ...current.diagnostics.filter(
                (entry) => !(entry.source === 'runtime' && entry.file?.startsWith(device.name)),
              ),
              runtimeDiagnostic,
            ],
          }));
          void api(`/api/projects/${projectId}/preview/runtime-error`, {
            body: {
              deviceId,
              message: message.message,
              stack: message.stack,
              phase: message.phase,
              screen: get().chrome[deviceId]?.route ?? null,
            },
          }).catch(() => undefined);
          break;
        }

        case 'preview:inspect':
          set({
            inspector: {
              deviceId,
              sourceRef: message.sourceRef,
              label: message.label,
              rect: message.rect,
            },
            inspectMode: false,
          });
          previewRegistry.broadcast({ type: 'host:inspect', enabled: false });
          if (message.sourceRef) {
            const path = message.sourceRef.split(':')[0];
            if (path) void get().openFile(path);
          }
          break;

        case 'preview:snapshot':
          void api(`/api/projects/${projectId}/studio-rpc`, {
            body: { requestId: message.requestId, value: message.snapshot },
          }).catch(() => undefined);
          break;
      }
    },

    dismissNotification: (deviceId, notificationId) =>
      set((state) => {
        const chrome = state.chrome[deviceId];
        if (!chrome) return {};
        const notifications = chrome.notifications.filter((entry) => entry.id !== notificationId);
        return {
          chrome: {
            ...state.chrome,
            [deviceId]: {
              ...chrome,
              notifications,
              island: notifications.length === 0 ? IDLE_ISLAND : chrome.island,
            },
          },
        };
      }),

    resolveSheet: (deviceId, sheetId, allowed) => {
      const chrome = get().chrome[deviceId];
      set((state) => ({
        chrome: {
          ...state.chrome,
          [deviceId]: { ...(state.chrome[deviceId] ?? emptyChrome()), sheet: null },
        },
      }));
      // Allowing a permission clears the flag that raised the sheet, so the app
      // genuinely takes the other branch.
      if (allowed && chrome?.sheet?.flag) {
        const device = get().devices.find((entry) => entry.id === deviceId);
        if (device) {
          void get().patchDevice(deviceId, {
            stateFlags: device.stateFlags.filter((flag) => flag !== chrome.sheet?.flag),
          });
        }
      }
      void postEvent(get().snapshot.project.id, {
        kind: 'system',
        name: `${sheetId} ${allowed ? 'allowed' : 'denied'}`,
        deviceId,
        payload: {},
      });
    },

    /* ----------------------------------------------------------- inspector */

    setInspectMode: (enabled) => {
      set({ inspectMode: enabled, ...(enabled ? {} : { inspector: null }) });
      previewRegistry.broadcast({ type: 'host:inspect', enabled });
    },

    clearInspector: () => set({ inspector: null }),

    /* ------------------------------------------------------------ versions */

    createSnapshot: async (label, description) => {
      try {
        await api(`/api/projects/${get().snapshot.project.id}/versions`, {
          body: { label, description },
        });
        await get().refreshVersions();
        get().notify('success', `Version "${label}" created`);
      } catch (error) {
        get().notify('error', errorText(error));
      }
    },

    restoreVersion: async (versionId) => {
      try {
        const result = await api<{ filesWritten: number; safetySnapshotLabel: string }>(
          `/api/projects/${get().snapshot.project.id}/versions/${versionId}/restore`,
          { method: 'POST', body: { confirm: true } },
        );
        await Promise.all([get().refreshTree(), get().refreshVersions()]);
        set((state) => ({ openFiles: state.openFiles.map((file) => ({ ...file, content: null, draft: null })) }));
        for (const file of get().openFiles) void get().openFile(file.path);
        await get().rebuildAll(true);
        get().notify(
          'success',
          `Restored ${result.filesWritten} file(s). Previous state saved as "${result.safetySnapshotLabel}".`,
        );
      } catch (error) {
        get().notify('error', errorText(error));
      }
    },

    refreshVersions: async () => {
      try {
        const result = await api<{ versions: VersionSummary[] }>(
          `/api/projects/${get().snapshot.project.id}/versions`,
        );
        set({ versions: result.versions });
      } catch (error) {
        get().notify('error', errorText(error));
      }
    },

    refreshJourneys: async () => {
      try {
        const result = await api<{ journeys: JourneyRow[] }>(
          `/api/projects/${get().snapshot.project.id}/journeys`,
        );
        set({ journeys: result.journeys });
      } catch {
        // Non-critical.
      }
    },

    setCompare: (patch) => {
      set((state) => ({ compare: { ...state.compare, ...patch } }));
      const compare = get().compare;
      if (compare.active) {
        void get().ensureBundle(compare.baseRef);
        void get().ensureBundle(compare.targetRef);
      }
    },

    /* ------------------------------------------------- timeline & journeys */

    toggleTimeline: () => set((state) => ({ timelineOpen: !state.timelineOpen })),
    toggleEdgeCases: () => set((state) => ({ edgeCasesOpen: !state.edgeCasesOpen })),

    startRecording: () => {
      get().resetDevices(true);
      set({ recording: { active: true, startedAt: Date.now(), steps: [] } });
      get().notify('info', 'Recording — every tap, entry and event is captured.');
    },

    cancelRecording: () => set({ recording: null }),

    saveRecording: async (name, description) => {
      const recording = get().recording;
      if (!recording || recording.steps.length === 0) {
        get().notify('error', 'Nothing was recorded yet.');
        return;
      }
      try {
        await api(`/api/projects/${get().snapshot.project.id}/journeys`, {
          body: {
            name,
            description,
            steps: recording.steps.map((step) => ({
              kind: step.kind,
              label: step.label,
              deviceId: step.deviceId,
              deviceRole: step.deviceRole,
              payload: step.payload,
              waitMs: step.waitMs,
            })),
          },
        });
        set({ recording: null });
        await get().refreshJourneys();
        get().notify('success', `Journey "${name}" saved`);
      } catch (error) {
        get().notify('error', errorText(error));
      }
    },

    runJourney: async (journeyId, speed = 1) => {
      try {
        const result = await api<{ runId: string; steps: ReplayStepPlan[] }>(
          `/api/projects/${get().snapshot.project.id}/journeys/${journeyId}/run`,
          { body: { speed } },
        );
        set({
          replay: {
            runId: result.runId,
            journeyId,
            step: 0,
            total: result.steps.length,
            playing: true,
            speed,
          },
        });
        void executeReplay(result.runId, result.steps, get, set);
      } catch (error) {
        get().notify('error', errorText(error));
      }
    },

    stopReplay: () => {
      const replay = get().replay;
      set({ replay: null });
      if (replay?.runId) {
        void api(`/api/projects/${get().snapshot.project.id}/journeys/runs/${replay.runId}`, {
          method: 'PATCH',
          body: { status: 'stopped' },
        }).catch(() => undefined);
      }
    },

    /* ------------------------------------------------------------ realtime */

    appendEvent: (event) =>
      set((state) => ({
        events: [...state.events.filter((entry) => entry.id !== event.id), event].slice(-MAX_EVENTS),
      })),

    applyRealtime: (event, payload) => {
      const state = get();
      switch (event) {
        case 'event.logged': {
          const row = payload as DeviceEventRow;
          if (row && typeof row === 'object' && 'sequence' in row) state.appendEvent(row);
          break;
        }
        case 'tree.changed':
        case 'file.created':
        case 'file.deleted':
          void state.refreshTree();
          break;
        case 'file.changed': {
          const changed = payload as { path?: string; editor?: string };
          void state.refreshTree();
          // Reload an open tab that Claude just edited, unless it has unsaved work.
          if (changed?.path) {
            const open = state.openFiles.find((file) => file.path === changed.path);
            if (open && open.draft === null) {
              void state.openFile(changed.path).then(() => undefined);
              set((current) => ({
                openFiles: current.openFiles.map((file) =>
                  file.path === changed.path ? { ...file, content: null } : file,
                ),
              }));
              void state.openFile(changed.path);
            }
          }
          void state.rebuildAll(true);
          break;
        }
        case 'version.created':
        case 'version.restored':
          void state.refreshVersions();
          break;
        case 'device.changed': {
          const body = payload as { device?: DeviceRow; moved?: { id: string; x: number; y: number }[] };
          const incoming = body?.device;
          if (incoming) {
            set((current) => ({
              devices: current.devices.some((device) => device.id === incoming.id)
                ? current.devices.map((device) => (device.id === incoming.id ? incoming : device))
                : [...current.devices, incoming],
              chrome: current.chrome[incoming.id]
                ? current.chrome
                : { ...current.chrome, [incoming.id]: emptyChrome() },
            }));
            const device = get().devices.find((entry) => entry.id === incoming.id);
            if (device) {
              previewRegistry.post(device.id, { type: 'host:context', context: get().contextFor(device) });
            }
          }
          if (body?.moved) state.applyLocalPositions(body.moved);
          break;
        }
        case 'device.removed': {
          const body = payload as { deviceId?: string };
          if (body?.deviceId) {
            previewRegistry.unregister(body.deviceId);
            set((current) => ({
              devices: current.devices.filter((device) => device.id !== body.deviceId),
              selectedDeviceIds: current.selectedDeviceIds.filter((id) => id !== body.deviceId),
            }));
          }
          break;
        }
        case 'device.event': {
          const body = payload as {
            dispatch?: { name: string; payload: unknown; to: string; fromDeviceId: string | null; fromRole: string | null };
          };
          if (body?.dispatch) {
            const targets = resolveTargets(state.devices, body.dispatch.fromDeviceId, body.dispatch.to);
            for (const target of targets) {
              previewRegistry.post(target.id, {
                type: 'host:event',
                event: {
                  name: body.dispatch.name,
                  payload: body.dispatch.payload,
                  fromDeviceId: body.dispatch.fromDeviceId,
                  fromRole: body.dispatch.fromRole,
                  at: new Date().toISOString(),
                },
              });
            }
          }
          break;
        }
        case 'preview.changed': {
          const body = payload as { forceReload?: boolean };
          if (body?.forceReload) void state.rebuildAll(true);
          break;
        }
        case 'comment.changed':
          void refreshThreads(get, set);
          break;
        case 'journey.changed':
          void state.refreshJourneys();
          break;
        case 'studio.capture-device': {
          const body = payload as { deviceId?: string; requestId?: string };
          if (body?.deviceId && body.requestId) {
            previewRegistry.post(body.deviceId, { type: 'host:snapshot', requestId: body.requestId });
          }
          break;
        }
        case 'studio.refresh-devices': {
          const body = payload as { resetSharedState?: boolean; requestId?: string };
          const reloaded = state.resetDevices(Boolean(body?.resetSharedState));
          if (body?.requestId) {
            void api(`/api/projects/${state.snapshot.project.id}/studio-rpc`, {
              body: { requestId: body.requestId, value: { reloaded } },
            }).catch(() => undefined);
          }
          break;
        }
        case 'mcp.activity':
          // The Claude panel reads from `events`, which already received this.
          break;
      }
    },
  }));
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

type SetState = (partial: Partial<StudioStore> | ((state: StudioStore) => Partial<StudioStore>)) => void;
type GetState = () => StudioStore;

export interface ReplayStepPlan extends ReplayStep {
  index: number;
  waitMs: number;
  deviceId: string | null;
  deviceRole: string | null;
  description: string;
}

/** Which devices a `to` selector addresses. Never echoes back to the sender. */
function resolveTargets(devices: DeviceRow[], senderId: string | null, to: string): DeviceRow[] {
  const others = devices.filter((device) => device.id !== senderId);
  if (to === 'all' || to === '') return others;
  const byId = others.filter((device) => device.id === to);
  if (byId.length > 0) return byId;
  return others.filter((device) => device.role === to);
}

async function postEvent(
  projectId: string,
  input: {
    kind: DeviceEventRow['kind'];
    name: string;
    level?: DeviceEventRow['level'];
    deviceId?: string | null;
    targetDeviceId?: string | null;
    screen?: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await api(`/api/projects/${projectId}/events`, { body: input });
  } catch {
    // Timeline writes are best-effort; never break the preview because of one.
  }
}

function showNotification(
  deviceId: string,
  notification: PreviewNotification,
  set: SetState,
  get: GetState,
): void {
  set((state) => {
    const chrome = state.chrome[deviceId] ?? emptyChrome();
    const badges = notification.badge
      ? {
          ...chrome.badges,
          [notification.badge.key]: (chrome.badges[notification.badge.key] ?? 0) + notification.badge.value,
        }
      : chrome.badges;
    return {
      chrome: {
        ...state.chrome,
        [deviceId]: {
          ...chrome,
          notifications: [...chrome.notifications, notification].slice(-3),
          badges,
          island: {
            state: notification.island,
            label: notification.islandLabel ?? notification.title,
            detail: notification.body,
            progress: notification.island === 'activity' || notification.island === 'delivery' ? 0.35 : null,
            tone:
              notification.kind === 'success'
                ? 'success'
                : notification.kind === 'warning'
                  ? 'warning'
                  : notification.kind === 'error'
                    ? 'error'
                    : 'default',
          },
        },
      },
    };
  });

  window.setTimeout(() => {
    get().dismissNotification(deviceId, notification.id);
  }, notification.duration);

  // Long-running activities linger in the island after the banner goes away.
  const islandHold = notification.island === 'activity' || notification.island === 'delivery' ? 9_000 : notification.duration + 900;
  window.setTimeout(() => {
    set((state) => {
      const chrome = state.chrome[deviceId];
      if (!chrome || chrome.island.label !== (notification.islandLabel ?? notification.title)) return {};
      return {
        chrome: { ...state.chrome, [deviceId]: { ...chrome, island: IDLE_ISLAND } },
      };
    });
  }, islandHold);
}

function maybeRaisePermissionSheet(
  deviceId: string,
  flags: string[],
  set: SetState,
  get: GetState,
): void {
  const flag = flags.find((entry) => PERMISSION_SHEETS[entry]);
  if (!flag) return;
  const template = PERMISSION_SHEETS[flag];
  if (!template) return;
  const appName = get().snapshot.project.name;
  set((state) => ({
    chrome: {
      ...state.chrome,
      [deviceId]: {
        ...(state.chrome[deviceId] ?? emptyChrome()),
        sheet: {
          id: `${flag}-${deviceId}`,
          ...template,
          title: template.title.replace('{app}', appName),
        },
      },
    },
  }));
}

function recordStep(
  set: SetState,
  get: GetState,
  step: Omit<RecordedStep, 'waitMs' | 'at'>,
): void {
  const recording = get().recording;
  if (!recording?.active) return;
  const now = Date.now();
  const last = recording.steps[recording.steps.length - 1];
  const waitMs = last ? Math.min(Math.max(now - last.at, 0), 8_000) : 0;
  set({
    recording: {
      ...recording,
      steps: [...recording.steps, { ...step, waitMs, at: now }],
    },
  });
}

async function refreshThreads(get: GetState, set: SetState): Promise<void> {
  try {
    const result = await api<{ threads: ThreadWithComments[] }>(
      `/api/projects/${get().snapshot.project.id}/comments`,
    );
    set({ threads: result.threads });
  } catch {
    // Non-critical.
  }
}

/**
 * Replays a journey by driving the device iframes and reporting each step back to
 * the server, so `get_journey_report` over MCP sees real outcomes.
 */
async function executeReplay(
  runId: string,
  steps: ReplayStepPlan[],
  get: GetState,
  set: SetState,
): Promise<void> {
  const projectId = get().snapshot.project.id;
  get().resetDevices(true);
  await new Promise((resolve) => setTimeout(resolve, 500));

  for (const step of steps) {
    const replay = get().replay;
    if (!replay || replay.runId !== runId) return;

    while (get().replay?.playing === false) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (get().replay?.runId !== runId) return;
    }

    const speed = get().replay?.speed ?? 1;
    if (step.waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, step.waitMs / speed));
    }

    const target =
      get().devices.find((device) => device.id === step.deviceId) ??
      get().devices.find((device) => device.role === step.deviceRole) ??
      get().devices[0];

    const startedAt = Date.now();
    let status: 'ok' | 'error' | 'skipped' = 'ok';
    let message: string | null = null;

    if (!target) {
      status = 'skipped';
      message = 'No device on the canvas matched this step.';
    } else {
      set({ replay: { ...replay, step: step.index } });
      previewRegistry.post(target.id, { type: 'host:replay', step: stripPlan(step) });
      // Give the app a beat to react before judging the step.
      await new Promise((resolve) => setTimeout(resolve, 420 / speed));
      const chrome = get().chrome[target.id];
      if (chrome?.lastError) {
        status = 'error';
        message = chrome.lastError;
        set((state) => ({
          chrome: { ...state.chrome, [target.id]: { ...chrome, lastError: null } },
        }));
      }
    }

    await api(`/api/projects/${projectId}/journeys/runs/${runId}`, {
      method: 'PATCH',
      body: {
        currentStep: step.index,
        result: {
          index: step.index,
          kind: step.kind === 'assert' ? 'assert' : step.kind,
          label: step.description,
          status,
          message,
          at: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
        },
      },
    }).catch(() => undefined);
  }

  const failed = get().events.some((event) => event.level === 'error');
  await api(`/api/projects/${projectId}/journeys/runs/${runId}`, {
    method: 'PATCH',
    body: { status: failed ? 'completed' : 'completed', currentStep: steps.length },
  }).catch(() => undefined);

  set({ replay: null });
  get().notify('success', 'Journey replay finished.');
}

function stripPlan(step: ReplayStepPlan): ReplayStep {
  const { index: _index, waitMs: _wait, deviceId: _device, deviceRole: _role, description: _description, ...rest } = step;
  return rest;
}

/** Flags the phone chrome renders rather than the app. */
export const CHROME_FLAGS = new Set(
  EDGE_CASES.filter((entry) => entry.channel === 'chrome').map((entry) => entry.id),
);
