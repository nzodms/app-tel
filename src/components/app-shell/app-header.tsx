import Link from 'next/link';
import { Wordmark } from '@/components/brand/logo';
import { ProfileMenu } from '@/components/app-shell/profile-menu';
import { cn } from '@/lib/cn';
import type { PublicUser } from '@/server/services/auth';

/**
 * The header every page outside the studio shares.
 *
 * The studio has its own, denser chrome — this one is for the dashboard, project
 * creation and settings, where the point is knowing where you are and getting
 * somewhere else quickly.
 */
export function AppHeader({
  user,
  active,
  maxWidth = 1180,
}: {
  user: PublicUser;
  active?: 'dashboard' | 'settings';
  maxWidth?: number;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-paper-200 bg-paper-0/92 backdrop-blur">
      <div
        className="mx-auto flex h-13 items-center gap-3 px-5"
        style={{ maxWidth }}
      >
        <Link href="/dashboard" className="shrink-0" aria-label="PhoneLab">
          <Wordmark />
        </Link>

        <nav className="ml-2 flex items-center gap-0.5" aria-label="Main">
          <HeaderLink href="/dashboard" current={active === 'dashboard'}>
            Projects
          </HeaderLink>
          <HeaderLink href="/settings" current={active === 'settings'}>
            Settings
          </HeaderLink>
          <HeaderLink href="/docs/mcp">MCP docs</HeaderLink>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-[12.5px] font-medium text-paper-700 sm:inline">
            {user.name}
          </span>
          <ProfileMenu name={user.name} email={user.email} hue={user.avatarHue} />
        </div>
      </div>
    </header>
  );
}

function HeaderLink({
  href,
  current,
  children,
}: {
  href: string;
  current?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'rounded-md px-2 py-1 text-[12.5px] font-medium transition-colors',
        current ? 'bg-paper-100 text-paper-900' : 'text-paper-600 hover:bg-paper-100 hover:text-paper-900',
      )}
    >
      {children}
    </Link>
  );
}
