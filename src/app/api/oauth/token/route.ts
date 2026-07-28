import { NextResponse } from 'next/server';
import { isAppError } from '@/server/core/errors';
import { getStore } from '@/server/db';
import { exchangeAuthorizationCode, exchangeRefreshToken } from '@/server/oauth/service';
import { baseUrlFrom, mcpResourceUri } from '@/server/oauth/urls';

/**
 * OAuth 2.1 token endpoint.
 *
 * Supports `authorization_code` (with mandatory PKCE `S256`) and `refresh_token`
 * (with rotation). Accepts `application/x-www-form-urlencoded`, as the spec
 * requires, and returns the OAuth error shapes rather than our own JSON envelope.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function oauthError(code: string, description: string, status = 400): Response {
  return NextResponse.json(
    { error: code, error_description: description },
    { status, headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } },
  );
}

/** Client credentials may arrive in the body or as HTTP Basic. */
function readClientAuth(
  request: Request,
  form: URLSearchParams,
): { clientId: string | null; clientSecret?: string } {
  const header = request.headers.get('authorization');
  const basic = header?.match(/^Basic\s+(.+)$/i)?.[1];
  if (basic) {
    try {
      const decoded = Buffer.from(basic, 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      if (separator > 0) {
        return {
          clientId: decodeURIComponent(decoded.slice(0, separator)),
          clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
        };
      }
    } catch {
      // Fall through to the form parameters.
    }
  }
  const clientId = form.get('client_id');
  const clientSecret = form.get('client_secret');
  return { clientId, ...(clientSecret ? { clientSecret } : {}) };
}

export async function POST(request: Request): Promise<Response> {
  const baseUrl = baseUrlFrom(request);
  const resource = mcpResourceUri(baseUrl);

  let form: URLSearchParams;
  const contentType = request.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('application/x-www-form-urlencoded')) {
      form = new URLSearchParams(await request.text());
    } else if (contentType.includes('application/json')) {
      // Not required by the spec, but several clients send JSON; accept it.
      const body = (await request.json()) as Record<string, unknown>;
      form = new URLSearchParams(
        Object.entries(body).map(([key, value]) => [key, String(value ?? '')]),
      );
    } else {
      return oauthError(
        'invalid_request',
        'Content-Type must be application/x-www-form-urlencoded.',
      );
    }
  } catch {
    return oauthError('invalid_request', 'Malformed request body.');
  }

  const grantType = form.get('grant_type');
  const { clientId, clientSecret } = readClientAuth(request, form);
  if (!clientId) return oauthError('invalid_client', 'client_id is required.', 401);

  const store = getStore();

  try {
    if (grantType === 'authorization_code') {
      const code = form.get('code');
      const redirectUri = form.get('redirect_uri');
      const codeVerifier = form.get('code_verifier');
      if (!code) return oauthError('invalid_request', 'code is required.');
      if (!redirectUri) return oauthError('invalid_request', 'redirect_uri is required.');
      if (!codeVerifier) {
        return oauthError('invalid_request', 'code_verifier is required (PKCE is mandatory).');
      }

      const tokens = await exchangeAuthorizationCode(
        store,
        {
          code,
          clientId,
          ...(clientSecret ? { clientSecret } : {}),
          redirectUri,
          codeVerifier,
          ...(form.get('resource') ? { resource: form.get('resource') as string } : {}),
        },
        resource,
      );
      return NextResponse.json(tokens, {
        headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
      });
    }

    if (grantType === 'refresh_token') {
      const refreshToken = form.get('refresh_token');
      if (!refreshToken) return oauthError('invalid_request', 'refresh_token is required.');
      const tokens = await exchangeRefreshToken(
        store,
        {
          refreshToken,
          clientId,
          ...(clientSecret ? { clientSecret } : {}),
          ...(form.get('resource') ? { resource: form.get('resource') as string } : {}),
        },
        resource,
      );
      return NextResponse.json(tokens, {
        headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
      });
    }

    return oauthError(
      'unsupported_grant_type',
      'Supported grant types: authorization_code, refresh_token.',
    );
  } catch (error) {
    if (isAppError(error)) {
      // Domain errors carry an OAuth code prefix, e.g. "invalid_grant: …".
      const match = /^([a-z_]+):\s*(.*)$/.exec(error.message);
      const code = match?.[1] ?? (error.code === 'unauthorized' ? 'invalid_client' : 'invalid_request');
      const description = match?.[2] ?? error.message;
      return oauthError(code, description, error.status === 401 ? 401 : 400);
    }
    console.error('[phonelab] token endpoint failure', error);
    return oauthError('server_error', 'Could not issue a token.', 500);
  }
}

export function OPTIONS(): Response {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
