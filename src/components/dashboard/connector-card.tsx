'use client';

import { useState } from 'react';
import { Check, Copy, ExternalLink, Plug, ShieldCheck } from 'lucide-react';
import { api, errorText } from '@/lib/api-client';
import { MCP_SCOPES, type McpScope } from '@/server/services/access';
import { Badge, Button, Card, Field, Input } from '@/components/ui/primitives';

interface Connection {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  protocolVersion: string | null;
  toolCallCount: number;
}

/**
 * Connecting PhoneLab to Claude.
 *
 * The design decision this card embodies: PhoneLab does not resell model access.
 * You add it to Claude as a custom connector and use your own subscription; the
 * OAuth consent screen is where you decide what it may touch.
 *
 * A personal access token is offered as well, for testing the MCP server with the
 * Inspector or curl — same validation, same scopes, same audit trail.
 */
export function ConnectorCard({
  endpoint,
  connections: initial,
}: {
  endpoint: string;
  connections: Connection[];
}) {
  const [connections, setConnections] = useState(initial);
  const [copied, setCopied] = useState<string | null>(null);
  const [tokenName, setTokenName] = useState('MCP Inspector');
  const [scopes, setScopes] = useState<McpScope[]>(['projects.read', 'projects.write', 'preview.run']);
  const [issued, setIssued] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1700);
  };

  const mint = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ token: string }>('/api/mcp-tokens', {
        body: { name: tokenName, scopes },
      });
      setIssued(result.token);
      const refreshed = await api<{ connections: Connection[] }>('/api/mcp-tokens');
      setConnections(refreshed.connections);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (connectionId: string) => {
    try {
      await api(`/api/mcp-tokens?connectionId=${encodeURIComponent(connectionId)}`, {
        method: 'DELETE',
      });
      setConnections((current) =>
        current.map((connection) =>
          connection.id === connectionId
            ? { ...connection, revokedAt: new Date().toISOString() }
            : connection,
        ),
      );
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  const live = connections.filter((connection) => connection.revokedAt === null);

  return (
    <Card className="p-4">
      <div className="flex items-start gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-paper-100 text-paper-600">
          <Plug size={15} strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold tracking-[-0.012em] text-paper-900">
            Connect PhoneLab to Claude
          </h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-paper-600">
            Add PhoneLab as a custom connector in Claude&apos;s settings, using your own
            subscription. Claude then gets tools to read your projects, patch files, run previews
            and create versions. PhoneLab never sees your Claude conversations, cookies or quota —
            it only receives tool calls.
          </p>

          <div className="mt-2.5 flex items-center gap-1.5">
            <code className="min-w-0 flex-1 truncate rounded-md border border-paper-200 bg-paper-50 px-2 py-1.5 font-mono text-[11.5px] text-paper-700">
              {endpoint}
            </code>
            <Button size="sm" variant="primary" onClick={() => void copy(endpoint, 'endpoint')}>
              {copied === 'endpoint' ? <Check size={12.5} strokeWidth={2.4} /> : <Copy size={12.5} strokeWidth={1.9} />}
              {copied === 'endpoint' ? 'Copied' : 'Copy URL'}
            </Button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge tone="positive">
              <ShieldCheck size={9.5} strokeWidth={2.2} />
              OAuth 2.1 · PKCE
            </Badge>
            <Badge tone="neutral">Streamable HTTP</Badge>
            <Badge tone="neutral">MCP 2025-11-25</Badge>
            <a
              href="/docs/mcp"
              className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-azure-600 hover:underline"
            >
              Setup guide
              <ExternalLink size={11} strokeWidth={2} />
            </a>
          </div>
        </div>
      </div>

      {live.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-[var(--radius-panel)] border border-paper-200">
          <div className="border-b border-paper-150 bg-paper-50 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-paper-500">
            Active connections
          </div>
          {live.map((connection) => (
            <div
              key={connection.id}
              className="flex items-center gap-2 border-b border-paper-100 px-2.5 py-2 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-medium text-paper-800">
                  {connection.name}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {connection.scopes.map((scope) => (
                    <Badge key={scope} tone="accent">
                      {scope}
                    </Badge>
                  ))}
                </div>
                <div className="mt-1 text-[10.5px] text-paper-400">
                  {connection.toolCallCount} tool call(s)
                  {connection.lastUsedAt
                    ? ` · last used ${new Date(connection.lastUsedAt).toLocaleString()}`
                    : ' · never used'}
                  {connection.protocolVersion ? ` · ${connection.protocolVersion}` : ''}
                </div>
              </div>
              <Button size="xs" variant="ghost" onClick={() => void revoke(connection.id)}>
                Revoke
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <details className="mt-4 rounded-[var(--radius-panel)] border border-paper-200 bg-paper-25">
        <summary className="cursor-pointer px-2.5 py-2 text-[12.5px] font-medium text-paper-700">
          Personal access token (for MCP Inspector or curl)
        </summary>
        <div className="space-y-2.5 border-t border-paper-150 p-2.5">
          <Field label="Token name">
            <Input value={tokenName} onChange={(event) => setTokenName(event.target.value)} />
          </Field>
          <div>
            <span className="mb-1 block text-[12px] font-medium text-paper-700">Scopes</span>
            <div className="space-y-1">
              {(Object.keys(MCP_SCOPES) as McpScope[]).map((scope) => (
                <label key={scope} className="flex items-start gap-2 text-[12px] text-paper-700">
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={(event) =>
                      setScopes((current) =>
                        event.target.checked
                          ? [...current, scope]
                          : current.filter((entry) => entry !== scope),
                      )
                    }
                    className="mt-[3px] size-3.5"
                  />
                  <span>
                    <span className="font-medium">{scope}</span>
                    <span className="text-paper-500"> — {MCP_SCOPES[scope].description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <Button size="sm" onClick={() => void mint()} disabled={busy || scopes.length === 0}>
            {busy ? 'Creating…' : 'Create token'}
          </Button>

          {issued ? (
            <div className="rounded-lg border border-caution-200 bg-caution-50 p-2.5">
              <div className="text-[12px] font-semibold text-caution-700">
                Copy this now — it is not shown again.
              </div>
              <code className="mt-1.5 block break-all rounded-md border border-caution-200 bg-paper-0 px-2 py-1.5 font-mono text-[11px] text-paper-800">
                {issued}
              </code>
              <Button size="xs" className="mt-1.5" onClick={() => void copy(issued, 'token')}>
                {copied === 'token' ? 'Copied' : 'Copy token'}
              </Button>
            </div>
          ) : null}

          {error ? <p className="text-[12px] text-danger-700">{error}</p> : null}
        </div>
      </details>
    </Card>
  );
}
