'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { api } from '@/lib/api-client';
import { Avatar } from '@/components/ui/primitives';
import { MenuItem, MenuLabel, Popover } from '@/components/ui/popover';

/**
 * The account menu.
 *
 * Carries "Revisit onboarding", which is the answer to onboarding being a
 * one-shot thing you can never see again: it clears the completion flag and sends
 * you back through the flow. Projects, files and versions are untouched.
 */
export function ProfileMenu({
  name,
  email,
  hue,
}: {
  name: string;
  email: string;
  hue: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const go = (path: string) => {
    router.push(path);
  };

  const signOut = async () => {
    setBusy(true);
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/login');
    router.refresh();
  };

  return (
    <Popover
      align="end"
      width={232}
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          data-testid="profile-menu-trigger"
          className="flex items-center gap-1.5 rounded-lg px-1 py-1 transition-colors hover:bg-paper-100"
          aria-label="Account menu"
        >
          <Avatar name={name} hue={hue} size={24} />
          <ChevronDown size={12} strokeWidth={2} className="text-paper-400" />
        </button>
      )}
    >
      {({ close }) => (
        <div>
          <div className="border-b border-paper-150 px-2.5 py-2">
            <div className="truncate text-[12.5px] font-semibold text-paper-900">{name}</div>
            <div className="truncate text-[11.5px] text-paper-500">{email}</div>
          </div>

          <MenuLabel>Account</MenuLabel>
          <MenuItem
            onClick={() => {
              close();
              go('/settings');
            }}
          >
            Settings
          </MenuItem>
          <MenuItem
            onClick={() => {
              close();
              go('/settings/connections');
            }}
          >
            Claude connections
          </MenuItem>
          <MenuItem
            onClick={() => {
              close();
              go('/settings/workspace');
            }}
          >
            Workspace
          </MenuItem>

          <MenuLabel>Help</MenuLabel>
          <MenuItem
            onClick={() => {
              close();
              go('/onboarding?again=1');
            }}
            hint="again"
          >
            Revisit onboarding
          </MenuItem>
          <MenuItem
            onClick={() => {
              close();
              go('/docs/mcp');
            }}
          >
            MCP docs
          </MenuItem>

          <div className="border-t border-paper-150">
            <MenuItem disabled={busy} onClick={() => void signOut()}>
              Sign out
            </MenuItem>
          </div>
        </div>
      )}
    </Popover>
  );
}
