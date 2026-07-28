'use client';

import type { ReactNode } from 'react';
import { deviceGeometry, type DevicePreset } from '@/lib/devices/presets';
import type { PreviewNotification } from '@/lib/preview/protocol';
import { GLASS_SHEEN, chassisStyle } from './chassis';
import { DeviceCutout, type IslandContent } from './dynamic-island';
import {
  KeyboardLayer,
  NotificationLayer,
  SystemSheetLayer,
  type SystemSheet,
} from './overlays';
import { HomeIndicator, StatusBar, type StatusBarState } from './status-bar';

/**
 * The phone.
 *
 * Everything is drawn from the preset's numbers with CSS and SVG — the chassis,
 * the machined edge, the bezel, the buttons, the glass highlight. There are no
 * device images anywhere in PhoneLab, and nothing here is tied to a manufacturer's
 * branding; presets name a *viewport format* so you know what you are testing.
 *
 * The screen is a real, interactive preview: `children` is the sandboxed iframe.
 * Overlays (status bar, cutout, banners, sheets, keyboard) sit above it inside the
 * same clipped rounded rect, so they crop exactly like they would on the device.
 */

export interface PhoneChromeState {
  status: StatusBarState;
  island: IslandContent;
  notifications: PreviewNotification[];
  sheet: SystemSheet | null;
  keyboardOpen: boolean;
}

export function Phone({
  preset,
  orientation,
  theme,
  chrome,
  selected,
  dimmed,
  children,
  onDismissNotification,
  onResolveSheet,
}: {
  preset: DevicePreset;
  orientation: 'portrait' | 'landscape';
  theme: 'light' | 'dark';
  chrome: PhoneChromeState;
  selected: boolean;
  dimmed?: boolean;
  children: ReactNode;
  onDismissNotification: (id: string) => void;
  onResolveSheet: (sheetId: string, allowed: boolean) => void;
}) {
  const geometry = deviceGeometry(preset, orientation);
  const material = chassisStyle(preset.material);
  const landscape = geometry.landscape;
  const keyboardHeight = Math.round(geometry.screen.height * 0.42);

  return (
    <div
      className="relative"
      style={{
        width: geometry.chassis.width,
        height: geometry.chassis.height,
      }}
    >
      {/* Side buttons sit behind the body so they read as protruding from under it. */}
      {preset.buttons.map((button) => {
        const along = landscape ? { left: button.top, width: button.length, height: button.thickness } : { top: button.top, height: button.length, width: button.thickness };
        const edge = landscape
          ? button.side === 'left'
            ? { bottom: -button.thickness + 0.5 }
            : { top: -button.thickness + 0.5 }
          : button.side === 'left'
            ? { left: -button.thickness + 0.5 }
            : { right: -button.thickness + 0.5 };

        return (
          <div
            key={button.id}
            aria-hidden="true"
            className="absolute"
            style={{
              ...along,
              ...edge,
              background: material.button,
              borderRadius: landscape ? '2px 2px 0 0' : button.side === 'left' ? '2px 0 0 2px' : '0 2px 2px 0',
              boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.35), 0 1px 2px rgba(10,12,16,0.28)',
            }}
          />
        );
      })}

      {/* Chassis rail. */}
      <div
        className="absolute inset-0"
        style={{
          borderRadius: geometry.outerRadius,
          background: material.rail,
          boxShadow: `${material.railRing}, var(--shadow-device)`,
        }}
      />

      {/* Bezel: the black band between rail and glass. */}
      <div
        className="absolute"
        style={{
          inset: preset.rail,
          borderRadius: geometry.screenRadius + preset.bezel,
          background: material.bezel,
          boxShadow: 'inset 0 0 1.5px rgba(0,0,0,0.9)',
        }}
      />

      {/* Screen. Everything inside is clipped to the display radius. */}
      <div
        className="absolute overflow-hidden"
        style={{
          inset: geometry.inset,
          borderRadius: geometry.screenRadius,
          background: theme === 'dark' ? '#0e1116' : '#f5f6f8',
          // A hairline inside the glass keeps the display edge crisp at any zoom.
          boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.06)',
        }}
      >
        <div className="absolute inset-0">{children}</div>

        {preset.cutout.kind !== 'none' || preset.statusBar === 'android' ? (
          <StatusBar preset={preset} state={chrome.status} theme={theme} landscape={landscape} />
        ) : null}

        <DeviceCutout preset={preset} content={chrome.island} landscape={landscape} />

        <NotificationLayer
          notifications={chrome.notifications}
          preset={preset}
          theme={theme}
          onDismiss={onDismissNotification}
        />

        {chrome.keyboardOpen ? (
          <KeyboardLayer height={keyboardHeight} theme={theme} landscape={landscape} />
        ) : null}

        <SystemSheetLayer sheet={chrome.sheet} theme={theme} onResolve={onResolveSheet} />

        {preset.homeIndicator ? (
          <HomeIndicator theme={theme} width={geometry.screen.width} landscape={landscape} />
        ) : null}

        {/* Glass highlight, above the app but never interactive. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[60]"
          style={{ background: GLASS_SHEEN, borderRadius: geometry.screenRadius }}
        />

        {dimmed ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-[61]"
            style={{ background: 'rgba(10,12,16,0.35)' }}
          />
        ) : null}
      </div>

      {/* Selection ring, outside the chassis so it never covers the screen. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute transition-opacity duration-150"
        style={{
          inset: -5,
          borderRadius: geometry.outerRadius + 5,
          boxShadow: selected
            ? '0 0 0 2px var(--color-azure-400), 0 0 0 5px rgb(37 112 232 / 0.14)'
            : 'none',
          opacity: selected ? 1 : 0,
        }}
      />
    </div>
  );
}
