import { afterEach, describe, expect, it } from 'vitest';
import { runTool } from '@/server/mcp/runner';
import { ALL_TOOLS } from '@/server/mcp/registry';
import { activityKind, activityTarget, type ClaudeActivity } from '@/server/mcp/activity';
import { RT, getBus, projectChannel } from '@/server/realtime/bus';
import { makeFixture, makeProject, type Fixture } from './helpers';
import type { ToolContext } from '@/server/mcp/types';

/**
 * Watching Claude work.
 *
 * The audit trail records a tool call after it returns, which is exactly too late
 * to watch. These events fire on both edges so the studio can show what is
 * happening while it happens — and the thing that makes that honest rather than
 * decorative is that every field is observed: the tool that really ran, the
 * argument it really ran on, the outcome it really had.
 */

let fixture: Fixture | null = null;
afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

function recorder(projectId: string) {
  const seen: ClaudeActivity[] = [];
  const stop = getBus().subscribe(projectChannel(projectId), (message) => {
    if (message.event === RT.claudeActivity) seen.push(message.payload as ClaudeActivity);
  });
  return { seen, stop };
}

async function setup() {
  fixture = await makeFixture();
  const { projectId } = await makeProject(fixture);
  const context: ToolContext = {
    store: fixture.store,
    actor: fixture.actor,
    baseUrl: 'http://localhost:3000',
    protocolVersion: '2025-11-25',
  };
  return { store: fixture.store, projectId, context };
}

describe('claude.activity', () => {
  it('fires a started and a finished, paired by call id', async () => {
    const { projectId, context } = await setup();
    const bus = recorder(projectId);
    try {
      await runTool('list_files', { projectId }, context);

      expect(bus.seen).toHaveLength(2);
      const [started, finished] = bus.seen;
      expect(started?.phase).toBe('started');
      expect(finished?.phase).toBe('finished');
      expect(started?.callId).toBe(finished?.callId);
      expect(started?.tool).toBe('list_files');
      expect(finished?.ok).toBe(true);
      expect(typeof finished?.durationMs).toBe('number');
    } finally {
      bus.stop();
    }
  });

  it('still closes the pair when the tool fails', async () => {
    const { projectId, context } = await setup();
    const bus = recorder(projectId);
    try {
      // A path that does not exist: a real failure, not a thrown protocol error.
      const result = await runTool(
        'read_file',
        { projectId, path: 'src/DoesNotExist.tsx' },
        context,
      );
      expect(result.isError).toBe(true);

      expect(bus.seen).toHaveLength(2);
      expect(bus.seen[1]?.phase).toBe('finished');
      expect(bus.seen[1]?.ok).toBe(false);
      expect(bus.seen[1]?.error).toBeTruthy();
      // A stuck "started" with no matching "finished" would leave the studio
      // claiming Claude is still working forever.
      expect(bus.seen[0]?.callId).toBe(bus.seen[1]?.callId);
    } finally {
      bus.stop();
    }
  });

  it('names what the call acted on, from the call itself', async () => {
    const { projectId, context } = await setup();
    const bus = recorder(projectId);
    try {
      await runTool(
        'write_file',
        { projectId, path: 'src/Scratch.tsx', content: 'export default () => null;' },
        context,
      );
      expect(bus.seen[0]?.target).toBe('src/Scratch.tsx');
      expect(bus.seen[0]?.kind).toBe('editing');
    } finally {
      bus.stop();
    }
  });

  it('says nothing at all when the call names no project', async () => {
    const { context } = await setup();
    if (!fixture) throw new Error('fixture');
    const { projectId } = await makeProject(fixture);
    const bus = recorder(projectId);
    try {
      await runTool('list_projects', {}, context);
      expect(bus.seen).toHaveLength(0);
    } finally {
      bus.stop();
    }
  });

  it('classifies every registered tool without a per-tool table', () => {
    const kinds = new Set(ALL_TOOLS.map((tool) => activityKind(tool)));
    // If a whole group ever fell through to 'other', the strip would go silent
    // about a real class of work.
    expect(kinds.has('reading')).toBe(true);
    expect(kinds.has('editing')).toBe(true);
    expect(kinds.has('building')).toBe(true);
    for (const tool of ALL_TOOLS) {
      expect(activityKind(tool), tool.name).not.toBe('other');
    }
  });

  it('picks the most specific target the arguments offer', () => {
    expect(activityTarget({ projectId: 'p', path: 'src/App.tsx' })).toBe('src/App.tsx');
    expect(activityTarget({ projectId: 'p', deviceId: 'dev_1' })).toBe('dev_1');
    expect(activityTarget({ projectId: 'p' })).toBeNull();
    expect(activityTarget({ path: '   ' })).toBeNull();
  });

  it('is a name the client subscribes to', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/components/studio/use-realtime.ts', import.meta.url), 'utf8'),
    );
    expect(source).toContain(`'${RT.claudeActivity}'`);
  });
});
