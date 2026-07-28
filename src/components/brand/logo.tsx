import { cn } from '@/lib/cn';

/**
 * PhoneLab mark.
 *
 * A phone outline whose screen is split into a narrow code column and a wider
 * canvas — the product's layout, at 20px. Drawn as vectors: no bitmap assets, and
 * no resemblance to any vendor's branding.
 */
export function Logo({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={cn('shrink-0', className)}
      aria-hidden="true"
    >
      <rect
        x="4.75"
        y="2.75"
        width="14.5"
        height="18.5"
        rx="4"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M10 2.75h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="7.25" y="6.75" width="3" height="10.5" rx="1" fill="currentColor" opacity="0.85" />
      <rect x="11.75" y="6.75" width="5" height="6" rx="1" fill="currentColor" opacity="0.32" />
      <rect x="11.75" y="14" width="5" height="3.25" rx="1" fill="currentColor" opacity="0.32" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <Logo size={20} className="text-paper-900" />
      <span className="text-[14.5px] font-semibold tracking-[-0.014em] text-paper-900">
        PhoneLab
      </span>
    </span>
  );
}
