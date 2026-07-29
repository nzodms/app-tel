'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Code2,
  FolderTree,
  History,
  MessageSquare,
  Sparkle,
  Terminal,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { isPreviewMessage } from '@/lib/preview/protocol';
import { Badge, IconButton } from '@/components/ui/primitives';
import { StudioProvider, useStudio, useStudioApi } from './context';
import { Canvas } from './canvas/canvas';
import { canvasApi } from './canvas/canvas-api';
import { previewRegistry } from './preview-registry';
import { Toolbar } from './toolbar';
import { Timeline } from './timeline';
import { EdgeCasesPanel } from './edge-cases-panel';
import { ClaudeActivityStrip } from './claude-activity-strip';
import { CommandPalette, useCommandShortcuts } from './command-palette';
import { PresentationChrome, useViewMode } from './presentation-chrome';
import { chromeFor } from './view-modes';
import { ShareDialog } from './share-dialog';
import { FilesPanel } from './left/files-panel';
import { CodePanel } from './left/code-panel';
import { LogsPanel } from './left/logs-panel';
import { VersionsPanel } from './left/versions-panel';
import { ClaudePanel } from './left/claude-panel';
import { CommentsPanel } from './left/comments-panel';
import { useRealtime } from './use-realtime';
import { useStudioTheme } from './theme';
import { ProjectSwitcherProvider, type SwitcherProject } from './project-switcher';
import type { LeftTab, StudioSnapshot } from './types';

/**
 * The studio.
 *
 * Layout is 25 / 75 by default — code and tools on the left, canvas on the right —
 * and the split is draggable. Everything below is composition; the interesting code
 * lives in `canvas/`, `store.ts` and the panels.
 */
export function Studio({
  snapshot,
  projects = [],
}: {
  snapshot: StudioSnapshot;
  /** Everything the person can open, for the toolbar's project switcher. */
  projects?: SwitcherProject[];
}) {
  return (
    <ProjectSwitcherProvider projects={projects}>
      <StudioProvider snapshot={snapshot}>
        <StudioShell />
      </StudioProvider>
    </ProjectSwitcherProvider>
  );
}

const TABS: { id: LeftTab; label: string; icon: typeof FolderTree }[] = [
  { id: 'files', label: 'Files', icon: FolderTree },
  { id: 'code', label: 'Code', icon: Code2 },
  { id: 'logs', label: 'Logs', icon: Terminal },
  { id: 'versions', label: 'Versions', icon: History },
  { id: 'claude', label: 'Claude', icon: Sparkle },
  { id: 'comments', label: 'Comments', icon: MessageSquare },
];

function StudioShell() {
  const store = useStudioApi();
  const projectId = useStudio((state) => state.snapshot.project.id);
  const leftTab = useStudio((state) => state.leftTab);
  const setLeftTab = useStudio((state) => state.setLeftTab);
  const leftWidth = useStudio((state) => state.leftWidth);
  const setLeftWidth = useStudio((state) => state.setLeftWidth);
  const persistLeftWidth = useStudio((state) => state.persistLeftWidth);
  const reduceMotion = useStudio((state) => state.preferences.reduceMotion);
  // Applies the stored theme and keeps following it: when it changes in
  // Settings, and — under 'system' — when the OS flips under the open studio.
  // The pre-paint script in the root layout has already set the same value on a
  // fresh load, so this writes what it finds and only earns its keep afterwards.
  useStudioTheme(useStudio((state) => state.preferences.theme));
  const openThreads = useStudio((state) => state.threads.filter((thread) => thread.status === 'open').length);
  const errorCount = useStudio(
    (state) => state.diagnostics.filter((entry) => entry.severity === 'error').length,
  );
  const dirtyCount = useStudio((state) => state.openFiles.filter((file) => file.draft !== null).length);
  const inspector = useStudio((state) => state.inspector);
  const clearInspector = useStudio((state) => state.clearInspector);
  const toast = useStudio((state) => state.toast);
  const dismissToast = useStudio((state) => state.dismissToast);

  const [shareOpen, setShareOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resizeRef = useRef<{ pointerId: number } | null>(null);

  useRealtime(projectId);

  /**
   * Focus and Presentation.
   *
   * `chromeFor` says what a mode hides; nothing here unmounts. The left column is
   * hidden with the `hidden` attribute so it keeps its open editors, its scroll
   * positions and its width — "restore the previous layout" is then true by
   * construction rather than by a second reducer copying state back. The toolbar
   * and the timeline render null *in their existing slot*, because re-ordering or
   * re-wrapping an ancestor of a preview iframe reloads the app inside it.
   */
  const view = useViewMode();
  const chrome = chromeFor(view.mode);

  // Every command in one registry, bound in one place, so a shortcut cannot exist
  // in the palette and not on the keyboard.
  useCommandShortcuts(store, { openShare: () => setShareOpen(true) });

  /* One message listener for every preview frame. */
  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (!isPreviewMessage(data)) return;
      // The nonce identifies which frame, and `event.source` proves it.
      const deviceId = previewRegistry.resolve(event.source, data.nonce);
      if (!deviceId) return;
      // Proof the frame is listening, whatever the message. Recovers a frame
      // whose one-shot `preview:ready` was missed, which otherwise leaves it
      // queueing forever.
      previewRegistry.markReadyFromInbound(deviceId);
      store.getState().handlePreviewMessage(deviceId, data);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [store]);

  /* Build the working tree once on mount so the phones have something to run. */
  useEffect(() => {
    void store.getState().rebuildAll(false);
  }, [store]);

  /* Keyboard shortcuts. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
          target.isContentEditable ||
          target.closest('.monaco-editor') !== null);

      const mod = event.metaKey || event.ctrlKey;

      if (mod && event.key === '0') {
        event.preventDefault();
        canvasApi.get()?.zoomTo(1);
        return;
      }
      if (mod && (event.key === '=' || event.key === '+')) {
        event.preventDefault();
        canvasApi.get()?.zoomBy(1.25);
        return;
      }
      if (mod && event.key === '-') {
        event.preventDefault();
        canvasApi.get()?.zoomBy(1 / 1.25);
        return;
      }
      if (mod && event.key === '1') {
        event.preventDefault();
        canvasApi.get()?.fit();
        return;
      }
      if (typing) return;

      if (event.key === 'f' && !mod) {
        canvasApi.get()?.fit();
        return;
      }
      if (event.key === 'i' && !mod) {
        const state = store.getState();
        state.setInspectMode(!state.inspectMode);
        return;
      }
      if (event.key === 'e' && !mod) {
        store.getState().toggleEdgeCases();
        return;
      }
      if (event.key === 't' && !mod) {
        store.getState().toggleTimeline();
        return;
      }
      if (event.key === 'Escape') {
        const state = store.getState();
        if (state.inspectMode) state.setInspectMode(false);
        else if (state.inspector) state.clearInspector();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [store]);

  /* Split resizer. */
  const onResizeStart = useCallback((event: React.PointerEvent) => {
    resizeRef.current = { pointerId: event.pointerId };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    document.body.style.cursor = 'col-resize';
  }, []);

  const onResizeMove = useCallback(
    (event: React.PointerEvent) => {
      if (resizeRef.current?.pointerId !== event.pointerId) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      setLeftWidth(((event.clientX - rect.left) / rect.width) * 100);
    },
    [setLeftWidth],
  );

  const onResizeEnd = useCallback(
    (event: React.PointerEvent) => {
      if (resizeRef.current?.pointerId !== event.pointerId) return;
      resizeRef.current = null;
      document.body.style.cursor = '';
      // The canvas viewport changed size; keep everything in frame.
      window.setTimeout(() => canvasApi.get()?.fit(), 40);
      // One write per gesture, not one per pointermove.
      persistLeftWidth();
    },
    [persistLeftWidth],
  );

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden bg-paper-50"
      data-reduce-motion={reduceMotion ? 'true' : undefined}
    >
      {chrome.toolbar ? <Toolbar onOpenShare={() => setShareOpen(true)} /> : null}

      <div ref={containerRef} className="flex min-h-0 flex-1">
        {/* Left column: code and tools. */}
        <div
          hidden={!chrome.leftPanel}
          className="flex min-w-[240px] flex-col border-r border-paper-200 bg-paper-0"
          style={{ width: `${leftWidth}%` }}
        >
          <div className="flex h-9 shrink-0 items-stretch border-b border-paper-200">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const badge =
                tab.id === 'comments' && openThreads > 0
                  ? openThreads
                  : tab.id === 'logs' && errorCount > 0
                    ? errorCount
                    : tab.id === 'code' && dirtyCount > 0
                      ? dirtyCount
                      : null;
              return (
                <button
                  key={tab.id}
                  onClick={() => setLeftTab(tab.id)}
                  className={cn(
                    'relative flex flex-1 items-center justify-center gap-1.5 px-1 text-[11.5px] font-medium transition-colors',
                    leftTab === tab.id
                      ? 'bg-paper-0 text-paper-900 after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-azure-500'
                      : 'text-paper-500 hover:bg-paper-50 hover:text-paper-700',
                  )}
                  title={tab.label}
                >
                  <Icon size={13.5} strokeWidth={1.8} />
                  <span className="hidden lg:inline">{tab.label}</span>
                  {badge !== null ? (
                    <span
                      className={cn(
                        'grid min-w-[15px] place-items-center rounded-full px-1 text-[9.5px] font-semibold',
                        tab.id === 'logs'
                          ? 'bg-danger-500 text-white'
                          : tab.id === 'comments'
                            ? 'bg-caution-500 text-white'
                            : 'bg-azure-500 text-white',
                      )}
                    >
                      {badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="min-h-0 flex-1">
            {leftTab === 'files' ? <FilesPanel /> : null}
            {leftTab === 'code' ? <CodePanel /> : null}
            {leftTab === 'logs' ? <LogsPanel /> : null}
            {leftTab === 'versions' ? <VersionsPanel /> : null}
            {leftTab === 'claude' ? <ClaudePanel /> : null}
            {leftTab === 'comments' ? <CommentsPanel /> : null}
          </div>
        </div>

        {/* Resizer. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panels"
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
          onDoubleClick={() => setLeftWidth(25)}
          className="group relative w-[3px] shrink-0 cursor-col-resize bg-paper-200 transition-colors hover:bg-azure-300"
          title="Drag to resize · double-click to reset to 25%"
        >
          <span className="absolute inset-y-0 -left-1 -right-1" />
        </div>

        {/* Right: canvas + timeline. */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <Canvas />
            {chrome.edgeCases ? <EdgeCasesPanel /> : null}
            {/* Claude, working, as it happens. Absent entirely when nothing is
                happening — an idle studio shows no strip, not an empty one. */}
            <ClaudeActivityStrip />
            {inspector ? (
              <InspectorCard
                sourceRef={inspector.sourceRef}
                label={inspector.label}
                onClose={clearInspector}
              />
            ) : null}
          </div>
          {chrome.timeline ? <Timeline /> : null}
        </div>
      </div>

      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} />
      <CommandPalette onOpenShare={() => setShareOpen(true)} />
      <PresentationChrome />

      {toast ? (
        <div
          role="status"
          className={cn(
            'fixed bottom-4 left-1/2 z-[120] flex max-w-[480px] -translate-x-1/2 items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px] shadow-float',
            toast.kind === 'error'
              ? 'border-danger-200 bg-danger-50 text-danger-700'
              : toast.kind === 'success'
                ? 'border-positive-200 bg-positive-50 text-positive-700'
                : 'border-paper-200 bg-paper-0 text-paper-700',
          )}
        >
          <span className="min-w-0">{toast.message}</span>
          <IconButton label="Dismiss" size="xs" onClick={dismissToast}>
            <X size={12} strokeWidth={2.2} />
          </IconButton>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The inspector result: what you clicked, and where it lives in the code.
 *
 * The mapping is produced by the compiler (esbuild's dev JSX transform) rather than
 * by annotating the user's components, so it works on any project without changes.
 */
function InspectorCard({
  sourceRef,
  label,
  onClose,
}: {
  sourceRef: string | null;
  label: string | null;
  onClose: () => void;
}) {
  const openFile = useStudio((state) => state.openFile);
  const path = sourceRef?.split(':')[0] ?? null;
  const line = sourceRef?.split(':')[1] ?? null;

  return (
    <div className="absolute bottom-3 left-3 z-30 w-[300px] rounded-[var(--radius-panel)] border border-paper-200 bg-paper-0/97 p-2.5 shadow-float backdrop-blur">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-paper-500">
            Inspected element
          </div>
          <div className="mt-1 truncate text-[12.5px] font-medium text-paper-800">
            {label ?? 'Element'}
          </div>
          {sourceRef ? (
            <button
              onClick={() => path && void openFile(path)}
              className="mt-1.5 block max-w-full truncate rounded border border-paper-200 bg-paper-50 px-1.5 py-[2px] font-mono text-[10.5px] text-azure-700 hover:bg-azure-50"
            >
              {path}
              {line ? `:${line}` : ''}
            </button>
          ) : (
            <p className="mt-1.5 text-[11.5px] leading-snug text-paper-500">
              This element has no source mapping — it is probably rendered by the phone chrome
              rather than by your project.
            </p>
          )}
        </div>
        <IconButton label="Close inspector" size="xs" onClick={onClose}>
          <X size={12} strokeWidth={2.2} />
        </IconButton>
      </div>
      <Badge tone="neutral" className="mt-2">
        Press i to inspect again
      </Badge>
    </div>
  );
}
