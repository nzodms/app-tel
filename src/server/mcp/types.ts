import type { z } from 'zod';
import type { Store } from '../db';
import type { Actor, Capability } from '../services/access';

/**
 * Tool definitions for the PhoneLab MCP server.
 *
 * The shape is intentionally opinionated so that every tool gets the same
 * treatment without repeating it 45 times:
 *
 *  - `input` is a Zod schema; the JSON Schema advertised in `tools/list` is
 *    generated from it, and arguments are validated against it before the handler
 *    runs (MCP "Servers MUST validate all tool inputs").
 *  - `capability` is checked against the caller's workspace role *and* the OAuth
 *    scopes on the token — a token can never exceed the member's own rights.
 *  - `destructive` tools must be called with `confirm: true`; the first call
 *    returns an actionable error instead of doing the damage.
 *  - every call is rate limited and written to the audit log.
 */

export interface ToolContext {
  store: Store;
  actor: Actor;
  /** Absolute origin of this deployment, for building links back into the studio. */
  baseUrl: string;
  protocolVersion: string;
}

export interface ToolOutcome {
  /** Human/model-readable summary. Always present. */
  text: string;
  /** Machine-readable result, returned as `structuredContent`. */
  data?: Record<string, unknown>;
  /** Set when the tool failed in a way the model can correct. */
  isError?: boolean;
}

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ToolDefinition<Schema extends z.ZodType = z.ZodType<any>> {
  name: string;
  title: string;
  description: string;
  input: Schema;
  capability: Capability;
  annotations: ToolAnnotations;
  /** Grouping used by the docs page and the studio's tool list. */
  group: 'projects' | 'files' | 'preview' | 'devices' | 'versions' | 'journeys' | 'sharing';
  /** Requires `confirm: true` before it will act. */
  destructive?: boolean;
  handler: (input: z.output<Schema>, context: ToolContext) => Promise<ToolOutcome>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineTool<Schema extends z.ZodType<any>>(
  definition: ToolDefinition<Schema>,
): ToolDefinition {
  return definition as unknown as ToolDefinition;
}

/** Compact helper for the common "return a summary + structured payload" case. */
export function outcome(text: string, data?: Record<string, unknown>): ToolOutcome {
  return data ? { text, data } : { text };
}
