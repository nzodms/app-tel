'use client';

import { useEffect, useState } from 'react';
import type { DevicePreset } from '@/lib/devices/presets';

/**
 * Simulated status bar.
 *
 * Original vector glyphs sized to sit correctly beside a Dynamic Island or a
 * punch-hole. The clock ticks in real time; signal, wifi and battery are
 * controllable so the Edge Case Studio can show a phone that is offline or nearly
 * flat.
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
  const color = theme === 'dark' ? '#f4f6f8' : '#101318';
  const isIos = preset.statusBar === 'ios';

  // Vertically centre the row on the cutout so the clock lines up with the island.
  const height = landscape
    ? Math.max(preset.safeArea.top, 22)
    : preset.cutout.kind === 'none'
      ? preset.safeArea.top - 6
      : preset.cutout.top * 2 + preset.cutout.height;

  const sidePadding = isIos ? (landscape ? 44 : 27) : 16;
  const fontSize = isIos ? 15 : 13;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between"
      style={{ height, paddingLeft: sidePadding, paddingRight: sidePadding, color }}
    >
      <span
        className="pl-tabular font-semibold"
        style={{
          fontSize,
          letterSpacing: '-0.01em',
          // Android puts the clock left-aligned and smaller; iOS centres it in the
          // left third with a heavier weight.
          fontWeight: isIos ? 600 : 500,
        }}
      >
        {time}
      </span>

      <span className="flex items-center" style={{ gap: isIos ? 5 : 6 }}>
        {state.network === 'offline' ? (
          <NoSignalGlyph color={color} />
        ) : (
          <SignalGlyph bars={state.signal} color={color} />
        )}
        {state.wifi && state.network !== 'offline' ? (
          <WifiGlyph color={color} weak={state.network === 'slow'} />
        ) : null}
        <BatteryGlyph level={state.battery} charging={state.charging} color={color} />
      </span>
    </div>
  );
}

function SignalGlyph({ bars, color }: { bars: number; color: string }) {
  return (
    <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => {
        const height = 3.5 + index * 2.4;
        return (
          <rect
            key={index}
            x={index * 4.4}
            y={12 - height}
            width="3"
            height={height}
            rx="1"
            fill={color}
            opacity={index < bars ? 1 : 0.28}
          />
        );
      })}
    </svg>
  );
}

function NoSignalGlyph({ color }: { color: string }) {
  return (
    <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true">
      <path
        d="M1 11l14-10"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.85"
      />
      <rect x="1" y="7.5" width="2.6" height="3.5" rx="0.9" fill={color} opacity="0.3" />
      <rect x="5" y="5.5" width="2.6" height="5.5" rx="0.9" fill={color} opacity="0.3" />
      <rect x="9" y="3.5" width="2.6" height="7.5" rx="0.9" fill={color} opacity="0.3" />
    </svg>
  );
}

function WifiGlyph({ color, weak }: { color: string; weak?: boolean }) {
  return (
    <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true">
      <path
        d="M8 10.6a1.35 1.35 0 100-2.7 1.35 1.35 0 000 2.7z"
        fill={color}
      />
      <path
        d="M4.6 7.1a4.9 4.9 0 016.8 0"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        opacity={weak ? 0.32 : 1}
      />
      <path
        d="M1.9 4.4a8.7 8.7 0 0112.2 0"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        opacity={weak ? 0.18 : 1}
      />
    </svg>
  );
}

function BatteryGlyph({
  level,
  charging,
  color,
}: {
  level: number;
  charging: boolean;
  color: string;
}) {
  const clamped = Math.max(0, Math.min(100, level));
  const fillWidth = (clamped / 100) * 18;
  const low = clamped <= 20 && !charging;

  return (
    <svg width="26" height="13" viewBox="0 0 26 13" aria-hidden="true">
      <rect
        x="0.6"
        y="0.6"
        width="22"
        height="11.8"
        rx="3.4"
        stroke={color}
        strokeWidth="1"
        fill="none"
        opacity="0.36"
      />
      <path d="M23.6 4.4c1.1.35 1.1 3.85 0 4.2V4.4z" fill={color} opacity="0.36" />
      <rect
        x="2.2"
        y="2.2"
        width={fillWidth}
        height="8.6"
        rx="2.1"
        fill={low ? '#f0483c' : charging ? '#37c463' : color}
      />
      {charging ? (
        <path
          d="M12.4 2.6l-3.6 5h2.5l-.9 3.2 3.7-5.1h-2.5l.8-3.1z"
          fill="#0b0d10"
          opacity="0.85"
        />
      ) : null}
    </svg>
  );
}

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
