'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, History } from 'lucide-react';
import {
  BUILD_PHASE_LABELS,
  formatBuildDuration,
  formatElapsed,
  isBuildBusy,
  type BuildPhase,
} from '../build-phase';

/**
 * What a phone shows while it is being built — and, before that, what it shows
 * when it has never been built at all.
 *
 * The canvas had three states and two of them were nothing: the app, a 2px blue
 * line sliding across the top, or the failure card. A phone waiting on its first
 * build was a grey rectangle, a phone recompiling gave no clue what was being
 * compiled or how long it had been going, and a phone whose preview had just
 * landed said nothing at all. This fills the gap without inventing one.
 *
 * WHAT IT DOES NOT DO. There is no progress bar and no step list, because there
 * is no progress and there are no steps — see the note at the top of
 * `build-phase.ts`. Everything drawn here is observable: the phase, a clock this
 * component runs itself, the entry file the server said it compiled, and how
 * long the last build that finished took.
 *
 * Three rules it is built around:
 *
 *  - It never touches the preview. Not a re-parent, not a key, not a wrapper
 *    around the iframe — every element is an absolutely positioned sibling, so
 *    a rebuild (or a drag) cannot cost the running app its state.
 *  - It never covers a working app with an opaque sheet. When a previous preview
 *    is on screen it is dimmed by 10% and the overlay is a strip at the bottom;
 *    the full-screen placeholder only appears when there is genuinely nothing
 *    underneath, and even then it is transparent — the device screen paints its
 *    own background, so nothing here can flash white.
 *  - Every layer stays mounted and moves on opacity and transform alone, driven
 *    by CSS transitions so the reduced-motion rules in globals.css collapse them
 *    without this component knowing. Nothing animates on a JS timeline, and
 *    nothing mounts or unmounts mid-transition — which is also why the enter
 *    side animates at all: a layer that appears already at its end state has
 *    nothing to transition from.
 *
 * `failed` renders nothing: `build-error-card.tsx` owns that case, and two
 * components describing one failure is how they start disagreeing.
 *
 * It reads no store. Every input is a prop, so the caller decides when a phone
 * renders this at all — which is what keeps a build on one device from
 * re-rendering the other eleven.
 */

/** Enter/exit, short enough to feel like a state change rather than an animation. */
const ENTER_MS = 180;
const EXIT_MS = 200;
/** Lets the busy strip clear out before the badge replacing it arrives. */
const BADGE_ENTER_DELAY_MS = 60;
/** How long "Preview updated" holds before it fades. Long enough to read once. */
const BADGE_HOLD_MS = 1500;
/** Clock tick. Fast enough to read as live, slow enough to be free. */
const CLOCK_MS = 200;

export interface BuildStateOverlayProps {
  /** From `deriveBuildPhase(bundle, frameMounted)`. */
  phase: BuildPhase;
  /**
   * The device this belongs to, used only to scope the test ids — twelve phones
   * on a canvas need twelve distinct handles, exactly as the error card does.
   */
  deviceId?: string;
  /** Names the project on a phone that has never been built. */
  projectName: string;
  /** The device's role label, e.g. "Customer" — what this phone is *for*. */
  roleLabel: string;
  /** The role's colour (`roleColor(device.role)`), so the strip belongs to this phone. */
  roleColor?: string;
  /** The device's own theme, so a placeholder on a dark phone is not a light panel. */
  theme?: 'light' | 'dark';
  /**
   * The entry file the build compiled. The build response returns it as `entry`;
   * `snapshot.project.entryFile` is the same value before a build has answered.
   * Null when it is not known — the line is then simply absent.
   */
  entry?: string | null;
  /**
   * How long the last build that completed took, in milliseconds. Null when none
   * has. Shown as a fact about the past, never as a prediction about this one.
   */
  lastBuildMs?: number | null;
  /**
   * True when an app is actually on screen right now — a bundle is loaded *and*
   * the frame has mounted it. Decides between dimming what is there and drawing
   * a placeholder over what is not. `derivePreviewPresence(bundle, mounted) !==
   * 'none'` answers it; the error card makes the same test before it claims
   * "still running the last version that compiled".
   */
  hasPreview?: boolean;
  /**
   * When this build started, as `Date.now()`. Optional: with nothing passed the
   * clock times from the moment it started running, which is the only start the
   * client can actually observe.
   */
  startedAt?: number | null;
}

export function BuildStateOverlay({
  phase,
  deviceId,
  projectName,
  roleLabel,
  roleColor,
  theme = 'light',
  entry = null,
  lastBuildMs = null,
  hasPreview = false,
  startedAt = null,
}: BuildStateOverlayProps) {
  const busy = isBuildBusy(phase);

  /*
   * "Preview updated" is a claim about an *update*, so it has to know whether
   * anything was ever on screen before. Both of these are state rather than refs
   * so the comparison survives a double render instead of being eaten by it.
   */
  const [previousPhase, setPreviousPhase] = useState<BuildPhase>(phase);
  const [everReady, setEverReady] = useState(phase === 'ready');
  // Two counters instead of a timestamp: the badge is shown while the token the
  // phase raised is ahead of the token its timer retired. Nothing impure.
  const [badgeToken, setBadgeToken] = useState(0);
  const [retiredToken, setRetiredToken] = useState(0);

  // The strip keeps the last busy label through its fade-out. Without this the
  // text flips to "Preview updated" halfway through the exit, which reads as a
  // glitch rather than a transition.
  const [busyLabel, setBusyLabel] = useState(BUILD_PHASE_LABELS[phase]);

  if (busy && busyLabel !== BUILD_PHASE_LABELS[phase]) setBusyLabel(BUILD_PHASE_LABELS[phase]);

  if (previousPhase !== phase) {
    setPreviousPhase(phase);
    if (phase === 'ready') {
      // A first build is not an update — there was nothing to update. Nor is a
      // `stale → ready` flip: only a build we watched go through a busy phase.
      if (everReady && isBuildBusy(previousPhase)) setBadgeToken((token) => token + 1);
      setEverReady(true);
    }
  }

  useEffect(() => {
    if (badgeToken === 0) return;
    const timer = window.setTimeout(() => setRetiredToken(badgeToken), BADGE_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [badgeToken]);

  // The failure card is the whole story on a failed build, and a second opinion
  // drawn underneath it would only ever contradict. After the hooks, never before.
  if (phase === 'failed') return null;

  const dark = theme === 'dark';
  const suffix = deviceId ? `-${deviceId}` : '';
  const lastBuild = formatBuildDuration(lastBuildMs);
  const showPlaceholder = phase === 'never-built' || (busy && !hasPreview);
  const showScrim = busy && hasPreview;
  const showStale = phase === 'stale';
  const showBadge = badgeToken > retiredToken;

  return (
    <>
      {/* Nothing underneath: name the project and the role instead of a void.
          Transparent, so it can fade out over an arriving app without a frame of
          flat colour between the two. */}
      <div
        aria-hidden={!showPlaceholder}
        className="pointer-events-none absolute inset-0 z-[10] flex flex-col items-center justify-center gap-1 px-6 text-center"
        style={fade(showPlaceholder, { opacity: 1 })}
        data-testid={`build-state-placeholder${suffix}`}
      >
        <span
          className="mb-1 size-[7px] rounded-full"
          style={{ background: roleColor ?? 'var(--color-paper-400)', opacity: 0.9 }}
          aria-hidden="true"
        />
        <div
          className="max-w-full truncate text-[13px] font-semibold tracking-[-0.008em]"
          style={{ color: dark ? 'var(--color-slate-code-text)' : 'var(--color-paper-800)' }}
        >
          {projectName}
        </div>
        <div
          className="max-w-full truncate text-[11.5px]"
          style={{ color: dark ? 'var(--color-slate-code-dim)' : 'var(--color-paper-500)' }}
        >
          {roleLabel}
        </div>
        {phase === 'never-built' ? (
          <div
            className="mt-0.5 text-[10.5px] leading-snug"
            style={{ color: dark ? 'var(--color-slate-code-dim)' : 'var(--color-paper-400)' }}
          >
            No preview has been built for this phone yet.
          </div>
        ) : null}
      </div>

      {/* A previous preview stays exactly where it is and loses a little light,
          so it is obvious it is still the old one without it being hidden. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[10]"
        style={{
          background: 'var(--color-paper-950)',
          ...fade(showScrim, { opacity: 0.1 }),
        }}
      />

      {/* The build itself: the phase, what is being compiled, how long it has
          been going. Low, compact, never over the app's own content. */}
      <div
        aria-hidden={!busy}
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[45] px-2.5 pb-4"
        style={fade(busy, { opacity: 1, lift: 8 })}
        data-testid={`build-state-strip${suffix}`}
      >
        <div className="flex items-center gap-2 rounded-[11px] border border-paper-200 bg-paper-0 px-2.5 py-1.5 shadow-float">
          <span
            className="size-[7px] shrink-0 rounded-full"
            style={{ background: roleColor ?? 'var(--color-paper-400)' }}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11.5px] font-semibold leading-tight text-paper-800">
              {busyLabel}
            </div>
            {entry || lastBuild ? (
              <div className="mt-[1px] flex items-baseline gap-1.5 text-[10px] leading-tight">
                {entry ? <span className="truncate font-mono text-paper-500">{entry}</span> : null}
                {lastBuild ? (
                  <span className="shrink-0 whitespace-nowrap text-paper-400">
                    last build {lastBuild}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          <ElapsedClock running={busy} startedAt={startedAt} />
        </div>
      </div>

      {/* Older than the sources, and not currently failing. A marker, not an
          interruption: the app underneath is real, it is just behind. */}
      <div
        aria-hidden={!showStale}
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[45] flex justify-center px-2.5 pb-4"
        style={fade(showStale, { opacity: 1, lift: 6 })}
        data-testid={`build-state-stale${suffix}`}
      >
        <Pill icon={<History size={10} strokeWidth={2.2} className="text-caution-500" />}>
          {BUILD_PHASE_LABELS.stale}
        </Pill>
      </div>

      {/* The only thing `ready` ever draws, and only when a build actually
          replaced something. Fades itself out; covers nothing that matters. */}
      <div
        aria-hidden={!showBadge}
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[45] flex justify-center px-2.5 pb-4"
        style={fade(showBadge, { opacity: 1, lift: 6, enterDelayMs: BADGE_ENTER_DELAY_MS })}
        data-testid={`build-state-updated${suffix}`}
      >
        <Pill icon={<Check size={10} strokeWidth={2.6} className="text-positive-500" />}>
          {BUILD_PHASE_LABELS.ready}
        </Pill>
      </div>
    </>
  );
}

/**
 * A small paper pill.
 *
 * Paper tokens plus a -500 solid for the glyph, deliberately: the device chassis
 * rule in globals.css restores the light `paper-*` and `danger-*` ramps inside a
 * device but not `caution-*`/`positive-*`, so a tinted `bg-caution-50` surface in
 * here would follow the *studio* theme while the phone around it did not. The
 * -500 solids are the same colour in both.
 */
function Pill({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-paper-200 bg-paper-0 px-2 py-[3px] text-[10.5px] font-medium text-paper-700 shadow-float">
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{children}</span>
    </span>
  );
}

/**
 * The one number on screen that is genuinely measured.
 *
 * Writes to the DOM node on an interval instead of holding the time in state: a
 * dozen phones building at once would otherwise be a dozen React renders every
 * tick, for a string. Not an animation — the reduced-motion rules have nothing
 * to collapse here, and a clock that stops is not a kindness.
 *
 * The origin is taken when the clock starts running, inside the effect, so each
 * busy stretch is timed from its own beginning and the value is never read
 * during a render.
 */
function ElapsedClock({
  running,
  startedAt,
}: {
  running: boolean;
  startedAt?: number | null;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || !running) return;
    const origin = startedAt ?? Date.now();
    const write = () => {
      node.textContent = formatElapsed(Date.now() - origin);
    };
    write();
    const timer = window.setInterval(write, CLOCK_MS);
    // The last value is deliberately left on the node: the strip is still fading
    // out, and blanking the number mid-fade looks like a failure.
    return () => window.clearInterval(timer);
  }, [running, startedAt]);

  return (
    <span
      ref={ref}
      className="pl-tabular shrink-0 self-start pt-[1px] text-[10.5px] text-paper-500"
    />
  );
}

/**
 * Enter and exit on opacity and transform only.
 *
 * `translateY` in pixels rather than anything that moves a box: these layers sit
 * over a live iframe, and animating a layout property there would reflow the
 * phone on every frame of every build.
 */
function fade(
  shown: boolean,
  { opacity, lift = 0, enterDelayMs = 0 }: { opacity: number; lift?: number; enterDelayMs?: number },
): React.CSSProperties {
  const duration = shown ? ENTER_MS : EXIT_MS;
  const delay = shown ? enterDelayMs : 0;
  return {
    opacity: shown ? opacity : 0,
    transform: shown || lift === 0 ? 'translateY(0)' : `translateY(${lift}px)`,
    transition: `opacity ${duration}ms var(--ease-out-quint) ${delay}ms, transform ${duration}ms var(--ease-out-quint) ${delay}ms`,
  };
}
