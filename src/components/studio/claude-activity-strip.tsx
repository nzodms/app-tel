'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { StatusDot } from '@/components/ui/primitives';
import { formatElapsed } from './build-phase';
import type { SessionStep } from './claude-session';
import { useClaudeSession, type ClaudeSessionView } from './use-claude-session';

/**
 * Claude working, as a line you can watch advance.
 *
 *     Reading the project ─ Editing 3 files ─ Compiling ─ Preview updated
 *
 * The sequence itself is `claude-session.ts`, which is pure and tested; the wire
 * that feeds it is `use-claude-session.ts`. This file only draws the result, and
 * it is allowed to draw exactly what the reducer produced.
 *
 * ## What it says, and what it refuses to say
 *
 * - Every step on screen came from a real event: a tool call starting or
 *   finishing, a build starting or finishing, a frame reporting that it mounted.
 * - There is no progress bar, no percentage, no step count known in advance. We
 *   do not know how many files Claude is about to edit until it has edited them.
 * - The pause between two tool calls is labelled "Waiting for Claude" — it is
 *   generating and we cannot see it. Never "thinking": that is not observable
 *   through an MCP connection and drawing it would be inventing a signal.
 * - It is visibly finite. Four steps at a time, and a "+N" when there are more,
 *   rather than a long tail implying we kept every detail.
 * - A step that failed keeps its line and its colour. Nothing is dropped to keep
 *   the sequence tidy — the one thing a person needs from this is to find out
 *   that something did not work.
 *
 * ## What it does not do
 *
 * - It does not exist when nothing is happening. Not an empty strip, not a
 *   placeholder: the element is removed from the DOM once the exit has run.
 * - It never touches a preview. Nothing here is an ancestor of an iframe.
 * - The only number that moves is elapsed time, and it is written straight to a
 *   text node on an interval — twelve phones compiling must not mean twelve React
 *   renders a second for a string.
 * - It takes no pointer events and holds nothing focusable, so it cannot swallow
 *   a click on the canvas or trap a keyboard user. The screen reader gets one
 *   polite live region carrying the current line, and nothing else — a clock
 *   ticking five times a second inside a live region is not information.
 *
 * ## Where it belongs
 *
 * Anywhere the caller positions it; it has no position of its own. It reads best
 * anchored to the top-left of the canvas (`absolute left-3 top-3 z-30`), which is
 * the one corner nothing else claims — the Edge Case Studio is top-right, the
 * inspector card bottom-left, the timeline pill bottom-centre — and where growth
 * to the right cannot push anything already on screen.
 */

/** Enter and exit. Short enough to read as a state change rather than an effect. */
const ENTER_MS = 200;
const EXIT_MS = 180;
/** Clock tick: fast enough to read as live, slow enough to be free. */
const CLOCK_MS = 200;
/** Steps on screen at once, including the current one. Deliberately small. */
const VISIBLE_STEPS = 4;

export function ClaudeActivityStrip({ className }: { className?: string }) {
  const view = useClaudeSession();

  /*
   * "Absent when idle" and "animates out" pull in opposite directions: the
   * element has to survive its own exit and then genuinely leave the DOM.
   *
   * `exiting` is raised during the render in which `live` goes false — the
   * pattern the build overlay already uses, and the one React sanctions for
   * adjusting state to a change — and a timer lowers it once the transition has
   * run. Nothing here is an animation timeline: the motion is a CSS transition,
   * so the reduced-motion rules in globals.css collapse it without this
   * component knowing the preference exists.
   */
  const [previousLive, setPreviousLive] = useState(view.live);
  const [exiting, setExiting] = useState(false);
  if (previousLive !== view.live) {
    setPreviousLive(view.live);
    setExiting(previousLive);
  }

  useEffect(() => {
    if (!exiting) return;
    const timer = window.setTimeout(() => setExiting(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [exiting]);

  if ((!view.live && !exiting) || view.label === null) return null;
  return <Strip view={view} className={className} />;
}

/**
 * The strip itself, mounted only while it has something to show — which is what
 * lets it animate in: a fresh mount has a from-state, and a component that was
 * merely hidden does not.
 */
function Strip({ view, className }: { view: ClaudeSessionView; className?: string }) {
  const entered = useEntered();
  const shown = entered && view.live;

  const steps = view.session.steps;
  const head = steps[steps.length - 1] ?? null;
  const trail = steps.slice(0, -1);
  const visible = trail.slice(Math.max(0, trail.length - (VISIBLE_STEPS - 1)));
  const hidden = trail.length - visible.length;

  // One sentence, and only when it changes: the head, its error if it has one,
  // and the pause if we are in one.
  const announce = [
    head?.status === 'failed' && head.error ? `${head.label}: ${head.error}` : head?.label,
    view.waiting ? view.label : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' — ');

  return (
    <div className={cn('pointer-events-none pl-no-select', className)}>
      {/* The only thing announced. Atomic, so a step change is one utterance. */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announce}
      </p>

      <div
        aria-hidden="true"
        data-testid="claude-activity-strip"
        className={cn(
          'inline-flex max-w-full items-center gap-1 rounded-[12px] border border-paper-200',
          'bg-paper-0/95 py-1 pl-1.5 pr-2 shadow-float backdrop-blur',
        )}
        style={{
          opacity: shown ? 1 : 0,
          transform: shown ? 'translateY(0)' : 'translateY(-4px)',
          transition: `opacity ${shown ? ENTER_MS : EXIT_MS}ms var(--ease-out-quint), transform ${
            shown ? ENTER_MS : EXIT_MS
          }ms var(--ease-out-quint)`,
        }}
      >
        {hidden > 0 ? (
          <>
            <span className="pl-tabular shrink-0 text-[10px] font-medium text-paper-400">
              +{hidden}
            </span>
            <Link />
          </>
        ) : null}

        {visible.map((step) => (
          <Fragment key={stepKey(step)}>
            <TrailStep step={step} />
            <Link />
          </Fragment>
        ))}

        {head ? <Head key={stepKey(head)} step={head} /> : null}

        {/* Waiting is not a step and is not drawn as one — the reducer never
            makes a step for it, because it is the gap between two tool calls. It
            trails the last real step, which also keeps the payoff on screen:
            "Preview updated" stays the head instead of being demoted the instant
            it lands. */}
        {view.waiting && view.label ? (
          <>
            <Link />
            <Waiting label={view.label} />
          </>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A step's identity for React.
 *
 * Not `step.id`: that follows the tool call in flight, so it changes on every
 * file of a coalesced burst — keying on it would re-mount (and re-animate) the
 * head each time "Editing 2 files" became "Editing 3 files". `startedAt` is set
 * once when the step opens and survives the merge, which is exactly the identity
 * a person perceives.
 */
function stepKey(step: SessionStep): string {
  return `${step.kind}-${step.startedAt}`;
}

/** The hairline that makes a row of chips read as one sequence. */
function Link() {
  return <span className="h-px w-2 shrink-0 bg-paper-300" />;
}

/** A step that is behind the current one. Quiet — unless it failed. */
function TrailStep({ step }: { step: SessionStep }) {
  const entered = useEntered();
  const failed = step.status === 'failed';
  // No `title`: the strip takes no pointer events, so a native tooltip could
  // never appear, and a control that cannot do what it advertises is worse than
  // no control. The panel is where a step gets its full detail.
  return (
    <span className="flex min-w-0 shrink items-center gap-1" style={enter(entered)}>
      <StatusDot tone={failed ? 'danger' : 'neutral'} />
      <span
        className={cn(
          'max-w-[112px] truncate text-[11px] leading-none',
          failed ? 'font-medium text-danger-700' : 'text-paper-500',
        )}
      >
        {step.label}
      </span>
    </span>
  );
}

/** The current line: the step that is running, or the one that just landed. */
function Head({ step }: { step: SessionStep }) {
  const entered = useEntered();
  const running = step.status === 'running';
  const failed = step.status === 'failed';
  // One name is already in the label ("Editing Schedule.tsx"); past that, the
  // most recent file is the thing the count does not tell you.
  const target = step.targets.length > 1 ? step.targets[step.targets.length - 1] : null;

  return (
    <span className="flex min-w-0 items-center gap-1.5" style={enter(entered)}>
      <StatusDot tone={failed ? 'danger' : running ? 'accent' : 'positive'} pulse={running} />
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span
            className={cn(
              'truncate text-[11.5px] font-semibold leading-tight',
              failed ? 'text-danger-700' : 'text-paper-800',
            )}
          >
            {step.label}
          </span>
          {target ? (
            <span className="hidden max-w-[150px] truncate font-mono text-[10px] text-paper-400 sm:inline">
              {target}
            </span>
          ) : null}
        </span>
        {/* A failure keeps its own words. Never collapsed into the label. */}
        {failed && step.error ? (
          <span className="max-w-[260px] truncate text-[10px] leading-tight text-danger-600">
            {step.error}
          </span>
        ) : null}
      </span>
      {running ? <LiveElapsed startedAt={step.startedAt} /> : null}
    </span>
  );
}

/**
 * The gap between two tool calls.
 *
 * Claude is generating and we are on the far side of an MCP connection, so this
 * is the whole of what can be said about it. Never "thinking": that would be a
 * claim about something nothing here can see.
 */
function Waiting({ label }: { label: string }) {
  const entered = useEntered();
  return (
    <span className="flex min-w-0 items-center gap-1.5" style={enter(entered)}>
      <StatusDot tone="neutral" pulse />
      <span className="truncate text-[11px] leading-none text-paper-500">{label}</span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The one number here that is genuinely measured.
 *
 * Written to the text node on an interval rather than held in state: a dozen
 * devices compiling at once must not cost a dozen React renders per tick for a
 * string. `Date.now()` is only ever read inside the effect, never during a
 * render, so the component stays pure.
 *
 * Exported because the Claude panel shows the same elapsed time for the session
 * as a whole, and two implementations of one clock is how they start disagreeing.
 */
export function LiveElapsed({
  startedAt,
  className,
}: {
  /** A `Date.now()` origin taken from an event that actually happened. */
  startedAt: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const write = () => {
      node.textContent = formatElapsed(Date.now() - startedAt);
    };
    write();
    const timer = window.setInterval(write, CLOCK_MS);
    // The last value is left on the node deliberately: the strip may be fading
    // out, and blanking the number mid-fade reads as a failure.
    return () => window.clearInterval(timer);
  }, [startedAt]);

  return (
    <span
      ref={ref}
      className={cn('pl-tabular shrink-0 text-[10.5px] leading-none text-paper-500', className)}
    />
  );
}

/**
 * True from the frame after mount, so a chip that has just appeared has a
 * from-state to transition out of. One boolean; the motion itself is CSS.
 */
function useEntered(): boolean {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return entered;
}

/** Compositor-only: opacity and a 3px lift, nothing that moves a box. */
function enter(entered: boolean): React.CSSProperties {
  return {
    opacity: entered ? 1 : 0,
    transform: entered ? 'translateY(0)' : 'translateY(3px)',
    transition: `opacity ${ENTER_MS}ms var(--ease-out-quint), transform ${ENTER_MS}ms var(--ease-out-quint)`,
  };
}
