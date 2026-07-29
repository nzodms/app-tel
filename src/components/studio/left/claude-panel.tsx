'use client';

import { useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, Link2, Plug } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge, Button, Card, EmptyState, PanelHeader, StatusDot } from '@/components/ui/primitives';
import { formatBuildDuration } from '../build-phase';
import { LiveElapsed } from '../claude-activity-strip';
import { sessionTotals, type SessionStep } from '../claude-session';
import { useClaudeSession, type ClaudeSessionView } from '../use-claude-session';
import { useStudio } from '../context';

/**
 * The Claude panel.
 *
 * Not a chat window — deliberately. Claude runs in Claude, using the user's own
 * subscription; PhoneLab's job is to be the workshop it acts on. So this panel
 * answers the questions you actually have while that is happening:
 *
 *   is the connector attached? · what is it doing right now? · what did it just
 *   do? · which files changed? · did the build survive it? · what version came
 *   out?
 *
 * Plus one genuinely useful affordance: a prompt with the current context already
 * filled in, ready to paste into Claude.
 *
 * The sequence at the top is the same session the activity strip shows — one
 * watcher, one fold of the same events (`use-claude-session.ts`) — with the room
 * this panel has and the strip does not: every step, the files each one touched,
 * and the totals. Everything in it is counted from events that happened; nothing
 * is estimated, and the one thing we cannot see (Claude generating between two
 * tool calls) is labelled as waiting rather than dressed up as progress.
 */
export function ClaudePanel() {
  const snapshot = useStudio((state) => state.snapshot);
  const events = useStudio((state) => state.events);
  const files = useStudio((state) => state.files);
  const versions = useStudio((state) => state.versions);
  const diagnostics = useStudio((state) => state.diagnostics);
  const buildStatus = useStudio((state) => state.buildStatus);
  const devices = useStudio((state) => state.devices);
  const threads = useStudio((state) => state.threads);
  const activePath = useStudio((state) => state.activeFilePath);
  const remoteBuild = useStudio((state) => state.remoteBuild);
  const session = useClaudeSession();

  const [copied, setCopied] = useState<string | null>(null);

  const mcpEvents = useMemo(
    () => events.filter((event) => event.kind === 'mcp').slice(-40).reverse(),
    [events],
  );

  const claudeFiles = useMemo(
    () =>
      files
        .filter((file) => file.lastEditedBy === 'claude')
        .sort((a, b) => b.lastEditedAt.localeCompare(a.lastEditedAt))
        .slice(0, 8),
    [files],
  );

  const connected = snapshot.mcp.connected;
  const lastCall = snapshot.mcp.recentCalls[0] ?? null;

  const prompt = useMemo(() => {
    const lines = [
      `Open my PhoneLab project "${snapshot.project.name}" (project id ${snapshot.project.id}).`,
      '',
      'Current state:',
      `- Entry point: ${snapshot.project.entryFile}`,
      `- ${files.length} files, ${versions.length} version(s)`,
      `- Devices on the canvas: ${devices.map((device) => `${device.name} (${device.role})`).join(', ') || 'none'}`,
      `- Last build: ${buildStatus}${diagnostics.length > 0 ? ` with ${diagnostics.length} diagnostic(s)` : ''}`,
    ];
    if (activePath) lines.push(`- I am looking at ${activePath}`);
    if (threads.filter((thread) => thread.status === 'open').length > 0) {
      lines.push(`- ${threads.filter((thread) => thread.status === 'open').length} open reviewer comment(s)`);
    }
    lines.push(
      '',
      'Then: <describe the change you want>',
      '',
      'Use the PhoneLab tools: read the relevant files, apply a targeted patch, start the preview to check it compiles, and create a version snapshot when it works.',
    );
    return lines.join('\n');
  }, [
    activePath,
    buildStatus,
    devices,
    diagnostics.length,
    files.length,
    snapshot.project.entryFile,
    snapshot.project.id,
    snapshot.project.name,
    threads,
    versions.length,
  ]);

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1800);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Claude">
        <Badge tone={connected ? 'positive' : 'neutral'}>
          <StatusDot tone={connected ? 'positive' : 'neutral'} pulse={connected} />
          {connected ? 'Connected' : 'Not connected'}
        </Badge>
      </PanelHeader>

      <div className="pl-scroll min-h-0 flex-1 space-y-2.5 overflow-y-auto p-2.5">
        {!connected ? (
          <Card className="p-3">
            <div className="flex items-start gap-2">
              <span className="mt-[1px] grid size-7 shrink-0 place-items-center rounded-lg bg-paper-100 text-paper-600">
                <Plug size={14} strokeWidth={1.8} />
              </span>
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold text-paper-800">
                  Connect PhoneLab to Claude
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-paper-500">
                  Add PhoneLab as a custom connector in Claude, using your own subscription. Claude
                  then gets tools to read this project, patch files, run the preview and create
                  versions — and everything it does shows up here.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button
                    size="xs"
                    variant="primary"
                    onClick={() => void copy(snapshot.mcp.endpoint, 'endpoint')}
                  >
                    {copied === 'endpoint' ? (
                      <Check size={11.5} strokeWidth={2.2} />
                    ) : (
                      <Link2 size={11.5} strokeWidth={1.9} />
                    )}
                    {copied === 'endpoint' ? 'Copied' : 'Copy connector URL'}
                  </Button>
                  <Button size="xs" onClick={() => window.open('/docs/mcp', '_blank')}>
                    Setup guide
                    <ExternalLink size={11} strokeWidth={1.9} />
                  </Button>
                </div>
                <code className="mt-2 block truncate rounded-md border border-paper-200 bg-paper-50 px-1.5 py-1 font-mono text-[10.5px] text-paper-600">
                  {snapshot.mcp.endpoint}
                </code>
              </div>
            </div>
          </Card>
        ) : (
          <Card className="p-2.5">
            <div className="flex items-center justify-between">
              <div className="text-[12px] font-semibold text-paper-800">
                {snapshot.mcp.connections[0]?.name ?? 'MCP connection'}
              </div>
              <span className="text-[10.5px] text-paper-400">
                {snapshot.mcp.connections[0]?.protocolVersion ?? 'protocol unknown'}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {(snapshot.mcp.connections[0]?.scopes ?? []).map((scope) => (
                <Badge key={scope} tone="accent">
                  {scope}
                </Badge>
              ))}
            </div>
            {/* While a sequence is live the card below says all of this, step by
                step. These lines are what is left when nothing is running. */}
            {session.live ? null : remoteBuild ? (
              <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-paper-600">
                <StatusDot tone="accent" pulse />
                {remoteBuild.triggeredBy === 'claude' ? 'Claude is building' : 'A build is running'}
                {remoteBuild.ref !== 'working' ? ' a pinned version' : ''}…
              </p>
            ) : lastCall ? (
              <p className="mt-2 text-[11.5px] text-paper-500">
                Last tool: <span className="font-medium text-paper-700">{lastCall.tool}</span> ·{' '}
                {lastCall.result} · {new Date(lastCall.createdAt).toLocaleTimeString()}
              </p>
            ) : (
              <p className="mt-2 text-[11.5px] text-paper-500">
                Connected, but no tool has been called yet.
              </p>
            )}
          </Card>
        )}

        <SessionCard view={session} />

        <Card className="p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-paper-500">
              Contextual prompt
            </span>
            <Button size="xs" onClick={() => void copy(prompt, 'prompt')}>
              {copied === 'prompt' ? <Check size={11.5} strokeWidth={2.2} /> : <Copy size={11.5} strokeWidth={1.9} />}
              {copied === 'prompt' ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <pre className="mt-1.5 max-h-[168px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-paper-200 bg-paper-50 p-2 font-mono text-[10.5px] leading-[1.55] text-paper-600">
            {prompt}
          </pre>
          <Button
            size="xs"
            variant="secondary"
            className="mt-1.5 w-full"
            onClick={() => window.open('https://claude.ai/new', '_blank', 'noopener')}
          >
            Open Claude
            <ExternalLink size={11} strokeWidth={1.9} />
          </Button>
        </Card>

        <div>
          <div className="mb-1.5 flex items-center justify-between px-0.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-paper-500">
              Activity
            </span>
            <span className="text-[10.5px] text-paper-400">{mcpEvents.length}</span>
          </div>
          {mcpEvents.length === 0 ? (
            <EmptyState
              title="No Claude activity yet"
              body="Tool calls, file edits, builds and snapshots made through MCP land here in real time."
            />
          ) : (
            <div className="overflow-hidden rounded-[var(--radius-panel)] border border-paper-200 bg-paper-0">
              {mcpEvents.map((event) => (
                <div
                  key={event.id}
                  className={cn(
                    'flex items-start gap-2 border-b border-paper-100 px-2 py-1.5 last:border-b-0',
                    event.level === 'error' && 'bg-danger-50',
                  )}
                >
                  <span className="mt-[3px] size-[6px] shrink-0 rounded-full bg-[#c08a4a]" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] text-paper-700">{event.name}</div>
                    <div className="text-[10.5px] text-paper-400">
                      {new Date(event.createdAt).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {claudeFiles.length > 0 ? (
          <div>
            <div className="mb-1.5 px-0.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-paper-500">
              Files Claude changed
            </div>
            <div className="overflow-hidden rounded-[var(--radius-panel)] border border-paper-200 bg-paper-0">
              {claudeFiles.map((file) => (
                <div
                  key={file.path}
                  className="flex items-center justify-between border-b border-paper-100 px-2 py-1.5 text-[11.5px] last:border-b-0"
                >
                  <span className="truncate text-paper-700">{file.path}</span>
                  <span className="shrink-0 text-[10.5px] text-paper-400">
                    {new Date(file.lastEditedAt).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The sequence                                                                */
/* -------------------------------------------------------------------------- */

/**
 * What Claude is doing, or did last — the same folded session the activity strip
 * shows on the canvas, with the detail the strip has no room for.
 *
 * Absent until something has actually happened. A studio that has watched nothing
 * shows no card, rather than an empty one implying a sequence is on its way.
 */
function SessionCard({ view }: { view: ClaudeSessionView }) {
  const { session } = view;
  const steps = session.steps;
  if (steps.length === 0 || session.startedAt === null) return null;

  /*
   * `sessionTotals` needs a clock, and a render must not read one: `Date.now()`
   * during render is impure, and it would make two renders of the same state
   * disagree. The last event we observed is the honest clock for a sequence that
   * has stopped; a live one gets a real ticking figure from `LiveElapsed`, which
   * reads the time inside an effect.
   */
  const totals = sessionTotals(session, session.lastEventAt ?? session.startedAt);
  const elapsed = formatBuildDuration(totals.elapsedMs);

  return (
    <Card className="p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-paper-500">
          {view.live ? 'Working now' : 'Last sequence'}
        </span>
        {view.waiting && view.label ? (
          <span className="flex shrink-0 items-center gap-1.5 text-[10.5px] text-paper-500">
            <StatusDot tone="neutral" pulse />
            {view.label}
          </span>
        ) : null}
      </div>

      <ol className="mt-2">
        {steps.map((step, index) => (
          <StepRow
            key={`${step.kind}-${step.startedAt}`}
            step={step}
            last={index === steps.length - 1}
            /* Once we have stopped calling the session live, its last step must
               stop looking live too: a pulsing dot over a clock still counting
               up says "in progress", and the whole point of `stalled` is that we
               no longer know that. The note below says what we do know. */
            stalled={view.stalled && index === steps.length - 1}
          />
        ))}
      </ol>

      {view.stalled ? (
        <p className="mt-1.5 rounded-md border border-caution-200 bg-caution-50 px-1.5 py-1 text-[10.5px] leading-snug text-caution-700">
          Nothing has been reported for over two minutes. The step above was never reported as
          finished — it may still be running, or the connection may have dropped. From here the two
          look the same.
        </p>
      ) : null}

      {/* Counts, not estimates: each one is a tally of events that arrived.
          "touched", not "written": the reducer records a target when the edit
          *starts*, so a failed edit is in this number too — and the failure
          count next to it is what says so. */}
      <div className="mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 border-t border-paper-150 pt-1.5 text-[10.5px] text-paper-500">
        <span>
          <span className="font-semibold text-paper-700">{totals.filesTouched}</span> file(s) touched
        </span>
        <span className="text-paper-300">·</span>
        <span>
          <span className="font-semibold text-paper-700">{totals.steps}</span> step(s)
        </span>
        {totals.failures > 0 ? (
          <>
            <span className="text-paper-300">·</span>
            <span className="font-medium text-danger-700">{totals.failures} failed</span>
          </>
        ) : null}
        <span className="text-paper-300">·</span>
        {view.live ? (
          <LiveElapsed startedAt={session.startedAt} className="text-[10.5px] text-paper-500" />
        ) : elapsed ? (
          <span className="pl-tabular">{elapsed}</span>
        ) : null}
      </div>

      <p className="mt-1.5 text-pretty text-[10.5px] leading-snug text-paper-400">
        Every line is a tool call, a build, or a phone reporting that it mounted. The gap between two
        calls is Claude generating — shown as waiting, because thinking is not observable through a
        connector.
      </p>
    </Card>
  );
}

/** One step, with the things it actually touched. */
function StepRow({
  step,
  last,
  stalled,
}: {
  step: SessionStep;
  last: boolean;
  stalled: boolean;
}) {
  const failed = step.status === 'failed';
  const running = step.status === 'running' && !stalled;
  // Zero would be a measurement we did not make: a mount is a moment, not a span.
  const duration =
    step.endedAt !== null && step.endedAt > step.startedAt
      ? formatBuildDuration(step.endedAt - step.startedAt)
      : null;
  const shown = step.targets.slice(0, 4);
  const hidden = step.targets.length - shown.length;

  return (
    <li className="flex gap-2">
      {/* The rail: what makes a list of rows read as one sequence. */}
      <span className="flex w-[7px] shrink-0 flex-col items-center pt-[4px]">
        {/* Never 'positive' for a stalled step: it did not succeed, we simply
            stopped hearing about it. Caution is the only honest colour. */}
        <StatusDot
          tone={failed ? 'danger' : stalled ? 'caution' : running ? 'accent' : 'positive'}
          pulse={running}
        />
        {!last ? <span aria-hidden="true" className="mt-[3px] w-px flex-1 bg-paper-200" /> : null}
      </span>

      <div className={cn('min-w-0 flex-1', last ? 'pb-0' : 'pb-2')}>
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              'truncate text-[12px] leading-tight',
              failed ? 'font-medium text-danger-700' : 'text-paper-700',
            )}
          >
            {step.label}
          </span>
          {running ? (
            <LiveElapsed startedAt={step.startedAt} className="text-[10px] text-paper-400" />
          ) : duration ? (
            <span className="pl-tabular shrink-0 text-[10px] text-paper-400">{duration}</span>
          ) : null}
        </div>

        {failed && step.error ? (
          <p className="mt-[2px] text-pretty text-[11px] leading-snug text-danger-600">
            {step.error}
          </p>
        ) : null}

        {shown.length > 0 ? (
          <div className="mt-[2px] flex flex-wrap items-baseline gap-x-1.5">
            {shown.map((target) => (
              <span key={target} className="max-w-full truncate font-mono text-[10px] text-paper-400">
                {target}
              </span>
            ))}
            {hidden > 0 ? <span className="text-[10px] text-paper-400">+{hidden}</span> : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}
