import type { ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: string;
  icon: ReactNode;
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
    <nav className="pf-tabbar" aria-label="Main">
      {items.map((item) => (
        <button
          key={item.id}
          className="pf-tab"
          data-active={item.id === active ? 'true' : 'false'}
          data-pl-id={`tab-${item.id}`}
          onClick={() => onSelect(item.id)}
          aria-current={item.id === active ? 'page' : undefined}
        >
          {item.icon}
          <span>{item.label}</span>
          {item.badge ? <span className="pf-tab-badge">{item.badge}</span> : null}
        </button>
      ))}
    </nav>
  );
}
