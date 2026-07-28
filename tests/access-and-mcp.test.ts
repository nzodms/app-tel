import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ALL_MCP_SCOPES,
  capabilitiesForScopes,
  parseScopeString,
  requireProjectAccess,
} from '@/server/services/access';
import { ALL_TOOLS, findTool, toolListing } from '@/server/mcp/registry';
import { runTool } from '@/server/mcp/runner';
import { redactArgs } from '@/server/services/audit';
import { signUp } from '@/server/services/auth';
import { getFile } from '@/server/services/files';
import { makeFixture, makeProject, type Fixture } from './helpers';

let fixture: Fixture | null = null;
afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

async function setup() {
  fixture = await makeFixture();
  const { projectId } = await makeProject(fixture);
  return { fixture, projectId, store: fixture.store, userId: fixture.userId };
}

describe('capabilities', () => {
  it('maps scopes to capabilities', () => {
    expect([...capabilitiesForScopes(['projects.read'])]).toEqual(['read']);
    expect([...capabilitiesForScopes(['projects.write'])].sort()).toEqual(['read', 'write']);
    expect(capabilitiesForScopes(['preview.run']).has('execute')).toBe(true);
    expect(capabilitiesForScopes(['share.manage']).has('share')).toBe(true);
  });

  it('ignores unknown scopes rather than granting them', () => {
    expect(parseScopeString('projects.read admin.everything')).toEqual(['projects.read']);
    expect(capabilitiesForScopes(['admin.everything']).size).toBe(0);
  });

  it('an MCP token can never exceed the member’s own rights', async () => {
    const { store, projectId, userId } = await setup();

    // Owner via a session: full rights.
    await expect(
      requireProjectAccess(store, { userId, via: 'session' }, projectId, 'write'),
    ).resolves.toBeTruthy();

    // Same owner, but a read-only token: write is refused.
    await expect(
      requireProjectAccess(
        store,
        { userId, via: 'mcp', scopes: ['projects.read'] },
        projectId,
        'write',
      ),
    ).rejects.toThrow(/missing the "write" capability/);
  });

  it('hides other tenants’ projects behind 404, not 403', async () => {
    const { store, projectId } = await setup();
    const stranger = await signUp(
      store,
      { name: 'Stranger', email: 'stranger@example.com', password: 'another-password' },
      null,
    );

    await expect(
      requireProjectAccess(store, { userId: stranger.user.id, via: 'session' }, projectId, 'read'),
    ).rejects.toThrow(/Project not found/);
  });
});

describe('tool registry', () => {
  it('covers every documented category', () => {
    const groups = new Set(ALL_TOOLS.map((tool) => tool.group));
    expect(groups).toEqual(
      new Set(['projects', 'files', 'preview', 'devices', 'versions', 'journeys', 'sharing']),
    );
  });

  it('exposes the tools the brief asks for', () => {
    const required = [
      'list_projects',
      'get_project',
      'create_project',
      'update_project',
      'duplicate_project',
      'archive_project',
      'list_files',
      'read_file',
      'read_files',
      'search_code',
      'write_file',
      'create_file',
      'apply_patch',
      'rename_file',
      'delete_file',
      'start_preview',
      'stop_preview',
      'restart_preview',
      'get_preview_status',
      'get_build_logs',
      'get_runtime_errors',
      'get_type_errors',
      'refresh_devices',
      'list_devices',
      'create_device',
      'update_device',
      'remove_device',
      'assign_device_role',
      'set_device_user',
      'set_device_state',
      'send_device_event',
      'capture_device',
      'create_snapshot',
      'list_versions',
      'get_version',
      'restore_version',
      'duplicate_version',
      'compare_versions',
      'create_journey',
      'update_journey',
      'run_journey',
      'pause_journey',
      'stop_journey',
      'get_journey_report',
      'compare_journeys',
      'create_share_link',
      'revoke_share_link',
      'list_comments',
      'get_comment',
      'resolve_comment',
      'create_task_from_comment',
    ];
    const present = new Set(ALL_TOOLS.map((tool) => tool.name));
    const missing = required.filter((name) => !present.has(name));
    expect(missing).toEqual([]);
  });

  it('advertises valid JSON Schema for every tool', () => {
    for (const listed of toolListing()) {
      expect(listed.inputSchema.type).toBe('object');
      expect(listed.name).toMatch(/^[A-Za-z0-9_.-]{1,128}$/);
      expect(listed.description.length).toBeGreaterThan(20);
    }
  });

  it('marks destructive tools and requires confirmation on them', () => {
    for (const tool of ALL_TOOLS) {
      if (tool.destructive) {
        expect(tool.annotations.destructiveHint).toBe(true);
        const shape = (tool.input as unknown as z.ZodObject<z.ZodRawShape>).shape;
        expect(Object.keys(shape)).toContain('confirm');
      }
      if (tool.annotations.readOnlyHint) {
        expect(tool.destructive).not.toBe(true);
      }
    }
  });
});

describe('tool runner', () => {
  const context = (fixtureValue: Fixture) => ({
    store: fixtureValue.store,
    actor: {
      userId: fixtureValue.userId,
      via: 'mcp' as const,
      scopes: ALL_MCP_SCOPES,
      connectionId: null,
    },
    baseUrl: 'https://phonelab.test',
    protocolVersion: '2025-11-25',
  });

  it('validates arguments before the handler runs', async () => {
    const setupResult = await setup();
    const result = await runTool('read_file', { projectId: 123 }, context(setupResult.fixture));
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Invalid arguments');
  });

  it('blocks a destructive tool without confirm, and the target survives', async () => {
    const { fixture: fixtureValue, projectId, store } = await setup();

    const blocked = await runTool(
      'delete_file',
      { projectId, path: 'src/App.tsx' },
      context(fixtureValue),
    );
    expect(blocked.isError).toBe(true);
    expect(blocked.content[0]?.text).toContain('confirm');
    await expect(getFile(store, projectId, 'src/App.tsx')).resolves.toBeTruthy();

    const allowed = await runTool(
      'delete_file',
      { projectId, path: 'src/App.tsx', confirm: true },
      context(fixtureValue),
    );
    expect(allowed.isError).toBeUndefined();
    await expect(getFile(store, projectId, 'src/App.tsx')).rejects.toThrow(/No file at/);
  });

  it('reports an unknown tool as a protocol error', async () => {
    const setupResult = await setup();
    await expect(runTool('no_such_tool', {}, context(setupResult.fixture))).rejects.toThrow(
      /Unknown tool/,
    );
  });

  it('returns structured content alongside text', async () => {
    const { fixture: fixtureValue, projectId } = await setup();
    const result = await runTool('list_files', { projectId }, context(fixtureValue));
    expect(result.isError).toBeUndefined();
    expect(Array.isArray(result.structuredContent?.files)).toBe(true);
    expect(result.content[0]?.text).toContain('file(s)');
  });

  it('writes an audit row for every call', async () => {
    const { fixture: fixtureValue, projectId, store, userId } = await setup();
    await runTool('list_files', { projectId }, context(fixtureValue));
    const rows = await store.select('mcpAuditLogs', { match: { userId } });
    expect(rows.some((row) => row.tool === 'list_files' && row.result === 'ok')).toBe(true);
  });

  it('finds tools by name', () => {
    expect(findTool('apply_patch')?.capability).toBe('write');
    expect(findTool('nope')).toBeUndefined();
  });
});

describe('audit redaction', () => {
  it('elides secrets and truncates long values', () => {
    const redacted = redactArgs({
      password: 'hunter2',
      apiKey: 'abc',
      content: 'x'.repeat(500),
      nested: { token: 'secret', keep: 'visible' },
      list: Array.from({ length: 30 }, (_, index) => index),
    });

    expect(redacted.password).toBe('[redacted]');
    expect(redacted.apiKey).toBe('[redacted]');
    expect(String(redacted.content)).toContain('(500 chars)');
    expect((redacted.nested as Record<string, unknown>).token).toBe('[redacted]');
    expect((redacted.nested as Record<string, unknown>).keep).toBe('visible');
    expect(redacted.list).toBe('[30 items]');
  });
});
