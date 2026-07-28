import { NextResponse } from 'next/server';
import { ALL_MCP_SCOPES } from '@/server/services/access';
import { baseUrlFrom, mcpResourceUri, oauthUrls } from '@/server/oauth/urls';

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728).
 *
 * MCP clients discover this either from the `resource_metadata` parameter of our
 * 401 `WWW-Authenticate` header, or by probing this well-known path. The sibling
 * route under `/api/mcp` covers the path-suffixed form clients try first.
 */
export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  const baseUrl = baseUrlFrom(request);
  const urls = oauthUrls(baseUrl);

  return NextResponse.json(
    {
      resource: mcpResourceUri(baseUrl),
      authorization_servers: [urls.issuer],
      scopes_supported: ALL_MCP_SCOPES,
      bearer_methods_supported: ['header'],
      resource_name: 'PhoneLab',
      resource_documentation: urls.documentation,
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
}
