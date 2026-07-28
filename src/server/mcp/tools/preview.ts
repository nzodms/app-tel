import { z } from 'zod';
import { requireProjectAccess } from '../../services/access';
import { buildPreview, listBuildRuns, previewStatus, startPreview, stopPreview } from '../../services/preview';
import { listEvents } from '../../services/events';
import { RT, getBus, projectChannel } from '../../realtime/bus';
import { STUDIO_RPC, askStudio } from '../../realtime/rpc';
import { defineTool, outcome } from '../types';

const projectIdSchema = z.string().min(1).describe('PhoneLab project id.');
const refSchema = z
  .string()
  .min(1)
  .optional()
  .describe('Version id to build, or "working" (default) for the live working tree.');

function normaliseRef(ref: string | undefined): 'working' | string {
  return !ref || ref === 'working' ? 'working' : ref;
}

export const previewTools = [
  defineTool({
    name: 'start_preview',
    title: 'Start preview',
    description:
      'Compiles the project and marks its preview session running. Returns build diagnostics — call this after editing code to check your change actually compiles.',
    group: 'preview',
    capability: 'execute',
    annotations: { readOnlyHint: false, idempotentHint: true },
    input: z.object({ projectId: projectIdSchema, versionId: refSchema }).strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'execute');
      const { session, build } = await startPreview(
        store,
        input.projectId,
        normaliseRef(input.versionId),
        'claude',
      );

      if (!build.ok) {
        return {
          text: [
            `The build failed, so the preview is not running.`,
            '',
            ...build.diagnostics.map(
              (diagnostic) =>
                `${diagnostic.severity}: ${diagnostic.file ?? '?'}${diagnostic.line ? `:${diagnostic.line}` : ''} — ${diagnostic.message}`,
            ),
          ].join('\n'),
          data: { sessionId: session.id, status: session.status, diagnostics: build.diagnostics },
          isError: true,
        };
      }

      return outcome(
        `Preview running. Built in ${build.durationMs}ms (${(build.bytes / 1024).toFixed(1)} kB)${build.cached ? ', from cache' : ''}. Any open studio reloads its phones.`,
        {
          sessionId: session.id,
          status: session.status,
          bundleHash: build.hash,
          durationMs: build.durationMs,
          bytes: build.bytes,
          cached: build.cached,
          diagnostics: build.diagnostics,
        },
      );
    },
  }),

  defineTool({
    name: 'restart_preview',
    title: 'Restart preview',
    description:
      'Forces a fresh compile and tells every open studio to reload its phones. Use it when the preview looks stale.',
    group: 'preview',
    capability: 'execute',
    annotations: { readOnlyHint: false, idempotentHint: false },
    input: z.object({ projectId: projectIdSchema, versionId: refSchema }).strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'execute');
      const ref = normaliseRef(input.versionId);
      await stopPreview(store, input.projectId, ref);
      const { build } = await startPreview(store, input.projectId, ref, 'claude');
      getBus().publish(projectChannel(input.projectId), RT.previewChanged, {
        status: build.ok ? 'running' : 'error',
        hash: build.hash,
        ref,
        forceReload: true,
      });
      return outcome(
        build.ok
          ? `Restarted the preview (${build.durationMs}ms).`
          : `Restart attempted but the build failed: ${build.diagnostics[0]?.message ?? 'unknown error'}`,
        { ok: build.ok, diagnostics: build.diagnostics, bundleHash: build.hash },
      );
    },
  }),

  defineTool({
    name: 'stop_preview',
    title: 'Stop preview',
    description: 'Marks the preview session stopped. The phones stay on the canvas showing their last render.',
    group: 'preview',
    capability: 'execute',
    annotations: { readOnlyHint: false, idempotentHint: true },
    input: z.object({ projectId: projectIdSchema, versionId: refSchema }).strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'execute');
      const stopped = await stopPreview(store, input.projectId, normaliseRef(input.versionId));
      return outcome(`Stopped ${stopped} preview session(s).`, { stopped });
    },
  }),

  defineTool({
    name: 'get_preview_status',
    title: 'Preview status',
    description: 'Current preview sessions, the last build result, and any diagnostics still outstanding.',
    group: 'preview',
    capability: 'read',
    annotations: { readOnlyHint: true, idempotentHint: true },
    input: z.object({ projectId: projectIdSchema }).strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'read');
      const status = await previewStatus(store, input.projectId);
      const running = status.sessions.filter((session) => session.status === 'running');

      return outcome(
        [
          `Preview sessions: ${status.sessions.length} (${running.length} running).`,
          status.lastBuild
            ? `Last build: ${status.lastBuild.status}${status.lastBuild.durationMs ? ` in ${status.lastBuild.durationMs}ms` : ''} at ${status.lastBuild.startedAt}, triggered by ${status.lastBuild.triggeredBy}.`
            : 'This project has never been built.',
          status.diagnostics.length > 0
            ? `Diagnostics:\n${status.diagnostics.map((d) => `  ${d.severity}: ${d.file ?? '?'}${d.line ? `:${d.line}` : ''} — ${d.message}`).join('\n')}`
            : 'No diagnostics.',
        ].join('\n'),
        {
          sessions: status.sessions.map((session) => ({
            id: session.id,
            versionId: session.versionId,
            status: session.status,
            bundleHash: session.bundleHash,
            error: session.error,
          })),
          lastBuild: status.lastBuild,
          diagnostics: status.diagnostics,
        },
      );
    },
  }),

  defineTool({
    name: 'get_build_logs',
    title: 'Build logs',
    description: 'Recent build runs with status, duration and diagnostics.',
    group: 'preview',
    capability: 'read',
    annotations: { readOnlyHint: true, idempotentHint: true },
    input: z
      .object({
        projectId: projectIdSchema,
        limit: z.number().int().min(1).max(50).optional().describe('Defaults to 10.'),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'read');
      const runs = await listBuildRuns(store, input.projectId, input.limit ?? 10);
      const lines = runs.map(
        (run) =>
          `${run.startedAt} · ${run.status}${run.durationMs ? ` · ${run.durationMs}ms` : ''} · by ${run.triggeredBy}` +
          `${run.diagnostics.length > 0 ? ` · ${run.diagnostics.length} diagnostic(s)` : ''}`,
      );
      return outcome(runs.length === 0 ? 'No builds recorded yet.' : lines.join('\n'), { runs });
    },
  }),

  defineTool({
    name: 'get_runtime_errors',
    title: 'Runtime errors',
    description:
      'Errors thrown inside running previews — the exceptions the phones actually hit, reported by the preview bridge, with the device and screen they happened on.',
    group: 'preview',
    capability: 'read',
    annotations: { readOnlyHint: true, idempotentHint: true },
    input: z
      .object({
        projectId: projectIdSchema,
        limit: z.number().int().min(1).max(100).optional().describe('Defaults to 20.'),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'read');
      const events = await listEvents(store, input.projectId, {
        kinds: ['error', 'runtime'],
        levels: ['error', 'warn'],
        limit: input.limit ?? 20,
      });
      if (events.length === 0) {
        return outcome('No runtime errors recorded.', { errors: [] });
      }
      const lines = events.map(
        (event) =>
          `${event.createdAt} · ${event.name}${event.screen ? ` (screen ${event.screen})` : ''}${event.deviceId ? ` [${event.deviceId}]` : ''}`,
      );
      return outcome(`${events.length} runtime error(s):\n${lines.join('\n')}`, {
        errors: events.map((event) => ({
          at: event.createdAt,
          message: event.name,
          deviceId: event.deviceId,
          screen: event.screen,
          detail: event.payload,
        })),
      });
    },
  }),

  defineTool({
    name: 'get_type_errors',
    title: 'Compiler diagnostics',
    description:
      'Compiler diagnostics from the last build. Note: PhoneLab compiles with esbuild, which reports syntax and resolution errors but does NOT perform TypeScript type checking — types are stripped, not verified. Do not treat an empty result as "types are correct".',
    group: 'preview',
    capability: 'read',
    annotations: { readOnlyHint: true, idempotentHint: true },
    input: z.object({ projectId: projectIdSchema, versionId: refSchema }).strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'read');
      const build = await buildPreview(store, input.projectId, normaliseRef(input.versionId), 'claude');
      const errors = build.diagnostics.filter((d) => d.severity === 'error');
      const warnings = build.diagnostics.filter((d) => d.severity === 'warning');

      return outcome(
        [
          build.ok
            ? 'The project compiles. (esbuild: syntax and imports only — no type checking.)'
            : 'The project does not compile.',
          ...build.diagnostics.map(
            (d) => `${d.severity}: ${d.file ?? '?'}${d.line ? `:${d.line}:${d.column ?? 0}` : ''} — ${d.message}`,
          ),
        ].join('\n'),
        {
          compiles: build.ok,
          typeCheckingPerformed: false,
          errors,
          warnings,
        },
      );
    },
  }),

  defineTool({
    name: 'refresh_devices',
    title: 'Refresh devices',
    description:
      'Asks every open studio to reload the phones from the latest build, resetting their in-app state. Useful after a change that alters startup behaviour.',
    group: 'preview',
    capability: 'execute',
    annotations: { readOnlyHint: false, idempotentHint: false },
    input: z
      .object({
        projectId: projectIdSchema,
        resetSharedState: z
          .boolean()
          .optional()
          .describe('Also clear state shared between phones. Defaults to false.'),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'execute');
      const answer = await askStudio<{ reloaded: number }>(
        input.projectId,
        STUDIO_RPC.refreshDevices,
        { resetSharedState: input.resetSharedState ?? false },
        5_000,
      );

      if (!answer.ok) {
        return outcome(
          'No PhoneLab studio is currently open for this project, so there was nothing to refresh. The next tab to open will build from the latest code.',
          { reloaded: 0, studioConnected: false },
        );
      }
      return outcome(`Refreshed ${answer.value?.reloaded ?? 0} device(s).`, {
        reloaded: answer.value?.reloaded ?? 0,
        studioConnected: true,
      });
    },
  }),
];
