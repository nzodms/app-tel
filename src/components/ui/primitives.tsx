import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * PhoneLab UI primitives.
 *
 * Hand-rolled rather than pulled from a component library: the studio needs dense,
 * quiet chrome that never competes with the phones, and that is easier to get right
 * with a small set of exact components than by overriding someone else's defaults.
 *
 * Conventions: hairline borders, 10px panel radius, one accent, hover states that
 * change surface rather than colour, and transitions capped at 160ms.
 */

/* ---------------------------------------------------------------- Button --- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type ButtonSize = 'xs' | 'sm' | 'md';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap ' +
  'transition-[background-color,border-color,color,box-shadow,transform] duration-[140ms] ' +
  '[transition-timing-function:var(--ease-out-quint)] disabled:opacity-45 ' +
  'disabled:pointer-events-none active:scale-[0.985] select-none';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-azure-500 text-white hover:bg-azure-600 shadow-[0_1px_2px_rgb(16_20_26/0.12)]',
  secondary:
    'bg-paper-100 text-paper-900 hover:bg-paper-150 border border-paper-200 ' +
    'shadow-[0_1px_1px_rgb(16_20_26/0.03)]',
  outline: 'bg-paper-0 text-paper-800 border border-paper-300 hover:bg-paper-50',
  ghost: 'text-paper-700 hover:bg-paper-100',
  danger: 'bg-danger-50 text-danger-700 border border-danger-200 hover:bg-danger-100',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  xs: 'h-6 px-2 text-[11.5px]',
  sm: 'h-7.5 px-2.5 text-[12.5px]',
  md: 'h-9 px-3.5 text-[13.5px]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = 'secondary',
  size = 'sm',
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      {...props}
    />
  );
}

/** Square icon button. `label` becomes the accessible name and the tooltip. */
export function IconButton({
  label,
  variant = 'ghost',
  size = 'sm',
  className,
  children,
  ...props
}: ButtonProps & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        BUTTON_BASE,
        BUTTON_VARIANTS[variant],
        size === 'xs' ? 'size-6' : size === 'sm' ? 'size-7.5' : 'size-9',
        'p-0',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ Input -- */

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-9 w-full rounded-lg border border-paper-300 bg-paper-0 px-2.5 text-[13.5px] text-paper-900',
        'placeholder:text-paper-400 transition-colors duration-[140ms]',
        'hover:border-paper-400 focus:border-azure-400 focus:outline-none focus:ring-2 focus:ring-azure-100',
        'disabled:bg-paper-50 disabled:text-paper-500',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-lg border border-paper-300 bg-paper-0 px-2.5 py-2 text-[13.5px] leading-[1.5] text-paper-900',
        'placeholder:text-paper-400 transition-colors duration-[140ms] resize-none',
        'hover:border-paper-400 focus:border-azure-400 focus:outline-none focus:ring-2 focus:ring-azure-100',
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-[12px] font-medium text-paper-700">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-[11.5px] text-danger-700">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[11.5px] text-paper-500">{hint}</span>
      ) : null}
    </label>
  );
}

/* ------------------------------------------------------------------- Card -- */

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-panel)] border border-paper-200 bg-paper-0 shadow-panel',
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ Badge -- */

type BadgeTone = 'neutral' | 'accent' | 'positive' | 'caution' | 'danger' | 'claude';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-paper-100 text-paper-600 border-paper-200',
  accent: 'bg-azure-50 text-azure-700 border-azure-100',
  positive: 'bg-positive-50 text-positive-700 border-positive-200',
  caution: 'bg-caution-50 text-caution-700 border-caution-200',
  danger: 'bg-danger-50 text-danger-700 border-danger-200',
  claude: 'bg-[#f7f2ec] text-[#8a5a2b] border-[#ecdfd0]',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-[1px] text-[11px] font-medium',
        BADGE_TONES[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

/** Small coloured dot, used for build status and connection state. */
export function StatusDot({
  tone,
  pulse,
  className,
}: {
  tone: 'positive' | 'caution' | 'danger' | 'neutral' | 'accent';
  pulse?: boolean;
  className?: string;
}) {
  const colors = {
    positive: 'bg-positive-500',
    caution: 'bg-caution-500',
    danger: 'bg-danger-500',
    neutral: 'bg-paper-400',
    accent: 'bg-azure-500',
  } as const;
  return (
    <span className={cn('relative inline-flex size-[7px]', className)}>
      <span className={cn('size-[7px] rounded-full', colors[tone])} />
      {pulse ? (
        <span
          className={cn(
            'absolute inset-0 animate-ping rounded-full opacity-60 [animation-duration:1.8s]',
            colors[tone],
          )}
        />
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------- Empty state - */

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mx-auto max-w-[280px] px-4 py-10 text-center', className)}>
      {icon ? (
        <div className="mx-auto mb-3 grid size-9 place-items-center rounded-lg bg-paper-100 text-paper-500">
          {icon}
        </div>
      ) : null}
      <div className="text-[13px] font-semibold text-paper-800">{title}</div>
      {body ? <p className="mt-1 text-[12.5px] leading-relaxed text-paper-500">{body}</p> : null}
      {action ? <div className="mt-3.5 flex justify-center">{action}</div> : null}
    </div>
  );
}

/* ----------------------------------------------------------------- Layout -- */

export function PanelHeader({
  title,
  children,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex h-9 shrink-0 items-center justify-between gap-2 border-b border-paper-200 px-2.5',
        className,
      )}
    >
      <div className="truncate text-[11px] font-semibold uppercase tracking-[0.055em] text-paper-500">
        {title}
      </div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}

export function Separator({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-paper-200', className)} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-paper-300 bg-paper-50 px-1 py-[1px] font-mono text-[10px] text-paper-600">
      {children}
    </kbd>
  );
}

/** Avatar derived from a name + hue, so identities are recognisable without images. */
export function Avatar({
  name,
  hue,
  size = 26,
  className,
}: {
  name: string;
  hue: number;
  size?: number;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-full font-semibold',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: `hsl(${hue} 52% 92%)`,
        color: `hsl(${hue} 45% 32%)`,
      }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
