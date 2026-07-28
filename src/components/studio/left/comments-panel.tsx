'use client';

import { useState } from 'react';
import { Check, CheckCircle2, Copy, ListTodo, MessageSquare, Send } from 'lucide-react';
import { cn } from '@/lib/cn';
import { api, errorText } from '@/lib/api-client';
import { Badge, Button, EmptyState, PanelHeader, Textarea } from '@/components/ui/primitives';
import { useStudio } from '../context';

/**
 * Reviewer feedback, owner side.
 *
 * Each thread carries exactly where it was left — version, role, screen, the
 * element that was clicked and its source location. That context is what makes the
 * "Copy for Claude" button useful rather than decorative: it produces a prompt that
 * points at a specific line of a specific file.
 */
export function CommentsPanel() {
  const threads = useStudio((state) => state.threads);
  const projectId = useStudio((state) => state.snapshot.project.id);
  const projectName = useStudio((state) => state.snapshot.project.name);
  const versions = useStudio((state) => state.versions);
  const notify = useStudio((state) => state.notify);
  const openFile = useStudio((state) => state.openFile);

  const [filter, setFilter] = useState<'open' | 'resolved' | 'all'>('open');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const visible = threads.filter((thread) =>
    filter === 'all' ? true : thread.status === filter,
  );

  const act = async (body: Record<string, unknown>, message: string) => {
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}/comments`, { body });
      notify('success', message);
    } catch (error) {
      notify('error', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const promptFor = (threadId: string): string => {
    const thread = threads.find((entry) => entry.id === threadId);
    if (!thread) return '';
    const version = versions.find((entry) => entry.id === thread.versionId);
    const lines = [
      `Fix this feedback on my PhoneLab project "${projectName}" (project id ${projectId}).`,
      '',
      `Thread id: ${thread.id}`,
      ...thread.comments.map((comment) => `- ${comment.authorName}: ${comment.body}`),
      '',
      'Context:',
      `- Version: ${version?.label ?? 'working tree'}`,
      `- Role: ${thread.role ?? 'unknown'} · Screen: ${thread.screen ?? 'unknown'} · Device: ${thread.presetId ?? 'unknown'}`,
      thread.elementLabel ? `- Element: "${thread.elementLabel}"` : null,
      thread.sourceRef ? `- Source: ${thread.sourceRef}` : null,
      thread.precedingAction ? `- Previous action: ${thread.precedingAction}` : null,
      '',
      'Use get_comment for the full context, patch the file, restart the preview, then reply on the thread and resolve it.',
    ].filter(Boolean) as string[];
    return lines.join('\n');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Comments">
        <Badge tone={visible.length > 0 ? 'caution' : 'neutral'}>{visible.length}</Badge>
      </PanelHeader>

      <div className="flex items-center gap-1 border-b border-paper-200 px-2 py-1.5">
        {(['open', 'resolved', 'all'] as const).map((option) => (
          <button
            key={option}
            onClick={() => setFilter(option)}
            className={cn(
              'rounded-md px-1.5 py-[2px] text-[11px] font-medium capitalize transition-colors',
              filter === option ? 'bg-paper-900 text-paper-0' : 'text-paper-500 hover:bg-paper-100',
            )}
          >
            {option}
          </button>
        ))}
      </div>

      <div className="pl-scroll min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <EmptyState
            icon={<MessageSquare size={16} strokeWidth={1.8} />}
            title={filter === 'open' ? 'No open comments' : 'Nothing here'}
            body="Share a version with an associate or beta tester. Their comments land here anchored to the exact screen and element."
          />
        ) : (
          visible.map((thread) => {
            const version = versions.find((entry) => entry.id === thread.versionId);
            return (
              <div key={thread.id} className="border-b border-paper-100 p-2.5">
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'size-[7px] shrink-0 rounded-full',
                      thread.status === 'open' ? 'bg-caution-500' : 'bg-positive-500',
                    )}
                  />
                  <span className="truncate text-[12px] font-semibold text-paper-800">
                    {thread.comments[0]?.authorName ?? 'Reviewer'}
                  </span>
                  {thread.taskTitle ? <Badge tone="accent">task</Badge> : null}
                  <span className="ml-auto shrink-0 text-[10.5px] text-paper-400">
                    {new Date(thread.createdAt).toLocaleDateString()}
                  </span>
                </div>

                <div className="mt-1.5 space-y-1.5">
                  {thread.comments.map((comment) => (
                    <div key={comment.id} className="text-[12px] leading-relaxed">
                      {thread.comments.length > 1 ? (
                        <span
                          className={cn(
                            'mr-1 font-semibold',
                            comment.authorKind === 'claude' ? 'text-[#8a5a2b]' : 'text-paper-700',
                          )}
                        >
                          {comment.authorName}:
                        </span>
                      ) : null}
                      <span className="text-paper-600">{comment.body}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10.5px] text-paper-400">
                  <span>{version?.label ?? 'working tree'}</span>
                  {thread.role ? <span>· {thread.role}</span> : null}
                  {thread.screen ? <span>· {thread.screen}</span> : null}
                  {thread.presetId ? <span>· {thread.presetId}</span> : null}
                </div>

                {thread.sourceRef ? (
                  <button
                    onClick={() => {
                      const path = thread.sourceRef?.split(':')[0];
                      if (path) void openFile(path);
                    }}
                    className="mt-1 block max-w-full truncate rounded border border-paper-200 bg-paper-50 px-1.5 py-[2px] font-mono text-[10.5px] text-azure-700 hover:bg-azure-50"
                  >
                    {thread.sourceRef}
                  </button>
                ) : null}

                <div className="mt-2 flex flex-wrap gap-1">
                  <Button
                    size="xs"
                    onClick={() => setReplyTo(replyTo === thread.id ? null : thread.id)}
                  >
                    <Send size={11} strokeWidth={1.9} />
                    Reply
                  </Button>
                  <Button
                    size="xs"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        {
                          action: 'status',
                          threadId: thread.id,
                          status: thread.status === 'open' ? 'resolved' : 'open',
                        },
                        thread.status === 'open' ? 'Thread resolved' : 'Thread reopened',
                      )
                    }
                  >
                    <CheckCircle2 size={11} strokeWidth={1.9} />
                    {thread.status === 'open' ? 'Resolve' : 'Reopen'}
                  </Button>
                  <Button
                    size="xs"
                    disabled={busy || Boolean(thread.taskTitle)}
                    onClick={() => {
                      const title = window.prompt(
                        'Task title',
                        thread.comments[0]?.body.slice(0, 80) ?? 'Fix reviewer feedback',
                      );
                      if (title) void act({ action: 'task', threadId: thread.id, title }, 'Task created');
                    }}
                  >
                    <ListTodo size={11} strokeWidth={1.9} />
                    {thread.taskTitle ? 'Task created' : 'Make task'}
                  </Button>
                  <Button
                    size="xs"
                    onClick={async () => {
                      await navigator.clipboard.writeText(promptFor(thread.id));
                      setCopied(thread.id);
                      window.setTimeout(
                        () => setCopied((current) => (current === thread.id ? null : current)),
                        1800,
                      );
                    }}
                  >
                    {copied === thread.id ? (
                      <Check size={11} strokeWidth={2.2} />
                    ) : (
                      <Copy size={11} strokeWidth={1.9} />
                    )}
                    {copied === thread.id ? 'Copied' : 'Copy for Claude'}
                  </Button>
                </div>

                {replyTo === thread.id ? (
                  <div className="mt-2 space-y-1.5">
                    <Textarea
                      rows={3}
                      value={replyBody}
                      onChange={(event) => setReplyBody(event.target.value)}
                      placeholder="Reply to the reviewer…"
                      className="text-[12px]"
                    />
                    <div className="flex gap-1">
                      <Button
                        size="xs"
                        variant="primary"
                        disabled={busy || replyBody.trim() === ''}
                        onClick={async () => {
                          await act(
                            { action: 'reply', threadId: thread.id, body: replyBody.trim() },
                            'Reply posted',
                          );
                          setReplyBody('');
                          setReplyTo(null);
                        }}
                      >
                        Post reply
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => setReplyTo(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
