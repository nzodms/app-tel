'use client';

import { DiffEditor, Editor, loader } from '@monaco-editor/react';
import { AlertTriangle, Map as MapIcon, Save, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import { api, errorText } from '@/lib/api-client';
import { Badge, Button, EmptyState, IconButton } from '@/components/ui/primitives';
import { useStudio } from '../context';

/**
 * The code editor.
 *
 * Monaco, served from our own origin (`public/monaco`, copied out of node_modules
 * at build time) so there is no CDN dependency and the CSP stays tight.
 *
 * Two modes:
 *  - normal: the active tab, with unsaved-change tracking and ⌘S to save;
 *  - diff: when comparison is on and a changed file is selected, the same editor
 *    shows the two versions side by side.
 */

let configured = false;
function configureMonaco() {
  if (configured) return;
  configured = true;
  loader.config({ paths: { vs: '/monaco/vs' } });
}

const THEME = 'phonelab-dark';

interface MonacoLike {
  editor: {
    defineTheme: (name: string, theme: unknown) => void;
  };
}

function defineTheme(monaco: MonacoLike) {
  monaco.editor.defineTheme(THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6b7684', fontStyle: 'italic' },
      { token: 'keyword', foreground: '8fb3f0' },
      { token: 'string', foreground: '9ec9a2' },
      { token: 'number', foreground: 'e0b184' },
      { token: 'type', foreground: '82c8cf' },
      { token: 'delimiter', foreground: 'a5b0bd' },
      { token: 'tag', foreground: '8fb3f0' },
      { token: 'attribute.name', foreground: 'c9b78f' },
    ],
    colors: {
      'editor.background': '#13171c',
      'editor.foreground': '#d8dde5',
      'editorLineNumber.foreground': '#4a525d',
      'editorLineNumber.activeForeground': '#9aa5b3',
      'editor.selectionBackground': '#2a3a52',
      'editor.lineHighlightBackground': '#181d23',
      'editorGutter.background': '#13171c',
      'editorIndentGuide.background1': '#232a32',
      'editorWidget.background': '#1b2027',
      'editorCursor.foreground': '#4d93fb',
      'scrollbarSlider.background': '#2f353f88',
      'diffEditor.insertedTextBackground': '#1a9b5c22',
      'diffEditor.removedTextBackground': '#d13c3c22',
    },
  });
}

const EDITOR_OPTIONS = {
  fontSize: 12.5,
  lineHeight: 19,
  fontFamily:
    "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, 'Cascadia Mono', monospace",
  fontLigatures: false,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  cursorBlinking: 'smooth' as const,
  renderLineHighlight: 'line' as const,
  padding: { top: 10, bottom: 24 },
  tabSize: 2,
  automaticLayout: true,
  scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9, useShadows: false },
  overviewRulerBorder: false,
  guides: { indentation: true },
  bracketPairColorization: { enabled: false },
  wordWrap: 'off' as const,
  stickyScroll: { enabled: false },
};

export function CodePanel() {
  configureMonaco();

  const openFiles = useStudio((state) => state.openFiles);
  const activePath = useStudio((state) => state.activeFilePath);
  const setActiveFile = useStudio((state) => state.setActiveFile);
  const closeFile = useStudio((state) => state.closeFile);
  const editDraft = useStudio((state) => state.editDraft);
  const saveFile = useStudio((state) => state.saveFile);
  const saving = useStudio((state) => state.saving);
  const diagnostics = useStudio((state) => state.diagnostics);
  const compare = useStudio((state) => state.compare);
  const projectId = useStudio((state) => state.snapshot.project.id);

  const [minimap, setMinimap] = useState(false);
  // Keyed by the comparison it belongs to, so a stale result is simply ignored on
  // render rather than needing a synchronous reset inside the effect.
  const [diff, setDiff] = useState<{ key: string; before: string; after: string } | null>(null);
  const [diffError, setDiffError] = useState<{ key: string; message: string } | null>(null);

  const active = openFiles.find((file) => file.path === activePath) ?? null;
  const value = active ? (active.draft ?? active.content ?? '') : '';
  const dirty = Boolean(active?.draft !== null && active?.draft !== undefined);

  const fileDiagnostics = useMemo(
    () => diagnostics.filter((entry) => entry.file === activePath),
    [diagnostics, activePath],
  );

  const showDiff = compare.active && compare.path !== null;
  const diffKey = `${String(compare.baseRef)}→${String(compare.targetRef)}:${compare.path ?? ''}`;

  useEffect(() => {
    if (!showDiff || !compare.path) return;
    let cancelled = false;
    api<{ detail: { before: string | null; after: string | null } }>(
      `/api/projects/${projectId}/versions/compare?base=${encodeURIComponent(String(compare.baseRef))}&target=${encodeURIComponent(String(compare.targetRef))}&path=${encodeURIComponent(compare.path)}`,
    )
      .then((result) => {
        if (cancelled) return;
        setDiff({ key: diffKey, before: result.detail.before ?? '', after: result.detail.after ?? '' });
      })
      .catch((error: unknown) => {
        if (!cancelled) setDiffError({ key: diffKey, message: errorText(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [showDiff, diffKey, compare.path, compare.baseRef, compare.targetRef, projectId]);

  const currentDiff = diff?.key === diffKey ? diff : null;
  const currentDiffError = diffError?.key === diffKey ? diffError.message : null;

  const onSave = useCallback(() => {
    if (activePath) void saveFile(activePath);
  }, [activePath, saveFile]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        onSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onSave]);

  const language = languageFor(activePath ?? '');

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-code-100">
      <div className="flex h-9 shrink-0 items-stretch border-b border-slate-code-300 bg-slate-code-50">
        <div className="pl-scroll-dark flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {openFiles.length === 0 ? (
            <span className="flex items-center px-3 text-[11px] font-medium uppercase tracking-[0.055em] text-slate-code-dim">
              Code
            </span>
          ) : (
            openFiles.map((file) => (
              <button
                key={file.path}
                onClick={() => setActiveFile(file.path)}
                className={cn(
                  'group flex max-w-[220px] shrink-0 items-center gap-1.5 border-r border-slate-code-300 px-2.5 text-[12px] transition-colors',
                  file.path === activePath
                    ? 'bg-slate-code-100 text-slate-code-text'
                    : 'text-slate-code-dim hover:bg-slate-code-200',
                )}
                title={file.path}
              >
                <span className="truncate">{file.path.split('/').pop()}</span>
                {file.draft !== null ? (
                  <span className="size-[6px] shrink-0 rounded-full bg-azure-400" title="Unsaved changes" />
                ) : null}
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={`Close ${file.path}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeFile(file.path);
                  }}
                  className="grid size-4 shrink-0 place-items-center rounded opacity-0 transition-opacity hover:bg-slate-code-400 group-hover:opacity-100"
                >
                  <X size={10} strokeWidth={2.2} />
                </span>
              </button>
            ))
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1 border-l border-slate-code-300 px-1.5">
          <IconButton
            label={minimap ? 'Hide minimap' : 'Show minimap'}
            size="xs"
            onClick={() => setMinimap((current) => !current)}
            className={cn(
              'text-slate-code-dim hover:bg-slate-code-300',
              minimap && 'bg-slate-code-300 text-slate-code-text',
            )}
          >
            <MapIcon size={12.5} strokeWidth={1.8} />
          </IconButton>
          <Button
            size="xs"
            variant="ghost"
            onClick={onSave}
            disabled={!dirty || saving}
            className={cn(
              'text-slate-code-dim hover:bg-slate-code-300',
              dirty && 'text-azure-300',
            )}
          >
            <Save size={12} strokeWidth={1.9} />
            {saving ? 'Saving' : dirty ? 'Save' : 'Saved'}
          </Button>
        </div>
      </div>

      {showDiff ? (
        <div className="min-h-0 flex-1">
          <div className="flex items-center gap-2 border-b border-slate-code-300 px-2.5 py-1.5 text-[11px] text-slate-code-dim">
            <Badge tone="neutral" className="border-slate-code-400 bg-slate-code-200 text-slate-code-text">
              diff
            </Badge>
            <span className="truncate">{compare.path}</span>
          </div>
          {currentDiffError ? (
            <p className="p-4 text-[12px] text-danger-500">{currentDiffError}</p>
          ) : currentDiff ? (
            <DiffEditor
              height="100%"
              theme={THEME}
              original={currentDiff.before}
              modified={currentDiff.after}
              language={languageFor(compare.path ?? '')}
              beforeMount={(monaco) => defineTheme(monaco as unknown as MonacoLike)}
              options={{ ...EDITOR_OPTIONS, renderSideBySide: false, readOnly: true }}
            />
          ) : null}
        </div>
      ) : active ? (
        active.error ? (
          <div className="grid flex-1 place-items-center">
            <p className="max-w-[260px] text-center text-[12.5px] leading-relaxed text-danger-500">
              {active.error}
            </p>
          </div>
        ) : (
          <div className="relative min-h-0 flex-1">
            <Editor
              height="100%"
              theme={THEME}
              path={active.path}
              language={language}
              value={value}
              beforeMount={(monaco) => defineTheme(monaco as unknown as MonacoLike)}
              onChange={(next) => editDraft(active.path, next ?? '')}
              options={{ ...EDITOR_OPTIONS, minimap: { enabled: minimap } }}
            />
            {fileDiagnostics.length > 0 ? (
              <div className="absolute inset-x-0 bottom-0 max-h-[132px] overflow-auto border-t border-danger-500/40 bg-[#241416]">
                {fileDiagnostics.map((diagnostic, index) => (
                  <div
                    key={index}
                    className="flex items-start gap-2 px-2.5 py-1.5 font-mono text-[11px] leading-[1.5] text-[#f0a7a2]"
                  >
                    <AlertTriangle size={12} strokeWidth={1.9} className="mt-[2px] shrink-0" />
                    <span>
                      {diagnostic.line ? `${diagnostic.line}:${diagnostic.column ?? 0} ` : ''}
                      {diagnostic.message}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )
      ) : (
        <div className="grid flex-1 place-items-center">
          <EmptyState
            title="No file open"
            body="Pick a file in the Files tab, or click a component inside a phone with the inspector to jump straight to it."
            className="text-slate-code-dim"
          />
        </div>
      )}
    </div>
  );
}

function languageFor(path: string): string {
  if (path.endsWith('.tsx') || path.endsWith('.ts')) return 'typescript';
  if (path.endsWith('.jsx') || path.endsWith('.js') || path.endsWith('.mjs')) return 'javascript';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.html')) return 'html';
  if (path.endsWith('.md')) return 'markdown';
  return 'plaintext';
}
