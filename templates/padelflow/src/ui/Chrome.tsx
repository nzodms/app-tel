import type { ReactNode } from 'react';
import { ChevronLeft } from './icons';

/** Screen shell: app bar + scroll area + optional sticky footer. */
export function Screen({
  title,
  subtitle,
  onBack,
  actions,
  footer,
  tabbed,
  children,
}: {
  title: string;
  subtitle?: string | null;
  onBack?: (() => void) | null;
  actions?: ReactNode;
  footer?: ReactNode;
  tabbed?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <header className="pf-appbar">
        {onBack ? (
          <button className="pf-back" onClick={onBack} aria-label="Back" data-pl-id="back">
            <ChevronLeft size={20} />
          </button>
        ) : null}
        <div className="pf-appbar-title">
          {title}
          {subtitle ? <div className="pf-appbar-sub">{subtitle}</div> : null}
        </div>
        {actions}
      </header>
      <div className={tabbed ? 'pf-scroll pf-scroll--tabbed' : 'pf-scroll'}>{children}</div>
      {footer ? <div className="pf-footer">{footer}</div> : null}
    </>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="pf-section-title">{children}</div>;
}

export function Card({
  children,
  onClick,
  testId,
}: {
  children: ReactNode;
  onClick?: () => void;
  testId?: string;
}) {
  if (!onClick) return <div className="pf-card">{children}</div>;
  return (
    <button className="pf-card pf-card--tappable" onClick={onClick} data-pl-id={testId}>
      {children}
    </button>
  );
}
