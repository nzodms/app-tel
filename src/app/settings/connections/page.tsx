import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ConnectorCard } from '@/components/dashboard/connector-card';
import { Card } from '@/components/ui/primitives';
import { getStore } from '@/server/db';
import { requestOrigin } from '@/server/http/origin';
import { readSessionUser } from '@/server/http/session';
import { listConnections } from '@/server/oauth/service';
import { mcpResourceUri } from '@/server/oauth/urls';

export const metadata: Metadata = { title: 'Claude connections' };
export const dynamic = 'force-dynamic';

export default async function ConnectionsSettingsPage() {
  const user = await readSessionUser();
  if (!user) redirect('/login?next=%2Fsettings%2Fconnections');

  const [connections, origin] = await Promise.all([
    listConnections(getStore(), user.id),
    requestOrigin(),
  ]);

  return (
    <div className="space-y-5">
      <ConnectorCard
        endpoint={mcpResourceUri(origin)}
        connections={connections.map((connection) => ({
          id: connection.id,
          name: connection.name,
          scopes: connection.scopes,
          createdAt: connection.createdAt,
          lastUsedAt: connection.lastUsedAt,
          revokedAt: connection.revokedAt,
          protocolVersion: connection.protocolVersion,
          toolCallCount: connection.toolCallCount,
        }))}
      />

      <Card className="p-4">
        <h2 className="text-[14px] font-semibold tracking-[-0.012em] text-paper-900">
          What PhoneLab can and cannot see
        </h2>
        <ul className="mt-2 space-y-1.5">
          {FACTS.map((fact) => (
            <li key={fact} className="flex gap-2 text-[12.5px] leading-relaxed text-paper-600">
              <span className="mt-[7px] size-[4px] shrink-0 rounded-full bg-paper-300" />
              {fact}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] text-paper-500">
          The protocol details, the tool list and the scopes are in the{' '}
          <Link href="/docs/mcp" className="underline underline-offset-2">
            MCP docs
          </Link>
          .
        </p>
      </Card>
    </div>
  );
}

const FACTS = [
  'You add PhoneLab in Claude as a custom connector, with your own Claude subscription. PhoneLab is not a Claude client and does not proxy a model API.',
  'PhoneLab never receives your Claude session, cookies, conversation history or quota. It only sees the tool calls Claude chooses to make against your projects.',
  'Every tool call is recorded with its arguments, its result and which connection made it. Revoking a connection stops it immediately.',
  'Scopes are granted per connection. A connection with only projects.read cannot write files, however it is asked.',
];
