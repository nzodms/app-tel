'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Minimal popover: click to open, click outside or Escape to close, focus returns
 * to the trigger. Enough for toolbar menus without pulling in a UI library, and
 * small enough to audit.
 */
export function Popover({
  trigger,
  children,
  align = 'start',
  width = 260,
  className,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (props: { close: () => void }) => ReactNode;
  align?: 'start' | 'end' | 'center';
  width?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const toggle = useCallback(() => setOpen((current) => !current), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const container = containerRef.current;
      const active = document.activeElement;
      const wasInside = active instanceof HTMLElement && container?.contains(active);
      // The panel is always the container's last element child while open, so
      // anything focusable that is not inside it is the caller's trigger.
      const panel = container?.lastElementChild ?? null;
      const trigger =
        container?.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? null;
      setOpen(false);
      // The docstring promised focus restoration but nothing implemented it: on
      // Escape the focused menu item unmounted and focus fell back to <body>,
      // stranding keyboard users at the top of the document. Only restore when
      // focus was actually inside the popover — an Escape pressed while focus is
      // elsewhere must not yank it back to the trigger.
      if (wasInside && trigger && !panel?.contains(trigger)) trigger.focus();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      {trigger({ open, toggle })}
      {open ? (
        <PopoverPanel align={align} width={width} className={className}>
          {children({ close: () => setOpen(false) })}
        </PopoverPanel>
      ) : null}
    </div>
  );
}

/**
 * The floating surface.
 *
 * Split out from `Popover` for one reason: it must play its entrance every time it
 * appears, and the cheapest way to guarantee that is to let it mount fresh — its
 * `entered` state is then false by construction instead of needing to be reset on
 * every close path.
 *
 * The panel used to appear fully formed on the same frame as the click, which reads
 * as a glitch rather than as a surface arriving: nothing connects the trigger to the
 * thing it opened.
 *
 * Deliberately a two-state CSS *transition* and not a keyframe animation:
 * globals.css collapses `transition-duration` under prefers-reduced-motion and under
 * [data-reduce-motion="true"], so this inherits that for free instead of needing its
 * own escape hatch. Nothing is animated from JS — React flips one class and the
 * compositor does the rest.
 *
 * There is deliberately no exit: the panel unmounts the instant `open` goes false,
 * so dismissal stays immediate. A menu you have to wait to leave feels slow, and a
 * fade-out would also delay whatever you clicked next.
 */
function PopoverPanel({
  align,
  width,
  className,
  children,
}: {
  align: 'start' | 'end' | 'center';
  width: number;
  className?: string;
  children: ReactNode;
}) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    // Two frames. One is not reliably enough: if the class flip lands in the same
    // frame the panel first paints in, the browser coalesces both values and the
    // transition never runs at all. The extra frame is spent inside the entrance,
    // not before it.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);

  return (
    <div
      role="dialog"
      className={cn(
        'absolute top-[calc(100%+6px)] z-50 overflow-hidden rounded-[var(--radius-panel)] border border-paper-200 bg-paper-0 shadow-float',
        // opacity + translate only, so this stays on the compositor and cannot cost
        // a layout. 4px of travel in the direction the panel opens: enough to read as
        // "it came from the trigger", not enough to look like it flew in.
        'transition-[opacity,translate] duration-[160ms] [transition-timing-function:var(--ease-out-quint)]',
        entered ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0',
        align === 'end' && 'right-0',
        align === 'start' && 'left-0',
        // Composes with the y translate above: Tailwind v4 keeps the two axes in
        // separate custom properties, so centring does not cancel the entrance.
        align === 'center' && 'left-1/2 -translate-x-1/2',
        className,
      )}
      style={{ width }}
    >
      {children}
    </div>
  );
}

export function MenuItem({
  children,
  onClick,
  disabled,
  active,
  hint,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2 px-2.5 py-[7px] text-left text-[12.5px]',
        // Fixed line box: row height used to come from the inherited line-height, so
        // a menu holding both plain text and richer children came out unevenly
        // spaced. py-[7px] holds the previous ~31px row while making it constant.
        'leading-[1.35]',
        // Tailwind v4's preflight leaves <button> on the default cursor.
        'cursor-pointer',
        'transition-[background-color,color] duration-[120ms] ' +
          '[transition-timing-function:var(--ease-out-quint)]',
        // The panel is overflow-hidden, so the global focus ring (outline-offset:1px)
        // was clipped flush against both edges of a full-width row and read as two
        // stray horizontal lines. Drawing it inset keeps it whole.
        'focus-visible:-outline-offset-2',
        active
          ? // A selected row had no hover response at all, so pointing at the item you
            // are already on felt dead. It now still lifts a step, and presses further.
            'bg-azure-50 text-azure-700 hover:bg-azure-100 active:bg-azure-100'
          : // Darkening the label as well as the surface is what separates "hovered"
            // from "slightly different background"; :active adds the third step so a
            // press is acknowledged before the menu closes.
            'text-paper-700 hover:bg-paper-100 hover:text-paper-900 active:bg-paper-150',
        disabled &&
          'cursor-not-allowed opacity-45 hover:bg-transparent hover:text-paper-700 active:bg-transparent',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {/* paper-400 on white is 2.4:1 — these hints carry real information (viewport
          sizes, step counts, shortcut notes) and were effectively unreadable.
          paper-500 matches every other secondary label in the system. Tabular figures
          stop stacked numeric hints going ragged down the right edge. */}
      {hint ? <span className="pl-tabular shrink-0 text-[11px] text-paper-500">{hint}</span> : null}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    // Was a filled paper-50 bar with a rule under it: two pieces of chrome for a
    // four-letter section label, which made the dividers louder than the items they
    // divide. The group is now separated by space alone — 10px above, 4px below, so
    // the label binds to the rows it introduces instead of floating between groups.
    <div className="select-none px-2.5 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-paper-500">
      {children}
    </div>
  );
}
