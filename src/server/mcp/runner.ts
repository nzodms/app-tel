import { z } from 'zod';
import { AppError, isAppError } from '../core/errors';
import { LIMITS } from '../core/limits';
import type { Store } from '../db';
import { checkRateLimit, recordToolCall } from '../services/audit';
import { touchConnection } from '../oauth/service';
import { findTool } from './registry';
import {
  activityKind,
  activityTarget,
  newCallId,
  publishActivity,
  type ClaudeActivity,
} from './activity';
import type { ToolContext, ToolOutcome } from './types';

/**
 * The single path every tool call takes.
 *
 * Validation → rate limit → destructive-confirmation gate → handler → audit.
 * Doing this centrally is what makes the security story checkable: there is one
 * place to read, not 45.
 */

export interface CallResult {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export async function runTool(
  name: string,
  rawArguments: unknown,
  context: ToolContext,
): Promise<CallResult> {
  const tool = findTool(name);
  if (!tool) {
    // Unknown tool is a *protocol* error, surfaced by the caller as -32602.
    throw new AppError('bad_request', `Unknown tool: ${name}`);
  }

  const startedAt = Date.now();
  const rateKey = `mcp:${context.actor.connectionId ?? context.actor.userId}`;
  const limit = checkRateLimit(rateKey, LIMITS.mcpCallsPerMinute);
  if (!limit.allowed) {
    const message = `Rate limit reached (${LIMITS.mcpCallsPerMinute} tool calls/minute). Try again in ${Math.ceil(limit.resetInMs / 1000)}s.`;
    await audit(context, tool.name, {}, 'denied', message, Date.now() - startedAt);
    return errorResult(message);
  }

  let input: unknown;
  try {
    input = tool.input.parse(rawArguments ?? {});
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? `Invalid arguments for ${tool.name}: ${error.issues
            .map((issue) => `${issue.path.join('.') || '(root)'} — ${issue.message}`)
            .join('; ')}`
        : `Invalid arguments for ${tool.name}.`;
    await audit(context, tool.name, asRecord(rawArguments), 'error', message, Date.now() - startedAt);
    return errorResult(message);
  }

  const args = asRecord(input);
  const projectId = typeof args.projectId === 'string' ? args.projectId : null;

  // Destructive tools need an explicit go-ahead. The first call explains what
  // would happen instead of doing it.
  if (tool.destructive && args.confirm !== true) {
    const message =
      `${tool.name} is destructive and was not executed. ` +
      `Re-send the same call with "confirm": true if this is intended. ` +
      `(Target: ${describeTarget(args)})`;
    await audit(context, tool.name, args, 'denied', message, Date.now() - startedAt, projectId);
    return errorResult(message);
  }

  // Both edges of the call, so the studio can show work in progress rather than a
  // list of work already done. Published before the handler runs — this is the
  // only place that knows a call has *started*.
  const callId = newCallId();
  const activity: Omit<ClaudeActivity, 'phase' | 'at'> = {
    callId,
    kind: activityKind(tool),
    tool: tool.name,
    title: tool.title,
    target: activityTarget(args),
  };
  publishActivity(projectId, { ...activity, phase: 'started', at: new Date().toISOString() });

  const finish = (ok: boolean, error: string | null) =>
    publishActivity(projectId, {
      ...activity,
      phase: 'finished',
      at: new Date().toISOString(),
      ok,
      durationMs: Date.now() - startedAt,
      error,
    });

  try {
    const result: ToolOutcome = await tool.handler(input, context);
    finish(!result.isError, result.isError ? result.text : null);
    await audit(
      context,
      tool.name,
      args,
      result.isError ? 'error' : 'ok',
      result.isError ? result.text : null,
      Date.now() - startedAt,
      projectId,
    );
    await touchConnection(context.store, context.actor.connectionId, context.protocolVersion);

    return {
      content: [{ type: 'text', text: result.text }],
      ...(result.data ? { structuredContent: result.data } : {}),
      ...(result.isError ? { isError: true } : {}),
    };
  } catch (error) {
    const message = toToolErrorMessage(error);
    finish(false, message);
    await audit(
      context,
      tool.name,
      args,
      isAppError(error) && error.code === 'forbidden' ? 'denied' : 'error',
      message,
      Date.now() - startedAt,
      projectId,
    );
    return errorResult(message);
  }
}

/**
 * Tool execution errors go back as `isError: true` results rather than JSON-RPC
 * errors: per the spec these are the ones a model can act on and retry.
 */
function errorResult(text: string): CallResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function toToolErrorMessage(error: unknown): string {
  if (isAppError(error)) {
    const details = error.details ? ` ${JSON.stringify(error.details)}` : '';
    return `${error.message}${details}`;
  }
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  }
  if (error instanceof Error) return error.message;
  return 'The tool failed for an unknown reason.';
}

function describeTarget(args: Record<string, unknown>): string {
  const keys = ['path', 'deviceId', 'shareId', 'versionId', 'projectId'];
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value !== '') return `${key}=${value}`;
  }
  return 'unspecified';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

async function audit(
  context: ToolContext,
  tool: string,
  args: Record<string, unknown>,
  result: 'ok' | 'error' | 'denied',
  errorMessage: string | null,
  durationMs: number,
  projectId: string | null = null,
): Promise<void> {
  try {
    await recordToolCall(context.store as Store, {
      userId: context.actor.userId,
      projectId,
      connectionId: context.actor.connectionId ?? null,
      tool,
      args,
      result,
      errorMessage,
      durationMs,
    });
  } catch (error) {
    // Never let audit failures mask a tool result; log and move on.
    console.error('[phonelab] failed to write audit row', error);
  }
}
