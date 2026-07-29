'use client';

import { useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { DEFAULT_PRESET_ID, deviceGeometry, getPreset } from '@/lib/devices/presets';
import type { PreviewDeviceContext } from '@/lib/preview/protocol';
import { IconButton } from '@/components/ui/primitives';
import { useStudio } from '../context';
import { CompareSlider, versionRefLabel, type CompareSide } from './compare-slider';

/**
 * Before and after, running side by side.
 *
 * Compare mode already existed and was entirely textual: the versions panel
 * listed which files differ and the code panel showed a diff. Useful for reading
 * a change, useless for *seeing* one — which is the question a studio full of
 * running phones is supposed to answer. This is the visual half: both versions
 * compiled, both live, both interactive, split by a divider you drag.
 *
 * ## Why it is a stage rather than a device
 *
 * The two frames here are deliberately **not** devices. They carry
 * `compare:before:<projectId>` / `compare:after:<projectId>` ids so the preview
 * registry can address them, and the studio store — which keys devices by id and
 * drives them through `chrome[deviceId]` — never mistakes one for a phone on the
 * canvas. A comparison is a temporary question about two versions, not two more
 * devices someone has to tidy up afterwards.
 *
 * The viewport comes from the first device on the canvas, so the comparison is
 * shown at a size the project is actually designed for rather than at some
 * neutral default. With no devices at all it falls back to the default preset and
 * says nothing it cannot support.
 */
export function CompareStage() {
  const compare = useStudio((state) => state.compare);
  const setCompare = useStudio((state) => state.setCompare);
  const devices = useStudio((state) => state.devices);
  const versions = useStudio((state) => state.versions);
  const bundles = useStudio((state) => state.bundles);
  const ensureBundle = useStudio((state) => state.ensureBundle);

  const baseKey = String(compare.baseRef);
  const targetKey = String(compare.targetRef);

  // Both halves need a compiled bundle. `ensureBundle` is idempotent and already
  // de-duplicates an in-flight build, so asking twice for the same ref is free.
  useEffect(() => {
    if (!compare.active) return;
    void ensureBundle(compare.baseRef);
    void ensureBundle(compare.targetRef);
  }, [compare.active, compare.baseRef, compare.targetRef, ensureBundle]);

  /**
   * The size to compare at. Taken from the canvas rather than invented: a layout
   * change reads completely differently at 402pt and at 1440, and the honest
   * answer to "did this get better" depends on which one you build for.
   */
  const geometry = useMemo(() => {
    const preset = getPreset(devices[0]?.presetId ?? DEFAULT_PRESET_ID);
    return deviceGeometry(preset, devices[0]?.orientation ?? 'portrait');
  }, [devices]);

  const projectId = useStudio((state) => state.snapshot.project.id);

  const contextFor = useMemo(
    () =>
      (frameId: string, ref: string): PreviewDeviceContext => ({
        deviceId: frameId,
        deviceName: versionRefLabel(ref, versions),
        role: devices[0]?.role ?? 'customer',
        userLabel: devices[0]?.userLabel ?? null,
        theme: devices[0]?.theme ?? 'light',
        locale: devices[0]?.locale ?? 'en',
        // Deliberately not the device's edge cases: a comparison isolates the
        // change between two versions, and a simulated offline connection on one
        // side would be a second variable in a two-variable question.
        network: 'fast',
        flags: [],
        versionLabel: versionRefLabel(ref, versions),
        viewport: geometry.screen,
        safeArea: geometry.safeArea,
      }),
    [devices, versions, geometry],
  );

  const beforeContext = useMemo(
    () => contextFor(`compare:before:${projectId}`, baseKey),
    [contextFor, projectId, baseKey],
  );
  const afterContext = useMemo(
    () => contextFor(`compare:after:${projectId}`, targetKey),
    [contextFor, projectId, targetKey],
  );

  if (!compare.active) return null;

  const before: CompareSide = {
    frameId: `compare:before:${projectId}`,
    label: versionRefLabel(baseKey, versions),
    bundle: bundles[baseKey] ?? null,
    context: beforeContext,
    onRetry: () => void ensureBundle(compare.baseRef, true),
  };
  const after: CompareSide = {
    frameId: `compare:after:${projectId}`,
    label: versionRefLabel(targetKey, versions),
    bundle: bundles[targetKey] ?? null,
    context: afterContext,
    onRetry: () => void ensureBundle(compare.targetRef, true),
  };

  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-paper-50/92 p-6 backdrop-blur-[2px]">
      <div className="flex w-full max-w-[min(96%,1400px)] items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.055em] text-paper-500">
          Before / after
        </span>
        <span className="truncate text-[12px] text-paper-600">
          {before.label} → {after.label}
        </span>
        <span className="ml-auto">
          <IconButton
            label="Close the comparison"
            size="xs"
            onClick={() => setCompare({ active: false })}
          >
            <X size={13} strokeWidth={2.2} />
          </IconButton>
        </span>
      </div>

      <CompareSlider
        before={before}
        after={after}
        width={geometry.screen.width}
        height={geometry.screen.height}
        radius={geometry.screenRadius}
        syncNavigation={compare.syncNavigation}
        className="max-h-full"
      />
    </div>
  );
}
