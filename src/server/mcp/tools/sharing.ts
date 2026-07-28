import { z } from 'zod';
import { requireProjectAccess } from '../../services/access';
import { createShareLink, listShareLinks, revokeShareLink } from '../../services/shares';
import {
  createTaskFromThread,
  getThread,
  listThreads,
  replyToThread,
  setThreadStatus,
  threadAsPrompt,
} from '../../services/comments';
import { getVersion } from '../../services/versions';
import { defineTool, outcome } from '../types';

const projectIdSchema = z.string().min(1).describe('PhoneLab project id.');

export const sharingTools = [
  defineTool({
    name: 'create_share_link',
    title: 'Create share link',
    description:
      'Creates a review link for a specific version. The reviewer gets the running app and can leave anchored comments; they never see the project’s code. Defaults to the newest version so reviewers cannot land on a half-finished working tree.',
    group: 'sharing',
    capability: 'share',
    annotations: { readOnlyHint: false, idempotentHint: false },
    input: z
      .object({
        projectId: projectIdSchema,
        label: z.string().trim().max(80).optional().describe('What this link is for.'),
        versionId: z
          .string()
          .min(1)
          .nullable()
          .optional()
          .describe('Version to pin. Omit to use the newest snapshot.'),
        access: z.enum(['read', 'comment']).optional().describe('Defaults to comment.'),
        visibility: z
          .enum(['public', 'password', 'email'])
          .optional()
          .describe('public = anyone with the link. Defaults to public.'),
        password: z.string().min(6).max(200).optional().describe('Required when visibility is password.'),
        allowedEmails: z.array(z.string().email()).max(50).optional().describe('Required when visibility is email.'),
        allowedRoles: z
          .array(z.string().min(1).max(40))
          .max(12)
          .optional()
          .describe('Roles the reviewer may switch between. Empty = all project roles.'),
        allowVersionCompare: z.boolean().optional(),
        expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
      })
      .strict(),
    async handler(input, { store, actor, baseUrl }) {
      await requireProjectAccess(store, actor, input.projectId, 'share');
      const { projectId, ...rest } = input;
      const link = await createShareLink(store, projectId, actor.userId, {
        label: rest.label ?? '',
        versionId: rest.versionId ?? null,
        access: rest.access ?? 'comment',
        visibility: rest.visibility ?? 'public',
        ...(rest.password ? { password: rest.password } : {}),
        allowedEmails: rest.allowedEmails ?? [],
        allowedRoles: rest.allowedRoles ?? [],
        allowVersionCompare: rest.allowVersionCompare ?? false,
        allowJourneys: true,
        expiresInDays: rest.expiresInDays ?? null,
      });

      const url = `${baseUrl}/share/${link.token}`;
      return outcome(
        `Share link ready: ${url}\nPinned to ${link.versionId ?? 'the live working tree'}, ${link.access} access, ${link.visibility} visibility.`,
        {
          shareId: link.id,
          url,
          token: link.token,
          versionId: link.versionId,
          access: link.access,
          visibility: link.visibility,
          expiresAt: link.expiresAt,
        },
      );
    },
  }),

  defineTool({
    name: 'list_share_links',
    title: 'List share links',
    description: 'Share links on this project, with view counts and revocation status.',
    group: 'sharing',
    capability: 'share',
    annotations: { readOnlyHint: true, idempotentHint: true },
    input: z.object({ projectId: projectIdSchema }).strict(),
    async handler(input, { store, actor, baseUrl }) {
      await requireProjectAccess(store, actor, input.projectId, 'share');
      const links = await listShareLinks(store, input.projectId);
      const lines = links.map(
        (link) =>
          `- ${link.label} · ${baseUrl}/share/${link.token} · ${link.access}/${link.visibility} · ${link.viewCount} views` +
          `${link.revokedAt ? ' · REVOKED' : ''}`,
      );
      return outcome(links.length === 0 ? 'No share links yet.' : lines.join('\n'), {
        links: links.map((link) => ({
          id: link.id,
          label: link.label,
          url: `${baseUrl}/share/${link.token}`,
          versionId: link.versionId,
          access: link.access,
          visibility: link.visibility,
          viewCount: link.viewCount,
          revokedAt: link.revokedAt,
          expiresAt: link.expiresAt,
        })),
      });
    },
  }),

  defineTool({
    name: 'revoke_share_link',
    title: 'Revoke share link',
    description: 'Immediately disables a share link. Comments already left are kept. Requires confirm=true.',
    group: 'sharing',
    capability: 'share',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    destructive: true,
    input: z
      .object({
        projectId: projectIdSchema,
        shareId: z.string().min(1),
        confirm: z.boolean().default(false),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'share');
      const link = await revokeShareLink(store, input.projectId, input.shareId);
      return outcome(`Revoked "${link.label}".`, { shareId: link.id, revokedAt: link.revokedAt });
    },
  }),

  defineTool({
    name: 'list_comments',
    title: 'List comments',
    description:
      'Reviewer feedback, newest first. Each thread carries where it was left: version, role, screen, the element clicked and — when available — the exact source location, so you can go straight to the right file.',
    group: 'sharing',
    capability: 'read',
    annotations: { readOnlyHint: true, idempotentHint: true },
    input: z
      .object({
        projectId: projectIdSchema,
        status: z.enum(['open', 'resolved']).optional().describe('Defaults to open.'),
        versionId: z.string().min(1).optional(),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'read');
      const threads = await listThreads(store, input.projectId, {
        status: input.status ?? 'open',
        ...(input.versionId ? { versionId: input.versionId } : {}),
      });

      if (threads.length === 0) {
        return outcome('No comments match.', { threads: [] });
      }

      const lines = threads.map((thread) => {
        const first = thread.comments[0];
        return (
          `- ${thread.id} · ${thread.status} · screen ${thread.screen ?? '?'} · role ${thread.role ?? '?'}` +
          `${thread.sourceRef ? ` · ${thread.sourceRef}` : ''}\n` +
          `    ${first ? `${first.authorName}: ${first.body.slice(0, 200)}` : '(empty)'}`
        );
      });

      return outcome(`${threads.length} thread(s):\n${lines.join('\n')}`, {
        threads: threads.map((thread) => ({
          id: thread.id,
          status: thread.status,
          versionId: thread.versionId,
          role: thread.role,
          screen: thread.screen,
          presetId: thread.presetId,
          sourceRef: thread.sourceRef,
          elementLabel: thread.elementLabel,
          precedingAction: thread.precedingAction,
          anchor: { x: thread.anchorX, y: thread.anchorY },
          taskTitle: thread.taskTitle,
          comments: thread.comments.map((comment) => ({
            author: comment.authorName,
            authorKind: comment.authorKind,
            body: comment.body,
            createdAt: comment.createdAt,
          })),
        })),
      });
    },
  }),

  defineTool({
    name: 'get_comment',
    title: 'Get comment thread',
    description:
      'One thread in full, plus a ready-to-use context block describing exactly where the feedback points. Use this before fixing reviewer feedback.',
    group: 'sharing',
    capability: 'read',
    annotations: { readOnlyHint: true, idempotentHint: true },
    input: z.object({ projectId: projectIdSchema, threadId: z.string().min(1) }).strict(),
    async handler(input, { store, actor }) {
      const { project } = await requireProjectAccess(store, actor, input.projectId, 'read');
      const thread = await getThread(store, input.projectId, input.threadId);
      const version = thread.versionId
        ? await getVersion(store, input.projectId, thread.versionId).catch(() => null)
        : null;

      return outcome(threadAsPrompt(thread, project.name, version?.label ?? null), {
        thread: {
          id: thread.id,
          status: thread.status,
          versionId: thread.versionId,
          versionLabel: version?.label ?? null,
          role: thread.role,
          screen: thread.screen,
          presetId: thread.presetId,
          sourceRef: thread.sourceRef,
          elementLabel: thread.elementLabel,
          precedingAction: thread.precedingAction,
          anchor: { x: thread.anchorX, y: thread.anchorY },
        },
        comments: thread.comments,
      });
    },
  }),

  defineTool({
    name: 'reply_to_comment',
    title: 'Reply to comment',
    description:
      'Posts a reply on a thread, attributed to Claude. Use it to tell the reviewer what you changed.',
    group: 'sharing',
    capability: 'share',
    annotations: { readOnlyHint: false, idempotentHint: false },
    input: z
      .object({
        projectId: projectIdSchema,
        threadId: z.string().min(1),
        body: z.string().trim().min(1).max(4000),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'share');
      const comment = await replyToThread(store, input.projectId, input.threadId, 'claude', {
        body: input.body,
        authorName: 'Claude',
      });
      return outcome('Reply posted.', { commentId: comment.id, threadId: input.threadId });
    },
  }),

  defineTool({
    name: 'resolve_comment',
    title: 'Resolve comment',
    description: 'Marks a thread resolved (or reopens it with status "open").',
    group: 'sharing',
    capability: 'share',
    annotations: { readOnlyHint: false, idempotentHint: true },
    input: z
      .object({
        projectId: projectIdSchema,
        threadId: z.string().min(1),
        status: z.enum(['resolved', 'open']).default('resolved'),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'share');
      const thread = await setThreadStatus(
        store,
        input.projectId,
        input.threadId,
        input.status,
        actor.userId,
      );
      return outcome(`Thread ${thread.id} is now ${thread.status}.`, {
        threadId: thread.id,
        status: thread.status,
      });
    },
  }),

  defineTool({
    name: 'create_task_from_comment',
    title: 'Create task from comment',
    description:
      'Turns a comment thread into a tracked task on the project, so feedback that needs work is visible next to the code.',
    group: 'sharing',
    capability: 'share',
    annotations: { readOnlyHint: false, idempotentHint: true },
    input: z
      .object({
        projectId: projectIdSchema,
        threadId: z.string().min(1),
        title: z.string().trim().min(1).max(200),
      })
      .strict(),
    async handler(input, { store, actor }) {
      await requireProjectAccess(store, actor, input.projectId, 'share');
      const thread = await createTaskFromThread(
        store,
        input.projectId,
        input.threadId,
        input.title,
      );
      return outcome(`Task created: "${thread.taskTitle}".`, {
        threadId: thread.id,
        taskTitle: thread.taskTitle,
      });
    },
  }),
];
