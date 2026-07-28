import { NextResponse } from 'next/server';
import { ALL_MCP_SCOPES } from '@/server/services/access';
import { baseUrlFrom, oauthUrls } from '@/server/oauth/urls';

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414).
 *
 * PhoneLab is its own authorization server for the MCP resource. Only what is
 * actually implemented is advertised: authorization code with PKCE `S256`, refresh
 * tokens, and dynamic client registration. No implicit grant (OAuth 2.1 removes
 * it), no `plain` PKCE.
 */
export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  const baseUrl = baseUrlFrom(request);
  const urls = oauthUrls(baseUrl);

  return NextResponse.json(
    {
      issuer: urls.issuer,
      authorization_endpoint: urls.authorizationEndpoint,
      token_endpoint: urls.tokenEndpoint,
      registration_endpoint: urls.registrationEndpoint,
      scopes_supported: ALL_MCP_SCOPES,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
      code_challenge_methods_supported: ['S256'],
      service_documentation: urls.documentation,
      // We do not implement Client ID Metadata Documents; clients should use DCR.
      client_id_metadata_document_supported: false,
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
}
