import { newId } from '../core/ids';
import { RT, getBus, projectChannel } from '../realtime/bus';
import type { Id } from '../db';
import type { ToolDefinition } from './types';

/**
 * What Claude is doing to a project, published as it happens.
 *
 * The audit trail already records every tool call — but it records it *after* the
 * call returns, which is exactly too late to watch. A studio that wants to show
 * "reading the project… editing three files… compiling…" needs the leading edge
 * too, and it needs the two edges tied together so a running step can be replaced
 * rather than appended.
 *
 * ## What is real here, and what is not
 *
 * Every field below is observed. `tool` is the tool that was actually invoked;
 * `target` is read out of the call's own arguments; `ok` and `durationMs` are the
 * real outcome. Nothing is inferred, sampled or smoothed.
 *
 * What is deliberately absent: any claim about Claude's reasoning. PhoneLab is on
 * the other side of an MCP connection and can see tool calls, nothing more. The
 * gap between one call finishing and the next starting is real and worth showing
 * — Claude is generating during it — but it is labelled as waiting, never as
 * "thinking", because we cannot see thinking and pretending otherwise is the kind
 * of invented signal this codebase refuses to ship.
 *
 * The `kind` is derived from the tool's own `group` and `readOnlyHint`, which are
 * declared next to each tool for the docs page and the permission model. Deriving
 * it means 45 tools did not need a new field, and a new tool is classified
 * correctly the moment it is written.
 */

export type ActivityKind =
  | 'reading'
  | 'editing'
  | 'building'
  | 'snapshotting'
  | 'arranging'
  | 'sharing'
  | 'other';

export interface ClaudeActivity {
  /** Ties `started` to its `finished`. */
  callId: Id;
  phase: 'started' | 'finished';
  kind: ActivityKind;
  tool: string;
  /** The tool's human title, e.g. "Patch a file". */
  title: string;
  /** What it acted on, straight out of the arguments. Null when it names nothing. */
  target: string | null;
  at: string;
  /** `finished` only. */
  ok?: boolean;
  durationMs?: number;
  /** `finished` only, and only when it failed. */
  error?: string | null;
}

/**
 * The tool's group and its read-only hint are enough: a `files` tool that only
 * reads is reading, one that writes is editing, and so on down the list. No
 * per-tool table to keep in sync.
 */
export function activityKind(tool: ToolDefinition): ActivityKind {
  const readOnly = tool.annotations.readOnlyHint === true;
  switch (tool.group) {
    case 'files':
      return readOnly ? 'reading' : 'editing';
    case 'projects':
      return readOnly ? 'reading' : 'editing';
    case 'preview':
      return 'building';
    case 'versions':
      return readOnly ? 'reading' : 'snapshotting';
    case 'devices':
      return readOnly ? 'reading' : 'arranging';
    case 'journeys':
      return readOnly ? 'reading' : 'arranging';
    case 'sharing':
      return readOnly ? 'reading' : 'sharing';
    default:
      return 'other';
  }
}

/**
 * The most specific thing the arguments name, in the order a person would care
 * about it. A path beats a device id beats the project itself.
 */
export function activityTarget(args: Record<string, unknown>): string | null {
  for (const key of ['path', 'to', 'from', 'label', 'deviceId', 'versionId', 'journeyId'] as const) {
    const value = args[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

export function newCallId(): Id {
  return newId('act');
}

/** No project, no channel: a call that names no project has nobody watching it. */
export function publishActivity(projectId: Id | null, activity: ClaudeActivity): void {
  if (!projectId) return;
  getBus().publish(projectChannel(projectId), RT.claudeActivity, activity);
}
