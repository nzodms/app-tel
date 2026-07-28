import { headers } from 'next/headers';
import { stripTrailingSlash } from '../oauth/urls';

/**
 * The origin PhoneLab is being served from.
 *
 * `PHONELAB_BASE_URL` wins when set — behind a proxy the forwarded headers are the
 * only other signal, and OAuth metadata has to be exact.
 */
export async function requestOrigin(): Promise<string> {
  const configured = process.env.PHONELAB_BASE_URL?.trim();
  if (configured) return stripTrailingSlash(configured);

  const headerList = await headers();
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host') ?? 'localhost:3000';
  const proto =
    headerList.get('x-forwarded-proto') ??
    (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  return stripTrailingSlash(`${proto}://${host}`);
}
