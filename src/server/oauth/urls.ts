/**
 * Canonical URLs for the OAuth 2.1 authorization server and the MCP resource.
 *
 * The MCP authorization spec requires the resource server to validate that an
 * access token was issued *for it* (RFC 8707 §2), which means we need one
 * canonical, stable identifier. Everything derives from `baseUrl`.
 */

/** Prefer explicit configuration; fall back to the forwarded request headers. */
export function baseUrlFrom(request: Request): string {
  const configured = process.env.PHONELAB_BASE_URL?.trim();
  if (configured) return stripTrailingSlash(configured);

  const url = new URL(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const host = forwardedHost ?? request.headers.get('host') ?? url.host;
  const proto = forwardedProto ?? (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  return stripTrailingSlash(`${proto}://${host}`);
}

export function stripTrailingSlash(input: string): string {
  return input.endsWith('/') ? input.slice(0, -1) : input;
}

/**
 * The MCP endpoint, which is also the OAuth *resource indicator*. No trailing
 * slash and no fragment, per RFC 8707 §2 / RFC 9728.
 */
export function mcpResourceUri(baseUrl: string): string {
  return `${stripTrailingSlash(baseUrl)}/api/mcp`;
}

export function oauthUrls(baseUrl: string) {
  const base = stripTrailingSlash(baseUrl);
  return {
    issuer: base,
    authorizationEndpoint: `${base}/oauth/authorize`,
    tokenEndpoint: `${base}/api/oauth/token`,
    registrationEndpoint: `${base}/api/oauth/register`,
    revocationEndpoint: `${base}/api/oauth/revoke`,
    resourceMetadata: `${base}/.well-known/oauth-protected-resource`,
    authorizationServerMetadata: `${base}/.well-known/oauth-authorization-server`,
    mcp: mcpResourceUri(base),
    documentation: `${base}/docs/mcp`,
  };
}

/**
 * `WWW-Authenticate` for a 401, pointing at the protected-resource metadata as
 * required by RFC 9728 §5.1.
 */
export function unauthorizedChallenge(
  baseUrl: string,
  scopes: readonly string[],
  error?: { code: string; description: string },
): string {
  const parts = [
    `Bearer resource_metadata="${oauthUrls(baseUrl).resourceMetadata}"`,
    `scope="${scopes.join(' ')}"`,
  ];
  if (error) {
    parts.push(`error="${error.code}"`, `error_description="${error.description}"`);
  }
  return parts.join(', ');
}

/** `WWW-Authenticate` for a 403 insufficient_scope response (RFC 6750 §3.1). */
export function insufficientScopeChallenge(
  baseUrl: string,
  requiredScopes: readonly string[],
  description: string,
): string {
  return [
    'Bearer error="insufficient_scope"',
    `error_description="${description.replace(/"/g, "'")}"`,
    `scope="${requiredScopes.join(' ')}"`,
    `resource_metadata="${oauthUrls(baseUrl).resourceMetadata}"`,
  ].join(', ');
}
