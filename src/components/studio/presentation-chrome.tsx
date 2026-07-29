'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent as ReactFocusEvent,
} from 'react';
import { Crosshair, RotateCcw, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { roleColor } from '@/lib/devices/roles';
import { Badge, Button, Kbd } from '@/components/ui/primitives';
import { useStudio, useStudioApi } from './context';
import {
  NORMAL_VIEW,
  deviceRemoved,
  leaveViewMode,
  showDeviceOnCanvas,
  versionOnScreen,
  viewModes,
  type ViewModeState,
} from './view-modes';

/**
 * The only chrome left while a view mode is running.
 *
 * ---------------------------------------------------------------------------
 * What is in it, and what is deliberately not
 * ---------------------------------------------------------------------------
 * In presentation mode: the project name, the version the canvas is actually
 * showing, a way to jump between the devices, a way to start the demo over, and
 * the way out. In focus mode: which device is being focused, the same device
 * jumper, and the way out. That is the whole surface.
 *
 * Not here, on purpose:
 *
 *  - anything that edits the project. A file tree, the code, the logs and the
 *    diagnostics are the things presentation mode exists to remove.
 *  - a role switcher. Switching a device's role is a persisted change to that
 *    device — it is still switched after the client has gone home — and the
 *    device action bar already refuses to write it for that reason ("Role —
 *    identity, not a control"). Framing a device moves a camera; changing its
 *    role changes the project, and a demo bar is the wrong place to do that
 *    quietly.
 *  - a progress bar, a "loading your app" step or any other narration. What the
 *    phones are doing is drawn on the phones, by the build overlay, from real
 *    build events.
 *
 * ---------------------------------------------------------------------------
 * Fading, and the promise that it can always be left
 * ---------------------------------------------------------------------------
 * The bar fades out when nothing has happened for CHROME_IDLE_MS, so a client is
 * looking at the app and not at our furniture. That is only acceptable because
 * getting it back is unmissable: it returns on pointer movement, on a press, on
 * a scroll, on any key, and whenever focus moves — which is to say on every
 * gesture that could possibly precede reaching for the exit. It is also pinned
 * open while the pointer is over it or the keyboard is in it, so it can never
 * fade from under a hand or a Tab.
 *
 * The one case worth naming: while the pointer is inside a preview iframe, the
 * frame receives its events and this window sees nothing, so the bar can fade
 * while someone is using the app. Moving the pointer back out of the phone —
 * which is what reaching for the exit means — crosses this document and brings
 * it back before the pointer arrives.
 *
 * Faded is `opacity: 0`, never `display: none` or `aria-hidden`: the exit stays
 * in the tab order and stays announced the whole time. A screen reader user is
 * never in a mode they cannot find their way out of.
 *
 * ---------------------------------------------------------------------------
 * Escape
 * ---------------------------------------------------------------------------
 * Owned here, on `window` in the bubble phase, and only while a mode is live.
 * That makes it cooperative rather than greedy: the command palette stops the
 * event before it reaches us, an open popover handles its own Escape, and if the
 * studio still has something Escape means — inspect mode, or an open inspector
 * result — this stands down and lets that go first. Press it again and the mode
 * ends. Escape peels one layer at a time, which is what people expect.
 *
 * One gap, named rather than papered over: the share dialog is neither a
 * role="dialog" nor an Escape handler of its own, so Escape while it is open
 * leaves the mode underneath it instead of closing it. Giving that dialog the
 * role it already behaves like would fix both halves at once, and it is not this
 * slice's file.
 *
 * There is no browser Fullscreen call anywhere in this file, and that is a
 * decision rather than an omission: `requestFullscreen` needs a user gesture (so
 * it could not be part of a palette command's effect), and while fullscreen is
 * active the browser takes Escape for exiting it — which would leave one key
 * doing two different things and this mode's exit rule at the mercy of the
 * browser's. A host that wants it should put it behind its own button and
 * reconcile the two Escapes there.
 */

/** How long the bar waits, with nothing happening at all, before it fades. */
export const CHROME_IDLE_MS = 2600;

/** Module state on a server is per-process, not per-request: always start normal. */
const serverView = (): ViewModeState => NORMAL_VIEW;

/** The mode the studio is in. The one supported way for a host to read it. */
export function useViewMode(): ViewModeState {
  return useSyncExternalStore(viewModes.subscribe, viewModes.get, serverView);
}

/**
 * Render once, unconditionally, inside `<StudioProvider>`. It draws nothing in
 * normal mode and holds no store subscription there.
 */
export function PresentationChrome() {
  const view = useViewMode();

  // The mode outlives this React tree — see `viewModes.reset`. Unmounting the
  // studio (navigating to another project, signing out) must not leave a mode
  // set against a canvas that no longer exists.
  useEffect(() => () => viewModes.reset(), []);

  return view.mode === 'normal' ? null : <ViewChromeBar view={view} />;
}

/* -------------------------------------------------------------------------- */

function ViewChromeBar({ view }: { view: ViewModeState }) {
  const store = useStudioApi();
  const projectName = useStudio((state) => state.snapshot.project.name);
  const devices = useStudio((state) => state.devices);
  const versions = useStudio((state) => state.versions);
  // Toasts stay on screen in presentation mode: they are real, they are short,
  // and a presenter who cannot see that a build just failed is worse off than a
  // client who sees one line of chrome. They are drawn bottom-centre by
  // studio.tsx, which is where this bar lives too, so the bar steps aside for
  // one instead of being buried under it.
  const toastShowing = useStudio((state) => state.toast !== null);

  const presenting = view.mode === 'presentation';
  const version = useMemo(() => versionOnScreen(devices, versions), [devices, versions]);
  const focused = devices.find((device) => device.id === view.focusedDeviceId) ?? null;

  const barRef = useRef<HTMLDivElement | null>(null);

  /* A mode cannot outlive what it is about. */
  useEffect(() => {
    const id = view.focusedDeviceId;
    if (id !== null && !devices.some((device) => device.id === id)) deviceRemoved(id);
  }, [devices, view.focusedDeviceId]);

  /* --------------------------------------------------------------- leaving */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;

      const target = event.target as HTMLElement | null;
      if (
        target &&
        (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
          target.isContentEditable ||
          target.closest('.monaco-editor') !== null)
      ) {
        return;
      }

      // Any open overlay owns Escape first. Popovers and the command palette
      // both render role="dialog"; matching on the role rather than on a
      // component keeps this true for the next one too.
      if (document.querySelector('[role="dialog"]') !== null) return;

      // And so does anything the studio's own Escape already means, so one
      // press never does two things.
      const state = store.getState();
      if (state.inspectMode || state.inspector) return;

      event.preventDefault();
      leaveViewMode();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [store]);

  /*
   * Focus lands on the exit only when nothing else has it.
   *
   * Entering a mode hides the panels, and hiding the element that had focus
   * drops focus to <body> — which strands a keyboard user at the top of a
   * document whose visible controls are now this bar. Taking focus in that case
   * is not stealing it; taking it when something still holds it would be.
   */
  useEffect(() => {
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    // Queried rather than ref'd: `Button` is a plain function component and does
    // not take a ref, and this is not a good enough reason to change a primitive
    // every other surface in the studio uses.
    barRef.current?.querySelector<HTMLButtonElement>('[data-view-exit]')?.focus({
      preventScroll: true,
    });
  }, []);

  /* ----------------------------------------------------------- idle fading */

  const [idle, setIdle] = useState(false);
  /** Pointer over the bar, or keyboard focus inside it. Never fades while true. */
  const [pinned, setPinned] = useState(false);
  const idleRef = useRef(false);
  const lastActivity = useRef(0);

  useEffect(() => {
    idleRef.current = idle;
    lastActivity.current = performance.now();

    let timer = 0;
    const tick = () => {
      const quietFor = performance.now() - lastActivity.current;
      if (quietFor >= CHROME_IDLE_MS) {
        idleRef.current = true;
        setIdle(true);
        return;
      }
      timer = window.setTimeout(tick, CHROME_IDLE_MS - quietFor);
    };

    // One ref write per pointer move. `setIdle` is reached only on the rare
    // transition back from faded, so moving the pointer across the canvas costs
    // no render and no layout.
    const wake = () => {
      lastActivity.current = performance.now();
      if (idleRef.current) {
        idleRef.current = false;
        setIdle(false);
      }
    };

    const passive = { passive: true } as const;
    window.addEventListener('pointermove', wake, passive);
    window.addEventListener('pointerdown', wake, passive);
    window.addEventListener('wheel', wake, passive);
    window.addEventListener('keydown', wake);
    // focusin bubbles all the way up, so tabbing into the faded bar reveals it.
    window.addEventListener('focusin', wake);
    // Focus leaving this document — into a preview frame, or another tab.
    window.addEventListener('blur', wake);

    if (!idle && !pinned) tick();

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('wheel', wake);
      window.removeEventListener('keydown', wake);
      window.removeEventListener('focusin', wake);
      window.removeEventListener('blur', wake);
    };
  }, [idle, pinned]);

  const pin = useCallback(() => {
    setPinned(true);
    idleRef.current = false;
    setIdle(false);
  }, []);

  const unpin = useCallback(() => setPinned(false), []);

  const onBarBlur = useCallback(
    (event: ReactFocusEvent<HTMLDivElement>) => {
      // Moving between two controls inside the bar is not leaving it.
      if (event.currentTarget.contains(event.relatedTarget)) return;
      unpin();
    },
    [unpin],
  );

  const visible = !idle || pinned;

  /* ------------------------------------------------------------------ view */

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[115] flex justify-center px-4"
      data-testid="view-mode-chrome"
    >
      <div
        ref={barRef}
        role="group"
        aria-label={presenting ? 'Presentation controls' : 'Focus mode controls'}
        data-visible={visible ? 'true' : 'false'}
        onPointerEnter={pin}
        onPointerLeave={unpin}
        onFocus={pin}
        onBlur={onBarBlur}
        style={{
          // Out of the toast's way rather than under it. Transform, so stepping
          // aside is one composited move and costs no layout.
          transform: toastShowing ? 'translateY(-46px)' : 'translateY(0)',
        }}
        className={cn(
          'flex max-w-[min(960px,100%)] flex-wrap items-center gap-1.5',
          'rounded-[var(--radius-panel)] border border-paper-200 bg-paper-0/95 px-2 py-1.5',
          'shadow-float backdrop-blur',
          // Opacity and transform only: this sits over a canvas full of live
          // previews and must never make one of them re-layout.
          'transition-[opacity,transform] duration-[200ms] [transition-timing-function:var(--ease-out-quint)]',
          visible ? 'pointer-events-auto opacity-100' : 'opacity-0',
        )}
      >
        {presenting ? (
          <div className="flex min-w-0 items-center gap-2 pl-1 pr-0.5">
            <span className="truncate text-[13px] font-semibold text-paper-900">{projectName}</span>
            {version ? (
              <Badge tone={version.kind === 'mixed' ? 'caution' : 'neutral'} title={version.detail}>
                {version.label}
              </Badge>
            ) : null}
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-1.5 pl-1 pr-0.5 text-[12.5px] text-paper-600">
            <Crosshair size={13} strokeWidth={1.9} className="shrink-0 text-paper-400" />
            <span className="truncate">
              Focus
              {focused ? (
                <>
                  {' · '}
                  <span className="font-semibold text-paper-900">{focused.name}</span>
                </>
              ) : null}
            </span>
          </div>
        )}

        {devices.length > 1 ? (
          <>
            <span className="mx-0.5 h-5 w-px shrink-0 bg-paper-200" aria-hidden="true" />
            <div
              className="flex flex-wrap items-center gap-0.5"
              role="group"
              aria-label="Show a device"
            >
              {devices.map((device) => {
                const shown = device.id === view.focusedDeviceId;
                return (
                  <button
                    key={device.id}
                    type="button"
                    onClick={() => showDeviceOnCanvas(device.id)}
                    // "the one this bar last framed", not "the one on screen" —
                    // aria-current is a position in a set, which is what this is;
                    // aria-pressed would promise a toggle that does not untoggle.
                    {...(shown ? { 'aria-current': true as const } : {})}
                    // Says what the button does, and stops short of claiming
                    // where the camera is now: it can be panned by hand after.
                    title={`Frame ${device.name} on the canvas`}
                    className={cn(
                      'inline-flex max-w-[140px] cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1',
                      'text-[12px] font-medium transition-colors duration-[140ms]',
                      '[transition-timing-function:var(--ease-out-quint)]',
                      shown
                        ? 'bg-paper-100 text-paper-900'
                        : 'text-paper-600 hover:bg-paper-50 hover:text-paper-900',
                    )}
                  >
                    <span
                      className="size-[7px] shrink-0 rounded-full"
                      style={{ background: roleColor(device.role) }}
                      aria-hidden="true"
                    />
                    <span className="truncate">{device.name}</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : null}

        <span className="mx-0.5 h-5 w-px shrink-0 bg-paper-200" aria-hidden="true" />

        {presenting ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              store.getState().resetDevices(true);
            }}
            title="Reloads every preview and clears the state shared between them."
          >
            <RotateCcw size={12} strokeWidth={1.9} />
            Restart
          </Button>
        ) : null}

        <Button
          data-view-exit="true"
          size="xs"
          onClick={() => {
            leaveViewMode();
          }}
        >
          <X size={12} strokeWidth={2.2} />
          {presenting ? 'Exit presentation' : 'Exit focus'}
        </Button>
        <Kbd className="shrink-0">Esc</Kbd>
      </div>
    </div>
  );
}
