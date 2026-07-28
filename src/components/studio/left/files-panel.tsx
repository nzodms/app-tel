'use client';

import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FilePlus2,
  Pencil,
  Search,
  Trash2,
} from 'lucide-react';
import type { TreeNode } from '@/server/services/files';
import { cn } from '@/lib/cn';
import { Badge, IconButton, Input, PanelHeader } from '@/components/ui/primitives';
import { useStudio } from '../context';

/**
 * The file tree.
 *
 * Files Claude touched are marked, because when an agent is editing your project
 * the first question is always "what changed?". Recently edited files get a quiet
 * dot; Claude's edits get a labelled marker that survives until you open the file.
 */

export function FilesPanel() {
  const tree = useStudio((state) => state.tree);
  const files = useStudio((state) => state.files);
  const activePath = useStudio((state) => state.activeFilePath);
  const openFile = useStudio((state) => state.openFile);
  const createFile = useStudio((state) => state.createFile);
  const renameFile = useStudio((state) => state.renameFile);
  const deleteFile = useStudio((state) => state.deleteFile);
  const entryFile = useStudio((state) => state.snapshot.project.entryFile);

  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Marked until someone else edits the file — deliberately not time-based, so the
  // marker is stable and does not depend on when the component happened to render.
  const claudeEdited = useMemo(
    () => new Set(files.filter((file) => file.lastEditedBy === 'claude').map((file) => file.path)),
    [files],
  );

  const filtered = useMemo(() => {
    if (query.trim() === '') return null;
    const needle = query.trim().toLowerCase();
    return files.filter((file) => file.path.toLowerCase().includes(needle)).slice(0, 80);
  }, [files, query]);

  const toggle = (path: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const promptCreate = () => {
    const path = window.prompt('New file path', 'src/components/NewScreen.tsx');
    if (path) void createFile(path, '');
  };

  const promptRename = (from: string) => {
    const to = window.prompt('Move or rename to', from);
    if (to && to !== from) void renameFile(from, to);
  };

  const confirmDelete = (path: string) => {
    if (window.confirm(`Delete ${path}?\n\nThis is recoverable — any version snapshot can restore it.`)) {
      void deleteFile(path);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Files">
        <Badge tone="neutral">{files.length}</Badge>
        <IconButton label="New file" onClick={promptCreate}>
          <FilePlus2 size={14} strokeWidth={1.7} />
        </IconButton>
      </PanelHeader>

      <div className="border-b border-paper-200 p-2">
        <div className="relative">
          <Search
            size={13}
            strokeWidth={1.8}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-paper-400"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a file"
            className="h-7.5 pl-7 text-[12.5px]"
          />
        </div>
      </div>

      <div className="pl-scroll min-h-0 flex-1 overflow-y-auto py-1">
        {filtered ? (
          filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12px] text-paper-500">
              No file matches “{query}”.
            </p>
          ) : (
            filtered.map((file) => (
              <FileRow
                key={file.path}
                name={file.path}
                path={file.path}
                depth={0}
                active={activePath === file.path}
                claudeEdited={claudeEdited.has(file.path)}
                isEntry={file.path === entryFile}
                onOpen={() => void openFile(file.path)}
                onRename={() => promptRename(file.path)}
                onDelete={() => confirmDelete(file.path)}
              />
            ))
          )
        ) : (
          <TreeLevel
            nodes={tree}
            depth={0}
            collapsed={collapsed}
            toggle={toggle}
            activePath={activePath}
            claudeEdited={claudeEdited}
            entryFile={entryFile}
            onOpen={(path) => void openFile(path)}
            onRename={promptRename}
            onDelete={confirmDelete}
          />
        )}
      </div>
    </div>
  );
}

function TreeLevel({
  nodes,
  depth,
  collapsed,
  toggle,
  activePath,
  claudeEdited,
  entryFile,
  onOpen,
  onRename,
  onDelete,
}: {
  nodes: TreeNode[];
  depth: number;
  collapsed: Set<string>;
  toggle: (path: string) => void;
  activePath: string | null;
  claudeEdited: Set<string>;
  entryFile: string;
  onOpen: (path: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === 'directory' ? (
          <div key={node.path}>
            <button
              onClick={() => toggle(node.path)}
              className="group flex h-6.5 w-full items-center gap-1 pr-2 text-left transition-colors hover:bg-paper-100"
              style={{ paddingLeft: 8 + depth * 12 }}
            >
              {collapsed.has(node.path) ? (
                <ChevronRight size={13} strokeWidth={1.9} className="shrink-0 text-paper-400" />
              ) : (
                <ChevronDown size={13} strokeWidth={1.9} className="shrink-0 text-paper-400" />
              )}
              <span className="truncate text-[12.5px] font-medium text-paper-700">{node.name}</span>
              {node.children && claudeEdited.size > 0 &&
              node.children.some((child) => claudeEdited.has(child.path)) ? (
                <span className="ml-1 size-[5px] shrink-0 rounded-full bg-[#c08a4a]" />
              ) : null}
            </button>
            {collapsed.has(node.path) ? null : (
              <TreeLevel
                nodes={node.children ?? []}
                depth={depth + 1}
                collapsed={collapsed}
                toggle={toggle}
                activePath={activePath}
                claudeEdited={claudeEdited}
                entryFile={entryFile}
                onOpen={onOpen}
                onRename={onRename}
                onDelete={onDelete}
              />
            )}
          </div>
        ) : (
          <FileRow
            key={node.path}
            name={node.name}
            path={node.path}
            depth={depth}
            active={activePath === node.path}
            claudeEdited={claudeEdited.has(node.path)}
            isEntry={node.path === entryFile}
            onOpen={() => onOpen(node.path)}
            onRename={() => onRename(node.path)}
            onDelete={() => onDelete(node.path)}
          />
        ),
      )}
    </>
  );
}

function FileRow({
  name,
  path,
  depth,
  active,
  claudeEdited,
  isEntry,
  onOpen,
  onRename,
  onDelete,
}: {
  name: string;
  path: string;
  depth: number;
  active: boolean;
  claudeEdited: boolean;
  isEntry: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        'group flex h-6.5 items-center gap-1 pr-1.5 transition-colors',
        active ? 'bg-azure-50' : 'hover:bg-paper-100',
      )}
      style={{ paddingLeft: 8 + depth * 12 + 14 }}
    >
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-1.5 text-left" title={path}>
        <span
          className={cn(
            'truncate text-[12.5px]',
            active ? 'font-semibold text-azure-700' : 'text-paper-700',
          )}
        >
          {name}
        </span>
        {isEntry ? (
          <span className="shrink-0 rounded border border-paper-200 px-1 text-[9.5px] font-medium uppercase tracking-wide text-paper-500">
            entry
          </span>
        ) : null}
        {claudeEdited ? (
          <span
            className="shrink-0 rounded border border-[#ecdfd0] bg-[#f7f2ec] px-1 text-[9.5px] font-semibold text-[#8a5a2b]"
            title="Edited by Claude"
          >
            claude
          </span>
        ) : null}
      </button>
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <IconButton label={`Rename ${name}`} size="xs" onClick={onRename}>
          <Pencil size={11.5} strokeWidth={1.8} />
        </IconButton>
        <IconButton label={`Delete ${name}`} size="xs" onClick={onDelete}>
          <Trash2 size={11.5} strokeWidth={1.8} />
        </IconButton>
      </span>
    </div>
  );
}
