import { toolListing } from './registry';
import { runTool } from './runner';
import type { ToolContext } from './types';

/**
 * JSON-RPC 2.0 method dispatch for the PhoneLab MCP server.
 *
 * Protocol revision: 2025-11-25 (with 2025-06-18 and 2025-03-26 accepted for
 * older clients). Capabilities are honest — we declare `tools` only, because
 * that is all this server implements today.
 */

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

export const SERVER_INFO = {
  name: 'phonelab',
  title: 'PhoneLab',
  version: '0.1.0',
} as const;

export const JSONRPC_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export type JsonRpcId = string | number | null;

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { jsonrpc?: unknown; method?: unknown };
  return candidate.jsonrpc === '2.0' && typeof candidate.method === 'string';
}

/** A notification has no `id` and expects no response (HTTP 202). */
export function isNotification(request: JsonRpcRequest): boolean {
  return request.id === undefined;
}

export function success(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result };
}

export function failure(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcFailure {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } };
}

export function negotiateProtocolVersion(requested: unknown): string {
  if (typeof requested === 'string' && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)) {
    return requested;
  }
  return LATEST_PROTOCOL_VERSION;
}

/**
 * Handles one JSON-RPC request. Returns `null` for notifications, which the
 * transport turns into `202 Accepted` with no body.
 */
export async function handleRpc(
  request: JsonRpcRequest,
  context: ToolContext,
): Promise<JsonRpcResponse | null> {
  const id = request.id ?? null;

  switch (request.method) {
    case 'initialize': {
      const params = (request.params ?? {}) as { protocolVersion?: unknown };
      const version = negotiateProtocolVersion(params.protocolVersion);
      return success(id, {
        protocolVersion: version,
        capabilities: {
          // No `listChanged`: the tool list is static for a given deployment, so
          // advertising change notifications would be a lie.
          tools: {},
        },
        serverInfo: SERVER_INFO,
        instructions:
          'PhoneLab is the visual studio for a mobile app project: files, previews on simulated phones, ' +
          'versions, journeys and reviewer comments. Typical flow: list_projects → get_project → ' +
          'search_code / read_file → apply_patch → start_preview (check diagnostics) → create_snapshot. ' +
          'Use list_comments to pick up reviewer feedback, and capture_device to see what a phone is showing.',
      });
    }

    case 'notifications/initialized':
    case 'notifications/cancelled':
    case 'notifications/progress':
      return null;

    case 'ping':
      return success(id, {});

    case 'tools/list':
      return success(id, { tools: toolListing() });

    case 'tools/call': {
      const params = (request.params ?? {}) as { name?: unknown; arguments?: unknown };
      if (typeof params.name !== 'string') {
        return failure(id, JSONRPC_ERRORS.invalidParams, 'tools/call requires a string "name".');
      }
      try {
        const result = await runTool(params.name, params.arguments, context);
        return success(id, result);
      } catch (error) {
        // Only genuinely unknown tools reach here; everything else is reported as
        // an `isError` tool result so the model can self-correct.
        const message = error instanceof Error ? error.message : 'Tool call failed.';
        return failure(id, JSONRPC_ERRORS.invalidParams, message);
      }
    }

    // Declared-but-unimplemented surfaces answer honestly rather than pretending.
    case 'resources/list':
    case 'resources/templates/list':
    case 'prompts/list':
      return failure(
        id,
        JSONRPC_ERRORS.methodNotFound,
        `PhoneLab does not implement ${request.method}. This server exposes tools only.`,
      );

    default:
      return failure(id, JSONRPC_ERRORS.methodNotFound, `Unknown method: ${request.method}`);
  }
}
