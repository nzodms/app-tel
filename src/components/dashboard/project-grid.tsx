'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Loader2, MessageSquare, Plus, Smartphone } from 'lucide-react';
import { cn } from '@/lib/cn';
import { api, errorText } from '@/lib/api-client';
import type { ProjectListItem } from '@/server/services/projects';
import type { ProjectTemplate } from '@/server/templates';
import { Badge, Button, Card, EmptyState, Input } from '@/components/ui/primitives';

/**
 * Projects and templates.
 *
 * Creating a project is a real operation: it lays down the template's files, the
 * canvas devices it recommends, and an initial snapshot — then takes you straight
 * into the studio.
 */
export function ProjectGrid({
  projects,
  templates,
}: {
  projects: ProjectListItem[];
  templates: Pick<ProjectTemplate, 'id' | 'name' | 'tagline' | 'summary' | 'highlights'>[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = async (templateId: string) => {
    setCreating(templateId);
    setError(null);
    try {
      const result = await api<{ project: { id: string } }>('/api/projects', {
        body: {
          name: name.trim() || templates.find((entry) => entry.id === templateId)?.name || 'New project',
          templateId,
        },
      });
      router.push(`/studio/${result.project.id}`);
    } catch (cause) {
      setError(errorText(cause));
      setCreating(null);
    }
  };

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold tracking-[-0.014em] text-paper-900">
            Your projects
          </h2>
          <span className="text-[12px] text-paper-500">{projects.length}</span>
        </div>

        {projects.length === 0 ? (
          <Card className="py-2">
            <EmptyState
              icon={<Smartphone size={16} strokeWidth={1.8} />}
              title="No projects yet"
              body="Start from a template below. PadelFlow ships with two roles, two versions and a cross-device booking flow — the fastest way to see what PhoneLab does."
            />
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/studio/${project.id}`}
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
                  <Badge tone="neutral">{project.fileCount} files</Badge>
                  <Badge tone="neutral">{project.deviceCount} devices</Badge>
                  <Badge tone="neutral">{project.versionCount} versions</Badge>
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
        )}
      </section>

      <section>
        <h2 className="mb-1 text-[15px] font-semibold tracking-[-0.014em] text-paper-900">
          Start from a template
        </h2>
        <p className="mb-3 text-[12.5px] text-paper-500">
          Every template is a runnable project, not a mockup — real files you and Claude can edit.
        </p>

        <div className="mb-3 max-w-[340px]">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Project name (optional)"
          />
        </div>

        {error ? (
          <div className="mb-3 rounded-lg border border-danger-200 bg-danger-50 px-2.5 py-2 text-[12.5px] text-danger-700">
            {error}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          {templates.map((template) => (
            <Card key={template.id} className="flex flex-col p-3.5">
              <div className="text-[14px] font-semibold tracking-[-0.012em] text-paper-900">
                {template.name}
              </div>
              <div className="mt-0.5 text-[11.5px] font-medium text-azure-600">{template.tagline}</div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-paper-600">{template.summary}</p>
              <ul className="mt-2.5 space-y-1">
                {template.highlights.map((highlight) => (
                  <li key={highlight} className="flex items-start gap-1.5 text-[12px] text-paper-600">
                    <span className="mt-[6px] size-[4px] shrink-0 rounded-full bg-paper-300" />
                    {highlight}
                  </li>
                ))}
              </ul>
              <Button
                variant="primary"
                size="md"
                className={cn('mt-3.5 w-full', creating && 'pointer-events-none')}
                disabled={creating !== null}
                onClick={() => void create(template.id)}
              >
                {creating === template.id ? (
                  <>
                    <Loader2 size={13} strokeWidth={2} className="animate-spin" />
                    Creating project…
                  </>
                ) : (
                  <>
                    <Plus size={13} strokeWidth={2.2} />
                    Create {template.name}
                  </>
                )}
              </Button>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
