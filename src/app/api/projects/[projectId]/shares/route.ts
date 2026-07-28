import { created, ok, readJson, route } from '@/server/http/respond';
import { withProject } from '@/server/http/project-route';
import {
  createShareLink,
  listShareLinks,
  revokeShareLink,
  shareInputSchema,
  toPublicShare,
} from '@/server/services/shares';
import { badRequest } from '@/server/core/errors';
import { baseUrlFrom } from '@/server/oauth/urls';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route(async (request: Request, ctx: Ctx) => {
  const { store, projectId } = await withProject(ctx.params, 'share');
  const links = await listShareLinks(store, projectId);
  const baseUrl = baseUrlFrom(request);
  return ok({
    shares: links.map((link) => ({ ...toPublicShare(link), url: `${baseUrl}/share/${link.token}` })),
  });
});

export const POST = route(async (request: Request, ctx: Ctx) => {
  const { store, actor, projectId } = await withProject(ctx.params, 'share');
  const input = await readJson(request, shareInputSchema);
  const link = await createShareLink(store, projectId, actor.userId, input);
  const baseUrl = baseUrlFrom(request);
  return created({
    share: { ...toPublicShare(link), url: `${baseUrl}/share/${link.token}` },
    url: `${baseUrl}/share/${link.token}`,
  });
});

export const DELETE = route(async (request: Request, ctx: Ctx) => {
  const { store, projectId } = await withProject(ctx.params, 'share');
  const shareId = new URL(request.url).searchParams.get('shareId');
  if (!shareId) throw badRequest('shareId is required.');
  const link = await revokeShareLink(store, projectId, shareId);
  return ok({ share: toPublicShare(link) });
});
