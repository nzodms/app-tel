import { z } from 'zod';
import { badRequest, forbidden, notFound, unauthorized } from '../core/errors';
import { hashSecret, sha256, sha256Base64Url, verifySecret } from '../core/crypto';
import { newId, newToken } from '../core/ids';
import type { Id, McpConnectionRow, OauthClientRow, OauthTokenRow, Store } from '../db';
import { ALL_MCP_SCOPES, isMcpScope, type Actor, type McpScope } from '../services/access';

/**
 * A minimal but spec-shaped OAuth 2.1 authorization server, so PhoneLab can be
 * added to Claude as a custom connector.
 *
 * Implements what the MCP authorization spec requires of the server side:
 *  - Dynamic Client Registration (RFC 7591) at `/api/oauth/register`
 *  - authorization code + PKCE, `S256` only (OAuth 2.1 drops implicit and plain)
 *  - exact redirect-URI matching
 *  - the `resource` parameter (RFC 8707) recorded on codes and tokens, and
 *    validated as the token audience on every MCP request
 *  - refresh tokens with rotation
 *
 * Tokens are opaque and stored only as SHA-256 hashes, so a database dump does
 * not hand over live credentials.
 */

const CODE_TTL_MS = 60_000; // short-lived, single use
const ACCESS_TTL_MS = 60 * 60_000; // 1 hour
const REFRESH_TTL_MS = 30 * 86_400_000; // 30 days

/* -------------------------------------------------------------------------- */
/* Client registration                                                         */
/* -------------------------------------------------------------------------- */

export const registrationSchema = z.object({
  client_name: z.string().trim().min(1).max(120).optional(),
  redirect_uris: z.array(z.string().url()).min(1, 'At least one redirect_uri is required.').max(10),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.enum(['none', 'client_secret_post', 'client_secret_basic']).optional(),
  scope: z.string().optional(),
  software_id: z.string().max(120).optional(),
});

export interface RegisteredClient {
  client_id: string;
  client_secret?: string;
  client_id_issued_at: number;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  scope: string;
}

export async function registerClient(
  store: Store,
  input: z.infer<typeof registrationSchema>,
): Promise<RegisteredClient> {
  const parsed = registrationSchema.parse(input);

  for (const uri of parsed.redirect_uris) {
    assertSafeRedirectUri(uri);
  }

  const authMethod = parsed.token_endpoint_auth_method ?? 'none';
  const grantTypes = parsed.grant_types ?? ['authorization_code', 'refresh_token'];
  const unsupported = grantTypes.filter(
    (grant) => grant !== 'authorization_code' && grant !== 'refresh_token',
  );
  if (unsupported.length > 0) {
    throw badRequest(
      `Unsupported grant_types: ${unsupported.join(', ')}. This server supports authorization_code and refresh_token.`,
    );
  }

  const requestedScopes = parsed.scope ? parsed.scope.split(/\s+/).filter(isMcpScope) : ALL_MCP_SCOPES;
  const scope = (requestedScopes.length > 0 ? requestedScopes : ALL_MCP_SCOPES).join(' ');

  const clientId = `plc_${newToken(16)}`;
  // Public clients (the PKCE case, which is what Claude uses) get no secret. When
  // one is requested we return the plaintext exactly once and store only its hash.
  const rawSecret = authMethod === 'none' ? undefined : newToken(32);
  const secretRecord = rawSecret ? await hashSecret(rawSecret) : null;

  const row: OauthClientRow = {
    id: newId('oac'),
    clientId,
    clientName: parsed.client_name ?? 'MCP client',
    redirectUris: parsed.redirect_uris,
    clientSecretHash: secretRecord?.hash ?? null,
    clientSecretSalt: secretRecord?.salt ?? null,
    tokenEndpointAuthMethod: authMethod,
    grantTypes,
    responseTypes: parsed.response_types ?? ['code'],
    scope,
    softwareId: parsed.software_id ?? null,
    createdAt: new Date().toISOString(),
  };

  await store.insert('oauthClients', row);

  return {
    client_id: clientId,
    ...(rawSecret ? { client_secret: rawSecret } : {}),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: row.clientName,
    redirect_uris: row.redirectUris,
    grant_types: row.grantTypes,
    response_types: row.responseTypes,
    token_endpoint_auth_method: row.tokenEndpointAuthMethod,
    scope: row.scope,
  };
}

export async function getClient(store: Store, clientId: string): Promise<OauthClientRow> {
  const client = await store.find('oauthClients', { match: { clientId } });
  if (!client) throw badRequest('Unknown client_id. Register the client first.');
  return client;
}

/**
 * Blocks the redirect targets that make open-redirection and SSRF easy. Loopback
 * and custom schemes are allowed because that is how desktop MCP clients work.
 */
function assertSafeRedirectUri(uri: string): void {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw badRequest(`"${uri}" is not a valid absolute URI.`);
  }
  if (parsed.hash) throw badRequest('redirect_uri must not contain a fragment.');

  const isHttps = parsed.protocol === 'https:';
  const isLoopbackHttp =
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]');
  const isCustomScheme = !parsed.protocol.startsWith('http');

  if (!isHttps && !isLoopbackHttp && !isCustomScheme) {
    throw badRequest('redirect_uri must use https, a loopback http address, or a custom scheme.');
  }
}

/* -------------------------------------------------------------------------- */
/* Authorization codes                                                         */
/* -------------------------------------------------------------------------- */

export const authorizeParamsSchema = z.object({
  response_type: z.literal('code', { message: 'Only response_type=code is supported.' }),
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal('S256', {
    message: 'Only code_challenge_method=S256 is supported.',
  }),
  scope: z.string().optional(),
  state: z.string().max(500).optional(),
  resource: z.string().optional(),
});

export type AuthorizeParams = z.infer<typeof authorizeParamsSchema>;

export interface AuthorizeRequestContext {
  client: OauthClientRow;
  params: AuthorizeParams;
  scopes: McpScope[];
  resource: string;
}

/**
 * Validates an authorization request before showing the consent screen. Anything
 * wrong with `client_id`/`redirect_uri` must be shown to the *user*, never
 * redirected — otherwise the server becomes an open redirector.
 */
export async function prepareAuthorization(
  store: Store,
  raw: Record<string, string | undefined>,
  canonicalResource: string,
): Promise<AuthorizeRequestContext> {
  const params = authorizeParamsSchema.parse(raw);
  const client = await getClient(store, params.client_id);

  if (!client.redirectUris.includes(params.redirect_uri)) {
    throw badRequest(
      'redirect_uri does not exactly match a registered redirect URI for this client.',
    );
  }

  const requested = params.scope ? params.scope.split(/\s+/).filter((entry) => entry !== '') : [];
  const allowed = client.scope.split(/\s+/).filter(isMcpScope);
  const scopes = (requested.length > 0 ? requested.filter(isMcpScope) : allowed).filter((scope) =>
    allowed.includes(scope),
  );
  if (scopes.length === 0) {
    throw badRequest('None of the requested scopes are available for this client.');
  }

  // RFC 8707: the token must be bound to this server. Accept a missing `resource`
  // (older clients) but never a mismatched one.
  const resource = params.resource ?? canonicalResource;
  if (normaliseResource(resource) !== normaliseResource(canonicalResource)) {
    throw badRequest(
      `resource "${resource}" is not this MCP server. Expected "${canonicalResource}".`,
    );
  }

  return { client, params, scopes, resource: canonicalResource };
}

export async function issueAuthorizationCode(
  store: Store,
  context: AuthorizeRequestContext,
  userId: Id,
  approvedScopes: readonly McpScope[],
): Promise<string> {
  const code = newToken(32);
  await store.insert('oauthCodes', {
    id: newId('ocd'),
    codeHash: sha256(code),
    clientId: context.client.clientId,
    userId,
    redirectUri: context.params.redirect_uri,
    codeChallenge: context.params.code_challenge,
    codeChallengeMethod: 'S256',
    scope: approvedScopes.join(' '),
    resource: context.resource,
    expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    usedAt: null,
    createdAt: new Date().toISOString(),
  });
  return code;
}

/* -------------------------------------------------------------------------- */
/* Token endpoint                                                              */
/* -------------------------------------------------------------------------- */

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export async function exchangeAuthorizationCode(
  store: Store,
  input: {
    code: string;
    clientId: string;
    clientSecret?: string;
    redirectUri: string;
    codeVerifier: string;
    resource?: string;
  },
  canonicalResource: string,
): Promise<TokenResponse> {
  const client = await getClient(store, input.clientId);
  await assertClientAuthenticated(client, input.clientSecret);

  const record = await store.find('oauthCodes', { match: { codeHash: sha256(input.code) } });
  if (!record) throw badRequest('invalid_grant: unknown authorization code.');

  // Single use: a replayed code invalidates the whole grant.
  if (record.usedAt) {
    await revokeTokensForGrant(store, record.clientId, record.userId);
    throw badRequest('invalid_grant: this authorization code was already used.');
  }
  if (new Date(record.expiresAt).getTime() <= Date.now()) {
    throw badRequest('invalid_grant: the authorization code has expired.');
  }
  if (record.clientId !== input.clientId) {
    throw badRequest('invalid_grant: the code was issued to a different client.');
  }
  if (record.redirectUri !== input.redirectUri) {
    throw badRequest('invalid_grant: redirect_uri does not match the authorization request.');
  }
  if (sha256Base64Url(input.codeVerifier) !== record.codeChallenge) {
    throw badRequest('invalid_grant: PKCE verification failed.');
  }
  if (input.resource && normaliseResource(input.resource) !== normaliseResource(record.resource)) {
    throw badRequest('invalid_target: resource does not match the authorization request.');
  }

  await store.update('oauthCodes', record.id, { usedAt: new Date().toISOString() });

  const connection = await upsertConnection(store, {
    userId: record.userId,
    clientId: record.clientId,
    name: client.clientName,
    scopes: record.scope.split(' ').filter(isMcpScope),
  });

  return issueTokenPair(store, {
    userId: record.userId,
    clientId: record.clientId,
    connectionId: connection.id,
    scope: record.scope,
    resource: canonicalResource,
  });
}

export async function exchangeRefreshToken(
  store: Store,
  input: { refreshToken: string; clientId: string; clientSecret?: string; resource?: string },
  canonicalResource: string,
): Promise<TokenResponse> {
  const client = await getClient(store, input.clientId);
  await assertClientAuthenticated(client, input.clientSecret);

  const record = await store.find('oauthTokens', {
    match: { tokenHash: sha256(input.refreshToken), kind: 'refresh' },
  });
  if (!record) throw badRequest('invalid_grant: unknown refresh token.');
  if (record.revokedAt) throw badRequest('invalid_grant: this refresh token was revoked.');
  if (record.clientId !== input.clientId) {
    throw badRequest('invalid_grant: the refresh token belongs to a different client.');
  }
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) {
    throw badRequest('invalid_grant: the refresh token has expired.');
  }

  // Rotation: the presented refresh token is retired as part of the exchange.
  await store.update('oauthTokens', record.id, { revokedAt: new Date().toISOString() });

  return issueTokenPair(store, {
    userId: record.userId,
    clientId: record.clientId,
    connectionId: record.connectionId,
    scope: record.scope,
    resource: canonicalResource,
  });
}

async function issueTokenPair(
  store: Store,
  grant: {
    userId: Id;
    clientId: string;
    connectionId: Id | null;
    scope: string;
    resource: string;
  },
): Promise<TokenResponse> {
  const accessToken = `pla_${newToken(32)}`;
  const refreshToken = `plr_${newToken(32)}`;
  const now = new Date().toISOString();

  await store.insertMany('oauthTokens', [
    {
      id: newId('otk'),
      tokenHash: sha256(accessToken),
      kind: 'access',
      clientId: grant.clientId,
      userId: grant.userId,
      connectionId: grant.connectionId,
      scope: grant.scope,
      resource: grant.resource,
      expiresAt: new Date(Date.now() + ACCESS_TTL_MS).toISOString(),
      revokedAt: null,
      createdAt: now,
      lastUsedAt: null,
      displayHint: null,
    },
    {
      id: newId('otk'),
      tokenHash: sha256(refreshToken),
      kind: 'refresh',
      clientId: grant.clientId,
      userId: grant.userId,
      connectionId: grant.connectionId,
      scope: grant.scope,
      resource: grant.resource,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS).toISOString(),
      revokedAt: null,
      createdAt: now,
      lastUsedAt: null,
      displayHint: null,
    },
  ]);

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope: grant.scope,
  };
}

async function assertClientAuthenticated(
  client: OauthClientRow,
  presentedSecret: string | undefined,
): Promise<void> {
  if (client.tokenEndpointAuthMethod === 'none') return;
  if (!presentedSecret) throw unauthorized('invalid_client: client authentication required.');
  if (!client.clientSecretHash || !client.clientSecretSalt) {
    throw unauthorized('invalid_client: no secret is configured for this client.');
  }
  const ok = await verifySecret(presentedSecret, client.clientSecretHash, client.clientSecretSalt);
  if (!ok) throw unauthorized('invalid_client: client authentication failed.');
}

/* -------------------------------------------------------------------------- */
/* Bearer token validation (the MCP resource-server side)                      */
/* -------------------------------------------------------------------------- */

export interface ResolvedToken {
  actor: Actor;
  token: OauthTokenRow;
  connection: McpConnectionRow | null;
}

/**
 * Validates an access token for *this* resource.
 *
 * Audience binding is the important part: a token minted for another resource is
 * rejected even if it is otherwise valid (RFC 8707 §2, and the "confused deputy"
 * mitigation in the MCP security guidance).
 */
export async function resolveAccessToken(
  store: Store,
  presented: string,
  canonicalResource: string,
): Promise<ResolvedToken> {
  const token = await store.find('oauthTokens', {
    match: { tokenHash: sha256(presented), kind: 'access' },
  });
  if (!token) throw unauthorized('invalid_token: unknown access token.');
  if (token.revokedAt) throw unauthorized('invalid_token: this token was revoked.');
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()) {
    throw unauthorized('invalid_token: the access token has expired.');
  }
  if (normaliseResource(token.resource) !== normaliseResource(canonicalResource)) {
    throw forbidden('invalid_token: this token was not issued for this MCP server.');
  }

  const connection = token.connectionId
    ? await store.find('mcpConnections', { match: { id: token.connectionId } })
    : null;
  if (connection?.revokedAt) {
    throw unauthorized('invalid_token: this connection was revoked in PhoneLab.');
  }

  const user = await store.find('users', { match: { id: token.userId } });
  if (!user) throw unauthorized('invalid_token: the account no longer exists.');

  await store.update('oauthTokens', token.id, { lastUsedAt: new Date().toISOString() });

  return {
    actor: {
      userId: token.userId,
      via: 'mcp',
      scopes: token.scope.split(' ').filter(isMcpScope),
      connectionId: token.connectionId,
    },
    token,
    connection: connection ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Connections (what the user sees and manages in the UI)                      */
/* -------------------------------------------------------------------------- */

async function upsertConnection(
  store: Store,
  input: { userId: Id; clientId: string; name: string; scopes: McpScope[] },
): Promise<McpConnectionRow> {
  const existing = await store.find('mcpConnections', {
    match: { userId: input.userId, clientId: input.clientId },
  });
  if (existing) {
    return store.update('mcpConnections', existing.id, {
      scopes: input.scopes,
      revokedAt: null,
      name: input.name,
    });
  }
  const row: McpConnectionRow = {
    id: newId('mcn'),
    userId: input.userId,
    clientId: input.clientId,
    name: input.name,
    scopes: input.scopes,
    lastUsedAt: null,
    createdAt: new Date().toISOString(),
    revokedAt: null,
    protocolVersion: null,
    toolCallCount: 0,
  };
  await store.insert('mcpConnections', row);
  return row;
}

export async function listConnections(store: Store, userId: Id): Promise<McpConnectionRow[]> {
  return store.select('mcpConnections', {
    match: { userId },
    orderBy: [{ col: 'createdAt', dir: 'desc' }],
  });
}

export async function revokeConnection(
  store: Store,
  userId: Id,
  connectionId: Id,
): Promise<McpConnectionRow> {
  const connection = await store.find('mcpConnections', { match: { id: connectionId, userId } });
  if (!connection) throw notFound('Connection not found.');
  const now = new Date().toISOString();
  await store.updateWhere(
    'oauthTokens',
    { match: { connectionId }, where: [{ col: 'revokedAt', op: 'isNull' }] },
    { revokedAt: now },
  );
  return store.update('mcpConnections', connectionId, { revokedAt: now });
}

export async function touchConnection(
  store: Store,
  connectionId: Id | null | undefined,
  protocolVersion: string | null,
): Promise<void> {
  if (!connectionId) return;
  const connection = await store.find('mcpConnections', { match: { id: connectionId } });
  if (!connection) return;
  await store.update('mcpConnections', connectionId, {
    lastUsedAt: new Date().toISOString(),
    toolCallCount: connection.toolCallCount + 1,
    ...(protocolVersion ? { protocolVersion } : {}),
  });
}

async function revokeTokensForGrant(store: Store, clientId: string, userId: Id): Promise<void> {
  await store.updateWhere(
    'oauthTokens',
    { match: { clientId, userId }, where: [{ col: 'revokedAt', op: 'isNull' }] },
    { revokedAt: new Date().toISOString() },
  );
}

/* -------------------------------------------------------------------------- */
/* Personal access tokens (for local testing with MCP Inspector / curl)        */
/* -------------------------------------------------------------------------- */

export const PAT_CLIENT_ID = 'phonelab-personal-token';

/**
 * A long-lived token the user can mint from the UI to test the MCP server
 * without running the full OAuth dance. Still audience-bound and scoped, still
 * revocable, still audited — it is the same validation path, just a different way
 * of obtaining a token.
 */
export async function createPersonalToken(
  store: Store,
  userId: Id,
  input: { name: string; scopes: McpScope[]; resource: string; days?: number },
): Promise<{ token: string; row: OauthTokenRow }> {
  const scopes = input.scopes.filter(isMcpScope);
  if (scopes.length === 0) throw badRequest('Select at least one scope.');

  const connection = await upsertConnection(store, {
    userId,
    clientId: `${PAT_CLIENT_ID}:${newToken(6)}`,
    name: input.name.trim().slice(0, 80) || 'Personal token',
    scopes,
  });

  const token = `plp_${newToken(32)}`;
  const row: OauthTokenRow = {
    id: newId('otk'),
    tokenHash: sha256(token),
    kind: 'access',
    clientId: connection.clientId,
    userId,
    connectionId: connection.id,
    scope: scopes.join(' '),
    resource: input.resource,
    expiresAt: new Date(Date.now() + (input.days ?? 90) * 86_400_000).toISOString(),
    revokedAt: null,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    displayHint: `${token.slice(0, 8)}…${token.slice(-4)}`,
  };
  await store.insert('oauthTokens', row);
  return { token, row };
}

/** RFC 8707 recommends the no-trailing-slash form; compare case-insensitively. */
function normaliseResource(uri: string): string {
  try {
    const url = new URL(uri);
    const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
    return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${path}`;
  } catch {
    return uri.trim().toLowerCase().replace(/\/$/, '');
  }
}
