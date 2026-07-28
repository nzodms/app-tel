import { z } from 'zod';
import { ok, readJson, route } from '@/server/http/respond';
import { withProject } from '@/server/http/project-route';
import { answerStudioRequest } from '@/server/realtime/rpc';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * The studio's answer to a server-initiated request.
 *
 * Some MCP tools need something only a browser can do — reading what a phone is
 * currently showing, reloading the frames. The server asks over the realtime
 * stream; this is where the answer comes back and resolves the waiting tool call.
 */
const schema = z.object({
  requestId: z.string().min(1).max(80),
  value: z.unknown(),
});

export const POST = route(async (request: Request, ctx: Ctx) => {
  await withProject(ctx.params, 'read');
  const input = await readJson(request, schema);
  const delivered = answerStudioRequest(input.requestId, input.value);
  return ok({ delivered });
});
