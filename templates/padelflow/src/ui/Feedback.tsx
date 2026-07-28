import type { ReactNode } from 'react';
import { Alert } from './icons';

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'positive' | 'warning' | 'danger';
}) {
  const className = tone === 'neutral' ? 'pf-pill' : `pf-pill pf-pill--${tone}`;
  return <span className={className}>{children}</span>;
}

export function Banner({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning' | 'danger';
  children: ReactNode;
}) {
  return (
    <div className={`pf-banner pf-banner--${tone}`} role="status">
      <Alert size={16} />
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="pf-empty">
      <div className="pf-empty-icon">{icon}</div>
      <div className="pf-empty-title">{title}</div>
      <div className="pf-empty-body">{body}</div>
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}

/** Shown only while a simulated request is genuinely in flight. */
export function LoadingList({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ marginTop: 12 }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div className="pf-skeleton" key={index} />
      ))}
    </div>
  );
}
