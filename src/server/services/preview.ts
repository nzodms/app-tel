import { newId } from '../core/ids';
import type {
  BuildRunRow,
  Diagnostic,
  EditorKind,
  Id,
  PreviewSessionRow,
  ProjectRow,
  Store,
} from '../db';
import { RT, getBus, projectChannel } from '../realtime/bus';
import { bundleProject, type BundleResult } from '../preview/bundler';
import { listFiles } from './files';
import { getProject } from './projects';
import { versionFiles } from './versions';
import { logEvent } from './events';

/**
 * Preview orchestration.
 *
 * Level 1 (what ships): compile the project with esbuild on the server, hand the
 * output to a sandboxed iframe. esbuild only parses and transforms — no user code
 * runs in this process.
 *
 * Level 2 (not built yet): the same `PreviewDriver` shape is meant to be
 * implemented by a cloud sandbox that installs dependencies and returns a preview
 * URL. `docs/ARCHITECTURE.md` describes the seam; `docs/STATUS.md` is explicit
 * that it is not implemented.
 */

export interface PreviewDriver {
  readonly id: 'browser' | 'cloud-sandbox';
  build(input: { files: { path: string; content: string }[]; entry: string }): Promise<BundleResult>;
}

/** The only driver implemented in V1. */
export const browserDriver: PreviewDriver = {
  id: 'browser',
  build: ({ files, entry }) => bundleProject(files, entry),
};

/* -------------------------------------------------------------------------- */
/* Bundle cache                                                                */
/* -------------------------------------------------------------------------- */

interface CacheEntry {
  key: string;
  result: BundleResult;
  builtAt: number;
}

const CACHE_LIMIT = 24;
const globalRef = globalThis as typeof globalThis & {
  __phonelabBundleCache?: Map<string, CacheEntry>;
};

function cache(): Map<string, CacheEntry> {
  if (!globalRef.__phonelabBundleCache) globalRef.__phonelabBundleCache = new Map();
  return globalRef.__phonelabBundleCache;
}

/** Cache key = project + version ref + a fingerprint of the exact sources. */
function fingerprint(files: readonly { path: string; content: string }[], entry: string): string {
  const parts = [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => `${file.path}:${file.content.length}`);
  return `${entry}|${parts.join('|')}`;
}

/* -------------------------------------------------------------------------- */
/* Building                                                                    */
/* -------------------------------------------------------------------------- */

export type BuildRef = 'working' | Id;

export interface BuildOutcome {
  ok: boolean;
  code: string;
  hash: string;
  diagnostics: Diagnostic[];
  bytes: number;
  durationMs: number;
  cached: boolean;
  buildRun: BuildRunRow;
  entry: string;
}

/**
 * Compiles the working tree (or a snapshot) and records a build run.
 *
 * The same content compiled twice returns the cached output with `cached: true`
 * and does not create a duplicate build run — moving a phone or opening a second
 * tab must not trigger work.
 */
export async function buildPreview(
  store: Store,
  projectId: Id,
  ref: BuildRef,
  triggeredBy: EditorKind,
): Promise<BuildOutcome> {
  const project = await getProject(store, projectId);
  const { files, entry } = await sourcesFor(store, project, ref);

  const key = `${projectId}:${ref}:${fingerprint(files, entry)}`;
  const cached = cache().get(key);

  if (cached) {
    const latest = await store.find('buildRuns', {
      match: { projectId },
      orderBy: [{ col: 'startedAt', dir: 'desc' }],
    });
    if (latest) {
      return {
        ok: cached.result.ok,
        code: cached.result.code,
        hash: cached.result.hash,
        diagnostics: cached.result.diagnostics,
        bytes: cached.result.bytes,
        durationMs: cached.result.durationMs,
        cached: true,
        buildRun: latest,
        entry,
      };
    }
  }

  const startedAt = new Date().toISOString();
  const running: BuildRunRow = {
    id: newId('bld'),
    projectId,
    previewSessionId: null,
    versionId: ref === 'working' ? null : ref,
    status: 'running',
    startedAt,
    finishedAt: null,
    durationMs: null,
    diagnostics: [],
    bundleBytes: null,
    triggeredBy,
  };
  await store.insert('buildRuns', running);

  const bus = getBus();
  bus.publish(projectChannel(projectId), RT.buildStarted, {
    buildId: running.id,
    ref,
    triggeredBy,
  });

  const result = await browserDriver.build({ files, entry });

  const finished = await store.update('buildRuns', running.id, {
    status: result.ok ? 'success' : 'error',
    finishedAt: new Date().toISOString(),
    durationMs: result.durationMs,
    diagnostics: result.diagnostics,
    bundleBytes: result.bytes,
  });

  if (result.ok) {
    // Only successful builds are worth caching; failures are cheap to redo and we
    // want the diagnostics to re-fire.
    const entries = cache();
    entries.set(key, { key, result, builtAt: Date.now() });
    if (entries.size > CACHE_LIMIT) {
      const oldest = [...entries.values()].sort((a, b) => a.builtAt - b.builtAt)[0];
      if (oldest) entries.delete(oldest.key);
    }
  }

  bus.publish(projectChannel(projectId), RT.buildFinished, {
    buildId: finished.id,
    ok: result.ok,
    hash: result.hash,
    durationMs: result.durationMs,
    diagnosticCount: result.diagnostics.length,
    bytes: result.bytes,
  });

  await logEvent(store, projectId, {
    kind: 'build',
    level: result.ok ? 'info' : 'error',
    name: result.ok
      ? `Build succeeded in ${result.durationMs}ms`
      : `Build failed: ${result.diagnostics[0]?.message ?? 'unknown error'}`,
    payload: {
      ref,
      triggeredBy,
      diagnostics: result.diagnostics.slice(0, 5),
      bytes: result.bytes,
    },
  });

  return {
    ok: result.ok,
    code: result.code,
    hash: result.hash,
    diagnostics: result.diagnostics,
    bytes: result.bytes,
    durationMs: result.durationMs,
    cached: false,
    buildRun: finished,
    entry,
  };
}

async function sourcesFor(
  store: Store,
  project: ProjectRow,
  ref: BuildRef,
): Promise<{ files: { path: string; content: string }[]; entry: string }> {
  if (ref === 'working') {
    const files = await listFiles(store, project.id);
    return {
      files: files.map((file) => ({ path: file.path, content: file.content })),
      entry: project.entryFile,
    };
  }
  const files = await versionFiles(store, ref);
  return {
    files: files.map((file) => ({ path: file.path, content: file.content })),
    entry: project.entryFile,
  };
}

/* -------------------------------------------------------------------------- */
/* Preview sessions                                                            */
/* -------------------------------------------------------------------------- */

export async function startPreview(
  store: Store,
  projectId: Id,
  ref: BuildRef,
  triggeredBy: EditorKind,
): Promise<{ session: PreviewSessionRow; build: BuildOutcome }> {
  const build = await buildPreview(store, projectId, ref, triggeredBy);

  const existing = await store.find('previewSessions', {
    match: { projectId, versionId: ref === 'working' ? null : ref },
    where: [{ col: 'stoppedAt', op: 'isNull' }],
    orderBy: [{ col: 'startedAt', dir: 'desc' }],
  });

  const session = existing
    ? await store.update('previewSessions', existing.id, {
        status: build.ok ? 'running' : 'error',
        bundleHash: build.hash || null,
        error: build.ok ? null : (build.diagnostics[0]?.message ?? 'Build failed'),
      })
    : await store.insert('previewSessions', {
        id: newId('prv'),
        projectId,
        versionId: ref === 'working' ? null : ref,
        status: build.ok ? 'running' : 'error',
        bundleHash: build.hash || null,
        startedAt: new Date().toISOString(),
        stoppedAt: null,
        error: build.ok ? null : (build.diagnostics[0]?.message ?? 'Build failed'),
      });

  if (build.buildRun.previewSessionId !== session.id) {
    await store.update('buildRuns', build.buildRun.id, { previewSessionId: session.id });
  }

  getBus().publish(projectChannel(projectId), RT.previewChanged, {
    sessionId: session.id,
    status: session.status,
    hash: session.bundleHash,
    ref,
  });

  return { session, build };
}

export async function stopPreview(store: Store, projectId: Id, ref: BuildRef): Promise<number> {
  const sessions = await store.select('previewSessions', {
    match: { projectId, versionId: ref === 'working' ? null : ref },
    where: [{ col: 'stoppedAt', op: 'isNull' }],
  });
  const now = new Date().toISOString();
  for (const session of sessions) {
    await store.update('previewSessions', session.id, { status: 'stopped', stoppedAt: now });
  }
  getBus().publish(projectChannel(projectId), RT.previewChanged, { status: 'stopped', ref });
  return sessions.length;
}

export async function previewStatus(
  store: Store,
  projectId: Id,
): Promise<{
  sessions: PreviewSessionRow[];
  lastBuild: BuildRunRow | null;
  diagnostics: Diagnostic[];
}> {
  const [sessions, lastBuild] = await Promise.all([
    store.select('previewSessions', {
      match: { projectId },
      orderBy: [{ col: 'startedAt', dir: 'desc' }],
      limit: 10,
    }),
    store.find('buildRuns', {
      match: { projectId },
      orderBy: [{ col: 'startedAt', dir: 'desc' }],
    }),
  ]);
  return { sessions, lastBuild, diagnostics: lastBuild?.diagnostics ?? [] };
}

export async function listBuildRuns(
  store: Store,
  projectId: Id,
  limit = 20,
): Promise<BuildRunRow[]> {
  return store.select('buildRuns', {
    match: { projectId },
    orderBy: [{ col: 'startedAt', dir: 'desc' }],
    limit,
  });
}

/** Runtime errors are reported by the preview bridge and logged as events. */
export async function recordRuntimeError(
  store: Store,
  projectId: Id,
  input: { deviceId: Id | null; message: string; stack: string | null; phase: string; screen: string | null },
): Promise<void> {
  await logEvent(store, projectId, {
    kind: 'error',
    level: 'error',
    name: input.message.slice(0, 200),
    deviceId: input.deviceId,
    screen: input.screen,
    payload: { stack: input.stack?.slice(0, 4_000) ?? null, phase: input.phase },
  });
}
