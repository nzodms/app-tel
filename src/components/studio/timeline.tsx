'use client';

import { useEffect, useMemo, useRef } from 'react';
import { ChevronDown, ChevronUp, Circle, Radio } from 'lucide-react';
import { cn } from '@/lib/cn';
import { roleColor } from '@/lib/devices/roles';
import type { EventKind } from '@/server/db';
import { Badge, Button } from '@/components/ui/primitives';
import { useStudio } from './context';

/**
 * The timeline.
 *
 * A single chronological track of what happened across every phone: navigation,
 * taps, cross-device events, notifications, builds, errors, Claude's tool calls.
 * During a replay the current step is highlighted, so you can watch a journey
 * progress here and on the phones at the same time.
 */

const SHOWN_KINDS: EventKind[] = [
  'device-event',
  'notification',
  'navigation',
  'error',
  'build',
  'mcp',
  'journey',
  'comment',
  'system',
];

const KIND_TONE: Record<string, string> = {
  'device-event': 'bg-azure-500',
  notification: 'bg-caution-500',
  navigation: 'bg-paper-400',
  error: 'bg-danger-500',
  build: 'bg-positive-500',
  mcp: 'bg-[#c08a4a]',
  journey: 'bg-role-admin',
  comment: 'bg-role-support',
  system: 'bg-paper-300',
};

export function Timeline() {
  const open = useStudio((state) => state.timelineOpen);
  const toggle = useStudio((state) => state.toggleTimeline);
  const events = useStudio((state) => state.events);
  const devices = useStudio((state) => state.devices);
  const recording = useStudio((state) => state.recording);
  const replay = useStudio((state) => state.replay);
  const selectDevice = useStudio((state) => state.selectDevice);

  const trackRef = useRef<HTMLDivElement | null>(null);

  const visible = useMemo(
    () => events.filter((event) => SHOWN_KINDS.includes(event.kind)).slice(-140),
    [events],
  );

  // Follow the newest event unless the user has scrolled back.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const nearEnd = track.scrollWidth - track.scrollLeft - track.clientWidth < 200;
    if (nearEnd) track.scrollLeft = track.scrollWidth;
  }, [visible.length]);

  const deviceById = useMemo(() => new Map(devices.map((device) => [device.id, device])), [devices]);

  return (
    <div
      className={cn(
        'shrink-0 border-t border-paper-200 bg-paper-0 transition-[height] duration-200 [transition-timing-function:var(--ease-out-quint)]',
        open ? 'h-[124px]' : 'h-9',
      )}
    >
      <div className="flex h-9 items-center gap-2 px-2.5">
        <button
          onClick={toggle}
          className="flex items-center gap-1.5 rounded-md px-1 py-1 text-[11px] font-semibold uppercase tracking-[0.055em] text-paper-500 transition-colors hover:bg-paper-100"
        >
          {open ? <ChevronDown size={13} strokeWidth={2} /> : <ChevronUp size={13} strokeWidth={2} />}
          Timeline
        </button>
        <Badge tone="neutral">{visible.length}</Badge>

        {recording?.active ? (
          <Badge tone="danger">
            <Radio size={10} strokeWidth={2.2} />
            Recording · {recording.steps.length}
          </Badge>
        ) : null}

        {replay ? (
          <Badge tone="accent">
            Replaying · step {replay.step + 1}/{replay.total}
          </Badge>
        ) : null}

        <div className="ml-auto flex items-center gap-2 text-[10.5px] text-paper-400">
          {devices.map((device) => (
            <span key={device.id} className="flex items-center gap-1">
              <span
                className="size-[6px] rounded-full"
                style={{ background: roleColor(device.role) }}
              />
              {device.name}
            </span>
          ))}
        </div>
      </div>

      {open ? (
        <div ref={trackRef} className="pl-scroll h-[84px] overflow-x-auto overflow-y-hidden px-2.5 pb-2">
          {visible.length === 0 ? (
            <div className="flex h-full items-center">
              <p className="text-[12px] text-paper-500">
                Nothing yet. Interact with a phone — navigation, cross-device events and
                notifications are recorded here.
              </p>
            </div>
          ) : (
            <div className="flex h-full items-stretch gap-1">
              {visible.map((event, index) => {
                const device = event.deviceId ? deviceById.get(event.deviceId) : null;
                const isReplayStep =
                  replay !== null && index === visible.length - 1 && event.kind !== 'build';
                return (
                  <button
                    key={event.id}
                    onClick={() => (device ? selectDevice(device.id) : undefined)}
                    className={cn(
                      'flex w-[132px] shrink-0 flex-col justify-between rounded-lg border p-1.5 text-left transition-colors',
                      isReplayStep
                        ? 'border-azure-300 bg-azure-50'
                        : 'border-paper-200 bg-paper-25 hover:bg-paper-50',
                    )}
                    title={`${event.kind} · ${event.name}`}
                  >
                    <span className="flex items-center gap-1">
                      <span className={cn('size-[6px] shrink-0 rounded-full', KIND_TONE[event.kind])} />
                      <span className="truncate text-[10px] font-medium uppercase tracking-[0.04em] text-paper-400">
                        {event.kind === 'device-event' ? 'event' : event.kind}
                      </span>
                      <span className="pl-tabular ml-auto shrink-0 text-[9.5px] text-paper-400">
                        {new Date(event.createdAt).toLocaleTimeString(undefined, {
                          hour12: false,
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'line-clamp-2 text-[11px] leading-[1.35]',
                        event.level === 'error' ? 'text-danger-700' : 'text-paper-700',
                      )}
                    >
                      {event.name}
                    </span>
                    <span className="flex items-center gap-1 text-[9.5px] text-paper-400">
                      {device ? (
                        <>
                          <Circle
                            size={6}
                            strokeWidth={0}
                            fill={roleColor(device.role)}
                            className="shrink-0"
                          />
                          <span className="truncate">{device.name}</span>
                        </>
                      ) : (
                        <span>project</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {replay ? (
        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-paper-150">
          <div
            className="h-full bg-azure-500 transition-[width] duration-200"
            style={{ width: `${((replay.step + 1) / Math.max(replay.total, 1)) * 100}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Compact controls shown while a replay is running. */
export function ReplayControls() {
  const replay = useStudio((state) => state.replay);
  const stop = useStudio((state) => state.stopReplay);

  if (!replay) return null;

  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-paper-200 bg-paper-0/95 px-3 py-1.5 shadow-float backdrop-blur">
      <span className="pl-tabular text-[12px] font-medium text-paper-700">
        Step {replay.step + 1} / {replay.total}
      </span>
      <Button size="xs" variant="danger" onClick={stop}>
        Stop
      </Button>
    </div>
  );
}
