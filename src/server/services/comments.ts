import { z } from 'zod';
import { badRequest, notFound } from '../core/errors';
import { LIMITS } from '../core/limits';
import { newId } from '../core/ids';
import type {
  CommentAuthorKind,
  CommentRow,
  CommentThreadRow,
  Id,
  Store,
} from '../db';
import { RT, getBus, projectChannel } from '../realtime/bus';
import { logEvent } from './events';

/**
 * Reviewer feedback, anchored precisely.
 *
 * A thread records *where* the comment was left: version, device preset, role,
 * screen, normalised coordinates inside the viewport, and — when the click landed
 * on a element the compiler stamped — the exact `path:line:column`. That is what
 * turns "this button is confusing" into something Claude can act on through MCP.
 */

export const createThreadSchema = z.object({
  versionId: z.string().min(1).nullable().optional(),
  deviceId: z.string().min(1).nullable().optional(),
  presetId: z.string().min(1).nullable().optional(),
  role: z.string().min(1).max(40).nullable().optional(),
  screen: z.string().max(200).nullable().optional(),
  /** 0..1 within the viewport, so the pin survives zoom and different presets. */
  anchorX: z.number().min(0).max(1),
  anchorY: z.number().min(0).max(1),
  sourceRef: z.string().max(300).nullable().optional(),
  elementLabel: z.string().max(200).nullable().optional(),
  precedingAction: z.string().max(200).nullable().optional(),
  body: z.string().trim().min(1, 'Write a comment.').max(LIMITS.maxCommentBodyChars),
  authorName: z.string().trim().min(1).max(80),
  authorEmail: z.string().trim().toLowerCase().email().nullable().optional(),
});

export type CreateThreadInput = z.infer<typeof createThreadSchema>;

export interface ThreadWithComments extends CommentThreadRow {
  comments: CommentRow[];
}

export async function createThread(
  store: Store,
  projectId: Id,
  shareLinkId: Id | null,
  authorKind: CommentAuthorKind,
  input: CreateThreadInput,
): Promise<ThreadWithComments> {
  const parsed = createThreadSchema.parse(input);
  const now = new Date().toISOString();

  const thread: CommentThreadRow = {
    id: newId('thr'),
    projectId,
    shareLinkId,
    versionId: parsed.versionId ?? null,
    deviceId: parsed.deviceId ?? null,
    presetId: parsed.presetId ?? null,
    role: parsed.role ?? null,
    screen: parsed.screen ?? null,
    anchorX: parsed.anchorX,
    anchorY: parsed.anchorY,
    sourceRef: parsed.sourceRef ?? null,
    elementLabel: parsed.elementLabel ?? null,
    precedingAction: parsed.precedingAction ?? null,
    status: 'open',
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    resolvedBy: null,
    taskTitle: null,
  };

  const comment: CommentRow = {
    id: newId('cmt'),
    threadId: thread.id,
    projectId,
    authorKind,
    authorName: parsed.authorName,
    authorEmail: parsed.authorEmail ?? null,
    body: parsed.body,
    createdAt: now,
  };

  await store.transaction(async (tx) => {
    await tx.insert('commentThreads', thread);
    await tx.insert('comments', comment);
  });

  getBus().publish(projectChannel(projectId), RT.commentChanged, {
    threadId: thread.id,
    created: true,
    authorName: comment.authorName,
  });
  await logEvent(store, projectId, {
    kind: 'comment',
    name: `${comment.authorName} left a comment`,
    deviceId: thread.deviceId,
    screen: thread.screen,
    payload: {
      threadId: thread.id,
      sourceRef: thread.sourceRef,
      element: thread.elementLabel,
      excerpt: comment.body.slice(0, 160),
    },
  });

  return { ...thread, comments: [comment] };
}

export async function replyToThread(
  store: Store,
  projectId: Id,
  threadId: Id,
  authorKind: CommentAuthorKind,
  input: { body: string; authorName: string; authorEmail?: string | null },
): Promise<CommentRow> {
  const thread = await getThread(store, projectId, threadId);
  const body = input.body.trim();
  if (body === '') throw badRequest('Write something before replying.');
  if (body.length > LIMITS.maxCommentBodyChars) {
    throw badRequest(`Comments are limited to ${LIMITS.maxCommentBodyChars} characters.`);
  }

  const comment: CommentRow = {
    id: newId('cmt'),
    threadId: thread.id,
    projectId,
    authorKind,
    authorName: input.authorName.slice(0, 80),
    authorEmail: input.authorEmail ?? null,
    body,
    createdAt: new Date().toISOString(),
  };

  await store.insert('comments', comment);
  await store.update('commentThreads', thread.id, { updatedAt: comment.createdAt });

  getBus().publish(projectChannel(projectId), RT.commentChanged, {
    threadId: thread.id,
    replied: true,
  });
  return comment;
}

export async function listThreads(
  store: Store,
  projectId: Id,
  filter: { status?: 'open' | 'resolved'; versionId?: Id } = {},
): Promise<ThreadWithComments[]> {
  const threads = await store.select('commentThreads', {
    match: {
      projectId,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.versionId ? { versionId: filter.versionId } : {}),
    },
    orderBy: [{ col: 'createdAt', dir: 'desc' }],
  });

  const comments = await store.select('comments', {
    match: { projectId },
    orderBy: [{ col: 'createdAt' }],
  });
  const byThread = new Map<Id, CommentRow[]>();
  for (const comment of comments) {
    const list = byThread.get(comment.threadId) ?? [];
    list.push(comment);
    byThread.set(comment.threadId, list);
  }

  return threads.map((thread) => ({ ...thread, comments: byThread.get(thread.id) ?? [] }));
}

export async function getThread(
  store: Store,
  projectId: Id,
  threadId: Id,
): Promise<ThreadWithComments> {
  const thread = await store.find('commentThreads', { match: { id: threadId, projectId } });
  if (!thread) throw notFound('Comment thread not found.');
  const comments = await store.select('comments', {
    match: { threadId },
    orderBy: [{ col: 'createdAt' }],
  });
  return { ...thread, comments };
}

export async function setThreadStatus(
  store: Store,
  projectId: Id,
  threadId: Id,
  status: 'open' | 'resolved',
  actorId: Id | null,
): Promise<CommentThreadRow> {
  const thread = await getThread(store, projectId, threadId);
  const now = new Date().toISOString();
  const updated = await store.update('commentThreads', thread.id, {
    status,
    updatedAt: now,
    resolvedAt: status === 'resolved' ? now : null,
    resolvedBy: status === 'resolved' ? actorId : null,
  });
  getBus().publish(projectChannel(projectId), RT.commentChanged, { threadId, status });
  return updated;
}

export async function createTaskFromThread(
  store: Store,
  projectId: Id,
  threadId: Id,
  title: string,
): Promise<CommentThreadRow> {
  const thread = await getThread(store, projectId, threadId);
  const trimmed = title.trim();
  if (trimmed === '') throw badRequest('Give the task a title.');

  const updated = await store.update('commentThreads', thread.id, {
    taskTitle: trimmed.slice(0, 200),
    updatedAt: new Date().toISOString(),
  });
  getBus().publish(projectChannel(projectId), RT.commentChanged, { threadId, task: true });
  await logEvent(store, projectId, {
    kind: 'comment',
    name: `Task created: ${updated.taskTitle}`,
    payload: { threadId },
  });
  return updated;
}

/**
 * Renders a thread as the prompt you would actually paste into Claude (or that
 * `get_comment` returns over MCP). Includes the anchor so the fix is unambiguous.
 */
export function threadAsPrompt(
  thread: ThreadWithComments,
  projectName: string,
  versionLabel: string | null,
): string {
  const lines = [
    `Feedback on ${projectName}${versionLabel ? ` (${versionLabel})` : ''}:`,
    '',
    ...thread.comments.map((comment) => `- ${comment.authorName}: ${comment.body}`),
    '',
    'Context:',
    `- Screen: ${thread.screen ?? 'unknown'}`,
    `- Role: ${thread.role ?? 'unknown'}`,
    `- Device: ${thread.presetId ?? 'unknown'}`,
  ];
  if (thread.elementLabel) lines.push(`- Element: "${thread.elementLabel}"`);
  if (thread.sourceRef) lines.push(`- Source: ${thread.sourceRef}`);
  if (thread.precedingAction) lines.push(`- Previous action: ${thread.precedingAction}`);
  lines.push(
    `- Anchor: ${(thread.anchorX * 100).toFixed(1)}% across, ${(thread.anchorY * 100).toFixed(1)}% down the viewport`,
  );
  return lines.join('\n');
}
