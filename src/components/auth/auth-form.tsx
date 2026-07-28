'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { api, errorText } from '@/lib/api-client';
import { Button, Field, Input } from '@/components/ui/primitives';

/**
 * Sign in / sign up.
 *
 * One component for both modes: the fields differ by one, and keeping them
 * together means the error handling and redirect behaviour cannot diverge.
 */
export function AuthForm({ mode, next }: { mode: 'login' | 'signup'; next: string }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signup') {
        await api('/api/auth/signup', { body: { name, email, password } });
      } else {
        await api('/api/auth/login', { body: { email, password } });
      }
      // Server components need to re-read the session cookie.
      router.replace(next);
      router.refresh();
    } catch (cause) {
      setError(errorText(cause));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3.5">
      {mode === 'signup' ? (
        <Field label="Your name">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            required
            placeholder="Enzo Daumas"
          />
        </Field>
      ) : null}

      <Field label="Email">
        <Input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          required
          placeholder="you@example.com"
        />
      </Field>

      <Field
        label="Password"
        hint={mode === 'signup' ? 'At least 10 characters.' : undefined}
      >
        <Input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          required
          minLength={mode === 'signup' ? 10 : undefined}
        />
      </Field>

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-danger-200 bg-danger-50 px-2.5 py-2 text-[12.5px] leading-relaxed text-danger-700"
        >
          {error}
        </div>
      ) : null}

      <Button type="submit" variant="primary" size="md" className="w-full" disabled={busy}>
        {busy ? 'Working…' : mode === 'signup' ? 'Create account' : 'Sign in'}
      </Button>

      <p className="pt-1 text-center text-[12.5px] text-paper-500">
        {mode === 'signup' ? (
          <>
            Already have an account?{' '}
            <Link
              href={`/login?next=${encodeURIComponent(next)}`}
              className="font-medium text-azure-600 hover:underline"
            >
              Sign in
            </Link>
          </>
        ) : (
          <>
            New to PhoneLab?{' '}
            <Link
              href={`/signup?next=${encodeURIComponent(next)}`}
              className="font-medium text-azure-600 hover:underline"
            >
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
