'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/primitives';

export function SignOutButton({ children }: { children?: ReactNode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
        router.replace('/login');
        router.refresh();
      }}
    >
      {children}
      Sign out
    </Button>
  );
}
