'use client';

import { AnimatePresence, motion } from 'motion/react';
import type { PreviewNotification } from '@/lib/preview/protocol';
import type { DevicePreset } from '@/lib/devices/presets';

/**
 * Device-chrome overlays: notification banners, system sheets, and the simulated
 * keyboard.
 *
 * These are drawn by PhoneLab, not by the app inside the phone — so a project gets
 * realistic system behaviour without writing any of it, and the same notification
 * looks right on every preset.
 */

const BANNER_SPRING = { type: 'spring', stiffness: 380, damping: 32, mass: 0.85 } as const;

const TONE_STYLES: Record<PreviewNotification['kind'], { accent: string; icon: string }> = {
  default: { accent: '#4d93fb', icon: 'bell' },
  success: { accent: '#37c463', icon: 'check' },
  warning: { accent: '#e0a33c', icon: 'alert' },
  error: { accent: '#f0655e', icon: 'alert' },
};

export function NotificationLayer({
  notifications,
  preset,
  theme,
  onDismiss,
}: {
  notifications: PreviewNotification[];
  preset: DevicePreset;
  theme: 'light' | 'dark';
  onDismiss: (id: string) => void;
}) {
  const top =
    preset.cutout.kind === 'dynamic-island'
      ? preset.cutout.top + preset.cutout.height + 10
      : preset.safeArea.top + 6;

  return (
    <div
      className="absolute inset-x-0 z-40 flex flex-col items-center gap-2 px-3"
      style={{ top }}
    >
      <AnimatePresence initial={false}>
        {notifications.map((notification) => (
          <motion.button
            key={notification.id}
            layout
            initial={{ opacity: 0, y: -22, scale: 0.965 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -14, scale: 0.97 }}
            transition={BANNER_SPRING}
            onClick={() => onDismiss(notification.id)}
            className="w-full max-w-[364px] cursor-pointer overflow-hidden rounded-[20px] text-left"
            style={{
              background:
                theme === 'dark' ? 'rgba(31,36,44,0.92)' : 'rgba(255,255,255,0.93)',
              backdropFilter: 'blur(18px) saturate(160%)',
              boxShadow:
                theme === 'dark'
                  ? '0 1px 1px rgba(0,0,0,0.5), 0 12px 28px -10px rgba(0,0,0,0.7)'
                  : '0 1px 1px rgba(16,20,26,0.06), 0 12px 28px -10px rgba(16,20,26,0.28)',
              border:
                theme === 'dark'
                  ? '0.5px solid rgba(255,255,255,0.1)'
                  : '0.5px solid rgba(16,20,26,0.07)',
            }}
          >
            <div className="flex items-start gap-2.5 p-3">
              <NotificationGlyph kind={notification.kind} />
              <div className="min-w-0 flex-1 pt-[1px]">
                <div
                  className="truncate text-[13px] font-semibold leading-tight"
                  style={{ color: theme === 'dark' ? '#eef1f5' : '#12161b' }}
                >
                  {notification.title}
                </div>
                {notification.body ? (
                  <div
                    className="mt-[3px] line-clamp-2 text-[12px] leading-[1.35]"
                    style={{ color: theme === 'dark' ? '#96a0ad' : '#5f6875' }}
                  >
                    {notification.body}
                  </div>
                ) : null}
              </div>
              <span
                className="mt-[3px] text-[10.5px] font-medium"
                style={{ color: theme === 'dark' ? '#7b8593' : '#8a929e' }}
              >
                now
              </span>
            </div>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}

function NotificationGlyph({ kind }: { kind: PreviewNotification['kind'] }) {
  const { accent, icon } = TONE_STYLES[kind];
  return (
    <span
      className="grid size-8 shrink-0 place-items-center rounded-[9px]"
      style={{ background: `${accent}22` }}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        {icon === 'check' ? (
          <path d="M5 12.5l4.5 4.5L19 7" />
        ) : icon === 'alert' ? (
          <>
            <path d="M12 4.5l8.5 15h-17l8.5-15z" />
            <path d="M12 10v4M12 16.8v.2" />
          </>
        ) : (
          <>
            <path d="M12 4.5a6 6 0 016 6v3l1.5 2.5H4.5L6 13.5v-3a6 6 0 016-6z" />
            <path d="M10 19a2.2 2.2 0 004 0" />
          </>
        )}
      </svg>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* System sheets — permission prompts and the like                             */
/* -------------------------------------------------------------------------- */

export interface SystemSheet {
  id: string;
  title: string;
  body: string;
  primaryLabel: string;
  secondaryLabel: string;
  /** Which flag raised this sheet, so dismissing it can clear the flag. */
  flag: string | null;
}

export function SystemSheetLayer({
  sheet,
  theme,
  onResolve,
}: {
  sheet: SystemSheet | null;
  theme: 'light' | 'dark';
  onResolve: (sheetId: string, allowed: boolean) => void;
}) {
  return (
    <AnimatePresence>
      {sheet ? (
        <motion.div
          className="absolute inset-0 z-50 grid place-items-center px-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          style={{ background: 'rgba(8,10,14,0.34)', backdropFilter: 'blur(2px)' }}
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 460, damping: 34 }}
            className="w-full max-w-[272px] overflow-hidden rounded-[15px] text-center"
            style={{
              background: theme === 'dark' ? 'rgba(38,43,52,0.96)' : 'rgba(250,250,252,0.97)',
              backdropFilter: 'blur(20px)',
              color: theme === 'dark' ? '#eef1f5' : '#12161b',
            }}
          >
            <div className="px-4 pb-4 pt-4">
              <div className="text-[15px] font-semibold leading-snug">{sheet.title}</div>
              <p
                className="mt-1.5 text-[12.5px] leading-[1.4]"
                style={{ color: theme === 'dark' ? '#a3adba' : '#5f6875' }}
              >
                {sheet.body}
              </p>
            </div>
            <div
              className="grid grid-cols-2"
              style={{
                borderTop:
                  theme === 'dark' ? '0.5px solid rgba(255,255,255,0.12)' : '0.5px solid rgba(16,20,26,0.1)',
              }}
            >
              <button
                onClick={() => onResolve(sheet.id, false)}
                className="py-2.5 text-[14px] font-normal text-[#4d93fb]"
                style={{
                  borderRight:
                    theme === 'dark'
                      ? '0.5px solid rgba(255,255,255,0.12)'
                      : '0.5px solid rgba(16,20,26,0.1)',
                }}
              >
                {sheet.secondaryLabel}
              </button>
              <button
                onClick={() => onResolve(sheet.id, true)}
                className="py-2.5 text-[14px] font-semibold text-[#4d93fb]"
              >
                {sheet.primaryLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/* -------------------------------------------------------------------------- */
/* Simulated keyboard                                                          */
/* -------------------------------------------------------------------------- */

const ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

/**
 * Drawn over the app when the `keyboard-open` edge case is applied. The runtime
 * reserves the same height via `--pl-keyboard`, so this reveals real layout
 * problems rather than just covering them up.
 */
export function KeyboardLayer({
  height,
  theme,
  landscape,
}: {
  height: number;
  theme: 'light' | 'dark';
  landscape: boolean;
}) {
  const dark = theme === 'dark';
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex flex-col justify-end gap-[6px] px-[3px] pb-[22px] pt-2"
      style={{
        height,
        background: dark ? 'rgba(28,32,38,0.97)' : 'rgba(209,212,218,0.97)',
        backdropFilter: 'blur(12px)',
        borderTop: dark ? '0.5px solid rgba(255,255,255,0.08)' : '0.5px solid rgba(16,20,26,0.1)',
      }}
    >
      {ROWS.map((row, index) => (
        <div
          key={index}
          className="flex justify-center gap-[5px]"
          style={{ paddingInline: index === 1 ? 14 : index === 2 ? 44 : 0 }}
        >
          {row.map((key) => (
            <span
              key={key}
              className="grid flex-1 place-items-center rounded-[5px] text-[15px] font-normal"
              style={{
                height: landscape ? 26 : 38,
                maxWidth: 40,
                background: dark ? '#4b5158' : '#ffffff',
                color: dark ? '#f2f5f8' : '#12161b',
                boxShadow: dark ? 'none' : '0 1px 0 rgba(16,20,26,0.22)',
              }}
            >
              {key}
            </span>
          ))}
        </div>
      ))}
      <div className="flex justify-center gap-[5px]">
        <span
          className="grid place-items-center rounded-[5px] text-[11px] font-medium"
          style={{
            width: 46,
            height: landscape ? 26 : 38,
            background: dark ? '#33383f' : '#adb3bb',
            color: dark ? '#e9edf2' : '#12161b',
          }}
        >
          123
        </span>
        <span
          className="grid flex-1 place-items-center rounded-[5px] text-[13px]"
          style={{
            height: landscape ? 26 : 38,
            background: dark ? '#4b5158' : '#ffffff',
            color: dark ? '#f2f5f8' : '#12161b',
          }}
        >
          space
        </span>
        <span
          className="grid place-items-center rounded-[5px] text-[11px] font-medium"
          style={{
            width: 62,
            height: landscape ? 26 : 38,
            background: '#4d93fb',
            color: '#fff',
          }}
        >
          return
        </span>
      </div>
    </div>
  );
}
