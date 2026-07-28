'use client';

import { useEffect, useState } from 'react';
import { GitCompare, History, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/cn';
import { api, errorText } from '@/lib/api-client';
import type { VersionComparison } from '@/server/services/versions';
import { Badge, Button, EmptyState, Input, PanelHeader } from '@/components/ui/primitives';
import { useStudio } from '../context';

/**
 * Version history, and the comparison entry point.
 *
 * Restoring is real — it rewrites the working tree from the snapshot — and it
 * always takes a safety snapshot first, which is why the button does not need a
 * scary confirmation dialog beyond a single prompt.
 */
export function VersionsPanel() {
  const versions = useStudio((state) => state.versions);
  const compare = useStudio((state) => state.compare);
  const setCompare = useStudio((state) => state.setCompare);
  const createSnapshot = useStudio((state) => state.createSnapshot);
  const restoreVersion = useStudio((state) => state.restoreVersion);
  const projectId = useStudio((state) => state.snapshot.project.id);

  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  // Results carry the key of the comparison that produced them, so a stale answer
  // is ignored at render time instead of being cleared inside the effect.
  const [comparison, setComparison] = useState<{ key: string; value: VersionComparison } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);

  const compareKey = `${String(compare.baseRef)}→${String(compare.targetRef)}@${versions.length}`;

  useEffect(() => {
    if (!compare.active) return;
    let cancelled = false;
    api<{ comparison: VersionComparison }>(
      `/api/projects/${projectId}/versions/compare?base=${encodeURIComponent(String(compare.baseRef))}&target=${encodeURIComponent(String(compare.targetRef))}`,
    )
      .then((result) => {
        if (!cancelled) setComparison({ key: compareKey, value: result.comparison });
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError({ key: compareKey, message: errorText(cause) });
      });
    return () => {
      cancelled = true;
    };
  }, [compare.active, compareKey, compare.baseRef, compare.targetRef, projectId]);

  const currentComparison = comparison?.key === compareKey ? comparison.value : null;
  const currentError = error?.key === compareKey ? error.message : null;

  const save = () => {
    const name = label.trim() || `V${versions.length + 1}`;
    void createSnapshot(name, description.trim());
    setLabel('');
    setDescription('');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Versions">
        <Badge tone="neutral">{versions.length}</Badge>
      </PanelHeader>

      <div className="space-y-1.5 border-b border-paper-200 p-2">
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder={`Name this snapshot (default V${versions.length + 1})`}
          className="h-7.5 text-[12.5px]"
        />
        <Input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="What changed?"
          className="h-7.5 text-[12.5px]"
        />
        <Button variant="primary" size="sm" className="w-full" onClick={save}>
          <History size={12.5} strokeWidth={1.9} />
          Snapshot the working tree
        </Button>
      </div>

      {compare.active ? (
        <div className="border-b border-paper-200 bg-azure-50/60 p-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-azure-700">
              Comparing
            </span>
            <Button size="xs" variant="ghost" onClick={() => setCompare({ active: false, path: null })}>
              Exit
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            <RefSelect
              value={String(compare.baseRef)}
              onChange={(value) => setCompare({ baseRef: value, path: null })}
              versions={versions}
            />
            <span className="text-[11px] text-paper-500">→</span>
            <RefSelect
              value={String(compare.targetRef)}
              onChange={(value) => setCompare({ targetRef: value, path: null })}
              versions={versions}
            />
          </div>
          <label className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-paper-600">
            <input
              type="checkbox"
              checked={compare.syncNavigation}
              onChange={(event) => setCompare({ syncNavigation: event.target.checked })}
              className="size-3"
            />
            Mirror navigation between the two phones
          </label>

          {currentError ? (
            <p className="mt-2 text-[11.5px] text-danger-700">{currentError}</p>
          ) : currentComparison ? (
            <div className="mt-2">
              <div className="mb-1 text-[11px] text-paper-600">
                {currentComparison.changes.length} file(s) changed · +
                {currentComparison.totals.additions} −{currentComparison.totals.deletions}
              </div>
              <div className="max-h-[180px] overflow-auto rounded-md border border-paper-200 bg-paper-0">
                {currentComparison.changes.length === 0 ? (
                  <p className="px-2 py-3 text-center text-[11.5px] text-paper-500">
                    These two are identical.
                  </p>
                ) : (
                  currentComparison.changes.map((change) => (
                    <button
                      key={change.path}
                      onClick={() => setCompare({ path: change.path })}
                      className={cn(
                        'flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11.5px] transition-colors',
                        compare.path === change.path ? 'bg-azure-50' : 'hover:bg-paper-50',
                      )}
                    >
                      <span
                        className={cn(
                          'w-[10px] shrink-0 font-mono',
                          change.status === 'added'
                            ? 'text-positive-700'
                            : change.status === 'removed'
                              ? 'text-danger-700'
                              : 'text-caution-700',
                        )}
                      >
                        {change.status === 'added' ? 'A' : change.status === 'removed' ? 'D' : 'M'}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-paper-700">{change.path}</span>
                      <span className="shrink-0 pl-tabular text-[10.5px] text-paper-500">
                        +{change.additions} −{change.deletions}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="pl-scroll min-h-0 flex-1 overflow-y-auto">
        {versions.length === 0 ? (
          <EmptyState
            title="No versions yet"
            body="Snapshot the project whenever you finish something. Snapshots are full copies, so restoring one is exact."
          />
        ) : (
          versions.map((version) => (
            <div key={version.id} className="border-b border-paper-100 px-2.5 py-2 hover:bg-paper-50">
              <div className="flex items-baseline gap-1.5">
                <span className="truncate text-[12.5px] font-semibold text-paper-800">
                  {version.label}
                </span>
                <span className="shrink-0 text-[10.5px] text-paper-400">#{version.sequence}</span>
                {version.authorKind === 'claude' ? (
                  <Badge tone="claude" className="shrink-0">
                    Claude
                  </Badge>
                ) : version.authorKind === 'system' ? (
                  <Badge tone="neutral" className="shrink-0">
                    auto
                  </Badge>
                ) : null}
              </div>
              {version.description ? (
                <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-paper-500">
                  {version.description}
                </p>
              ) : null}
              <div className="mt-1 flex items-center gap-2 text-[10.5px] text-paper-400">
                <span>{new Date(version.createdAt).toLocaleString()}</span>
                <span>· {version.fileCount} files</span>
                {version.changedPaths.length > 0 ? (
                  <span>· {version.changedPaths.length} changed</span>
                ) : null}
              </div>
              <div className="mt-1.5 flex gap-1">
                <Button
                  size="xs"
                  onClick={() =>
                    setCompare({
                      active: true,
                      baseRef: version.id,
                      targetRef: 'working',
                      path: null,
                    })
                  }
                >
                  <GitCompare size={11.5} strokeWidth={1.9} />
                  Compare
                </Button>
                <Button
                  size="xs"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Restore "${version.label}"?\n\nThe current working tree is snapshotted first, so this is undoable.`,
                      )
                    ) {
                      void restoreVersion(version.id);
                    }
                  }}
                >
                  <RotateCcw size={11.5} strokeWidth={1.9} />
                  Restore
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function RefSelect({
  value,
  onChange,
  versions,
}: {
  value: string;
  onChange: (value: string) => void;
  versions: { id: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-7 min-w-0 flex-1 rounded-md border border-paper-300 bg-paper-0 px-1.5 text-[11.5px] text-paper-700"
    >
      <option value="working">Working tree</option>
      {versions.map((version) => (
        <option key={version.id} value={version.id}>
          {version.label}
        </option>
      ))}
    </select>
  );
}
