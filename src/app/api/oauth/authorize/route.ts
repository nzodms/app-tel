import { NextResponse } from 'next/server';
import { getStore } from '@/server/db';
import { errorMessage } from '@/server/core/errors';
import { requireSessionUser } from '@/server/http/session';
import { issueAuthorizationCode, prepareAuthorization } from '@/server/oauth/service';
import { isMcpScope, type McpScope } from '@/server/services/access';
import { baseUrlFrom, mcpResourceUri } from '@/server/oauth/urls';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Consent decision.
 *
 * A form POST, so the authorization code is created server-side and delivered by an
 * HTTP redirect — it never exists in client JavaScript. `state` is echoed back
 * untouched, and a denial returns `access_denied` rather than failing silently.
 *
 * Custom-scheme redirect URIs (desktop MCP clients) cannot be used with a 303, so
 * those get a minimal hand-off page instead.
 */
export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const flat: Record<string, string | undefined> = {};
  for (const [key, value] of form.entries()) {
    if (key === 'scope') continue;
    if (typeof value === 'string') flat[key] = value;
  }

  const approvedScopes = form
    .getAll('scope')
    .filter((value): value is string => typeof value === 'string')
    .filter(isMcpScope) as McpScope[];

  const decision = form.get('decision');
  const baseUrl = baseUrlFrom(request);
  const store = getStore();

  let context;
  try {
    context = await prepareAuthorization(store, flat, mcpResourceUri(baseUrl));
  } catch (error) {
    // Invalid client/redirect: show the user, never redirect.
    return new NextResponse(errorPage(errorMessage(error)), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const target = new URL(context.params.redirect_uri);

  if (decision !== 'approve' || approvedScopes.length === 0) {
    target.searchParams.set('error', 'access_denied');
    target.searchParams.set(
      'error_description',
      approvedScopes.length === 0 && decision === 'approve'
        ? 'No permissions were approved.'
        : 'The user declined the request.',
    );
    if (context.params.state) target.searchParams.set('state', context.params.state);
    return redirectTo(target.toString());
  }

  const user = await requireSessionUser();
  // Never grant more than the request itself asked for.
  const granted = approvedScopes.filter((scope) => context.scopes.includes(scope));
  if (granted.length === 0) {
    target.searchParams.set('error', 'invalid_scope');
    if (context.params.state) target.searchParams.set('state', context.params.state);
    return redirectTo(target.toString());
  }

  const code = await issueAuthorizationCode(store, context, user.id, granted);
  target.searchParams.set('code', code);
  if (context.params.state) target.searchParams.set('state', context.params.state);
  return redirectTo(target.toString());
}

function redirectTo(url: string): Response {
  const isHttp = url.startsWith('http://') || url.startsWith('https://');
  if (isHttp) {
    return new NextResponse(null, {
      status: 303,
      headers: { Location: url, 'Cache-Control': 'no-store' },
    });
  }
  // Custom scheme: hand off through the browser instead of an HTTP redirect.
  const escaped = url.replace(/"/g, '&quot;');
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><title>Returning to your app…</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#41474f}
a{color:#1657c7}</style></head>
<body><div style="text-align:center"><p>Returning to your application…</p>
<p><a href="${escaped}">Continue</a></p></div>
<script>location.replace(${JSON.stringify(url)});</script></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}

function errorPage(message: string): string {
  const escaped = message.replace(/[<>&]/g, (char) =>
    char === '<' ? '&lt;' : char === '>' ? '&gt;' : '&amp;',
  );
  return `<!doctype html><html><head><meta charset="utf-8"><title>Request rejected</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f8f9fb;color:#191d22}
div{max-width:420px;padding:20px;border:1px solid #e4e7ec;border-radius:10px;background:#fff}
h1{font-size:16px;margin:0 0 8px}p{font-size:13px;line-height:1.55;color:#5b626d;margin:0}</style></head>
<body><div><h1>This authorisation request was rejected</h1><p>${escaped}</p></div></body></html>`;
}
