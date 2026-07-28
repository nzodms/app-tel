import { headers } from 'next/headers';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Wordmark } from '@/components/brand/logo';
import { Badge, Card } from '@/components/ui/primitives';
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from '@/server/mcp/server';
import { toolsByGroup } from '@/server/mcp/registry';
import { MCP_SCOPES, type McpScope } from '@/server/services/access';
import { LIMITS } from '@/server/core/limits';
import { mcpResourceUri, oauthUrls, stripTrailingSlash } from '@/server/oauth/urls';

export const metadata: Metadata = { title: 'MCP connector' };
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
 * Live documentation for the MCP server.
 *
 * The tool list is generated from the actual registry, so this page cannot drift
 * from what the server exposes.
 */
export default async function McpDocsPage() {
  const baseUrl = await origin();
  const urls = oauthUrls(baseUrl);
  const groups = toolsByGroup();
  const toolCount = groups.reduce((sum, group) => sum + group.tools.length, 0);

  return (
    <div className="min-h-dvh bg-paper-50">
      <header className="border-b border-paper-200 bg-paper-0">
        <div className="mx-auto flex h-13 max-w-[900px] items-center px-5">
          <Link href="/">
            <Wordmark />
          </Link>
          <Link
            href="/app"
            className="ml-auto text-[12.5px] font-medium text-paper-600 hover:text-paper-900"
          >
            Back to projects
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[900px] px-5 py-9">
        <Badge tone="neutral">MCP {LATEST_PROTOCOL_VERSION}</Badge>
        <h1 className="mt-2.5 text-[26px] font-semibold tracking-[-0.026em] text-paper-900">
          The PhoneLab connector
        </h1>
        <p className="mt-2 max-w-[640px] text-[13.5px] leading-relaxed text-paper-600">
          PhoneLab exposes a remote MCP server so Claude can work on your projects using your own
          subscription. It speaks Streamable HTTP and is protected by OAuth 2.1 — PhoneLab issues the
          tokens itself, and every token is bound to this exact endpoint.
        </p>

        <Card className="mt-6 p-4">
          <h2 className="text-[14px] font-semibold text-paper-900">Add it to Claude</h2>
          <ol className="mt-2.5 space-y-2 text-[13px] leading-relaxed text-paper-600">
            <li>
              <span className="font-medium text-paper-800">1.</span> In Claude, open connector
              settings and add a custom connector.
            </li>
            <li>
              <span className="font-medium text-paper-800">2.</span> Paste this URL:
              <code className="mt-1 block break-all rounded-md border border-paper-200 bg-paper-50 px-2 py-1.5 font-mono text-[12px] text-paper-800">
                {mcpResourceUri(baseUrl)}
              </code>
            </li>
            <li>
              <span className="font-medium text-paper-800">3.</span> Claude registers itself
              automatically (Dynamic Client Registration) and sends you to PhoneLab&apos;s consent
              screen.
            </li>
            <li>
              <span className="font-medium text-paper-800">4.</span> Approve the scopes you want —
              you can uncheck any of them.
            </li>
            <li>
              <span className="font-medium text-paper-800">5.</span> Ask Claude to open one of your
              projects by name.
            </li>
          </ol>
          <p className="mt-3 text-[12px] leading-relaxed text-paper-500">
            The server must be reachable over the public internet for Claude to connect. On
            localhost, use the personal access token on your dashboard with a local MCP client
            instead.
          </p>
        </Card>

        <Card className="mt-4 p-4">
          <h2 className="text-[14px] font-semibold text-paper-900">Endpoints</h2>
          <dl className="mt-2.5 space-y-1.5 text-[12.5px]">
            {[
              ['MCP endpoint (POST)', urls.mcp],
              ['Protected resource metadata', urls.resourceMetadata],
              ['Authorization server metadata', urls.authorizationServerMetadata],
              ['Authorization endpoint', urls.authorizationEndpoint],
              ['Token endpoint', urls.tokenEndpoint],
              ['Dynamic client registration', urls.registrationEndpoint],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-wrap items-baseline gap-2">
                <dt className="w-[220px] shrink-0 text-paper-600">{label}</dt>
                <dd className="min-w-0 break-all font-mono text-[11.5px] text-paper-800">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[12px] leading-relaxed text-paper-500">
            Supported protocol revisions: {SUPPORTED_PROTOCOL_VERSIONS.join(', ')}. GET on the MCP
            endpoint returns 405 — this server does not open a server-initiated SSE stream, and it
            does not issue session ids, so every request stands alone.
          </p>
        </Card>

        <Card className="mt-4 p-4">
          <h2 className="text-[14px] font-semibold text-paper-900">Scopes</h2>
          <div className="mt-2.5 space-y-2.5">
            {(Object.keys(MCP_SCOPES) as McpScope[]).map((scope) => (
              <div key={scope}>
                <code className="font-mono text-[12px] font-semibold text-paper-800">{scope}</code>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-paper-600">
                  <span className="font-medium">{MCP_SCOPES[scope].label}</span> —{' '}
                  {MCP_SCOPES[scope].description}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-paper-500">
            A token can never exceed your own permissions: PhoneLab intersects the scopes on the
            token with your role in the workspace, so a connector cannot do something you could not
            do yourself.
          </p>
        </Card>

        <Card className="mt-4 p-4">
          <h2 className="text-[14px] font-semibold text-paper-900">Limits and safeguards</h2>
          <ul className="mt-2.5 space-y-1.5 text-[12.5px] leading-relaxed text-paper-600">
            <li>{LIMITS.mcpCallsPerMinute} tool calls per connection per minute.</li>
            <li>
              Single file {Math.round(LIMITS.maxFileBytes / 1024)} kB, project{' '}
              {Math.round(LIMITS.maxProjectBytes / (1024 * 1024))} MB,{' '}
              {LIMITS.maxFilesPerProject} files.
            </li>
            <li>Reads are capped at {Math.round(LIMITS.maxMcpReadBytes / 1024)} kB per response.</li>
            <li>
              Destructive tools (delete, restore, revoke, archive) refuse to act unless called with{' '}
              <code className="font-mono text-[11.5px]">confirm: true</code>.
            </li>
            <li>File deletes are recoverable, and every version restore snapshots first.</li>
            <li>Every call is written to an audit log you can read in the Claude panel.</li>
          </ul>
        </Card>

        <section className="mt-8">
          <h2 className="text-[16px] font-semibold tracking-[-0.016em] text-paper-900">
            Tools ({toolCount})
          </h2>
          <p className="mt-1 text-[12.5px] text-paper-500">
            Generated from the server&apos;s own registry.
          </p>

          <div className="mt-4 space-y-5">
            {groups.map((group) => (
              <div key={group.group}>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.055em] text-paper-500">
                  {group.group}
                </h3>
                <div className="overflow-hidden rounded-[var(--radius-panel)] border border-paper-200 bg-paper-0">
                  {group.tools.map((tool) => (
                    <div key={tool.name} className="border-b border-paper-100 p-3 last:border-b-0">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <code className="font-mono text-[12.5px] font-semibold text-paper-900">
                          {tool.name}
                        </code>
                        <Badge tone={tool.annotations.readOnlyHint ? 'neutral' : 'accent'}>
                          {tool.capability}
                        </Badge>
                        {tool.destructive ? <Badge tone="danger">needs confirm</Badge> : null}
                        {tool.annotations.readOnlyHint ? <Badge tone="positive">read-only</Badge> : null}
                      </div>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-paper-600">
                        {tool.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
