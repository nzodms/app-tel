'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronDown, ChevronUp, Radio } from 'lucide-react';
import { cn } from '@/lib/cn';
import { roleColor } from '@/lib/devices/roles';
import type { DeviceEventRow, EventKind } from '@/server/db';
import { Badge, Button } from '@/components/ui/primitives';
import { canvasApi } from './canvas/canvas-api';
import { formatBuildDuration } from './build-phase';
import { useStudio } from './context';

/**
 * The timeline.
 *
 * One chronological line along the bottom of the studio: every event the project
 * logged, in order, drawn as a mark on a rail. Navigation, taps that mattered,
 * cross-device messages, notifications, builds, errors, and Claude's own tool
 * calls all land in the same stream (`state.events`, `DeviceEventRow`s), so the
 * strip is the one place where "what happened, and in what order" is answerable.
 *
 * ## What every mark and every number here is made of
 *
 * Nothing on this strip is computed from anything but the store.
 *
 * - A mark is one `DeviceEventRow`. There is no mark for something that did not
 *   produce an event, and no event produces two marks.
 * - The colour is read off the row: its `level` first (an error is red and a
 *   warning is amber whatever kind it arrived as), then its `kind`, and for
 *   anything a device emitted, that device's own role colour — the same colour
 *   the phone carries on the canvas.
 * - The rail's newest segment grows in when a new event arrives, and only then.
 *   It is a CSS transform on one element that mounts with the new mark, so it
 *   can only ever grow forward, and `globals.css` collapses it under
 *   reduced-motion without this file knowing the preference exists.
 * - The read-out counts what is in the store and nothing else:
 *     events      — the events on this timeline. When more are held than are
 *                   drawn, the count is still of all of them and its tooltip
 *                   says how many were left off.
 *     files       — distinct file paths named by Claude's file tools in those
 *                   events. Files, said as files. The studio knows paths; it
 *                   does not know components, and "components changed" is not a
 *                   number anything here can observe, so it is not shown.
 *     last build  — `bundles.working.lastCompletedMs`, the last build of the
 *                   working tree that finished. That includes builds that
 *                   failed, which is why it is labelled "last build" and never
 *                   "compiled in".
 *
 * ## Density
 *
 * Marks share the width equally (`flex-1`), capped at a chip's worth and floored
 * at a legible tick. So three events are three labelled chips at the left of an
 * otherwise empty rail, thirty are unlabelled ticks with room between them, and
 * three hundred are a dense bead of colour that scrolls — where a red column is
 * findable from across the room. The label appears when a mark is actually wide
 * enough to hold one; that is measured, once, per resize, never per pointer move.
 *
 * Past `NODE_CAP` the oldest are not drawn at all. That is a real limit and it
 * is stated rather than hidden: the event count keeps counting them and says in
 * its tooltip how many are off the strip.
 *
 * The name of whatever the pointer (or the keyboard) is on is written to the line
 * under the rail. It is written straight to a text node, so moving across three
 * hundred marks costs no React renders at all. With nothing pointed at, that line
 * says what happened last — which is true, and is what you want it to say.
 *
 * ## What is clickable
 *
 * Only a mark with somewhere real to go:
 *   - Claude wrote a file that still exists  → opens that file.
 *   - a build, or anything at error level    → opens the Logs panel, where the
 *                                              diagnostics and the full stream are.
 *   - anything a device emitted              → selects that device and brings it
 *                                              into view on the canvas.
 * A mark with none of those is drawn but not focusable and not pressable: a
 * control that does nothing is worse than no control. Its text is still in the
 * DOM for a screen reader, and still in its tooltip.
 *
 * ## What this deliberately does not claim
 *
 * - No mark is highlighted as "the current replay step". The strip cannot know
 *   which event a replay step produced — a step can produce none, or several —
 *   and the previous version highlighted the newest event instead, which is a
 *   different thing wearing that meaning. Replay progress is stated where it is
 *   actually known: the badge and the progress bar, both driven by `state.replay`.
 * - No mark is invented for a file saved from the editor. The studio's own writes
 *   publish `file.changed` on the realtime bus but log no event, so they are not
 *   in this stream and the file count does not include them.
 */

/* -------------------------------------------------------------------------- */
/* Shape                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Kinds drawn on the strip. `interaction` (every tap and keystroke) and
 * `runtime` (the app's own console) are chatter at this density and live in the
 * Logs panel instead — except when they carry an error, which `isShown` lets
 * through whatever the kind. An error is never filtered out of the timeline.
 */
const SHOWN_KINDS: readonly EventKind[] = [
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

/** Marks drawn at once. Beyond this the oldest are not drawn, and the count says so. */
const NODE_CAP = 240;
/** A tick you can still see, aim at and tell apart from its neighbour. */
const NODE_MIN_PX = 14;
/** A chip's worth. Past this, extra width buys nothing. */
const NODE_MAX_PX = 132;
/** Below this a mark cannot hold a legible name, so it does not pretend to. */
const LABEL_MIN_PX = 92;
/** The dot on the rail. */
const DOT_PX = 7;

/*
 * Geometry, in one place and derived, because the rail is a separately
 * positioned element that has to land exactly on the middle of every dot. Left
 * as three independent literals — a padding here, a row height there, a `top`
 * over in the rail — the first person to nudge one of them silently detaches
 * the line from the marks it is supposed to connect.
 */
const PAD_TOP_PX = 6;
const LABEL_ROW_PX = 24;
const RAIL_ROW_PX = 13;
const META_ROW_PX = 12;
/** Centre of every dot, from the top of its mark. */
const RAIL_Y_PX = PAD_TOP_PX + LABEL_ROW_PX + RAIL_ROW_PX / 2;
/** A mark's own height. Fixed, so every dot sits on the same line. */
const MARK_H_PX = PAD_TOP_PX + LABEL_ROW_PX + RAIL_ROW_PX + META_ROW_PX;
/**
 * Room for the focus ring around a mark: 2px of outline at 1px of offset, from
 * the global `:focus-visible` rule. The track clips its own overflow, so without
 * this the ring on a focused mark would be cut off at the top and bottom — which
 * is the same as not having one for the person who needs it most.
 */
const FOCUS_RING_PX = 3;
/** A classic (non-overlay) horizontal scrollbar, which only appears at density. */
const SCROLLBAR_PX = 9;
const TRACK_H_PX = FOCUS_RING_PX + MARK_H_PX + FOCUS_RING_PX + SCROLLBAR_PX;
/** The header, which is `h-9`. */
const HEADER_H_PX = 36;
/** The line under the rail that names what the pointer is on. */
const READOUT_H_PX = 20;
const OPEN_H_PX = HEADER_H_PX + TRACK_H_PX + READOUT_H_PX;
/** Devices named in the header legend before it starts counting instead. */
const LEGEND_MAX = 4;
/** How far from the end the view can be and still follow the newest mark. */
const FOLLOW_SLACK_PX = 240;
/** The newest rail segment drawing itself in. Short enough to read as arrival. */
const GROW_MS = 220;

/**
 * Claude's colour. Not a theme token — the same literal the Files panel and the
 * Claude panel already use for "Claude touched this", and the timeline agreeing
 * with them matters more than the token would.
 */
const CLAUDE_TONE = '#c08a4a';
const NEUTRAL_TONE = 'var(--color-paper-400)';

/**
 * Separators for the device key below. ASCII unit and record separators: they
 * cannot occur in a device id, name or role slug, so the key is unambiguous
 * without escaping.
 */
const FIELD_SEP = '\u001f';
const RECORD_SEP = '\u001e';

const KIND_LABEL: Record<EventKind, string> = {
  system: 'system',
  build: 'build',
  runtime: 'log',
  navigation: 'route',
  interaction: 'tap',
  'device-event': 'event',
  notification: 'notify',
  error: 'error',
  mcp: 'claude',
  journey: 'journey',
  comment: 'comment',
};

/** Where a click goes. Absent when the event names nothing that can be opened. */
type NodeAction =
  | { kind: 'file'; path: string }
  | { kind: 'logs' }
  | { kind: 'device'; deviceId: string; deviceName: string };

interface NodeView {
  id: string;
  event: DeviceEventRow;
  /** Fill of the dot. A CSS colour, resolved from level → kind → device role. */
  tone: string;
  /** A ring rather than a fill: a Claude call that touched no file. */
  hollow: boolean;
  /** A faint full-height column, so builds and errors are findable at 300 marks. */
  spine: 'error' | 'build' | null;
  /** `level` says error, or the row arrived as one. Never inferred from anything else. */
  failed: boolean;
  kindLabel: string;
  time: string;
  /** One line: what this event was. Used for the tooltip, the read-out and AT. */
  detail: string;
  action: NodeAction | null;
}

interface DeviceInfo {
  name: string;
  role: string;
}

/* -------------------------------------------------------------------------- */
/* Reading one row                                                             */
/* -------------------------------------------------------------------------- */

/** An error is always drawn, whatever kind carried it. */
function isShown(event: DeviceEventRow): boolean {
  return event.level === 'error' || SHOWN_KINDS.includes(event.kind);
}

/**
 * The file an MCP call named, if it named one.
 *
 * Restricted to `mcp` on purpose: a `navigation` row also carries `from`/`to`,
 * and those are routes ("/court"), not paths. Treating one as the other would
 * offer to open a file that never existed.
 */
function mcpFilePath(event: DeviceEventRow): string | null {
  if (event.kind !== 'mcp') return null;
  for (const key of ['path', 'to', 'from'] as const) {
    const value = event.payload[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

/**
 * One shared formatter rather than `toLocaleTimeString` per row: at three hundred
 * marks re-formatted on every arriving event, constructing the formatter is the
 * expensive half.
 */
let timeFormat: Intl.DateTimeFormat | null = null;

function formatTime(iso: string): string {
  timeFormat ??= new Intl.DateTimeFormat(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '' : timeFormat.format(at);
}

function describe(
  event: DeviceEventRow,
  device: DeviceInfo | null,
  fileExists: (path: string) => boolean,
  /** False until the client has mounted — see the note on `mounted` below. */
  withTime: boolean,
): NodeView {
  const failed = event.level === 'error' || event.kind === 'error';
  const warned = event.level === 'warn';
  const path = mcpFilePath(event);

  let tone = NEUTRAL_TONE;
  let hollow = false;
  let spine: NodeView['spine'] = null;

  if (failed) {
    // Including a build that failed: the mark that matters is that it failed,
    // not that it was a build.
    tone = 'var(--color-danger-500)';
    spine = 'error';
  } else if (warned) {
    tone = 'var(--color-caution-500)';
  } else {
    switch (event.kind) {
      case 'build':
        tone = 'var(--color-positive-500)';
        spine = 'build';
        break;
      case 'mcp':
        tone = CLAUDE_TONE;
        /*
         * Filled = this call named a file. Hollow = it did not.
         *
         * That is all the ring claims, and all it can claim. It is NOT "Claude
         * looking around": Claude's read tools (`read_file`, `read_files`,
         * `search_code`, `list_files`) log no event at all, so a read never
         * reaches this strip. The calls that log without naming a file are the
         * ones that changed something else — a device (`create_device`,
         * `set_device_state`) or a version (`create_version`,
         * `restore_version`). Hollow therefore means "Claude changed something
         * that is not a file", which is exactly why the mark still carries the
         * event's own name in its tooltip and its label.
         */
        hollow = path === null;
        break;
      case 'journey':
        tone = 'var(--color-role-admin)';
        break;
      case 'comment':
        tone = 'var(--color-role-support)';
        break;
      case 'device-event':
      case 'notification':
      case 'navigation':
      case 'interaction':
        tone = device ? roleColor(device.role) : NEUTRAL_TONE;
        break;
      default:
        tone = NEUTRAL_TONE;
        break;
    }
  }

  const time = withTime ? formatTime(event.createdAt) : '';
  const detail = [time, KIND_LABEL[event.kind], event.name, device?.name, event.screen]
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join(' · ');

  let action: NodeAction | null = null;
  if (path !== null && fileExists(path)) {
    action = { kind: 'file', path };
  } else if (failed || event.kind === 'build') {
    action = { kind: 'logs' };
  } else if (event.deviceId !== null && device !== null) {
    action = { kind: 'device', deviceId: event.deviceId, deviceName: device.name };
  }

  return {
    id: event.id,
    event,
    tone,
    hollow,
    spine,
    failed,
    kindLabel: KIND_LABEL[event.kind],
    time,
    detail,
    action,
  };
}

/* Hydration probe — see `mounted` below. Nothing to subscribe to: the answer
   changes exactly once, and React re-renders after hydration on its own. */
const subscribeNothing = (): (() => void) => () => undefined;
const hydrated = (): boolean => true;
const notHydrated = (): boolean => false;

function actionVerb(action: NodeAction): string {
  if (action.kind === 'file') return `Open ${action.path}`;
  if (action.kind === 'logs') return 'Open the logs';
  return `Select ${action.deviceName}`;
}

/* -------------------------------------------------------------------------- */
/* The strip                                                                   */
/* -------------------------------------------------------------------------- */

export function Timeline() {
  const open = useStudio((state) => state.timelineOpen);
  const toggle = useStudio((state) => state.toggleTimeline);
  const events = useStudio((state) => state.events);
  const openFile = useStudio((state) => state.openFile);
  const setLeftTab = useStudio((state) => state.setLeftTab);
  const selectDevice = useStudio((state) => state.selectDevice);

  /*
   * Narrow subscriptions.
   *
   * `state.devices` is a new array every time a phone is dragged, and
   * `state.files` a new array every time one is saved — subscribing to either
   * would re-render three hundred marks for something the strip cannot even
   * show. Both selectors therefore return a *string*: zustand compares with
   * Object.is, so an unchanged set of devices or paths is an unchanged string
   * and no render happens. The join runs on every store update and costs a
   * dozen concatenations; the render it avoids costs far more.
   */
  const deviceKey = useStudio((state) =>
    state.devices
      .map((device) => `${device.id}${FIELD_SEP}${device.name}${FIELD_SEP}${device.role}`)
      .join(RECORD_SEP),
  );
  const filePathKey = useStudio((state) => state.files.map((file) => file.path).join('\n'));

  // Primitives, so these re-render the strip only when the number itself moves.
  const lastBuildMs = useStudio((state) => state.bundles['working']?.lastCompletedMs ?? null);
  const buildEntry = useStudio((state) => state.bundles['working']?.entry ?? null);
  const recordedSteps = useStudio((state) => (state.recording?.active ? state.recording.steps.length : -1));
  const replaying = useStudio((state) => state.replay !== null);
  const replayStep = useStudio((state) => state.replay?.step ?? 0);
  const replayTotal = useStudio((state) => state.replay?.total ?? 0);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const detailRef = useRef<HTMLSpanElement | null>(null);
  const widthRef = useRef(0);
  const countRef = useRef(0);

  const [roomy, setRoomy] = useState(false);
  /*
   * Times are formatted in the visitor's locale and time zone, and the server
   * renders this component too. Holding them back until the client has hydrated
   * is what keeps the first client render byte-identical to the server's — the
   * previous version formatted during render and could disagree with itself on
   * hydration. `useSyncExternalStore` with a differing server snapshot is the
   * documented way to ask "am I hydrated yet"; a flag set from an effect would
   * be a cascading render for the same answer.
   */
  const mounted = useSyncExternalStore(subscribeNothing, hydrated, notHydrated);

  const devices = useMemo(() => {
    const map = new Map<string, DeviceInfo>();
    if (deviceKey === '') return map;
    for (const entry of deviceKey.split(RECORD_SEP)) {
      const [id, name, role] = entry.split(FIELD_SEP);
      if (id !== undefined && name !== undefined && role !== undefined) map.set(id, { name, role });
    }
    return map;
  }, [deviceKey]);

  const filePaths = useMemo(
    () => new Set(filePathKey === '' ? [] : filePathKey.split('\n')),
    [filePathKey],
  );

  const shown = useMemo(() => events.filter(isShown), [events]);

  const nodes = useMemo(() => {
    const fileExists = (path: string) => filePaths.has(path);
    return shown
      .slice(-NODE_CAP)
      .map((event) =>
        describe(event, event.deviceId ? (devices.get(event.deviceId) ?? null) : null, fileExists, mounted),
      );
  }, [shown, devices, filePaths, mounted]);

  /** Distinct paths Claude's file tools named. Files, and said as files. */
  const fileCount = useMemo(() => {
    const paths = new Set<string>();
    for (const event of shown) {
      const path = mcpFilePath(event);
      if (path !== null) paths.add(path);
    }
    return paths.size;
  }, [shown]);

  const last = nodes[nodes.length - 1] ?? null;
  const lastId = last?.id ?? null;
  /*
   * "Did an event actually arrive?", which is the only thing allowed to make the
   * rail move.
   *
   * State adjusted during render rather than a ref read during one: the value
   * has to be *rendered*, and React re-runs the component before committing, so
   * the pass that sees the change is discarded and the pass that draws the new
   * mark has `arrived` already true. It stays true for later renders with the
   * same newest event, which is harmless — a segment reads it once, at mount.
   *
   * A first render, and a first event after the log was cleared, both leave it
   * false: the strip appearing is not an event arriving. (The first mark has no
   * segment to grow anyway — there is nothing behind it to grow from.)
   */
  const [seen, setSeen] = useState<{ id: string | null; arrived: boolean }>({
    id: lastId,
    arrived: false,
  });
  if (seen.id !== lastId) setSeen({ id: lastId, arrived: seen.id !== null && lastId !== null });
  const arrived = seen.id === lastId && seen.arrived;

  const defaultDetail = last?.detail ?? '';

  /* Label visibility: measured once per resize, never on a pointer path. */
  const measure = useCallback((count: number) => {
    setRoomy(count > 0 && widthRef.current / count >= LABEL_MIN_PX);
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      widthRef.current = entry.contentRect.width;
      measure(countRef.current);
    });
    observer.observe(track);
    return () => observer.disconnect();
  }, [measure, open]);

  useEffect(() => {
    countRef.current = nodes.length;
    measure(nodes.length);
  }, [nodes.length, measure]);

  /*
   * Follow the newest mark unless the user has scrolled back to read history.
   * Keyed on the newest id rather than on the count: once the strip is at its
   * cap the count stops changing while events keep arriving, and the previous
   * version stopped following at exactly that point.
   */
  useEffect(() => {
    const track = trackRef.current;
    if (!track || !open) return;
    const nearEnd = track.scrollWidth - track.scrollLeft - track.clientWidth < FOLLOW_SLACK_PX;
    if (nearEnd) track.scrollLeft = track.scrollWidth;
  }, [lastId, open, roomy]);

  /*
   * The read-out under the rail is written straight to its text node. Three
   * hundred marks, one delegated listener, zero React renders while the pointer
   * crosses them — and nothing here reads or writes layout.
   */
  useEffect(() => {
    // `open` is a dependency because the node itself only exists while the strip
    // is open: re-opening onto an unchanged newest event would otherwise leave
    // the line blank.
    if (detailRef.current) detailRef.current.textContent = defaultDetail;
  }, [defaultDetail, open]);

  const point = useCallback((event: { target: EventTarget | null }) => {
    const node = detailRef.current;
    if (!node) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const mark = target.closest<HTMLElement>('[data-detail]');
    if (mark?.dataset.detail) node.textContent = mark.dataset.detail;
  }, []);

  const unpoint = useCallback(() => {
    if (detailRef.current) detailRef.current.textContent = defaultDetail;
  }, [defaultDetail]);

  const run = useCallback(
    (action: NodeAction) => {
      if (action.kind === 'file') {
        void openFile(action.path);
        return;
      }
      if (action.kind === 'logs') {
        setLeftTab('logs');
        return;
      }
      selectDevice(action.deviceId);
      // Selecting a phone that is off-screen is not visible as a selection. The
      // canvas pans the minimum distance and does nothing at all when the device
      // is already fully in view; it moves device nodes, never an iframe.
      canvasApi.get()?.revealDevice(action.deviceId);
    },
    [openFile, setLeftTab, selectDevice],
  );

  const truncated = shown.length - nodes.length;

  return (
    <div
      // A stable handle for browser checks. The strip's markup is free to change;
      // the claim "it shows real events and counts real things" should not have to
      // be re-guessed from class names each time it does.
      data-testid="timeline"
      className={cn(
        // `relative` is load bearing: the replay progress bar below is absolute,
        // and without it the bar resolved against the canvas column instead —
        // right by accident, wrong the moment anything above it gains position.
        'relative shrink-0 overflow-hidden border-t border-paper-200 bg-paper-0',
        'transition-[height] duration-200 [transition-timing-function:var(--ease-out-quint)]',
      )}
      style={{ height: open ? OPEN_H_PX : HEADER_H_PX }}
    >
      <div className="flex h-9 items-center gap-2 px-2.5">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className={cn(
            'flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-1 transition-colors hover:bg-paper-100',
            'text-[11px] font-semibold uppercase tracking-[0.055em] text-paper-600',
          )}
        >
          {open ? <ChevronDown size={13} strokeWidth={2} /> : <ChevronUp size={13} strokeWidth={2} />}
          Timeline
        </button>

        {recordedSteps >= 0 ? (
          <Badge tone="danger">
            <Radio size={10} strokeWidth={2.2} />
            Recording · {recordedSteps}
          </Badge>
        ) : null}

        {replaying ? (
          <Badge tone="accent">
            {/* The fraction is drawn only when there is a real denominator.
                `update_journey` accepts an empty `steps` array (unlike
                `create_journey`, which requires one), so a journey can be left
                with no steps and still be run — and `Math.max(total, 1)` would
                turn that into "step 1/1", a step that does not exist, under a
                progress bar sitting at 100%. Say the one thing that is known
                instead: a replay is running. */}
            {replayTotal > 0 ? `Replaying · step ${replayStep + 1}/${replayTotal}` : 'Replaying'}
          </Badge>
        ) : null}

        <div className="ml-auto flex min-w-0 items-center gap-3">
          {/* Which colour is which phone. Hidden when the column is too narrow to
              hold it and the numbers, which are the thing that must survive. */}
          <div className="hidden min-w-0 items-center gap-2 text-[10.5px] text-paper-500 lg:flex">
            {[...devices.entries()].slice(0, LEGEND_MAX).map(([id, device]) => (
              <span key={id} className="flex min-w-0 items-center gap-1">
                <span
                  className="size-[6px] shrink-0 rounded-full"
                  style={{ background: roleColor(device.role) }}
                />
                <span className="truncate">{device.name}</span>
              </span>
            ))}
            {/* Said, rather than quietly dropped: a legend that hides two of your
                phones is a legend that lies about the colours on the rail. */}
            {devices.size > LEGEND_MAX ? (
              <span className="pl-tabular shrink-0 text-paper-400">
                +{devices.size - LEGEND_MAX}
              </span>
            ) : null}
          </div>

          <ActivityReadOut
            events={shown.length}
            truncated={truncated}
            files={fileCount}
            buildMs={lastBuildMs}
            buildEntry={buildEntry}
          />
        </div>
      </div>

      {open ? (
        <>
          <div
            ref={trackRef}
            style={{ height: TRACK_H_PX, paddingTop: FOCUS_RING_PX }}
            className="pl-scroll overflow-x-auto overflow-y-hidden px-2.5"
            onMouseOver={point}
            onFocus={point}
            onMouseLeave={unpoint}
            onBlur={unpoint}
          >
            {nodes.length === 0 ? (
              <p className="flex h-full items-center text-[12px] text-paper-500">
                Nothing yet. Builds, navigation, cross-device events, errors and Claude’s own
                tool calls all appear here, in order, as they happen.
              </p>
            ) : (
              // items-start, not stretch: a mark is exactly as tall as its own
              // rows, which leaves the focus ring and the scrollbar the room
              // budgeted for them above.
              <ol className="flex items-start">
                {nodes.map((node, index) => (
                  <Mark
                    key={node.id}
                    node={node}
                    roomy={roomy}
                    first={index === 0}
                    newest={index === nodes.length - 1}
                    grow={index === nodes.length - 1 && arrived}
                    onRun={run}
                  />
                ))}
              </ol>
            )}
          </div>

          {/* What the pointer is on, or — pointing at nothing — what happened
              last. Written imperatively; React renders an empty node. */}
          <div className="flex items-center px-2.5" style={{ height: READOUT_H_PX }}>
            {/* min-w-0: without it a flex item refuses to shrink below its
                content and a long event name pushes the strip sideways instead
                of ellipsing. */}
            <span
              ref={detailRef}
              aria-hidden="true"
              className="min-w-0 flex-1 truncate text-[10.5px] leading-none text-paper-500"
            />
          </div>
        </>
      ) : null}

      {/* No steps, no progress: a bar needs a real denominator to mean anything,
          and a full bar for a journey with nothing in it is a drawing of
          progress rather than a report of it. */}
      {replaying && replayTotal > 0 ? (
        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-paper-150">
          <div
            className="h-full bg-azure-500 transition-[width] duration-200 [transition-timing-function:var(--ease-out-quint)]"
            style={{ width: `${((replayStep + 1) / replayTotal) * 100}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* One mark on the rail                                                        */
/* -------------------------------------------------------------------------- */

function Mark({
  node,
  roomy,
  first,
  newest,
  grow,
  onRun,
}: {
  node: NodeView;
  /** There is room for this mark's name. Decided by measurement, not by count. */
  roomy: boolean;
  /** Nothing precedes it, so it has no rail segment to draw. */
  first: boolean;
  /** The last thing that happened. Carries a ring, so the head of the line shows. */
  newest: boolean;
  /** Its event has just arrived, so its rail segment may draw itself in. */
  grow: boolean;
  onRun: (action: NodeAction) => void;
}) {
  const { event, action } = node;

  const dot = (
    <span
      className="rounded-full"
      style={{
        width: DOT_PX,
        height: DOT_PX,
        background: node.hollow ? 'transparent' : node.tone,
        boxShadow: newest ? `0 0 0 2.5px color-mix(in srgb, ${node.tone} 20%, transparent)` : undefined,
        ...(node.hollow ? { border: `1.5px solid ${node.tone}` } : {}),
      }}
    />
  );

  /*
   * The three rows keep their heights whether or not they hold anything, which
   * is what pins every dot — and therefore the rail — to the same line at every
   * density. An empty row at high density is not wasted space; it is the reason
   * the line is straight.
   */
  const body = (
    <>
      <span
        className="flex w-full items-end justify-center overflow-hidden"
        style={{ height: LABEL_ROW_PX }}
      >
        {roomy ? (
          <span
            className={cn(
              'line-clamp-2 w-full text-center text-[10.5px] leading-[1.15]',
              node.failed ? 'font-medium text-danger-700' : 'text-paper-700',
            )}
          >
            {event.name}
          </span>
        ) : null}
      </span>
      <span
        className="flex w-full items-center justify-center"
        style={{ height: RAIL_ROW_PX }}
      >
        {dot}
      </span>
      <span
        className="flex w-full items-center justify-center gap-1 overflow-hidden"
        style={{ height: META_ROW_PX }}
      >
        {roomy ? (
          <>
            <span className="truncate text-[9px] uppercase tracking-[0.05em] text-paper-400">
              {node.kindLabel}
            </span>
            <span className="pl-tabular shrink-0 text-[9px] text-paper-400">{node.time}</span>
          </>
        ) : null}
      </span>
    </>
  );

  const inner = 'flex h-full w-full flex-col items-center';
  const innerStyle = { paddingTop: PAD_TOP_PX };

  /*
   * `flex-1` with a floor and a ceiling is the whole density rule: marks divide
   * the width equally, stop growing at a chip's worth, and stop shrinking at a
   * legible tick — past which they overflow and the strip scrolls. No shrink
   * utility here: the basis is already 0, so the floor is what decides, and a
   * second opinion about it could only disagree with the first.
   */
  return (
    <li
      className="relative flex flex-1"
      style={{ minWidth: NODE_MIN_PX, maxWidth: NODE_MAX_PX, height: MARK_H_PX }}
    >
      {/* A build and an error each get a faint column, so the beats of a session
          and the places it went wrong are findable without reading a word. */}
      {node.spine ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2"
          style={{
            width: node.spine === 'error' ? 2 : 1,
            background:
              node.spine === 'error'
                ? 'color-mix(in srgb, var(--color-danger-500) 26%, transparent)'
                : 'color-mix(in srgb, var(--color-positive-500) 20%, transparent)',
          }}
        />
      ) : null}

      {action ? (
        <button
          type="button"
          data-detail={node.detail}
          title={node.detail}
          aria-label={`${actionVerb(action)} — ${node.detail}`}
          onClick={() => onRun(action)}
          style={innerStyle}
          className={cn(inner, 'cursor-pointer rounded-[5px] transition-colors hover:bg-paper-100/60')}
        >
          {body}
        </button>
      ) : (
        <span data-detail={node.detail} title={node.detail} style={innerStyle} className={inner}>
          {/* Not focusable and not pressable: there is nothing for a press to do.
              The text is still here for a screen reader reading the list. */}
          <span className="sr-only">{node.detail}</span>
          {body}
        </span>
      )}

      {/* The rail. Each mark draws the segment behind it, stopping at both dots'
          edges so the line never paints over one. Only the newest can be told to
          grow, and only when an event actually arrived, so the line advances
          forward and never redraws itself backwards. */}
      {first ? null : <Rail tone={node.tone} grow={grow} />}
    </li>
  );
}

/**
 * One segment of the rail, from the previous mark's dot to this one's.
 *
 * `grow` is read once, at mount, and never again — deliberately not keyed on
 * anything, because a key that changed while the transition ran would remount
 * the segment at full width and swallow the very motion it was asked for. The
 * segment's identity is its mark's, and a mark mounts exactly when its event
 * arrives; so a segment animates on arrival and at no other time. The motion is
 * a CSS transition on `transform`, which stays on the compositor and which
 * globals.css already collapses under reduced-motion.
 */
function Rail({ tone, grow }: { tone: string; grow: boolean }) {
  const [full, setFull] = useState(!grow);

  useEffect(() => {
    if (full) return;
    const frame = requestAnimationFrame(() => setFull(true));
    return () => cancelAnimationFrame(frame);
  }, [full]);

  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute h-px origin-left bg-paper-300"
      style={{
        // The 1px line's own centre lands on the dots' centre.
        top: RAIL_Y_PX - 0.5,
        left: `calc(-50% + ${DOT_PX / 2}px)`,
        width: `calc(100% - ${DOT_PX}px)`,
        transform: full ? 'scaleX(1)' : 'scaleX(0)',
        transition: `transform ${GROW_MS}ms var(--ease-out-quint)`,
        // A hint of the arriving mark's own colour, so a burst of Claude edits or
        // a run of errors reads as one stretch of line rather than N dots.
        background: `color-mix(in srgb, ${tone} 34%, var(--color-paper-300))`,
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* The numbers                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Files, last build, events. Every one of them is a count of something in the
 * store; there is no fourth number because there is no fourth thing this can
 * see. In particular there is no component count: a file is not a component,
 * the studio only ever knew about files, and inventing the difference is the
 * one thing this product does not do.
 */
function ActivityReadOut({
  events,
  truncated,
  files,
  buildMs,
  buildEntry,
}: {
  events: number;
  truncated: number;
  files: number;
  buildMs: number | null;
  buildEntry: string | null;
}) {
  const build = formatBuildDuration(buildMs);

  return (
    <div className="pl-tabular flex shrink-0 items-center gap-2 text-[11px] text-paper-500">
      <Stat
        value={String(events)}
        label={events === 1 ? 'event' : 'events'}
        title={
          `${events} event(s) on this timeline. Taps and the app’s own console are not drawn here; an error always is.` +
          (truncated > 0 ? ` The ${truncated} oldest are counted but not drawn.` : '')
        }
      />
      <Divider />
      <Stat
        value={String(files)}
        label={files === 1 ? 'file' : 'files'}
        title={`${files} distinct file path(s) named by Claude’s file tools in these events. Files saved from the editor log no event and are not counted. The studio knows files, not components.`}
      />
      {build !== null ? (
        <>
          <Divider />
          <Stat
            value={build}
            label="last build"
            title={`How long the last build of the working tree took, successful or not${
              buildEntry ? ` (entry: ${buildEntry})` : ''
            }.`}
          />
        </>
      ) : null}
    </div>
  );
}

function Stat({ value, label, title }: { value: string; label: string; title: string }) {
  return (
    <span className="flex shrink-0 items-baseline gap-1" title={title}>
      <span className="font-semibold text-paper-800">{value}</span>
      <span>{label}</span>
    </span>
  );
}

function Divider() {
  return <span aria-hidden="true" className="h-2.5 w-px shrink-0 bg-paper-200" />;
}

/* -------------------------------------------------------------------------- */

/**
 * Compact controls shown while a replay is running.
 *
 * Kept and still exported, but dead: nothing in `src/` renders it, and the Stop
 * control a running replay actually shows comes from the toolbar
 * (`toolbar.tsx`, which reads the same `stopReplay`). Left in place rather than
 * deleted because removing it is a decision about the toolbar's design, not
 * about this strip — but it should not be mistaken for something on screen.
 */
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
