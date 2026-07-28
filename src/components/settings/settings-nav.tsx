'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

const ITEMS = [
  { href: '/settings', label: 'Account' },
  { href: '/settings/connections', label: 'Claude connections' },
  { href: '/settings/workspace', label: 'Workspace' },
];

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 sm:flex-col" aria-label="Settings">
      {ITEMS.map((item) => {
        const current = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
              current
                ? 'bg-paper-0 text-paper-900 shadow-[0_1px_2px_rgb(16_20_26/0.05)] ring-1 ring-paper-200'
                : 'text-paper-600 hover:bg-paper-100 hover:text-paper-900',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
