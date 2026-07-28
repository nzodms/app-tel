'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
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

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
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
      {trigger({ open, toggle: () => setOpen((current) => !current) })}
      {open ? (
        <div
          role="dialog"
          className={cn(
            'absolute top-[calc(100%+6px)] z-50 overflow-hidden rounded-[var(--radius-panel)] border border-paper-200 bg-paper-0 shadow-float',
            align === 'end' && 'right-0',
            align === 'start' && 'left-0',
            align === 'center' && 'left-1/2 -translate-x-1/2',
            className,
          )}
          style={{ width }}
        >
          {children({ close: () => setOpen(false) })}
        </div>
      ) : null}
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
        'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] transition-colors',
        active ? 'bg-azure-50 text-azure-700' : 'text-paper-700 hover:bg-paper-100',
        disabled && 'cursor-not-allowed opacity-45 hover:bg-transparent',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span className="shrink-0 text-[11px] text-paper-400">{hint}</span> : null}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="border-b border-paper-150 bg-paper-50 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-paper-500">
      {children}
    </div>
  );
}
