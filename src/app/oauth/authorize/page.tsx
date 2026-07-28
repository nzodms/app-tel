import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { ShieldCheck } from 'lucide-react';
import { Wordmark } from '@/components/brand/logo';
import { Avatar, Badge, Card } from '@/components/ui/primitives';
import { ConsentForm } from '@/components/oauth/consent-form';
import { getStore } from '@/server/db';
import { errorMessage } from '@/server/core/errors';
import { readSessionUser } from '@/server/http/session';
import { prepareAuthorization } from '@/server/oauth/service';
import { MCP_SCOPES, type McpScope } from '@/server/services/access';
import { headers } from 'next/headers';
import { mcpResourceUri, stripTrailingSlash } from '@/server/oauth/urls';

export const metadata: Metadata = { title: 'Authorise access' };
export const dynamic = 'force-dynamic';

async function origin(): Promise<string> {
  const configured = process.env.PHONELAB_BASE_URL?.trim();
  if (configured) return stripTrailingSlash(configured);
  const headerList = await headers();
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host') ?? 'localhost:3000';
  const proto =
    headerList.get('x-forwarded-proto') ??
    (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  return stripTrailingSlash(`${proto}://${host}`);
}

/**
 * The OAuth consent screen.
 *
 * Two rules from the spec matter here and both are honoured:
 *  - anything wrong with `client_id` or `redirect_uri` is shown to the *user*, never
 *    redirected, so this endpoint can never be used as an open redirector;
 *  - the user must actively approve, and can narrow the scopes before doing so.
 */
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const flat: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    flat[key] = Array.isArray(value) ? value[0] : value;
  }

  const user = await readSessionUser();
  if (!user) {
    const query = new URLSearchParams(
      Object.entries(flat).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${query.toString()}`)}`);
  }

  const baseUrl = await origin();

  let context;
  try {
    context = await prepareAuthorization(getStore(), flat, mcpResourceUri(baseUrl));
  } catch (error) {
    return (
      <main className="grid min-h-dvh place-items-center bg-paper-50 px-4">
        <Card className="max-w-[420px] p-5">
          <h1 className="text-[15px] font-semibold text-paper-900">This request cannot be approved</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-paper-600">{errorMessage(error)}</p>
          <p className="mt-3 text-[12px] leading-relaxed text-paper-500">
            Nothing was authorised. PhoneLab will not redirect anywhere until the request is valid —
            that is deliberate, so this page can never be used to bounce you to an attacker&apos;s
            site.
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-paper-50 px-4 py-10">
      <div className="w-full max-w-[452px]">
        <div className="mb-5 flex justify-center">
          <Wordmark />
        </div>
        <Card className="overflow-hidden">
          <div className="border-b border-paper-200 p-5">
            <Badge tone="positive">
              <ShieldCheck size={10} strokeWidth={2.2} />
              OAuth 2.1 · PKCE S256
            </Badge>
            <h1 className="mt-2.5 text-[17px] font-semibold tracking-[-0.018em] text-paper-900">
              Allow {context.client.clientName} to use PhoneLab?
            </h1>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-paper-600">
              It will act on your PhoneLab account with the permissions you approve below. You can
              revoke this at any time from your dashboard.
            </p>
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-paper-200 bg-paper-50 px-2.5 py-2">
              <Avatar name={user.name} hue={user.avatarHue} size={26} />
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-medium text-paper-800">{user.name}</div>
                <div className="truncate text-[11.5px] text-paper-500">{user.email}</div>
              </div>
            </div>
          </div>

          <ConsentForm
            scopes={context.scopes as McpScope[]}
            descriptions={Object.fromEntries(
              (context.scopes as McpScope[]).map((scope) => [
                scope,
                { label: MCP_SCOPES[scope].label, description: MCP_SCOPES[scope].description },
              ]),
            )}
            params={{
              client_id: context.params.client_id,
              redirect_uri: context.params.redirect_uri,
              code_challenge: context.params.code_challenge,
              code_challenge_method: context.params.code_challenge_method,
              ...(context.params.state ? { state: context.params.state } : {}),
              resource: context.resource,
              response_type: 'code',
            }}
            clientName={context.client.clientName}
            redirectUri={context.params.redirect_uri}
          />
        </Card>
      </div>
    </main>
  );
}
