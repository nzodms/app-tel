'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, RotateCcw } from 'lucide-react';
import { api, errorText } from '@/lib/api-client';
import { Badge, Button, Card, Field, Input } from '@/components/ui/primitives';
import type { UserPreferences } from '@/lib/preferences';

/**
 * Account settings.
 *
 * Preferences are stored on the account, not in the browser, so the studio can
 * render at your pane width on the first paint instead of jumping to it.
 */
export function AccountSettings({
  name,
  email,
  preferences,
}: {
  name: string;
  email: string;
  preferences: UserPreferences;
}) {
  const router = useRouter();
  const [draftName, setDraftName] = useState(name);
  const [prefs, setPrefs] = useState(preferences);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const save = async (patch: { name?: string; preferences?: Partial<UserPreferences> }) => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/me', { method: 'PATCH', body: patch });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      router.refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (key: keyof UserPreferences, value: boolean) => {
    setPrefs((current) => ({ ...current, [key]: value }));
    void save({ preferences: { [key]: value } });
  };

  const revisitOnboarding = async () => {
    setResetting(true);
    setError(null);
    try {
      await api('/api/onboarding', { body: { action: 'reset' } });
      router.push('/onboarding');
    } catch (cause) {
      setError(errorText(cause));
      setResetting(false);
    }
  };

  return (
    <div className="space-y-5">
      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-[12.5px] text-danger-700"
        >
          {error}
        </div>
      ) : null}

      <Card className="p-4">
        <h2 className="text-[14px] font-semibold tracking-[-0.012em] text-paper-900">Account</h2>
        <div className="mt-3 space-y-4">
          <Field label="Name">
            <div className="flex gap-2">
              <Input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                maxLength={80}
                data-testid="settings-name"
              />
              <Button
                onClick={() => void save({ name: draftName.trim() })}
                disabled={busy || draftName.trim().length === 0 || draftName === name}
                size="md"
              >
                {busy ? <Loader2 size={13} className="animate-spin" strokeWidth={2} /> : null}
                Save
              </Button>
            </div>
          </Field>

          <Field label="Email" hint="Changing your email address is not built yet.">
            <Input value={email} readOnly disabled />
          </Field>

          {saved ? (
            <div className="flex items-center gap-1.5 text-[12px] text-positive-700">
              <Check size={12} strokeWidth={2.4} />
              Saved
            </div>
          ) : null}
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="text-[14px] font-semibold tracking-[-0.012em] text-paper-900">Studio</h2>
        <p className="mt-1 text-[12.5px] text-paper-500">
          These follow your account between machines.
        </p>
        <div className="mt-3 divide-y divide-paper-150">
          <Toggle
            label="Snap phones to a grid"
            hint="Dragging a phone snaps to 20px and to the edges of its neighbours."
            checked={prefs.canvasSnap}
            onChange={(value) => toggle('canvasSnap', value)}
          />
          <Toggle
            label="Show the canvas grid"
            hint="A faint dot grid behind the phones."
            checked={prefs.canvasGrid}
            onChange={(value) => toggle('canvasGrid', value)}
          />
          <Toggle
            label="Editor minimap"
            hint="The code overview strip down the right of the editor."
            checked={prefs.editorMinimap}
            onChange={(value) => toggle('editorMinimap', value)}
          />
          <Toggle
            label="Reduce motion"
            hint="Cuts canvas and panel transitions. Your system setting is honoured either way."
            checked={prefs.reduceMotion}
            onChange={(value) => toggle('reduceMotion', value)}
          />
        </div>
        <p className="mt-3 text-[11.5px] text-paper-400">
          Dark mode is not built yet — PhoneLab is light-only for now.
        </p>
      </Card>

      <Card className="p-4">
        <h2 className="text-[14px] font-semibold tracking-[-0.012em] text-paper-900">Onboarding</h2>
        <p className="mt-1 max-w-[520px] text-[12.5px] leading-relaxed text-paper-600">
          Run through the introduction again. Your projects, files, versions and devices are not
          touched — this only reopens the walkthrough.
        </p>
        <Button className="mt-3" size="md" onClick={() => void revisitOnboarding()} disabled={resetting}>
          {resetting ? (
            <Loader2 size={13} className="animate-spin" strokeWidth={2} />
          ) : (
            <RotateCcw size={13} strokeWidth={2} />
          )}
          Revisit onboarding
        </Button>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-2">
          <h2 className="text-[14px] font-semibold tracking-[-0.012em] text-paper-900">
            Danger zone
          </h2>
          <Badge tone="neutral">not built</Badge>
        </div>
        <p className="mt-1 max-w-[520px] text-[12.5px] leading-relaxed text-paper-600">
          Deleting an account and exporting your data are not implemented. Rather than show buttons
          that do nothing, they are listed here as missing.
        </p>
      </Card>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-[3px] size-3.5 shrink-0 accent-[var(--color-azure-500)]"
      />
      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium text-paper-800">{label}</span>
        <span className="block text-[11.5px] leading-relaxed text-paper-500">{hint}</span>
      </span>
    </label>
  );
}
