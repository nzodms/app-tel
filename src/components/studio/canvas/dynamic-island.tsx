'use client';

import { useState } from 'react';
import type { DevicePreset } from '@/lib/devices/presets';
import type { IslandState } from '@/lib/preview/protocol';

/**
 * The cutout, and its states.
 *
 * On presets that have a Dynamic Island this is a live element: it expands into a
 * short notification, a long-running activity, a timer, a call or a payment
 * confirmation, then settles back to compact. Notch and punch-hole presets render
 * the correct static shape instead and let the banner layer carry the message —
 * which is what those devices actually do.
 *
 * **How the morph is built.** The island is one fixed-size box — as wide and as
 * tall as its largest state ever gets — that is never resized. What changes is a
 * `clip-path: inset(… round …)`, which reveals exactly the pill the current state
 * asks for, centred on the box and anchored to its top edge. That buys three
 * things the old width/height spring could not:
 *
 *  - No layout. Nothing reflows while the island opens, so the text inside never
 *    re-wraps mid-animation and the canvas can hold 60fps with a dozen phones on
 *    it. `inset()` interpolates its radius too, so the corners round out smoothly
 *    instead of stepping.
 *  - It is a CSS transition, so `prefers-reduced-motion` and the app's own
 *    `[data-reduce-motion]` setting collapse it for free. A JS spring ignored
 *    both.
 *  - Every state morphs into every other one, including expanded → expanded,
 *    because they are all clips of the same box.
 *
 * Motion stays a single damped ease, no bounce, and inside the 250ms budget: the
 * island should feel like matter, not like a toy.
 */

export interface IslandContent {
  state: IslandState;
  label: string | null;
  detail: string | null;
  /** Progress 0..1 for activity/delivery states. */
  progress: number | null;
  tone: 'default' | 'success' | 'warning' | 'error';
}

export const IDLE_ISLAND: IslandContent = {
  state: 'compact',
  label: null,
  detail: null,
  progress: null,
  tone: 'default',
};

/** One ease, one duration, everywhere in this file. Inside the 250ms budget. */
const MORPH_MS = 220;
const MORPH = `${MORPH_MS}ms var(--ease-out-quint)`;

const TONE_ACCENT: Record<IslandContent['tone'], string> = {
  default: '#4d93fb',
  success: '#37c463',
  warning: '#e0a33c',
  error: '#f0655e',
};

/* -------------------------------------------------------------------------- */
/* Geometry                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Expanded sizes, as ratios of the preset's own numbers rather than as constants.
 *
 * Each ratio is the value the design was tuned at on the reference preset
 * (iPhone 17 Pro: 402pt wide, island 125 × 36.5), divided by the preset number it
 * came from — so the reference is reproduced exactly and a preset with a
 * different island or a different screen gets a proportional one instead of a
 * borrowed constant.
 */
const WIDE_OF_SCREEN = 358 / 402;
const TIMER_OF_PILL = 196 / 125;
const NOTIFICATION_OF_PILL = 56 / 36.5;
const ACTIVITY_OF_PILL = 78 / 36.5;
const TIMER_OF_PILL_H = 44 / 36.5;
const CALL_OF_PILL_H = 68 / 36.5;
/** Corner radius ceiling. Under it, a state is a full pill: radius = height / 2. */
const MAX_RADIUS_OF_PILL = 30 / 36.5;

interface IslandRect {
  width: number;
  height: number;
  radius: number;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function heightRatio(state: IslandState): number {
  switch (state) {
    case 'notification':
    case 'payment':
      return NOTIFICATION_OF_PILL;
    case 'activity':
    case 'delivery':
      return ACTIVITY_OF_PILL;
    case 'timer':
      return TIMER_OF_PILL_H;
    default:
      return CALL_OF_PILL_H;
  }
}

function islandRect(state: IslandState, preset: DevicePreset): IslandRect {
  const { cutout, viewport } = preset;
  if (state === 'idle' || state === 'compact') {
    return { width: cutout.width, height: cutout.height, radius: cutout.radius };
  }

  const height = round1(cutout.height * heightRatio(state));
  const width =
    state === 'timer'
      ? round1(cutout.width * TIMER_OF_PILL)
      : round1(viewport.width * WIDE_OF_SCREEN);

  return {
    width,
    height,
    radius: Math.min(height / 2, round1(cutout.height * MAX_RADIUS_OF_PILL)),
  };
}

/**
 * Where a notification banner may start, given what the cutout is currently
 * doing.
 *
 * The banner layer used to clear the *compact* pill, which is right until the
 * island expands: a live activity reaches roughly 89pt down a 17 Pro and a banner
 * pinned at 57.5pt was drawn straight through it. Reading the current state means
 * the two can never overlap, whatever the island is showing.
 */
export function bannerTop(preset: DevicePreset, content: IslandContent): number {
  if (preset.cutout.kind !== 'dynamic-island') return preset.safeArea.top + 6;
  return preset.cutout.top + islandRect(content.state, preset).height + 10;
}

/**
 * The box every state is clipped out of: as wide and as tall as the island ever
 * needs to be. It never changes, which is the whole point — no state change
 * touches layout.
 */
function islandShell(preset: DevicePreset): { width: number; height: number } {
  const { cutout, viewport } = preset;
  return {
    width: Math.max(cutout.width, round1(viewport.width * WIDE_OF_SCREEN)),
    height: Math.max(cutout.height, round1(cutout.height * ACTIVITY_OF_PILL)),
  };
}

/**
 * `rect`, expressed as a clip of `shell`: horizontally centred, anchored to the
 * top edge — which is where a real island grows from. `shrink` pulls the clip in
 * on every side, used for the 1px edge highlight and for the shadow's spread.
 */
function clipTo(
  rect: IslandRect,
  shell: { width: number; height: number },
  shrink: number,
): string {
  const side = (shell.width - rect.width) / 2 + shrink;
  const bottom = shell.height - rect.height + shrink;
  const radius = Math.max(rect.radius - shrink, 0);
  return `inset(${shrink}px ${side}px ${bottom}px ${side}px round ${radius}px)`;
}

/* -------------------------------------------------------------------------- */

export function DeviceCutout({
  preset,
  content,
  landscape,
}: {
  preset: DevicePreset;
  content: IslandContent;
  landscape: boolean;
}) {
  const { cutout } = preset;
  if (cutout.kind === 'none') return null;

  // Turned sideways, the top edge of the display becomes its leading edge, so
  // every cutout moves there and turns with it. A live island in that position
  // would have to render its content rotated, so it holds the hardware shape and
  // the banner layer carries the message — the same thing the notch presets do.
  if (landscape || cutout.kind !== 'dynamic-island') {
    return <StaticCutout preset={preset} landscape={landscape} />;
  }

  return <DynamicIsland preset={preset} content={content} />;
}

function StaticCutout({ preset, landscape }: { preset: DevicePreset; landscape: boolean }) {
  const { cutout } = preset;
  const ring = 'inset 0 0 0 1px rgba(255,255,255,0.06)';

  // A notch is part of the bezel, not a floating element: it hangs off the edge
  // of the display with only its two inboard corners rounded. An island and a
  // punch-hole float clear of the edge and are rounded all the way round.
  const attached = cutout.kind === 'notch';
  const radius = attached
    ? landscape
      ? `0 ${cutout.radius}px ${cutout.radius}px 0`
      : `0 0 ${cutout.radius}px ${cutout.radius}px`
    : `${cutout.radius}px`;

  return (
    <div
      data-pl="cutout"
      className="pointer-events-none absolute z-30 bg-black"
      style={{
        width: landscape ? cutout.height : cutout.width,
        height: landscape ? cutout.width : cutout.height,
        top: landscape ? '50%' : cutout.top,
        left: landscape ? cutout.top : '50%',
        transform: landscape ? 'translateY(-50%)' : 'translateX(-50%)',
        borderRadius: radius,
        boxShadow: ring,
      }}
    />
  );
}

function DynamicIsland({ preset, content }: { preset: DevicePreset; content: IslandContent }) {
  const expanded = content.state !== 'compact' && content.state !== 'idle';

  // While the island closes, the clip animates back to the compact pill but the
  // content has to stay on screen to fade out with it — so the last expanded
  // content is held and keeps being rendered until the next one arrives. This is
  // React's "adjust state while rendering" case: it re-runs this component
  // immediately, before anything is committed, and never touches the DOM twice.
  const [held, setHeld] = useState<IslandContent>(content);
  if (expanded && held !== content) setHeld(content);
  const shown = expanded ? content : held;

  const shell = islandShell(preset);
  const rect = islandRect(content.state, preset);
  const shownRect = islandRect(shown.state, preset);

  return (
    <div
      data-pl="cutout"
      data-pl-island={content.state}
      // This box is the *shell* — as wide as the island ever gets — so its own
      // rect says nothing about where the hardware pill sits. The pill's width
      // is published separately, because that is what the status bar's ears are
      // measured against and what a probe has to check the clock against.
      data-pl-cutout-w={preset.cutout.width}
      data-pl-vw={preset.viewport.width}
      className="pointer-events-none absolute z-30"
      style={{
        top: preset.cutout.top,
        left: '50%',
        transform: 'translateX(-50%)',
        width: shell.width,
        height: shell.height,
      }}
    >
      {/* Shadow. Blurring a *child* that carries the clip, rather than blurring a
          clipped element, because clipping is applied after filtering and would
          otherwise cut the halo straight back off. The clip is pulled in 5px,
          which is this construction's version of a negative spread: it keeps the
          halo from creeping out above the island's top edge. */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          filter: 'blur(9px)',
          transform: 'translateY(6px)',
          opacity: expanded ? 0.42 : 0,
          transition: `opacity ${MORPH}`,
        }}
      >
        <div
          className="absolute inset-0 bg-black"
          style={{ clipPath: clipTo(rect, shell, 5), transition: `clip-path ${MORPH}` }}
        />
      </div>

      {/* Edge highlight: the outer 1px of the shape, with the body clipped 1px
          inside it. Two opaque clips rather than an inset box-shadow, which would
          follow the (invisible) shell rectangle instead of the pill. The colour is
          black lifted by ~6% white — what the ring used to composite to — baked in
          so it reads the same over a light app and a dark one, and so it no longer
          jumps to a different value the instant the island opens. */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background: '#0f0f0f',
          clipPath: clipTo(rect, shell, 0),
          transition: `clip-path ${MORPH}`,
        }}
      />

      <div
        className="absolute inset-0 bg-black"
        style={{ clipPath: clipTo(rect, shell, 1), transition: `clip-path ${MORPH}` }}
      >
        {/* Laid out at the size of the state it belongs to and revealed by the
            clip, so the label is composed once and then uncovered — it never
            reflows while the island is opening. */}
        <div
          aria-hidden={!expanded}
          className="absolute top-0 flex items-center gap-2.5 px-3.5"
          style={{
            left: '50%',
            transform: 'translateX(-50%)',
            width: shownRect.width,
            height: shownRect.height,
            opacity: expanded ? 1 : 0,
            transition: `opacity ${MORPH}`,
          }}
        >
          <IslandGlyph content={shown} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-semibold leading-tight text-white">
              {shown.label ?? 'Live activity'}
            </div>
            {shown.detail ? (
              <div className="truncate text-[11px] leading-tight text-white/60">
                {shown.detail}
              </div>
            ) : null}
            {shown.progress !== null ? (
              <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-white/15">
                <div
                  className="h-full w-full rounded-full"
                  style={{
                    background: TONE_ACCENT[shown.tone],
                    // scaleX rather than width: a transform, so the bar cannot
                    // make the island's contents reflow as it fills.
                    transform: `scaleX(${Math.min(Math.max(shown.progress, 0), 1)})`,
                    transformOrigin: 'left',
                    transition: `transform ${MORPH}`,
                  }}
                />
              </div>
            ) : null}
          </div>
          {shown.state === 'timer' ? null : (
            <div
              className="size-[7px] shrink-0 rounded-full"
              style={{ background: TONE_ACCENT[shown.tone] }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function IslandGlyph({ content }: { content: IslandContent }) {
  const accent = TONE_ACCENT[content.tone];
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none' } as const;

  switch (content.state) {
    case 'payment':
      return (
        <span
          className="grid size-8 shrink-0 place-items-center rounded-full"
          style={{ background: `${accent}26` }}
        >
          <svg {...common} stroke={accent} strokeWidth="2" strokeLinecap="round">
            <path d="M4.5 12.5l4.5 4.5 10-10" />
          </svg>
        </span>
      );
    case 'call':
      return (
        <span
          className="grid size-8 shrink-0 place-items-center rounded-full"
          style={{ background: `${accent}26` }}
        >
          <svg {...common} stroke={accent} strokeWidth="1.8" strokeLinejoin="round">
            <path d="M6 3.5h3l1.5 4-2 1.5a10 10 0 005.5 5.5l1.5-2 4 1.5v3a2 2 0 01-2.2 2A16 16 0 014 5.7 2 2 0 016 3.5z" />
          </svg>
        </span>
      );
    case 'delivery':
      return (
        <span
          className="grid size-8 shrink-0 place-items-center rounded-full"
          style={{ background: `${accent}26` }}
        >
          <svg {...common} stroke={accent} strokeWidth="1.7" strokeLinejoin="round">
            <path d="M3 7.5h9v9H3zM12 10.5h4l3 3v3h-7z" />
            <circle cx="6.5" cy="18" r="1.6" />
            <circle cx="16" cy="18" r="1.6" />
          </svg>
        </span>
      );
    case 'timer':
      return (
        <span className="grid size-6 shrink-0 place-items-center">
          <svg {...common} width={16} height={16} stroke={accent} strokeWidth="1.9" strokeLinecap="round">
            <circle cx="12" cy="13" r="8" />
            <path d="M12 8.5V13l2.5 1.8M9.5 2.5h5" />
          </svg>
        </span>
      );
    case 'activity':
      return (
        <span
          className="grid size-9 shrink-0 place-items-center rounded-full"
          style={{ background: `${accent}22` }}
        >
          <span
            className="size-2.5 rounded-full"
            style={{ background: accent, boxShadow: `0 0 10px ${accent}` }}
          />
        </span>
      );
    default:
      return (
        <span
          className="grid size-8 shrink-0 place-items-center rounded-[9px]"
          style={{ background: `${accent}26` }}
        >
          <svg {...common} stroke={accent} strokeWidth="1.8" strokeLinecap="round">
            <path d="M12 4.5a6 6 0 016 6v3l1.5 2.5H4.5L6 13.5v-3a6 6 0 016-6z" />
            <path d="M10 19a2.2 2.2 0 004 0" />
          </svg>
        </span>
      );
  }
}
