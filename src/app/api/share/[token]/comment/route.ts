import { z } from 'zod';
import { created, readJson, route } from '@/server/http/respond';
import { forbidden } from '@/server/core/errors';
import { LIMITS } from '@/server/core/limits';
import { getStore } from '@/server/db';
import { createThread } from '@/server/services/comments';
import { openShareLink } from '@/server/services/shares';
import { checkRateLimit } from '@/server/services/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ token: string }> };

const schema = z.object({
  password: z.string().max(200).optional(),
  email: z.string().max(200).optional(),
  authorName: z.string().trim().min(1).max(80),
  authorEmail: z.string().trim().email().nullable().optional(),
  body: z.string().trim().min(1).max(LIMITS.maxCommentBodyChars),
  anchorX: z.number().min(0).max(1),
  anchorY: z.number().min(0).max(1),
  screen: z.string().max(200).nullable().optional(),
  role: z.string().max(40).nullable().optional(),
  sourceRef: z.string().max(300).nullable().optional(),
  elementLabel: z.string().max(200).nullable().optional(),
  precedingAction: z.string().max(200).nullable().optional(),
});

/** A reviewer leaves an anchored comment. Requires a `comment`-access link. */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const { token } = await ctx.params;
  const input = await readJson(request, schema);
  const store = getStore();

  const gate = await openShareLink(store, token, {
    ...(input.password ? { password: input.password } : {}),
    ...(input.email ? { email: input.email } : {}),
  });
  if (gate.state !== 'ok') throw forbidden('This link needs to be unlocked before commenting.');
  if (gate.link.access !== 'comment') {
    throw forbidden('This link is read-only — the owner did not enable comments.');
  }

  // Cheap abuse guard on an unauthenticated endpoint.
  const limit = checkRateLimit(`share-comment:${token}`, 30, 60_000);
  if (!limit.allowed) {
    throw forbidden('Too many comments in a short time. Try again in a minute.');
  }

  const thread = await createThread(store, gate.link.projectId, gate.link.id, 'guest', {
    versionId: gate.link.versionId,
    presetId: null,
    role: input.role ?? null,
    screen: input.screen ?? null,
    anchorX: input.anchorX,
    anchorY: input.anchorY,
    sourceRef: input.sourceRef ?? null,
    elementLabel: input.elementLabel ?? null,
    precedingAction: input.precedingAction ?? null,
    body: input.body,
    authorName: input.authorName,
    authorEmail: input.authorEmail ?? null,
  });

  return created({
    thread: {
      id: thread.id,
      anchorX: thread.anchorX,
      anchorY: thread.anchorY,
      screen: thread.screen,
      role: thread.role,
      author: input.authorName,
      body: input.body,
      createdAt: thread.createdAt,
    },
  });
});
