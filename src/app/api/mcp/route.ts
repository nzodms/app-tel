import { NextResponse } from 'next/server';
import { isAppError } from '@/server/core/errors';
import { getStore } from '@/server/db';
import {
  JSONRPC_ERRORS,
  SUPPORTED_PROTOCOL_VERSIONS,
  failure,
  handleRpc,
  isJsonRpcRequest,
  isNotification,
} from '@/server/mcp/server';
import { resolveAccessToken } from '@/server/oauth/service';
import { ALL_MCP_SCOPES } from '@/server/services/access';
import {
  baseUrlFrom,
  insufficientScopeChallenge,
  mcpResourceUri,
  unauthorizedChallenge,
} from '@/server/oauth/urls';

/**
 * The MCP endpoint — Streamable HTTP, per the 2025-11-25 specification.
 *
 * Shape of this implementation:
 *  - POST accepts exactly one JSON-RPC message and answers with
 *    `Content-Type: application/json` (the spec allows a single JSON object as an
 *    alternative to opening an SSE stream). Notifications get `202 Accepted`.
 *  - GET returns 405, which the spec defines as "this server does not offer an SSE
 *    stream at this endpoint". Nothing here needs server-initiated messages.
 *  - No `Mcp-Session-Id` is issued: the server is stateless, so every request
 *    carries its own bearer token and nothing needs pinning to an instance. The
 *    spec makes session ids optional (MAY).
 *  - The `Origin` header is validated when present, to block DNS rebinding.
 *  - `MCP-Protocol-Version` is validated; an unsupported value is 400.
 *
 * Authorization is OAuth 2.1 bearer, audience-bound to this exact URL.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1_000_000;

function corsHeaders(origin: string | null): Record<string, string> {
  // Claude connects server-to-server, so CORS is only needed for browser-based
  // inspectors. Echo the origin we already validated rather than using `*`.
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version, Mcp-Session-Id',
    'Access-Control-Expose-Headers': 'WWW-Authenticate, MCP-Protocol-Version',
    'Access-Control-Max-Age': '600',
  };
}

/** Same-origin, loopback and the configured base URL are acceptable origins. */
function originAllowed(origin: string, baseUrl: string): boolean {
  try {
    const candidate = new URL(origin);
    if (candidate.origin === new URL(baseUrl).origin) return true;
    return candidate.hostname === 'localhost' || candidate.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<Response> {
  const baseUrl = baseUrlFrom(request);
  const resource = mcpResourceUri(baseUrl);
  const origin = request.headers.get('origin');

  if (origin && !originAllowed(origin, baseUrl)) {
    // Spec: "If the Origin header is present and invalid, servers MUST respond
    // with HTTP 403 Forbidden."
    return NextResponse.json(
      failure(null, JSONRPC_ERRORS.invalidRequest, 'Origin not allowed.'),
      { status: 403 },
    );
  }

  const protocolHeader = request.headers.get('mcp-protocol-version');
  if (protocolHeader && !(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(protocolHeader)) {
    return NextResponse.json(
      failure(
        null,
        JSONRPC_ERRORS.invalidRequest,
        `Unsupported MCP-Protocol-Version "${protocolHeader}". Supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}.`,
      ),
      { status: 400, headers: corsHeaders(origin) },
    );
  }

  const authorization = request.headers.get('authorization');
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!bearer) {
    return new NextResponse(
      JSON.stringify(
        failure(null, JSONRPC_ERRORS.invalidRequest, 'Authorization required. Connect PhoneLab as a connector in Claude.'),
      ),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': unauthorizedChallenge(baseUrl, ALL_MCP_SCOPES),
          ...corsHeaders(origin),
        },
      },
    );
  }

  const store = getStore();

  let resolved;
  try {
    resolved = await resolveAccessToken(store, bearer, resource);
  } catch (error) {
    const message = isAppError(error) ? error.message : 'Token validation failed.';
    const status = isAppError(error) && error.code === 'forbidden' ? 403 : 401;
    return new NextResponse(JSON.stringify(failure(null, JSONRPC_ERRORS.invalidRequest, message)), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate':
          status === 403
            ? insufficientScopeChallenge(baseUrl, ALL_MCP_SCOPES, message)
            : unauthorizedChallenge(baseUrl, ALL_MCP_SCOPES, {
                code: 'invalid_token',
                description: message,
              }),
        ...corsHeaders(origin),
      },
    });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      failure(null, JSONRPC_ERRORS.invalidRequest, 'Request body is too large.'),
      { status: 413, headers: corsHeaders(origin) },
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json(failure(null, JSONRPC_ERRORS.parseError, 'Body must be valid JSON.'), {
      status: 400,
      headers: corsHeaders(origin),
    });
  }

  if (Array.isArray(payload)) {
    // The 2025-11-25 revision removed JSON-RPC batching.
    return NextResponse.json(
      failure(
        null,
        JSONRPC_ERRORS.invalidRequest,
        'JSON-RPC batching is not supported. Send one message per request.',
      ),
      { status: 400, headers: corsHeaders(origin) },
    );
  }

  if (!isJsonRpcRequest(payload)) {
    return NextResponse.json(
      failure(null, JSONRPC_ERRORS.invalidRequest, 'Not a valid JSON-RPC 2.0 message.'),
      { status: 400, headers: corsHeaders(origin) },
    );
  }

  const protocolVersion = protocolHeader ?? '2025-03-26';

  const response = await handleRpc(payload, {
    store,
    actor: resolved.actor,
    baseUrl,
    protocolVersion,
  });

  if (response === null || isNotification(payload)) {
    // Spec: accepted notification/response → 202 with no body.
    return new NextResponse(null, { status: 202, headers: corsHeaders(origin) });
  }

  return NextResponse.json(response, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      ...corsHeaders(origin),
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  // Spec: 405 means "no SSE stream at this endpoint".
  return new NextResponse(
    JSON.stringify({
      error: 'method_not_allowed',
      message:
        'This MCP endpoint does not offer a server-initiated SSE stream. POST JSON-RPC messages instead.',
    }),
    {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        Allow: 'POST, OPTIONS',
        ...corsHeaders(request.headers.get('origin')),
      },
    },
  );
}

export async function DELETE(request: Request): Promise<Response> {
  // No sessions are issued, so there is nothing to terminate. The spec allows 405.
  return new NextResponse(null, {
    status: 405,
    headers: { Allow: 'POST, OPTIONS', ...corsHeaders(request.headers.get('origin')) },
  });
}

export async function OPTIONS(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  const baseUrl = baseUrlFrom(request);
  if (origin && !originAllowed(origin, baseUrl)) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}
