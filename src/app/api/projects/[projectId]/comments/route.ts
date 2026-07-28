import { z } from 'zod';
import { created, ok, readJson, route } from '@/server/http/respond';
import { withProject } from '@/server/http/project-route';
import {
  createTaskFromThread,
  listThreads,
  replyToThread,
  setThreadStatus,
} from '@/server/services/comments';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route(async (request: Request, ctx: Ctx) => {
  const { store, projectId } = await withProject(ctx.params, 'read');
  const status = new URL(request.url).searchParams.get('status');
  return ok({
    threads: await listThreads(store, projectId, {
      ...(status === 'open' || status === 'resolved' ? { status } : {}),
    }),
  });
});

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reply'), threadId: z.string().min(1), body: z.string().min(1).max(4000) }),
  z.object({ action: z.literal('status'), threadId: z.string().min(1), status: z.enum(['open', 'resolved']) }),
  z.object({ action: z.literal('task'), threadId: z.string().min(1), title: z.string().min(1).max(200) }),
]);

/** Owner-side actions on reviewer feedback: reply, resolve, or convert to a task. */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const { store, actor, projectId } = await withProject(ctx.params, 'share');
  const input = await readJson(request, actionSchema);
  const { user } = await import('@/server/http/session').then(async (module) => ({
    user: await module.requireSessionUser(),
  }));

  switch (input.action) {
    case 'reply': {
      const comment = await replyToThread(store, projectId, input.threadId, 'owner', {
        body: input.body,
        authorName: user.name,
        authorEmail: user.email,
      });
      return created({ comment });
    }
    case 'status': {
      const thread = await setThreadStatus(store, projectId, input.threadId, input.status, actor.userId);
      return ok({ thread });
    }
    case 'task': {
      const thread = await createTaskFromThread(store, projectId, input.threadId, input.title);
      return ok({ thread });
    }
  }
});
