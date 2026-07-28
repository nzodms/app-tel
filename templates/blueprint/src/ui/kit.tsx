import type { ReactNode } from 'react';

/** The small UI kit this project is built from. Edit freely. */

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
      <header className="bp-appbar">
        {onBack ? (
          <button className="bp-back" onClick={onBack} aria-label="Back" data-pl-id="back">
            <Icon name="chevron-left" />
          </button>
        ) : null}
        <div className="bp-appbar-title">
          {title}
          {subtitle ? <div className="bp-appbar-sub">{subtitle}</div> : null}
        </div>
        {actions}
      </header>
      <div className={tabbed ? 'bp-scroll bp-scroll--tabbed' : 'bp-scroll'}>{children}</div>
      {footer ? <div className="bp-footer">{footer}</div> : null}
    </>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="bp-section-title">{children}</div>;
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
  if (!onClick) return <div className="bp-card">{children}</div>;
  return (
    <button className="bp-card bp-card--tappable" onClick={onClick} data-pl-id={testId}>
      {children}
    </button>
  );
}

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
  return (
    <button
      className={variant === 'primary' ? 'bp-btn' : `bp-btn bp-btn--${variant}`}
      onClick={onClick}
      disabled={disabled}
      data-pl-id={testId}
    >
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
    <label className="bp-field">
      <span className="bp-field-label">{label}</span>
      <input
        className="bp-input"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        data-pl-id={testId}
        onInput={(event) => onChange((event.target as HTMLInputElement).value)}
      />
    </label>
  );
}

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'positive' | 'warning' | 'danger';
}) {
  return <span className={tone === 'neutral' ? 'bp-pill' : `bp-pill bp-pill--${tone}`}>{children}</span>;
}

export function Banner({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning' | 'danger';
  children: ReactNode;
}) {
  return (
    <div className={`bp-banner bp-banner--${tone}`} role="status">
      <Icon name="alert" size={16} />
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="bp-empty">
      <div className="bp-empty-icon">
        <Icon name="box" size={22} />
      </div>
      <div className="bp-empty-title">{title}</div>
      <div className="bp-empty-body">{body}</div>
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}

export function LoadingList({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ marginTop: 12 }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div className="bp-skeleton" key={index} />
      ))}
    </div>
  );
}

export function AvatarStack({
  people,
  max = 4,
}: {
  people: { id: string; name: string; initials: string }[];
  max?: number;
}) {
  const shown = people.slice(0, max);
  const overflow = people.length - shown.length;
  return (
    <div className="bp-avatars">
      {shown.map((person, index) => (
        <span
          className={index === 0 ? 'bp-avatar bp-avatar--accent' : 'bp-avatar'}
          key={person.id}
          title={person.name}
        >
          {person.initials}
        </span>
      ))}
      {overflow > 0 ? <span className="bp-avatar">+{overflow}</span> : null}
    </div>
  );
}

export interface TabItem {
  id: string;
  label: string;
  icon: string;
  badge?: number;
}

export function TabBar({
  items,
  active,
  onSelect,
}: {
  items: TabItem[];
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="bp-tabbar" aria-label="Main">
      {items.map((item) => (
        <button
          key={item.id}
          className="bp-tab"
          data-active={item.id === active ? 'true' : 'false'}
          data-pl-id={`tab-${item.id}`}
          onClick={() => onSelect(item.id)}
          aria-current={item.id === active ? 'page' : undefined}
        >
          <Icon name={item.icon} size={21} />
          <span>{item.label}</span>
          {item.badge ? <span className="bp-tab-badge">{item.badge}</span> : null}
        </button>
      ))}
    </nav>
  );
}

/** Stroke icons, drawn inline — previews have no npm install. */
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    'chevron-left': <path d="M15 5l-7 7 7 7" />,
    grid: (
      <>
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
      </>
    ),
    inbox: (
      <>
        <path d="M3.5 13.5V7a2.5 2.5 0 012.5-2.5h12A2.5 2.5 0 0120.5 7v6.5" />
        <path d="M3.5 13.5h4l1.5 3h6l1.5-3h4v3.5a2.5 2.5 0 01-2.5 2.5H6a2.5 2.5 0 01-2.5-2.5z" />
      </>
    ),
    list: <path d="M4 6.5h16M4 12h16M4 17.5h16" />,
    users: (
      <>
        <circle cx="9" cy="8.5" r="3.2" />
        <path d="M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
        <path d="M16 6.2a3.2 3.2 0 010 6M17.5 19.5c0-2.2-.9-3.7-2.2-4.6" />
      </>
    ),
    chart: <path d="M4 19.5V10M10 19.5V5M16 19.5v-6M21 19.5H3" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </>
    ),
    star: <path d="M12 4l2.3 4.9 5.2.7-3.8 3.7.9 5.3-4.6-2.5-4.6 2.5.9-5.3L4.5 9.6l5.2-.7z" />,
    alert: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 8v4.5M12 15.8v.2" />
      </>
    ),
    box: (
      <>
        <path d="M3.5 7.5l8.5-4 8.5 4v9l-8.5 4-8.5-4z" />
        <path d="M3.5 7.5l8.5 4 8.5-4M12 11.5v9" />
      </>
    ),
    check: <path d="M4.5 12.5l5 5 10-11" />,
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.box}
    </svg>
  );
}
