'use client';

import { createContext, useContext, type ReactNode } from 'react';
import Link from 'next/link';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/primitives';
import { MenuItem, MenuLabel, Popover } from '@/components/ui/popover';
import { cn } from '@/lib/cn';

/**
 * Switching projects without leaving the studio.
 *
 * The list is rendered server-side with the page, so opening the menu costs no
 * request. Each entry is a real link — a hard navigation, which is what we want:
 * a project switch replaces the whole preview and canvas state anyway.
 */
export interface SwitcherProject {
  id: string;
  name: string;
  workspaceName: string;
  isDemo: boolean;
  updatedAt: string;
}

const SwitcherContext = createContext<SwitcherProject[]>([]);

export function ProjectSwitcherProvider({
  projects,
  children,
}: {
  projects: SwitcherProject[];
  children: ReactNode;
}) {
  return <SwitcherContext.Provider value={projects}>{children}</SwitcherContext.Provider>;
}

export function ProjectSwitcher({
  currentId,
  currentName,
  archived,
}: {
  currentId: string;
  currentName: string;
  archived: boolean;
}) {
  const projects = useContext(SwitcherContext);
  const others = projects.filter((project) => project.id !== currentId);

  return (
    <Popover
      width={264}
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          data-testid="project-switcher"
          className={cn(
            'flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors',
            open ? 'bg-paper-100' : 'hover:bg-paper-100',
          )}
          title="Switch project"
        >
          <span className="truncate text-[13px] font-semibold tracking-[-0.012em] text-paper-900">
            {currentName}
          </span>
          {archived ? <Badge tone="neutral">archived</Badge> : null}
          <ChevronsUpDown size={12} strokeWidth={2} className="shrink-0 text-paper-400" />
        </button>
      )}
    >
      {({ close }) => (
        <div className="max-h-[380px] overflow-y-auto">
          <MenuLabel>Current</MenuLabel>
          <MenuItem active onClick={close}>
            <span className="flex items-center gap-1.5">
              <Check size={11} strokeWidth={2.4} />
              {currentName}
            </span>
          </MenuItem>

          {others.length > 0 ? (
            <>
              <MenuLabel>Switch to</MenuLabel>
              {others.map((project) => (
                <Link key={project.id} href={`/studio/${project.id}`} onClick={close}>
                  <MenuItem hint={project.isDemo ? 'demo' : undefined}>{project.name}</MenuItem>
                </Link>
              ))}
            </>
          ) : null}

          <div className="border-t border-paper-150">
            <Link href="/projects/new" onClick={close}>
              <MenuItem>
                <span className="flex items-center gap-1.5">
                  <Plus size={11} strokeWidth={2.4} />
                  New project
                </span>
              </MenuItem>
            </Link>
            <Link href="/dashboard" onClick={close}>
              <MenuItem>All projects</MenuItem>
            </Link>
          </div>
        </div>
      )}
    </Popover>
  );
}
