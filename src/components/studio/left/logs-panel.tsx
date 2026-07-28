'use client';

import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api-client';
import type { EventKind, EventLevel } from '@/server/db';
import { Badge, EmptyState, IconButton, PanelHeader } from '@/components/ui/primitives';
import { useStudio } from '../context';
import { countDiagnostics } from '../store';

/**
 * Build output, runtime logs, device events and errors in one stream.
 *
 * One filter set for all of them, because when something breaks you do not yet know
 * which category it belongs to. Filters are by level and by device.
 */

const LEVEL_STYLES: Record<EventLevel, string> = {
  debug: 'text-paper-400',
  info: 'text-paper-600',
  warn: 'text-caution-700',
  error: 'text-danger-700',
};

const KIND_LABEL: Record<EventKind, string> = {
  system: 'system',
  build: 'build',
  runtime: 'runtime',
  navigation: 'nav',
  interaction: 'tap',
  'device-event': 'event',
  notification: 'notif',
  error: 'error',
  mcp: 'claude',
  journey: 'journey',
  comment: 'comment',
};

/**
 * The problems the build actually reported, above the event stream.
 *
 * The build badge sends you here, and the event stream alone could not answer:
 * a request that never reaches the compiler produces a diagnostic but no event,
 * so clicking "1 error" landed on a panel with nothing in it. Diagnostics are
 * the thing being counted, so they are the thing shown first.
 */
function ProblemsSection() {
  const diagnostics = useStudio((state) => state.diagnostics);
  const openFile = useStudio((state) => state.openFile);
  const counts = countDiagnostics(diagnostics);

  if (diagnostics.length === 0) return null;

  const sourceLabel: Record<string, string> = {
    esbuild: 'build',
    runtime: 'runtime',
    transport: 'request',
  };

  return (
    <div className="shrink-0 border-b border-paper-200 bg-danger-50/35">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.055em] text-paper-500">
          Problems
        </span>
        <Badge tone={counts.total > 0 ? 'danger' : 'caution'}>
          {counts.total > 0
            ? `${counts.total} error${counts.total === 1 ? '' : 's'}`
            : `${counts.warnings} warning${counts.warnings === 1 ? '' : 's'}`}
        </Badge>
      </div>
      <div className="max-h-[190px] overflow-y-auto pb-1.5">
        {diagnostics.map((diagnostic, index) => (
          <button
            key={`${diagnostic.source}-${index}-${diagnostic.message.slice(0, 24)}`}
            type="button"
            onClick={() => {
              // Only a compile diagnostic points at a file we can open.
              if (diagnostic.source === 'esbuild' && diagnostic.file) void openFile(diagnostic.file);
            }}
            className="flex w-full gap-2 px-2.5 py-1 text-left hover:bg-paper-100/70"
          >
            <span
              className={cn(
                'mt-[5px] size-[5px] shrink-0 rounded-full',
                diagnostic.severity === 'error' ? 'bg-danger-500' : 'bg-caution-500',
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-1.5">
                <span className="text-[10px] font-medium uppercase tracking-wide text-paper-400">
                  {sourceLabel[diagnostic.source] ?? diagnostic.source}
                </span>
                {diagnostic.file ? (
                  <span className="truncate font-mono text-[10.5px] text-paper-600">
                    {diagnostic.file}
                    {diagnostic.line ? `:${diagnostic.line}` : ''}
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 block whitespace-pre-wrap break-words font-mono text-[10.5px] leading-[1.5] text-paper-700">
                {diagnostic.message}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function LogsPanel() {
  const events = useStudio((state) => state.events);
  const devices = useStudio((state) => state.devices);
  const projectId = useStudio((state) => state.snapshot.project.id);
  const notify = useStudio((state) => state.notify);

  const [level, setLevel] = useState<'all' | EventLevel>('all');
  const [deviceId, setDeviceId] = useState<'all' | string>('all');
  const [hideChatter, setHideChatter] = useState(true);

  const filtered = useMemo(() => {
    return events
      .filter((event) => (level === 'all' ? true : event.level === level))
      .filter((event) => (deviceId === 'all' ? true : event.deviceId === deviceId))
      .filter((event) => (hideChatter ? event.kind !== 'interaction' : true))
      .slice()
      .reverse();
  }, [events, level, deviceId, hideChatter]);

  const clear = async () => {
    await api(`/api/projects/${projectId}/events`, { method: 'DELETE' }).catch(() => undefined);
    notify('info', 'Log cleared. New events will appear as they happen.');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Logs">
        <Badge tone="neutral">{filtered.length}</Badge>
        <IconButton label="Clear log" onClick={() => void clear()}>
          <Trash2 size={13} strokeWidth={1.7} />
        </IconButton>
      </PanelHeader>

      <ProblemsSection />

      <div className="flex flex-wrap items-center gap-1 border-b border-paper-200 px-2 py-1.5">
        {(['all', 'error', 'warn', 'info', 'debug'] as const).map((option) => (
          <button
            key={option}
            onClick={() => setLevel(option)}
            className={cn(
              'rounded-md px-1.5 py-[2px] text-[11px] font-medium capitalize transition-colors',
              level === option ? 'bg-paper-900 text-paper-0' : 'text-paper-500 hover:bg-paper-100',
            )}
          >
            {option}
          </button>
        ))}
        <span className="mx-0.5 h-3.5 w-px bg-paper-200" />
        <select
          value={deviceId}
          onChange={(event) => setDeviceId(event.target.value)}
          className="h-6 rounded-md border border-paper-200 bg-paper-0 px-1 text-[11px] text-paper-600"
        >
          <option value="all">All devices</option>
          {devices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => setHideChatter((current) => !current)}
          className={cn(
            'ml-auto rounded-md px-1.5 py-[2px] text-[11px] font-medium transition-colors',
            hideChatter ? 'text-paper-500 hover:bg-paper-100' : 'bg-paper-900 text-paper-0',
          )}
          title="Show every tap and keystroke"
        >
          taps
        </button>
      </div>

      <div className="pl-scroll min-h-0 flex-1 overflow-y-auto font-mono text-[11px] leading-[1.55]">
        {filtered.length === 0 ? (
          <EmptyState
            title="Nothing logged yet"
            body="Builds, navigation, cross-device events and errors all show up here as they happen."
          />
        ) : (
          filtered.map((event) => (
            <div
              key={event.id}
              className="flex gap-2 border-b border-paper-100 px-2.5 py-1.5 hover:bg-paper-50"
            >
              <span className="w-[52px] shrink-0 pl-tabular text-paper-400">
                {new Date(event.createdAt).toLocaleTimeString(undefined, {
                  hour12: false,
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
              <span className="w-[52px] shrink-0 text-paper-400">{KIND_LABEL[event.kind]}</span>
              <span className={cn('min-w-0 flex-1 break-words', LEVEL_STYLES[event.level])}>
                {event.name}
                {event.screen ? <span className="text-paper-400"> · {event.screen}</span> : null}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
