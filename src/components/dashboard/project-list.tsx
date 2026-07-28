'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2, MessageSquare, Plus, Search, Smartphone } from 'lucide-react';
import { api, errorText } from '@/lib/api-client';
import { Badge, Button, Card, EmptyState, Input } from '@/components/ui/primitives';
import type { ProjectListItem } from '@/server/services/projects';

/**
 * The dashboard's project list.
 *
 * Your own projects come first; anything created from the demo template is kept in
 * its own section below, because having opened the demo is not the same as having
 * built something.
 */
export function ProjectList({
  projects,
  lastOpenedId,
}: {
  projects: ProjectListItem[];
  lastOpenedId: string | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [creatingDemo, setCreatingDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { own, demos, archivedCount } = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = projects.filter((project) => {
      if (!showArchived && project.status === 'archived') return false;
      if (!needle) return true;
      return (
        project.name.toLowerCase().includes(needle) ||
        project.description.toLowerCase().includes(needle) ||
        project.workspaceName.toLowerCase().includes(needle)
      );
    });
    return {
      own: matching.filter((project) => !project.isDemo),
      demos: matching.filter((project) => project.isDemo),
      archivedCount: projects.filter((project) => project.status === 'archived').length,
    };
  }, [projects, query, showArchived]);

  const createDemo = async () => {
    setCreatingDemo(true);
    setError(null);
    try {
      const result = await api<{ project: { id: string } }>('/api/projects/demo', { body: {} });
      router.push(`/studio/${result.project.id}`);
    } catch (cause) {
      setError(errorText(cause));
      setCreatingDemo(false);
    }
  };

  const lastOpened = projects.find((project) => project.id === lastOpenedId) ?? null;

  return (
    <div className="space-y-8">
      {lastOpened ? (
        <section>
          <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.05em] text-paper-500">
            Continue
          </h2>
          <Link
            href={`/studio/${lastOpened.id}`}
            data-testid="continue-project"
            className="group flex items-center gap-3 rounded-[var(--radius-panel)] border border-paper-200 bg-paper-0 p-3.5 shadow-panel transition-[border-color,box-shadow] duration-150 hover:border-paper-300 hover:shadow-float"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-paper-100 text-paper-500">
              <Smartphone size={16} strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold text-paper-900">
                {lastOpened.name}
              </span>
              <span className="block truncate text-[12px] text-paper-500">
                {lastOpened.deviceCount} device{lastOpened.deviceCount === 1 ? '' : 's'} ·{' '}
                {lastOpened.versionCount} version{lastOpened.versionCount === 1 ? '' : 's'} ·
                updated {new Date(lastOpened.updatedAt).toLocaleDateString()}
              </span>
            </span>
            <ArrowRight
              size={15}
              strokeWidth={1.9}
              className="shrink-0 text-paper-300 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-paper-500"
            />
          </Link>
        </section>
      ) : null}

      <section>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-semibold tracking-[-0.014em] text-paper-900">
            Your projects
          </h2>
          <span className="text-[12px] text-paper-500">{own.length}</span>
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Search
                size={13}
                strokeWidth={2}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-paper-400"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter"
                className="h-8 w-[160px] pl-7 text-[12.5px]"
                aria-label="Filter projects"
              />
            </div>
            {archivedCount > 0 ? (
              <Button size="sm" onClick={() => setShowArchived((current) => !current)}>
                {showArchived ? 'Hide archived' : `Archived (${archivedCount})`}
              </Button>
            ) : null}
            <Link href="/projects/new">
              <Button size="sm" variant="primary" data-testid="new-project">
                <Plus size={13} strokeWidth={2.2} />
                New project
              </Button>
            </Link>
          </div>
        </div>

        {error ? (
          <div className="mb-3 rounded-lg border border-danger-200 bg-danger-50 px-2.5 py-2 text-[12.5px] text-danger-700">
            {error}
          </div>
        ) : null}

        {own.length === 0 ? (
          <Card className="py-2">
            <EmptyState
              icon={<Smartphone size={16} strokeWidth={1.8} />}
              title={query ? 'Nothing matches' : 'No projects yet'}
              body={
                query
                  ? 'No project matches that filter. Clear it to see everything.'
                  : 'Describe what you are building and PhoneLab generates a working two-sided app, or start from the PadelFlow demo to see how it all fits together.'
              }
              action={
                query ? (
                  <Button size="sm" onClick={() => setQuery('')}>
                    Clear filter
                  </Button>
                ) : (
                  <div className="flex flex-wrap justify-center gap-2">
                    <Link href="/projects/new">
                      <Button size="sm" variant="primary">
                        <Plus size={13} strokeWidth={2.2} />
                        New project
                      </Button>
                    </Link>
                    <Button size="sm" onClick={() => void createDemo()} disabled={creatingDemo}>
                      {creatingDemo ? (
                        <Loader2 size={13} strokeWidth={2} className="animate-spin" />
                      ) : null}
                      {creatingDemo ? 'Creating…' : 'Open the PadelFlow demo'}
                    </Button>
                  </div>
                )
              }
            />
          </Card>
        ) : (
          <ProjectCards projects={own} />
        )}
      </section>

      <section>
        <div className="mb-2 flex items-baseline gap-2">
          <h2 className="text-[15px] font-semibold tracking-[-0.014em] text-paper-900">Demo</h2>
          <span className="text-[12px] text-paper-500">
            A reference project you can break freely.
          </span>
        </div>

        {demos.length === 0 ? (
          <Card className="flex flex-wrap items-center gap-3 p-3.5">
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold text-paper-900">PadelFlow</div>
              <p className="mt-1 max-w-[560px] text-[12.5px] leading-relaxed text-paper-600">
                A player app and a club app that talk to each other: pick a court, invite three
                players, pay — and the club phone gets a notification it can accept. Ships with V1
                and V2 to compare and a recorded journey to replay.
              </p>
            </div>
            <Button size="md" onClick={() => void createDemo()} disabled={creatingDemo}>
              {creatingDemo ? (
                <Loader2 size={13} strokeWidth={2} className="animate-spin" />
              ) : (
                <Plus size={13} strokeWidth={2.2} />
              )}
              {creatingDemo ? 'Creating…' : 'Create the demo'}
            </Button>
          </Card>
        ) : (
          <ProjectCards projects={demos} />
        )}
      </section>
    </div>
  );
}

function ProjectCards({ projects }: { projects: ProjectListItem[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {projects.map((project) => (
        <Link
          key={project.id}
          href={`/studio/${project.id}`}
          data-testid={`project-card-${project.id}`}
          className="group block rounded-[var(--radius-panel)] border border-paper-200 bg-paper-0 p-3.5 shadow-panel transition-[box-shadow,transform,border-color] duration-150 [transition-timing-function:var(--ease-out-quint)] hover:-translate-y-[1px] hover:border-paper-300 hover:shadow-float"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold tracking-[-0.012em] text-paper-900">
                {project.name}
              </div>
              <div className="mt-0.5 truncate text-[11.5px] text-paper-500">
                {project.workspaceName}
              </div>
            </div>
            <ArrowRight
              size={15}
              strokeWidth={1.9}
              className="mt-0.5 shrink-0 text-paper-300 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-paper-500"
            />
          </div>

          <p className="mt-2 line-clamp-2 text-[12.5px] leading-relaxed text-paper-600">
            {project.description}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">
              {project.fileCount} file{project.fileCount === 1 ? '' : 's'}
            </Badge>
            <Badge tone="neutral">
              {project.deviceCount} device{project.deviceCount === 1 ? '' : 's'}
            </Badge>
            <Badge tone="neutral">
              {project.versionCount} version{project.versionCount === 1 ? '' : 's'}
            </Badge>
            {project.openCommentCount > 0 ? (
              <Badge tone="caution">
                <MessageSquare size={9.5} strokeWidth={2.2} />
                {project.openCommentCount}
              </Badge>
            ) : null}
            {project.status === 'archived' ? <Badge tone="neutral">archived</Badge> : null}
          </div>

          <div className="mt-2.5 text-[11px] text-paper-400">
            Updated {new Date(project.updatedAt).toLocaleString()}
          </div>
        </Link>
      ))}
    </div>
  );
}
