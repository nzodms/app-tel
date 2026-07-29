'use client';

import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { edgeCaseGroups, toggleFlag } from '@/lib/devices/edge-cases';
import { DEVICE_PRESETS, getPreset, isRotatable } from '@/lib/devices/presets';
import { Badge, Button, IconButton } from '@/components/ui/primitives';
import { FAMILY_LABELS, FAMILY_ORDER } from './device-family';
import { useStudio } from './context';

/**
 * Chrome the phone draws and a laptop, a monitor or a browser window does not.
 *
 * These stay visible on those families but cannot be switched on, and say why.
 * Silently accepting the flag would be the worse option: it persists, the chip
 * reads "active", and nothing happens on screen.
 */
const HANDHELD_ONLY_FLAGS: Record<string, string> = {
  'keyboard-open': 'A software keyboard is a handheld thing — this format has a real one.',
  'notifications-disabled': 'Banner notifications are drawn on handhelds only.',
};

/**
 * Edge Case Studio.
 *
 * Every switch here has a real effect, and the panel says which layer produces it:
 *
 *  - `network` changes the device's simulated connection, which the SDK's
 *    `request()` honours (added latency, or a rejected promise when offline);
 *  - `chrome` is drawn by PhoneLab (keyboard, permission sheet, suppressed banners);
 *  - `app` is read by the project through `useFlag()` — so if a template does not
 *    handle a flag, the chip says so instead of pretending something happened.
 */
export function EdgeCasesPanel() {
  const open = useStudio((state) => state.edgeCasesOpen);
  const toggleOpen = useStudio((state) => state.toggleEdgeCases);
  const devices = useStudio((state) => state.devices);
  const selectedIds = useStudio((state) => state.selectedDeviceIds);
  const patchDevice = useStudio((state) => state.patchDevice);

  if (!open) return null;

  const target = devices.find((device) => device.id === selectedIds[0]) ?? devices[0] ?? null;
  const targetFamily = target ? getPreset(target.presetId).family : null;
  const handheld = targetFamily === 'phone' || targetFamily === 'tablet';
  const unavailable = (flagId: string) =>
    target && !handheld ? HANDHELD_ONLY_FLAGS[flagId] : undefined;

  const applyToTarget = (flagId: string) => {
    if (!target || unavailable(flagId)) return;
    void patchDevice(target.id, { stateFlags: toggleFlag(target.stateFlags, flagId) });
  };

  /** Sets the flag to the same value on every phone, so states can be compared. */
  const applyToAll = (flagId: string, enable: boolean) => {
    for (const device of devices) {
      const has = device.stateFlags.includes(flagId);
      if (has === enable) continue;
      void patchDevice(device.id, {
        stateFlags: enable
          ? toggleFlag(device.stateFlags, flagId)
          : device.stateFlags.filter((flag) => flag !== flagId),
      });
    }
  };

  const clearAll = () => {
    for (const device of devices) {
      if (device.stateFlags.length > 0) void patchDevice(device.id, { stateFlags: [] });
    }
  };

  return (
    <aside className="absolute right-3 top-3 z-30 flex max-h-[calc(100%-24px)] w-[318px] flex-col overflow-hidden rounded-[var(--radius-panel)] border border-paper-200 bg-paper-0/97 shadow-float backdrop-blur">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-paper-200 px-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.055em] text-paper-500">
          Edge cases
        </span>
        <Badge tone="neutral">{target?.stateFlags.length ?? 0} active</Badge>
        <span className="ml-auto flex items-center gap-1">
          <Button size="xs" variant="ghost" onClick={clearAll}>
            Clear all
          </Button>
          <IconButton label="Close edge cases" size="xs" onClick={toggleOpen}>
            <X size={13} strokeWidth={2} />
          </IconButton>
        </span>
      </div>

      {target ? (
        <div className="shrink-0 border-b border-paper-200 bg-paper-50 px-2.5 py-2">
          <div className="text-[11.5px] text-paper-600">
            Applying to <span className="font-semibold text-paper-800">{target.name}</span> ·{' '}
            {target.role}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <select
              value={target.presetId}
              onChange={(event) => void patchDevice(target.id, { presetId: event.target.value })}
              className="h-6.5 rounded-md border border-paper-300 bg-paper-0 px-1 text-[11px] text-paper-700"
              aria-label="Device format"
            >
              {FAMILY_ORDER.filter((family) =>
                DEVICE_PRESETS.some((preset) => preset.family === family),
              ).map((family) => (
                <optgroup key={family} label={FAMILY_LABELS[family]}>
                  {DEVICE_PRESETS.filter((preset) => preset.family === family).map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {isRotatable(getPreset(target.presetId)) ? (
              <button
                onClick={() =>
                  void patchDevice(target.id, {
                    orientation: target.orientation === 'portrait' ? 'landscape' : 'portrait',
                  })
                }
                className="h-6.5 rounded-md border border-paper-300 bg-paper-0 px-1.5 text-[11px] text-paper-700 hover:bg-paper-100"
              >
                {target.orientation}
              </button>
            ) : null}
            <button
              onClick={() =>
                void patchDevice(target.id, { theme: target.theme === 'light' ? 'dark' : 'light' })
              }
              className={cn(
                'h-6.5 rounded-md border px-1.5 text-[11px]',
                target.theme === 'dark'
                  ? 'border-paper-700 bg-paper-800 text-paper-50'
                  : 'border-paper-300 bg-paper-0 text-paper-700 hover:bg-paper-100',
              )}
            >
              {target.theme}
            </button>
            <select
              value={target.locale}
              onChange={(event) => void patchDevice(target.id, { locale: event.target.value })}
              className="h-6.5 rounded-md border border-paper-300 bg-paper-0 px-1 text-[11px] uppercase text-paper-700"
              aria-label="Locale"
            >
              <option value="en">EN</option>
              <option value="fr">FR</option>
            </select>
          </div>
        </div>
      ) : (
        <p className="px-2.5 py-3 text-[12px] text-paper-500">Add a device to apply edge cases.</p>
      )}

      <div className="pl-scroll min-h-0 flex-1 overflow-y-auto">
        {edgeCaseGroups().map((group) => (
          <div key={group.group}>
            <div className="sticky top-0 border-b border-paper-150 bg-paper-50/95 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-paper-500 backdrop-blur">
              {group.group}
            </div>
            {group.entries.map((entry) => {
              const active = target?.stateFlags.includes(entry.id) ?? false;
              const blocked = unavailable(entry.id);
              return (
                <div
                  key={entry.id}
                  className={cn(
                    'flex items-start gap-2 border-b border-paper-100 px-2.5 py-2 transition-colors',
                    active && !blocked && 'bg-azure-50/60',
                    blocked && 'opacity-60',
                  )}
                >
                  <button
                    onClick={() => applyToTarget(entry.id)}
                    disabled={!target || Boolean(blocked)}
                    title={blocked}
                    className={cn(
                      'mt-[2px] grid h-4 w-7 shrink-0 place-items-center rounded-full border transition-colors',
                      active && !blocked
                        ? 'border-azure-500 bg-azure-500'
                        : 'border-paper-300 bg-paper-100 hover:border-paper-400',
                      (!target || blocked) && 'cursor-not-allowed opacity-45',
                    )}
                    aria-pressed={active && !blocked}
                    aria-label={`${active ? 'Disable' : 'Enable'} ${entry.label}`}
                  >
                    <span
                      className={cn(
                        'size-3 rounded-full bg-paper-0 transition-transform duration-150 [transition-timing-function:var(--ease-out-quint)]',
                        active ? 'translate-x-[6px]' : '-translate-x-[6px]',
                      )}
                    />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12.5px] font-medium text-paper-800">{entry.label}</span>
                      <span
                        className="rounded border border-paper-200 px-1 text-[9.5px] font-medium uppercase tracking-wide text-paper-500"
                        title={
                          entry.channel === 'app'
                            ? 'The project decides what this means, via useFlag()'
                            : entry.channel === 'network'
                              ? 'Changes the simulated connection'
                              : entry.channel === 'chrome'
                                ? 'Drawn by the phone chrome'
                                : 'Changes device configuration'
                        }
                      >
                        {entry.channel}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11.5px] leading-snug text-paper-500">
                      {blocked ?? entry.description}
                    </p>
                  </div>
                  <button
                    onClick={() => applyToAll(entry.id, !active)}
                    className="mt-[2px] shrink-0 rounded-md px-1 py-[2px] text-[10.5px] font-medium text-paper-500 hover:bg-paper-100"
                    title="Apply to every phone on the canvas"
                  >
                    all
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}
