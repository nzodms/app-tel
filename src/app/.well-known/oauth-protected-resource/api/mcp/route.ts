import { NextResponse } from 'next/server';
import { ALL_MCP_SCOPES } from '@/server/services/access';
import { baseUrlFrom, mcpResourceUri, oauthUrls } from '@/server/oauth/urls';

/**
 * Path-suffixed Protected Resource Metadata for the `/api/mcp` resource.
 *
 * RFC 9728 lets a resource host its metadata at
 * `/.well-known/oauth-protected-resource/<resource path>`, and the MCP spec says
 * clients MUST try that form before falling back to the root. Serving both means
 * discovery works whichever order a client probes in.
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
