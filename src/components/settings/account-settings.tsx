'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Monitor, Moon, RotateCcw, Sun } from 'lucide-react';
import { api, errorText } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { Badge, Button, Card, Field, Input } from '@/components/ui/primitives';
import { applyTheme, resolveTheme } from '@/components/studio/theme';
import type { UserPreferences } from '@/lib/preferences';

/** "System" is a real third option, not a dressed-up default: it follows the OS. */
const THEME_CHOICES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const satisfies readonly { value: UserPreferences['theme']; label: string; icon: unknown }[];

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

  const chooseTheme = (theme: UserPreferences['theme']) => {
    setPrefs((current) => ({ ...current, theme }));
    // Applied immediately rather than on the round trip: the page you are
    // looking at is the preview of this setting, and waiting on the network to
    // see it makes the control feel broken.
    applyTheme(resolveTheme(theme));
    void save({ preferences: { theme } });
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

        <div className="mt-3 border-t border-paper-150 pt-3">
          <div className="text-[12.5px] font-medium text-paper-800">Appearance</div>
          <p className="mt-0.5 text-[11.5px] leading-snug text-paper-500">
            The studio only. A device on the canvas keeps its own light or dark
            setting, so what you are testing never changes with the room around it.
          </p>
          <div
            role="radiogroup"
            aria-label="Appearance"
            className="mt-2 inline-flex rounded-lg border border-paper-200 bg-paper-100 p-0.5"
          >
            {THEME_CHOICES.map((choice) => {
              const active = prefs.theme === choice.value;
              return (
                <button
                  key={choice.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => chooseTheme(choice.value)}
                  className={cn(
                    'flex cursor-pointer items-center gap-1.5 rounded-[7px] px-2.5 py-1 text-[12px] font-medium transition-colors duration-150 [transition-timing-function:var(--ease-out-quint)]',
                    active
                      ? 'bg-paper-0 text-paper-900 shadow-[0_1px_2px_rgb(16_20_26/0.06)]'
                      : 'text-paper-600 hover:text-paper-900',
                  )}
                >
                  <choice.icon size={12.5} strokeWidth={1.9} />
                  {choice.label}
                </button>
              );
            })}
          </div>
        </div>
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
