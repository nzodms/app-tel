'use client';

import { useEffect, useId, useState } from 'react';
import type { DevicePreset } from '@/lib/devices/presets';

/**
 * Simulated status bar.
 *
 * Original vector glyphs, laid out from the preset's own cutout geometry. The
 * clock ticks in real time; signal, wifi and battery are controllable so the Edge
 * Case Studio can show a phone that is offline or nearly flat.
 *
 * Two things this file is careful about, because both were wrong before:
 *
 *  1. **The clock is centred in the ear, not pinned to a padding.** On iOS the
 *     time sits in the middle of the region *left of the cutout*. That region is
 *     `(viewport.width − cutout.width) / 2` for every centred cutout — island,
 *     notch or punch-hole — so the same expression is right on all of them and
 *     no preset needs a hand-tuned number. Android does not do this: its clock is
 *     pinned to the leading edge, which is what `statusBar` selects.
 *
 *  2. **Every glyph is drawn in the same 12-unit-tall box with its ink filling
 *     that box.** Before, the wifi arcs floated ~0.5u high inside their viewBox
 *     and the battery outline was 1u taller than the bars beside it, so the three
 *     icons sat on three different optical centres. Now one `icon` size drives
 *     all of them and they scale together with the preset.
 */

export interface StatusBarState {
  /** Overrides the live clock when set (used during journey replay). */
  time?: string | null;
  battery: number;
  charging: boolean;
  /** 0–4 bars. */
  signal: number;
  wifi: boolean;
  network: 'fast' | 'slow' | 'offline';
}

export const DEFAULT_STATUS: StatusBarState = {
  battery: 82,
  charging: false,
  signal: 4,
  wifi: true,
  network: 'fast',
};

function useClock(override: string | null | undefined): string {
  const [now, setNow] = useState(() => formatClock(new Date()));
  useEffect(() => {
    if (override) return;
    const timer = setInterval(() => setNow(formatClock(new Date())), 20_000);
    return () => clearInterval(timer);
  }, [override]);
  return override ?? now;
}

function formatClock(date: Date): string {
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Half-pixel rounding: crisp at 100%, and still on a pixel edge at 50% and 200%. */
function half(value: number): number {
  return Math.round(value * 2) / 2;
}

/* -------------------------------------------------------------------------- */
/* Metrics                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The preset every ratio in this file was measured against: iPhone 17 Pro, 402pt
 * wide, Dynamic Island 125 × 36.5 sitting 11pt down. Anything larger or smaller
 * is derived from it, so the reference itself comes out unchanged to the pixel.
 */
const REFERENCE_WIDTH = 402;

interface StatusBarMetrics {
  /** Height of the bar box. Content is centred in it, so this is 2 × the centre. */
  height: number;
  /** Distance from the top of the display to the row's optical centre line. */
  centre: number;
  fontSize: number;
  fontWeight: number;
  /** Ink height shared by every glyph. */
  icon: number;
  /** Gap between glyphs in the trailing cluster. */
  gap: number;
  /** Inset of the trailing cluster from the right edge of the display. */
  gutter: number;
  /** Width of the display region to the left of the cutout. 0 when there is none. */
  ear: number;
  /** Leading edge used when the clock is *not* centred in an ear. */
  leading: number;
  /** iOS portrait with a centred cutout: the clock lives in the middle of the ear. */
  centred: boolean;
}

/**
 * Everything the bar is drawn with, derived from the preset.
 *
 * Scale: iOS specifies its status bar in points and ships the same one on every
 * iPhone, but PhoneLab's presets span 360–440pt, so the chrome is allowed to
 * breathe by ±8% either side of the reference rather than staying frozen on a
 * small phone. Android specifies its bar in *dp*, which is density- and
 * size-independent by definition, so an Android bar is the same on both Android
 * presets — that difference is real and worth keeping.
 */
function statusBarMetrics(preset: DevicePreset, landscape: boolean): StatusBarMetrics {
  const ios = preset.statusBar === 'ios';
  const { cutout, viewport, safeArea } = preset;
  const scale = ios ? clamp(viewport.width / REFERENCE_WIDTH, 0.92, 1.08) : 1;
  const size = (value: number) => half(value * scale);

  // Vertical: the row shares the cutout's centre line, which is what makes the
  // clock and the icons look like they belong to the same piece of hardware.
  // Turned sideways there is no cutout on the top edge to line up with, so the
  // bar falls back to the reserved inset.
  const centre = landscape
    ? Math.max(safeArea.top, 22) / 2
    : cutout.kind === 'none'
      ? Math.max(safeArea.top - 6, 11) / 2
      : cutout.top + cutout.height / 2;

  // Horizontal: portrait cutouts are drawn centred on the display, so the ear is
  // whatever is left over on one side of it. A punch-hole leaves a very wide ear;
  // a notch a narrow one; the maths is the same for all three kinds.
  const ear = landscape || cutout.kind === 'none' ? 0 : (viewport.width - cutout.width) / 2;

  const fontSize = ios ? size(15) : 13;
  const gutter = ios ? size(16) : 16;

  // Turned sideways the cutout moves to the leading edge of the display, so the
  // clock has to start past it rather than at a fixed padding.
  const leading = landscape
    ? half(cutout.kind === 'none' ? gutter : cutout.top + cutout.height + size(8))
    : gutter;

  return {
    height: centre * 2,
    centre,
    fontSize,
    fontWeight: ios ? 600 : 500,
    icon: ios ? size(11.5) : 12,
    gap: ios ? size(5) : 5,
    gutter,
    ear,
    leading,
    // Guard against a preset whose cutout leaves no usable ear: below three
    // characters' worth of room, centring would push the clock into the cutout.
    centred: ios && !landscape && ear >= fontSize * 3,
  };
}

/* -------------------------------------------------------------------------- */

export function StatusBar({
  preset,
  state,
  theme,
  landscape,
}: {
  preset: DevicePreset;
  state: StatusBarState;
  theme: 'light' | 'dark';
  landscape: boolean;
}) {
  const time = useClock(state.time);

  // A format that says it has no status bar does not get one drawn on it.
  if (preset.statusBar === 'none') return null;

  const color = theme === 'dark' ? '#f4f6f8' : '#101318';
  const ios = preset.statusBar === 'ios';
  const metrics = statusBarMetrics(preset, landscape);
  const offline = state.network === 'offline';

  const cellular = offline ? (
    <NoServiceGlyph size={metrics.icon} color={color} android={!ios} />
  ) : (
    <CellularGlyph size={metrics.icon} color={color} bars={state.signal} android={!ios} />
  );
  const wifi =
    state.wifi && !offline ? (
      ios ? (
        <WifiArcsGlyph size={metrics.icon} color={color} weak={state.network === 'slow'} />
      ) : (
        <WifiWedgeGlyph size={metrics.icon} color={color} weak={state.network === 'slow'} />
      )
    ) : null;
  const battery = (
    <BatteryGlyph
      size={metrics.icon}
      color={color}
      level={state.battery}
      charging={state.charging}
      android={!ios}
    />
  );

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-20"
      style={{ height: metrics.height, color }}
    >
      <div
        className="absolute top-0 flex items-center"
        style={
          metrics.centred
            ? { left: 0, width: metrics.ear, height: metrics.height, justifyContent: 'center' }
            : { left: metrics.leading, height: metrics.height }
        }
      >
        <span
          // Tagged so a browser probe can assert where the clock actually lands.
          // Its position is a geometric claim about the ear beside the cutout,
          // and it was wrong by 24pt on the 17 Pro until it was measured.
          data-pl="status-clock"
          className="pl-tabular"
          style={{
            fontSize: metrics.fontSize,
            fontWeight: metrics.fontWeight,
            lineHeight: 1,
            letterSpacing: '-0.01em',
          }}
        >
          {time}
        </span>
      </div>

      <div
        data-pl="status-right"
        className="absolute top-0 flex items-center"
        style={{ right: metrics.gutter, height: metrics.height, gap: metrics.gap }}
      >
        {/* iOS reads cellular → wifi → battery; Android puts wifi first. Both end
            on the battery, which is the one thing they agree about. */}
        {ios ? (
          <>
            {cellular}
            {wifi}
          </>
        ) : (
          <>
            {wifi}
            {cellular}
          </>
        )}
        {battery}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Glyphs                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every glyph is drawn in design units in a box `GLYPH_H` tall, with its ink
 * filling that box top to bottom, and is scaled to the preset's icon size on the
 * way out. That is what puts them all on one optical centre — and it means one
 * number (`metrics.icon`) resizes the whole cluster.
 */
const GLYPH_H = 12;

const BAR_COUNT = 4;
const BAR_W = 3.2;
const BAR_GAP = 1.9;
const BARS_W = BAR_COUNT * BAR_W + (BAR_COUNT - 1) * BAR_GAP;
/** Shortest bar, as a share of the tallest. */
const BAR_FLOOR = 0.38;

/** Android draws cellular as one solid wedge rather than as separate bars. */
const TRIANGLE_W = 14;
const TRIANGLE = 'M12.9 0.8L12.9 11.2L1.1 11.2Z';
/** Bottom-left vertex of the wedge: the point a partial signal grows out of. */
const TRIANGLE_ORIGIN = { x: 1.1, y: 11.2 };

const WIFI_W = 16;
const WIFI_OUTER = 'M0.75 3.7A10.38 10.38 0 0 1 15.25 3.7';
const WIFI_INNER = 'M3.9 7A4.53 4.53 0 0 1 12.1 7';
/** Android's wifi is a filled fan with the same apex-and-arc construction. */
const WIFI_WEDGE = 'M0.4 3.6A9.82 9.82 0 0 1 15.6 3.6L8 12Z';
const WIFI_APEX = { x: 8, y: 12 };

function glyphWidth(designWidth: number, size: number): number {
  return (size * designWidth) / GLYPH_H;
}

function CellularGlyph({
  size,
  color,
  bars,
  android,
}: {
  size: number;
  color: string;
  bars: number;
  android: boolean;
}) {
  const active = clamp(Math.round(bars), 0, BAR_COUNT);

  if (android) {
    const strength = active / BAR_COUNT;
    return (
      <svg
        width={glyphWidth(TRIANGLE_W, size)}
        height={size}
        viewBox={`0 0 ${TRIANGLE_W} ${GLYPH_H}`}
        aria-hidden="true"
      >
        <path d={TRIANGLE} fill={color} stroke={color} strokeWidth={1.4} strokeLinejoin="round" opacity={0.28} />
        {strength > 0 ? (
          // A partial signal is the same wedge scaled about its bottom-left
          // vertex — which is exactly how the filled steps of the Material
          // cellular icon are shaped. The stroke is divided back out so the
          // rounded corners stay the same weight as the full wedge's.
          <path
            d={TRIANGLE}
            fill={color}
            stroke={color}
            strokeWidth={1.4 / strength}
            strokeLinejoin="round"
            transform={`translate(${TRIANGLE_ORIGIN.x} ${TRIANGLE_ORIGIN.y}) scale(${strength}) translate(${-TRIANGLE_ORIGIN.x} ${-TRIANGLE_ORIGIN.y})`}
          />
        ) : null}
      </svg>
    );
  }

  return (
    <svg
      width={glyphWidth(BARS_W, size)}
      height={size}
      viewBox={`0 0 ${BARS_W} ${GLYPH_H}`}
      aria-hidden="true"
    >
      {Array.from({ length: BAR_COUNT }, (_, index) => {
        const height = GLYPH_H * (BAR_FLOOR + (index * (1 - BAR_FLOOR)) / (BAR_COUNT - 1));
        return (
          <rect
            key={index}
            x={index * (BAR_W + BAR_GAP)}
            y={GLYPH_H - height}
            width={BAR_W}
            height={height}
            rx={1.1}
            fill={color}
            opacity={index < active ? 1 : 0.28}
          />
        );
      })}
    </svg>
  );
}

function NoServiceGlyph({
  size,
  color,
  android,
}: {
  size: number;
  color: string;
  android: boolean;
}) {
  const width = android ? TRIANGLE_W : BARS_W;
  return (
    <svg
      width={glyphWidth(width, size)}
      height={size}
      viewBox={`0 0 ${width} ${GLYPH_H}`}
      aria-hidden="true"
    >
      {android ? (
        <path d={TRIANGLE} fill={color} stroke={color} strokeWidth={1.4} strokeLinejoin="round" opacity={0.26} />
      ) : (
        Array.from({ length: BAR_COUNT }, (_, index) => {
          const height = GLYPH_H * (BAR_FLOOR + (index * (1 - BAR_FLOOR)) / (BAR_COUNT - 1));
          return (
            <rect
              key={index}
              x={index * (BAR_W + BAR_GAP)}
              y={GLYPH_H - height}
              width={BAR_W}
              height={height}
              rx={1.1}
              fill={color}
              opacity={0.26}
            />
          );
        })
      )}
      <path
        d={`M0.9 ${GLYPH_H - 0.9}L${width - 0.9} 0.9`}
        stroke={color}
        strokeWidth={1.3}
        strokeLinecap="round"
        opacity={0.9}
      />
    </svg>
  );
}

function WifiArcsGlyph({ size, color, weak }: { size: number; color: string; weak: boolean }) {
  return (
    <svg
      width={glyphWidth(WIFI_W, size)}
      height={size}
      viewBox={`0 0 ${WIFI_W} ${GLYPH_H}`}
      aria-hidden="true"
    >
      <path
        d={WIFI_OUTER}
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        fill="none"
        opacity={weak ? 0.24 : 1}
      />
      <path
        d={WIFI_INNER}
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        fill="none"
        opacity={weak ? 0.44 : 1}
      />
      <circle cx={8} cy={10.6} r={1.4} fill={color} />
    </svg>
  );
}

function WifiWedgeGlyph({ size, color, weak }: { size: number; color: string; weak: boolean }) {
  return (
    <svg
      width={glyphWidth(WIFI_W, size)}
      height={size}
      viewBox={`0 0 ${WIFI_W} ${GLYPH_H}`}
      aria-hidden="true"
    >
      <path d={WIFI_WEDGE} fill={color} opacity={weak ? 0.28 : 1} />
      {weak ? (
        <path
          d={WIFI_WEDGE}
          fill={color}
          transform={`translate(${WIFI_APEX.x} ${WIFI_APEX.y}) scale(0.55) translate(${-WIFI_APEX.x} ${-WIFI_APEX.y})`}
        />
      ) : null}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */

interface BatteryShape {
  /** Total glyph width in design units, terminal nub included. */
  width: number;
  /** Width of the outlined body. */
  body: number;
  radius: number;
  /** Distance from the outer edge of the outline to the fill. */
  inset: number;
  fillRadius: number;
}

/** 25 × 12 body with a 1.5-wide terminal — the proportions of the iOS meter. */
const IOS_BATTERY: BatteryShape = { width: 26.5, body: 25, radius: 3.8, inset: 2, fillRadius: 2.4 };
/** Android's is narrower and squarer. */
const ANDROID_BATTERY: BatteryShape = { width: 23, body: 21.5, radius: 2.6, inset: 1.9, fillRadius: 1.4 };

/** Centred on x = 12.5 and on the body's own centre line, at whatever width. */
const BOLT = 'M13.9 1.9L9.4 6.6h2.7l-1 3.5 4.5-4.9h-2.7z';

function BatteryGlyph({
  size,
  color,
  level,
  charging,
  android,
}: {
  size: number;
  color: string;
  level: number;
  charging: boolean;
  android: boolean;
}) {
  // useId can emit characters that are not valid in a url(#…) reference.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const shape = android ? ANDROID_BATTERY : IOS_BATTERY;

  const clamped = clamp(level, 0, 100);
  // The fill runs the whole track, so 100% reaches the far end of the cavity.
  // The old glyph inset the fill by 1.1 units on the left and stopped 1.9 short
  // on the right, so a full battery read as ~96% and never looked quite full.
  const track = shape.body - shape.inset * 2;
  const fill = (clamped / 100) * track;
  const low = clamped <= 20 && !charging;
  const fillColor = low ? '#f0483c' : charging ? '#37c463' : color;

  return (
    <svg
      width={glyphWidth(shape.width, size)}
      height={size}
      viewBox={`0 0 ${shape.width} ${GLYPH_H}`}
      aria-hidden="true"
    >
      {charging ? (
        <defs>
          <clipPath id={`${uid}-charged`}>
            <rect x={shape.inset} y={0} width={fill} height={GLYPH_H} />
          </clipPath>
          <clipPath id={`${uid}-empty`}>
            <rect x={shape.inset + fill} y={0} width={track - fill} height={GLYPH_H} />
          </clipPath>
        </defs>
      ) : null}

      <rect
        x={0.5}
        y={0.5}
        width={shape.body - 1}
        height={GLYPH_H - 1}
        rx={shape.radius}
        stroke={color}
        strokeWidth={1}
        fill="none"
        opacity={0.36}
      />
      <rect
        x={shape.body + 0.3}
        y={(GLYPH_H - 5) / 2}
        width={shape.width - shape.body - 0.3}
        height={5}
        rx={0.7}
        fill={color}
        opacity={0.36}
      />

      {fill > 0 ? (
        <rect
          x={shape.inset}
          y={shape.inset}
          width={fill}
          height={GLYPH_H - shape.inset * 2}
          // A nearly-flat battery is a sliver, not a lozenge: never round it by
          // more than it is wide.
          rx={Math.min(shape.fillRadius, fill / 2)}
          fill={fillColor}
        />
      ) : null}

      {charging ? (
        // The bolt is knocked out of the charged part of the meter and drawn in
        // the fill colour over the empty part, so it is legible at every level.
        // It used to be a single near-black path: right while the battery was
        // above ~66%, but below that it hung over the empty cavity and sank into
        // whatever dark app was behind the glass.
        <g transform={`translate(${shape.body / 2 - 12.5} 0)`}>
          <path d={BOLT} fill="#0b0d10" opacity={0.86} clipPath={`url(#${uid}-charged)`} />
          <path d={BOLT} fill={fillColor} clipPath={`url(#${uid}-empty)`} />
        </g>
      ) : null}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */

/** The home-gesture pill at the bottom of the screen. */
export function HomeIndicator({
  theme,
  width,
  landscape,
}: {
  theme: 'light' | 'dark';
  width: number;
  landscape: boolean;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-20 flex justify-center"
      style={{ bottom: landscape ? 7 : 8 }}
    >
      <div
        style={{
          width: Math.round(width * (landscape ? 0.22 : 0.36)),
          height: 5,
          borderRadius: 999,
          background: theme === 'dark' ? 'rgba(255,255,255,0.42)' : 'rgba(10,12,16,0.32)',
        }}
      />
    </div>
  );
}
