'use client';

import { useState } from 'react';
import { FileWarning, RotateCcw, ScrollText, Sparkle, Undo2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useStudio, useStudioApi } from '../context';
import type { BundleState } from '../types';

/**
 * What a phone shows when its build fails.
 *
 * The old version dropped a flat dark sheet over the whole phone with a stack of
 * raw compiler text and no way out, which read as "your app is gone". It is not:
 * only the newest edit is broken, and the last bundle that compiled is still in
 * `bundle.lastGoodCode`. So the previous app stays visible behind this card and
 * every button here does something real.
 *
 * Nothing is invented. The step, the file and the message all come from the
 * diagnostic that was actually produced; when there is no diagnostic — a request
 * that never reached the compiler — it says exactly that instead of inventing a
 * compile error.
 */
export function BuildErrorCard({ deviceId, bundle }: { deviceId: string; bundle: BundleState }) {
  const store = useStudioApi();
  const setLeftTab = useStudio((state) => state.setLeftTab);
  const openFile = useStudio((state) => state.openFile);
  const versions = useStudio((state) => state.versions);
  const restoreVersion = useStudio((state) => state.restoreVersion);
  // Whether this phone actually has an app on screen right now. The card must not
  // claim "still running the last version" over a blank boot placeholder.
  const mounted = useStudio((state) => state.chrome[deviceId]?.mounted ?? false);
  const [busy, setBusy] = useState<'retry' | 'restore' | null>(null);

  const primary = bundle.diagnostics.find((entry) => entry.severity === 'error') ?? null;
  const transport = primary?.source === 'transport';

  // Where it broke, in the terms of the thing that actually failed.
  const step = transport
    ? 'Reaching the build service'
    : primary?.source === 'runtime'
      ? 'Running the app'
      : 'Compiling';

  const file = primary?.file ?? null;
  const message = (primary?.message ?? bundle.error ?? 'The build did not complete.').trim();
  const shortMessage = message.length > 220 ? `${message.slice(0, 217)}…` : message;

  // Newest by sequence, not by position: the array order is not guaranteed and
  // offering to restore the oldest snapshot would be worse than offering nothing.
  const restorable =
    versions.length > 0 ? [...versions].sort((a, b) => b.sequence - a.sequence)[0]! : null;

  const retry = async () => {
    setBusy('retry');
    try {
      await store.getState().ensureBundle(bundle.ref, true);
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    if (!restorable) return;
    setBusy('restore');
    try {
      await restoreVersion(restorable.id);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="absolute inset-0 z-[55] flex items-end p-3"
      data-testid={`build-error-${deviceId}`}
      // A scrim, not a blackout: the last working app stays legible underneath so
      // it is obvious the project is intact.
      style={{
        background:
          'linear-gradient(to bottom, rgb(16 20 26 / 0.10) 0%, rgb(16 20 26 / 0.42) 55%, rgb(16 20 26 / 0.62) 100%)',
      }}
    >
      <div className="w-full overflow-hidden rounded-[13px] border border-danger-200 bg-paper-0 shadow-float">
        <div className="flex items-start gap-2 border-b border-paper-150 px-3 py-2.5">
          <span className="mt-[1px] grid size-5 shrink-0 place-items-center rounded-md bg-danger-50 text-danger-600">
            <FileWarning size={12} strokeWidth={2.2} />
          </span>
          <div className="min-w-0">
            <div className="text-[12.5px] font-semibold leading-tight text-paper-900">
              {step} failed
            </div>
            {file ? (
              <div className="mt-0.5 truncate font-mono text-[10.5px] text-paper-500">
                {file}
                {primary?.line ? `:${primary.line}` : ''}
              </div>
            ) : (
              <div className="mt-0.5 text-[10.5px] text-paper-500">
                {transport ? 'No compiler output — the request itself failed.' : 'No file reported.'}
              </div>
            )}
          </div>
        </div>

        <p className="max-h-[92px] overflow-auto px-3 py-2 font-mono text-[10.5px] leading-[1.55] text-paper-700">
          {shortMessage}
        </p>

        {mounted && bundle.code ? (
          <p className="px-3 pb-2 text-[10.5px] leading-snug text-paper-500">
            {bundle.recoveredFrom
              ? `Still running ${bundle.recoveredFrom} — the last version that compiled.`
              : 'Still running the last version that compiled. Your project is intact.'}
          </p>
        ) : restorable ? (
          <p className="px-3 pb-2 text-[10.5px] leading-snug text-paper-500">
            Nothing is running yet. {restorable.label} is the last version that compiled.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-1 border-t border-paper-150 bg-paper-50 px-2 py-1.5">
          <CardButton
            icon={<ScrollText size={11} strokeWidth={2} />}
            onClick={() => {
              setLeftTab('logs');
              if (file) void openFile(file);
            }}
          >
            View logs
          </CardButton>
          <CardButton
            icon={<RotateCcw size={11} strokeWidth={2} />}
            onClick={() => void retry()}
            disabled={busy !== null}
          >
            {busy === 'retry' ? 'Retrying…' : 'Retry'}
          </CardButton>
          {restorable ? (
            <CardButton
              icon={<Undo2 size={11} strokeWidth={2} />}
              onClick={() => void restore()}
              disabled={busy !== null}
            >
              {busy === 'restore' ? 'Restoring…' : `Restore ${restorable.label}`}
            </CardButton>
          ) : null}
          <CardButton
            icon={<Sparkle size={11} strokeWidth={2} />}
            onClick={() => setLeftTab('claude')}
          >
            Fix with Claude
          </CardButton>
        </div>
      </div>
    </div>
  );
}

function CardButton({
  icon,
  children,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-paper-200 bg-paper-0 px-1.5 py-[3px]',
        'text-[10.5px] font-medium text-paper-700 transition-colors',
        'hover:border-paper-300 hover:bg-paper-100 hover:text-paper-900',
        'disabled:pointer-events-none disabled:opacity-50',
      )}
    >
      {icon}
      {children}
    </button>
  );
}
