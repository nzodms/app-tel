'use client';

import { AnimatePresence, motion } from 'motion/react';
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
 * Motion is a single damped spring, no bounce: the island should feel like matter,
 * not like a toy.
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

const SPRING = { type: 'spring', stiffness: 420, damping: 34, mass: 0.9 } as const;

const TONE_ACCENT: Record<IslandContent['tone'], string> = {
  default: '#4d93fb',
  success: '#37c463',
  warning: '#e0a33c',
  error: '#f0655e',
};

function expandedSize(
  content: IslandContent,
  preset: DevicePreset,
): { width: number; height: number; radius: number } {
  const compact = { width: preset.cutout.width, height: preset.cutout.height, radius: preset.cutout.radius };
  const maxWidth = Math.min(preset.viewport.width - 40, 358);

  switch (content.state) {
    case 'idle':
    case 'compact':
      return compact;
    case 'notification':
    case 'payment':
      return { width: maxWidth, height: 56, radius: 28 };
    case 'activity':
    case 'delivery':
      return { width: maxWidth, height: 78, radius: 30 };
    case 'timer':
      return { width: 196, height: 44, radius: 22 };
    case 'call':
      return { width: maxWidth, height: 68, radius: 30 };
  }
}

export function DeviceCutout({
  preset,
  content,
  landscape,
}: {
  preset: DevicePreset;
  content: IslandContent;
  landscape: boolean;
}) {
  if (preset.cutout.kind === 'none') return null;

  if (preset.cutout.kind === 'punch-hole') {
    return (
      <div
        className="pointer-events-none absolute z-30 rounded-full bg-black"
        style={{
          width: preset.cutout.width,
          height: preset.cutout.height,
          top: landscape ? '50%' : preset.cutout.top,
          left: landscape ? preset.cutout.top : '50%',
          transform: landscape ? 'translateY(-50%)' : 'translateX(-50%)',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
        }}
      />
    );
  }

  if (preset.cutout.kind === 'notch') {
    // A notch is part of the bezel, not a floating element: draw it as a shape
    // hanging from the top edge with the correct inverted corners.
    return (
      <div
        className="pointer-events-none absolute z-30 flex justify-center"
        style={{ top: 0, left: 0, right: 0 }}
      >
        <div
          style={{
            width: preset.cutout.width,
            height: preset.cutout.height,
            background: '#000',
            borderBottomLeftRadius: preset.cutout.radius,
            borderBottomRightRadius: preset.cutout.radius,
          }}
        />
      </div>
    );
  }

  const size = expandedSize(content, preset);
  const expanded = content.state !== 'compact' && content.state !== 'idle';

  return (
    <motion.div
      className="pointer-events-none absolute z-30 overflow-hidden bg-black"
      initial={false}
      animate={{
        width: size.width,
        height: size.height,
        borderRadius: size.radius,
      }}
      transition={SPRING}
      style={{
        top: preset.cutout.top,
        left: '50%',
        x: '-50%',
        boxShadow: expanded
          ? '0 6px 24px -6px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.08)'
          : 'inset 0 0 0 1px rgba(255,255,255,0.05)',
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {expanded ? (
          <motion.div
            key={`${content.state}-${content.label ?? ''}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="flex h-full w-full items-center gap-2.5 px-3.5"
          >
            <IslandGlyph content={content} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-semibold leading-tight text-white">
                {content.label ?? 'Live activity'}
              </div>
              {content.detail ? (
                <div className="truncate text-[11px] leading-tight text-white/60">
                  {content.detail}
                </div>
              ) : null}
              {content.progress !== null ? (
                <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-white/15">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: TONE_ACCENT[content.tone] }}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.round(content.progress * 100)}%` }}
                    transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  />
                </div>
              ) : null}
            </div>
            {content.state === 'timer' ? null : (
              <div
                className="size-[7px] shrink-0 rounded-full"
                style={{ background: TONE_ACCENT[content.tone] }}
              />
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
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
