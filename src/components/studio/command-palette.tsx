'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Kbd } from '@/components/ui/primitives';
import { MenuLabel } from '@/components/ui/popover';
import { useStudioApi } from './context';
import {
  PALETTE_SHORTCUT,
  commandAvailability,
  formatShortcut,
  runCommand,
  shortcutMatches,
  studioCommands,
  type Command,
  type CommandAvailability,
  type CommandGroup,
  type CommandHost,
  type StudioStoreApi,
} from './commands';

/**
 * The command palette (⌘K / Ctrl-K) and the studio's keyboard layer.
 *
 * Both read `studioCommands()` — see commands.ts for why that matters. Nothing
 * here knows what any command *does*; it only knows how to find one, show
 * whether it can run, and run it.
 *
 * ---------------------------------------------------------------------------
 * Mounting
 * ---------------------------------------------------------------------------
 * `<CommandPalette />` is self-contained: it installs ⌘K itself and calls
 * `useCommandShortcuts` for you, so mounting it anywhere inside `<StudioProvider>`
 * is enough. Closed, it renders nothing and holds no store subscription — an
 * idle palette costs one keydown listener.
 *
 * `onOpenShare` is optional and exists because the share dialog's open state
 * lives in `StudioShell`, not in the store. Pass it and the palette offers
 * "Share for review"; leave it out and that command simply is not there. A
 * command that could not possibly work is not drawn.
 *
 * It renders a fixed-position overlay and never portals, re-parents or reorders
 * anything: a device node moving in the DOM would reload the preview inside it.
 *
 * ---------------------------------------------------------------------------
 * Why the key listener is in the capture phase
 * ---------------------------------------------------------------------------
 * The studio already binds some of these keys on `window` (studio.tsx binds
 * f/i/e/t and the zoom keys; code-panel.tsx binds ⌘S). If both layers ran, every
 * *toggle* would fire twice and cancel itself out — press `t` and the timeline
 * would open and close in the same tick.
 *
 * So this listener runs in the capture phase, which reaches `window` before any
 * bubbling listener, and calls `stopImmediatePropagation()` for the keys it
 * actually claims. Exactly one handler runs, and it is this one. Keys that are
 * not claimed are not touched, and a keystroke aimed at a text field is left
 * alone before any of this is considered.
 *
 * That holds whether or not the older duplicates are removed later: if they are,
 * this keeps working unchanged; if they stay, they are shadowed rather than
 * doubled.
 */

/* -------------------------------------------------------------------------- */
/* Keyboard layer                                                              */
/* -------------------------------------------------------------------------- */

interface Binding {
  store: StudioStoreApi;
  host: CommandHost;
}

/**
 * One window listener for the whole app, however many callers there are.
 *
 * `<CommandPalette />` calls the hook internally *and* exports it, so a studio
 * that mounts the palette and also calls `useCommandShortcuts` would otherwise
 * install two identical listeners and run every shortcut twice. Sharing one
 * listener behind a small registry makes that impossible rather than merely
 * unlikely.
 */
const bindings: Binding[] = [];
let listening = false;

/** True while a palette is open; global shortcuts stand down until it closes. */
let paletteOpen = false;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
    target.isContentEditable ||
    target.closest('.monaco-editor') !== null
  );
}

function onWindowKeyDown(event: KeyboardEvent): void {
  // The most recent binding wins — there is one studio per page, so this is a
  // stack of one in practice.
  const binding = bindings[bindings.length - 1];
  if (!binding) return;
  // `repeat` is dropped so holding a key cannot queue twenty rebuilds. Nothing
  // bound here is a hold-to-repeat action.
  if (event.defaultPrevented || event.repeat || paletteOpen) return;
  if (isTypingTarget(event.target)) return;

  const state = binding.store.getState();
  for (const command of studioCommands(state, binding.host)) {
    if (!command.shortcut || !shortcutMatches(command.shortcut, event)) continue;
    // Claimed either way: swallowing ⌘S when there is nothing to save is still
    // better than letting the browser offer to save the page.
    event.preventDefault();
    event.stopImmediatePropagation();

    const availability = commandAvailability(command, state);
    if (availability === true) runCommand(command, binding.store);
    // A key that is bound, does nothing and says nothing is a dead control. The
    // palette shows the reason on the row; from the keyboard there is no row, so
    // it is said out loud instead.
    else state.notify('info', availability);
    return;
  }
}

/**
 * Binds every command's declared shortcut, globally.
 *
 * Keystrokes typed into an input, a textarea, a select, a contenteditable or the
 * code editor are ignored — the same test studio.tsx already used, so a key that
 * was safe to type before is still safe to type.
 */
export function useCommandShortcuts(store: StudioStoreApi, host: CommandHost = {}): void {
  const binding = useRef<Binding>({ store, host });

  // Kept current without re-installing the listener, so a host object recreated
  // on every render costs nothing.
  useEffect(() => {
    binding.current.store = store;
    binding.current.host = host;
  });

  useEffect(() => {
    const entry = binding.current;
    bindings.push(entry);
    if (!listening) {
      window.addEventListener('keydown', onWindowKeyDown, true);
      listening = true;
    }
    return () => {
      const index = bindings.indexOf(entry);
      if (index >= 0) bindings.splice(index, 1);
      if (bindings.length === 0 && listening) {
        window.removeEventListener('keydown', onWindowKeyDown, true);
        listening = false;
      }
    };
  }, []);
}

/* -------------------------------------------------------------------------- */
/* Search                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Fuzzy-ish, in the sense people expect from a palette: whole words rank above
 * fragments, a hit in the title ranks above one in the description, and letters
 * in order ("adv" → "Add a device") still match when nothing else does. Every
 * word you type has to match something, so extra words narrow rather than widen.
 */
function isSubsequence(haystack: string, needle: string): boolean {
  let index = 0;
  for (const character of needle) {
    index = haystack.indexOf(character, index);
    if (index === -1) return false;
    index += 1;
  }
  return true;
}

function tokenScore(command: Command, token: string): number {
  const title = command.title.toLowerCase();
  const rest = `${command.subtitle ?? ''} ${command.group} ${command.keywords ?? ''}`.toLowerCase();

  const inTitle = title.indexOf(token);
  if (inTitle === 0) return 100;
  if (inTitle > 0) return title[inTitle - 1] === ' ' ? 80 : 60;
  if (rest.includes(token)) return 30;
  if (isSubsequence(title, token)) return 20;
  if (isSubsequence(`${title} ${rest}`, token)) return 10;
  return 0;
}

interface Row {
  command: Command;
  availability: CommandAvailability;
}

interface Section {
  group: CommandGroup;
  rows: Row[];
}

/**
 * Matches, best first, and the same rows grouped for display.
 *
 * Sorting is global and the groups follow it, so the best match is always the
 * first row of the first group — which is where the highlight starts. With an
 * empty query every score is equal and the sort is stable, so the palette opens
 * in registry order.
 */
function search(rows: readonly Row[], query: string): { flat: Row[]; sections: Section[] } {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);

  const scored: { row: Row; score: number; index: number }[] = [];
  rows.forEach((row, index) => {
    let total = 0;
    for (const token of tokens) {
      const score = tokenScore(row.command, token);
      if (score === 0) return;
      total += score;
    }
    scored.push({ row, score: total, index });
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  const flat = scored.map((entry) => entry.row);
  const sections: Section[] = [];
  for (const row of flat) {
    const last = sections[sections.length - 1];
    if (last && last.group === row.command.group) last.rows.push(row);
    else sections.push({ group: row.command.group, rows: [row] });
  }
  return { flat, sections };
}

/* -------------------------------------------------------------------------- */
/* Palette                                                                     */
/* -------------------------------------------------------------------------- */

export function CommandPalette({ onOpenShare }: { onOpenShare?: () => void }) {
  const store = useStudioApi();
  const [open, setOpen] = useState(false);

  const host = useMemo<CommandHost>(
    () => (onOpenShare ? { openShare: onOpenShare } : {}),
    [onOpenShare],
  );

  useCommandShortcuts(store, host);

  /* ⌘K, from anywhere — including the code editor, which is the point. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!shortcutMatches(PALETTE_SHORTCUT, event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen((current) => !current);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  // Mounted only while open. That is what makes the entrance play every time
  // (`entered` is false by construction rather than reset on every close path),
  // what stops the studio's store churn from re-rendering a closed palette, and
  // what guarantees a reopened palette starts on an empty query.
  return open ? <PaletteSurface store={store} host={host} onClose={close} /> : null;
}

const neverSubscribe = (): (() => void) => () => {};

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return /mac|iphone|ipad|ipod/i.test(data?.platform ?? navigator.platform ?? navigator.userAgent);
}

/**
 * Server snapshot: there is no `navigator` there, and React re-reads the client
 * value after hydration. `useState(isMacPlatform)` would freeze the server's
 * answer and show Ctrl to every Mac.
 */
const notMac = () => false;

function PaletteSurface({
  store,
  host,
  onClose,
}: {
  store: StudioStoreApi;
  host: CommandHost;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  /**
   * The highlight is held as a command id, not as an index. The list is rebuilt
   * whenever the store changes — a build finishing, a device reporting an event —
   * and an index would silently point at a different row, or reset under someone
   * mid-navigation. An id either still exists or falls back to the best match,
   * which is the right answer in both cases.
   */
  const [activeId, setActiveId] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const rowsRef = useRef<(HTMLElement | null)[]>([]);
  /** Set by keyboard navigation only, so hovering never scrolls the list. */
  const scrollTo = useRef<number | null>(null);

  const mac = useSyncExternalStore(neverSubscribe, isMacPlatform, notMac);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);

  const { flat, sections } = useMemo(() => {
    const rows = studioCommands(state, host).map((command) => ({
      command,
      availability: commandAvailability(command, state),
    }));
    return search(rows, query);
  }, [state, host, query]);

  const firstEnabled = useCallback(
    (from: number, step: number): number => {
      for (let index = from; index >= 0 && index < flat.length; index += step) {
        if (flat[index]?.availability === true) return index;
      }
      return -1;
    },
    [flat],
  );

  /**
   * Where the highlight actually is: the remembered command while it is still on
   * screen and still runnable, the best runnable match otherwise, and -1 when
   * nothing in the list can run.
   */
  const active = useMemo(() => {
    if (activeId !== null) {
      const index = flat.findIndex(
        (row) => row.command.id === activeId && row.availability === true,
      );
      if (index >= 0) return index;
    }
    return flat.findIndex((row) => row.availability === true);
  }, [flat, activeId]);

  /* Entrance: two frames, or the browser coalesces both values and nothing runs. */
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);

  /* Focus: taken on open, trapped while open, returned on close. */
  useEffect(() => {
    paletteOpen = true;
    const previous = document.activeElement;
    inputRef.current?.focus();

    const onFocusIn = (event: FocusEvent) => {
      const panel = panelRef.current;
      if (!panel || !(event.target instanceof Node) || panel.contains(event.target)) return;
      // Something outside took focus while we are modal — take it back.
      inputRef.current?.focus();
    };
    document.addEventListener('focusin', onFocusIn);

    return () => {
      paletteOpen = false;
      // Removed first: the guard must not fight the restoration below.
      document.removeEventListener('focusin', onFocusIn);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  /* Keeps the highlighted row in view when arrowing past the fold. */
  useEffect(() => {
    const index = scrollTo.current;
    if (index === null) return;
    scrollTo.current = null;
    rowsRef.current[index]?.scrollIntoView({ block: 'nearest' });
  });

  const execute = useCallback(
    (row: Row) => {
      if (row.availability !== true) return;
      onClose();
      // Next frame: the palette is gone and focus is back where it was before
      // the command runs, which matters for the two that open a window.prompt.
      // Nothing perceptible is delayed — the dismissal itself is immediate.
      requestAnimationFrame(() => runCommand(row.command, store));
    },
    [onClose, store],
  );

  /** Highlights `index`, and asks the effect above to scroll it into view. */
  const highlight = useCallback(
    (index: number) => {
      const row = index >= 0 ? flat[index] : undefined;
      if (!row) return;
      scrollTo.current = index;
      setActiveId(row.command.id);
    },
    [flat],
  );

  const move = useCallback(
    (delta: number) => {
      if (flat.length === 0) return;
      const from = active < 0 ? (delta > 0 ? 0 : flat.length - 1) : active + delta;
      let next = firstEnabled(from, delta);
      // Wrap once, so the last row leads back to the first.
      if (next === -1) next = firstEnabled(delta > 0 ? 0 : flat.length - 1, delta);
      highlight(next);
    },
    [active, firstEnabled, flat.length, highlight],
  );

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Mid-composition, Enter and the arrows belong to the input method, not to
    // the list — an IME user would otherwise run a command by accepting a word.
    if (event.nativeEvent.isComposing) return;

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        // The studio's own Escape handler would otherwise also clear the
        // inspector on the way past.
        event.stopPropagation();
        onClose();
        return;
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        return;
      case 'Home':
        event.preventDefault();
        highlight(firstEnabled(0, 1));
        return;
      case 'End':
        event.preventDefault();
        highlight(firstEnabled(flat.length - 1, -1));
        return;
      case 'Enter': {
        event.preventDefault();
        const row = active >= 0 ? flat[active] : undefined;
        if (row) execute(row);
        return;
      }
      case 'Tab':
        // The dialog holds exactly one focusable element, so the trap is simply
        // that Tab does not leave it.
        event.preventDefault();
        return;
      default:
    }
  };

  const activeRow = active >= 0 ? flat[active] : undefined;
  const activeOptionId = activeRow ? optionId(activeRow.command) : undefined;
  let rowIndex = -1;

  return (
    <div
      className={cn(
        'fixed inset-0 z-[130] flex items-start justify-center p-4 pt-[12vh]',
        'bg-paper-950/28 backdrop-blur-[2px]',
        'transition-opacity duration-[160ms] [transition-timing-function:var(--ease-out-quint)]',
        entered ? 'opacity-100' : 'opacity-0',
      )}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
        className={cn(
          'flex w-full max-w-[560px] flex-col overflow-hidden',
          'rounded-[var(--radius-panel)] border border-paper-200 bg-paper-0 shadow-float',
          // Opacity and a 6px lift: compositor only, nothing that can cost a layout.
          'transition-[opacity,translate] duration-[160ms] [transition-timing-function:var(--ease-out-quint)]',
          entered ? 'translate-y-0 opacity-100' : '-translate-y-1.5 opacity-0',
        )}
      >
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-paper-200 px-3">
          <Search size={14} strokeWidth={1.9} className="shrink-0 text-paper-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              // A new query means a new best match; forget where the highlight was.
              setActiveId(null);
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls="pl-command-list"
            aria-autocomplete="list"
            {...(activeOptionId ? { 'aria-activedescendant': activeOptionId } : {})}
            aria-label="Search commands"
            placeholder="Search commands…"
            autoComplete="off"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] text-paper-900 outline-none placeholder:text-paper-400"
          />
          <Kbd>Esc</Kbd>
        </div>

        <div
          id="pl-command-list"
          role="listbox"
          aria-label="Commands"
          className="pl-scroll max-h-[min(52vh,420px)] min-h-0 flex-1 overflow-y-auto pb-1.5"
        >
          {flat.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12.5px] text-paper-500">
              No command matches “{query}”.
            </p>
          ) : (
            // Keyed by position, not by group name: sorting is global and the
            // groups follow it, so one group can legitimately appear more than
            // once ("zoom" scores two Canvas commands either side of a Devices
            // one). `key={section.group}` collided the moment that happened, and
            // React reconciles duplicate keys by dropping rows.
            sections.map((section, position) => (
              <div key={`${section.group}-${position}`} role="group" aria-label={section.group}>
                <div aria-hidden="true">
                  <MenuLabel>{section.group}</MenuLabel>
                </div>
                {section.rows.map((row) => {
                  rowIndex += 1;
                  const index = rowIndex;
                  const enabled = row.availability === true;
                  const detail = enabled ? row.command.subtitle : row.availability;
                  return (
                    <div
                      key={row.command.id}
                      id={optionId(row.command)}
                      role="option"
                      aria-selected={index === active}
                      aria-disabled={!enabled}
                      ref={(node) => {
                        rowsRef.current[index] = node;
                      }}
                      onMouseEnter={() => {
                        // No scrollIntoView on this path: the pointer decides what
                        // is under it, and moving the list under a moving pointer
                        // is how a palette starts fighting you.
                        if (enabled && index !== active) setActiveId(row.command.id);
                      }}
                      onClick={() => execute(row)}
                      className={cn(
                        'flex items-start gap-3 px-2.5 py-[7px]',
                        'transition-colors duration-[120ms] [transition-timing-function:var(--ease-out-quint)]',
                        enabled ? 'cursor-pointer' : 'cursor-not-allowed',
                        index === active && enabled ? 'bg-azure-50' : null,
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div
                          className={cn(
                            'truncate text-[12.5px] leading-[1.35]',
                            // Colour only, never weight: a bold-on-highlight row
                            // re-measures its own text, so arrowing down a list
                            // would make every title twitch as it passed.
                            // Same treatment as an active `MenuItem`.
                            !enabled
                              ? 'text-paper-500'
                              : index === active
                                ? 'text-azure-700'
                                : 'text-paper-800',
                          )}
                        >
                          {row.command.title}
                        </div>
                        {detail ? (
                          <div
                            className={cn(
                              'truncate text-[11.5px] leading-[1.4]',
                              // The reason a command is unavailable is the
                              // information on that row, so it is not the thing
                              // that gets dimmed.
                              enabled ? 'text-paper-500' : 'text-paper-600',
                            )}
                          >
                            {detail}
                          </div>
                        ) : null}
                      </div>
                      {row.command.shortcut ? (
                        <span className="flex shrink-0 items-center gap-1 pt-[2px]">
                          {formatShortcut(row.command.shortcut, mac).map((cap) => (
                            <Kbd key={cap}>{cap}</Kbd>
                          ))}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex h-8 shrink-0 items-center gap-3 border-t border-paper-200 px-3 text-[11px] text-paper-500">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            to move
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd>
            to run
          </span>
          <span className="pl-tabular ml-auto">
            {flat.length} command{flat.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>
    </div>
  );
}

function optionId(command: Command): string {
  return `pl-command-${command.id}`;
}
