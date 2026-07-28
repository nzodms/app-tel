import type { ReactNode } from 'react';
import { Check } from './icons';

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  testId,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  testId?: string;
}) {
  const className = variant === 'primary' ? 'pf-btn' : `pf-btn pf-btn--${variant}`;
  return (
    <button className={className} onClick={onClick} disabled={disabled} data-pl-id={testId}>
      {children}
    </button>
  );
}

export function Field({
  label,
  value,
  placeholder,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (next: string) => void;
  testId?: string;
}) {
  return (
    <label className="pf-field">
      <span className="pf-field-label">{label}</span>
      <input
        className="pf-input"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        data-pl-id={testId}
        onInput={(event) => onChange((event.target as HTMLInputElement).value)}
      />
    </label>
  );
}

export function SelectableRow({
  title,
  subtitle,
  selected,
  onToggle,
  testId,
}: {
  title: string;
  subtitle?: string;
  selected: boolean;
  onToggle: () => void;
  testId?: string;
}) {
  return (
    <button className="pf-row" onClick={onToggle} data-pl-id={testId} aria-pressed={selected}>
      <div className="pf-row-main">
        <div className="pf-row-title">{title}</div>
        {subtitle ? <div className="pf-row-sub">{subtitle}</div> : null}
      </div>
      <span className="pf-check" data-on={selected ? 'true' : 'false'}>
        {selected ? <Check size={13} /> : null}
      </span>
    </button>
  );
}
