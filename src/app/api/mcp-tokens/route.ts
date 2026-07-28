import { z } from 'zod';
import { created, ok, readJson, route } from '@/server/http/respond';
import { requireActor } from '@/server/http/session';
import { getStore } from '@/server/db';
import { createPersonalToken, listConnections, revokeConnection } from '@/server/oauth/service';
import { ALL_MCP_SCOPES, isMcpScope, type McpScope } from '@/server/services/access';
import { baseUrlFrom, mcpResourceUri } from '@/server/oauth/urls';
import { badRequest } from '@/server/core/errors';

export const runtime = 'nodejs';

/**
 * Personal access tokens.
 *
 * For testing the MCP server directly (MCP Inspector, curl) without running the
 * full OAuth flow. Same validation path, same scopes, same audit trail — just a
 * different way of obtaining a token. Shown once, stored hashed.
 */
const schema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.string()).min(1).max(8),
  days: z.number().int().min(1).max(365).optional(),
});

export const GET = route(async () => {
  const { actor } = await requireActor();
  const connections = await listConnections(getStore(), actor.userId);
  return ok({
    connections: connections.map((connection) => ({
      id: connection.id,
      name: connection.name,
      clientId: connection.clientId,
      scopes: connection.scopes,
      createdAt: connection.createdAt,
      lastUsedAt: connection.lastUsedAt,
      revokedAt: connection.revokedAt,
      protocolVersion: connection.protocolVersion,
      toolCallCount: connection.toolCallCount,
    })),
  });
});

export const POST = route(async (request: Request) => {
  const { actor } = await requireActor();
  const input = await readJson(request, schema);
  const scopes = input.scopes.filter(isMcpScope) as McpScope[];
  if (scopes.length === 0) {
    throw badRequest(`Pick at least one valid scope. Available: ${ALL_MCP_SCOPES.join(', ')}.`);
  }

  const result = await createPersonalToken(getStore(), actor.userId, {
    name: input.name,
    scopes,
    resource: mcpResourceUri(baseUrlFrom(request)),
    ...(input.days ? { days: input.days } : {}),
  });

  return created({
    // The only time the plaintext exists outside the client's hands.
    token: result.token,
    expiresAt: result.row.expiresAt,
    scopes,
    endpoint: mcpResourceUri(baseUrlFrom(request)),
  });
});

export const DELETE = route(async (request: Request) => {
  const { actor } = await requireActor();
  const connectionId = new URL(request.url).searchParams.get('connectionId');
  if (!connectionId) throw badRequest('connectionId is required.');
  const connection = await revokeConnection(getStore(), actor.userId, connectionId);
  return ok({ connection: { id: connection.id, revokedAt: connection.revokedAt } });
});
