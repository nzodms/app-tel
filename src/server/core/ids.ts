import { randomBytes, randomUUID } from 'node:crypto';

/** Prefixed, sortable-enough ids. The prefix makes logs and audit rows readable. */
export type IdPrefix =
  | 'usr'
  | 'ses'
  | 'wsp'
  | 'wsm'
  | 'prj'
  | 'fil'
  | 'ver'
  | 'vfl'
  | 'dev'
  | 'evt'
  | 'prv'
  | 'bld'
  | 'jny'
  | 'jst'
  | 'jrn'
  | 'shr'
  | 'thr'
  | 'cmt'
  | 'mcn'
  | 'aud'
  | 'oac'
  | 'ocd'
  | 'otk';

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

/** URL-safe high-entropy token (share links, session cookies, OAuth codes). */
export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function slugify(input: string, fallback = 'project'): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug.length > 0 ? slug : fallback;
}
