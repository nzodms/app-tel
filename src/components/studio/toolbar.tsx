'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlignHorizontalJustifyStart,
  Crosshair,
  GitCompare,
  LayoutGrid,
  Maximize2,
  MousePointerClick,
  Play,
  Plus,
  Share2,
  SlidersHorizontal,
  Square,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { DEVICE_PRESETS } from '@/lib/devices/presets';
import { ROLE_CATALOG } from '@/lib/devices/roles';
import { Badge, Button, IconButton, StatusDot } from '@/components/ui/primitives';
import { MenuItem, MenuLabel, Popover } from '@/components/ui/popover';
import { Logo } from '@/components/brand/logo';
import { useStudio, useStudioApi } from './context';
import { ProjectSwitcher } from './project-switcher';
import { canvasApi } from './canvas/canvas-api';
import { alignRects, distributeRects, tidyRects } from './canvas/geometry';
import { deviceGeometry, getPreset } from '@/lib/devices/presets';

/**
 * The canvas toolbar.
 *
 * Everything here does something. Zoom and recentre talk to the canvas through its
 * imperative handle (never through React state, so they cannot cause a re-render
 * mid-gesture); everything else goes through the store.
 */
export function Toolbar({ onOpenShare }: { onOpenShare: () => void }) {
  const store = useStudioApi();
  const project = useStudio((state) => state.snapshot.project);
  const versions = useStudio((state) => state.versions);
  const journeys = useStudio((state) => state.journeys ?? []);
  const devices = useStudio((state) => state.devices);
  const buildStatus = useStudio((state) => state.buildStatus);
  const buildDurationMs = useStudio((state) => state.buildDurationMs);
  const diagnostics = useStudio((state) => state.diagnostics);
  const compare = useStudio((state) => state.compare);
  const setCompare = useStudio((state) => state.setCompare);
  const inspectMode = useStudio((state) => state.inspectMode);
  const setInspectMode = useStudio((state) => state.setInspectMode);
  const edgeCasesOpen = useStudio((state) => state.edgeCasesOpen);
  const toggleEdgeCases = useStudio((state) => state.toggleEdgeCases);
  const recording = useStudio((state) => state.recording);
  const startRecording = useStudio((state) => state.startRecording);
  const cancelRecording = useStudio((state) => state.cancelRecording);
  const saveRecording = useStudio((state) => state.saveRecording);
  const runJourney = useStudio((state) => state.runJourney);
  const replay = useStudio((state) => state.replay);
  const stopReplay = useStudio((state) => state.stopReplay);
  const addDevice = useStudio((state) => state.addDevice);
  const roles = useStudio((state) => state.roles ?? state.snapshot.roles);

  const [zoom, setZoom] = useState(1);
  useEffect(() => canvasApi.subscribe(setZoom), []);

  const layout = (mode: 'tidy' | 'row' | 'align-top' | 'align-left') => {
    const rects = store.getState().devices.map((device) => {
      const geometry = deviceGeometry(getPreset(device.presetId), device.orientation);
      return {
        id: device.id,
        x: device.x,
        y: device.y,
        width: geometry.chassis.width,
        height: geometry.chassis.height,
      };
    });
    const positions =
      mode === 'tidy'
        ? tidyRects(rects)
        : mode === 'row'
          ? distributeRects(rects)
          : alignRects(rects, mode === 'align-top' ? 'top' : 'left');
    if (positions.length > 0) void store.getState().commitPositions(positions);
    window.setTimeout(() => canvasApi.get()?.fit(), 60);
  };

  const buildTone =
    buildStatus === 'error' ? 'danger' : buildStatus === 'building' ? 'caution' : 'positive';

  return (
    <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-paper-200 bg-paper-0 px-2.5">
      <Link
        href="/dashboard"
        className="flex items-center gap-1.5 rounded-md px-1 py-1 text-paper-800 transition-colors hover:bg-paper-100"
        title="All projects"
      >
        <Logo size={17} />
      </Link>

      <div className="mr-1 min-w-0">
        <ProjectSwitcher
          currentId={project.id}
          currentName={project.name}
          archived={project.status === 'archived'}
        />
      </div>

      <Badge tone={buildTone} className="shrink-0">
        <StatusDot tone={buildTone} pulse={buildStatus === 'building'} />
        {buildStatus === 'building'
          ? 'Building'
          : buildStatus === 'error'
            ? `${diagnostics.filter((entry) => entry.severity === 'error').length} error(s)`
            : buildDurationMs
              ? `Built in ${buildDurationMs}ms`
              : 'Ready'}
      </Badge>

      <span className="mx-0.5 h-5 w-px bg-paper-200" />

      {/* Add device */}
      <Popover
        width={252}
        trigger={({ toggle }) => (
          <Button size="sm" onClick={toggle}>
            <Plus size={13} strokeWidth={2} />
            Device
          </Button>
        )}
      >
        {({ close }) => (
          <div className="max-h-[420px] overflow-y-auto">
            <MenuLabel>Role</MenuLabel>
            {(roles.length > 0 ? roles : ROLE_CATALOG.map((role) => ({ slug: role.slug, label: role.label, defaultUser: role.defaultUser }))).map(
              (role) => (
                <MenuItem
                  key={role.slug}
                  onClick={() => {
                    void addDevice({ role: role.slug, name: role.label, userLabel: role.defaultUser });
                    close();
                  }}
                >
                  {role.label}
                </MenuItem>
              ),
            )}
            <MenuLabel>Format</MenuLabel>
            {DEVICE_PRESETS.map((preset) => (
              <MenuItem
                key={preset.id}
                hint={`${preset.viewport.width}×${preset.viewport.height}`}
                onClick={() => {
                  void addDevice({ presetId: preset.id, role: roles[0]?.slug ?? 'customer' });
                  close();
                }}
              >
                {preset.name}
              </MenuItem>
            ))}
            <p className="border-t border-paper-150 px-2.5 py-1.5 text-[10.5px] leading-snug text-paper-400">
              Preset names describe the viewport format. PhoneLab is not affiliated with any device
              manufacturer.
            </p>
          </div>
        )}
      </Popover>

      {/* Journeys */}
      <Popover
        width={280}
        trigger={({ toggle }) => (
          <Button size="sm" onClick={toggle} className={cn(recording?.active && 'text-danger-700')}>
            <Play size={13} strokeWidth={2} />
            Journey
          </Button>
        )}
      >
        {({ close }) => (
          <div>
            <MenuLabel>Record</MenuLabel>
            {recording?.active ? (
              <>
                <div className="px-2.5 py-1.5 text-[12px] text-paper-600">
                  Recording · {recording.steps.length} step(s) captured
                </div>
                <MenuItem
                  onClick={() => {
                    const name = window.prompt('Journey name', 'New customer books a court');
                    if (name) void saveRecording(name, '');
                    close();
                  }}
                >
                  Save journey
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    cancelRecording();
                    close();
                  }}
                >
                  Discard recording
                </MenuItem>
              </>
            ) : (
              <MenuItem
                onClick={() => {
                  startRecording();
                  close();
                }}
                hint="resets devices"
              >
                Start recording
              </MenuItem>
            )}

            <MenuLabel>Replay</MenuLabel>
            {journeys.length === 0 ? (
              <p className="px-2.5 py-2 text-[11.5px] leading-snug text-paper-500">
                No journeys saved yet. Record one — every tap, entry and cross-device event is
                captured.
              </p>
            ) : (
              journeys.map((journey) => (
                <MenuItem
                  key={journey.id}
                  hint={`${journey.stepCount} steps`}
                  onClick={() => {
                    void runJourney(journey.id);
                    close();
                  }}
                >
                  {journey.name}
                </MenuItem>
              ))
            )}
          </div>
        )}
      </Popover>

      {replay ? (
        <Button size="sm" variant="danger" onClick={stopReplay}>
          <Square size={11} strokeWidth={2.4} />
          Stop · step {replay.step + 1}/{replay.total}
        </Button>
      ) : null}

      <Button
        size="sm"
        onClick={() => {
          const latest = versions[0];
          const previous = versions[1];
          setCompare({
            active: !compare.active,
            baseRef: previous?.id ?? latest?.id ?? 'working',
            targetRef: 'working',
            path: null,
          });
          if (!compare.active) store.getState().setLeftTab('versions');
        }}
        className={cn(compare.active && 'bg-azure-50 text-azure-700 border-azure-200')}
      >
        <GitCompare size={13} strokeWidth={1.9} />
        Compare
      </Button>

      <Button
        size="sm"
        onClick={toggleEdgeCases}
        className={cn(edgeCasesOpen && 'bg-azure-50 text-azure-700 border-azure-200')}
      >
        <SlidersHorizontal size={13} strokeWidth={1.9} />
        Edge cases
      </Button>

      <Button size="sm" onClick={onOpenShare}>
        <Share2 size={13} strokeWidth={1.9} />
        Share
      </Button>

      <div className="ml-auto flex items-center gap-1">
        <IconButton
          label={inspectMode ? 'Cancel inspect' : 'Inspect a component'}
          onClick={() => setInspectMode(!inspectMode)}
          className={cn(inspectMode && 'bg-azure-50 text-azure-700')}
        >
          <MousePointerClick size={14} strokeWidth={1.8} />
        </IconButton>

        <Popover
          width={210}
          align="end"
          trigger={({ toggle }) => (
            <IconButton label="Arrange devices" onClick={toggle}>
              <LayoutGrid size={14} strokeWidth={1.8} />
            </IconButton>
          )}
        >
          {({ close }) => (
            <div>
              <MenuLabel>Arrange {devices.length} device(s)</MenuLabel>
              <MenuItem
                onClick={() => {
                  layout('tidy');
                  close();
                }}
              >
                Tidy into a grid
              </MenuItem>
              <MenuItem
                onClick={() => {
                  layout('row');
                  close();
                }}
              >
                Distribute in a row
              </MenuItem>
              <MenuItem
                onClick={() => {
                  layout('align-top');
                  close();
                }}
              >
                Align tops
              </MenuItem>
              <MenuItem
                onClick={() => {
                  layout('align-left');
                  close();
                }}
              >
                Align left edges
              </MenuItem>
            </div>
          )}
        </Popover>

        <span className="mx-0.5 h-5 w-px bg-paper-200" />

        <IconButton label="Zoom out" onClick={() => canvasApi.get()?.zoomBy(1 / 1.25)}>
          <ZoomOut size={14} strokeWidth={1.8} />
        </IconButton>
        <button
          onClick={() => canvasApi.get()?.zoomTo(1)}
          className="pl-tabular h-7.5 min-w-[46px] rounded-lg px-1 text-[12px] font-medium text-paper-600 transition-colors hover:bg-paper-100"
          title="Reset to 100%"
        >
          {Math.round(zoom * 100)}%
        </button>
        <IconButton label="Zoom in" onClick={() => canvasApi.get()?.zoomBy(1.25)}>
          <ZoomIn size={14} strokeWidth={1.8} />
        </IconButton>
        <IconButton label="Fit all devices" onClick={() => canvasApi.get()?.fit()}>
          <Maximize2 size={14} strokeWidth={1.8} />
        </IconButton>
      </div>
    </div>
  );
}

/** Kept exported so the shortcut layer can reuse the same labels. */
export const TOOLBAR_ICONS = {
  align: AlignHorizontalJustifyStart,
  crosshair: Crosshair,
};
