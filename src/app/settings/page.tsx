import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AccountSettings } from '@/components/settings/account-settings';
import { readSessionUser } from '@/server/http/session';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function AccountSettingsPage() {
  const user = await readSessionUser();
  if (!user) redirect('/login?next=%2Fsettings');

  return (
    <AccountSettings name={user.name} email={user.email} preferences={user.preferences} />
  );
}
