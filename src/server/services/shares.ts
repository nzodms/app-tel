import { z } from 'zod';
import { badRequest, forbidden, notFound, tooLarge } from '../core/errors';
import { LIMITS } from '../core/limits';
import { hashSecret, verifySecret } from '../core/crypto';
import { newId, newToken } from '../core/ids';
import type { Id, ProjectRow, ShareLinkRow, Store } from '../db';
import { RT, getBus, projectChannel } from '../realtime/bus';
import { getProject } from './projects';
import { latestVersion } from './versions';
import { logEvent } from './events';

/**
 * Share links.
 *
 * A link points at a *pinned version* by default: a reviewer must see the build
 * you asked them to look at, not whatever the working tree happens to contain.
 * The link never exposes project files — the reviewer surface gets the compiled
 * bundle and nothing else.
 */

export const shareInputSchema = z.object({
  label: z.string().trim().max(80).default(''),
  versionId: z.string().min(1).nullable().optional(),
  access: z.enum(['read', 'comment']).default('comment'),
  visibility: z.enum(['public', 'password', 'email']).default('public'),
  password: z.string().min(6).max(200).optional(),
  allowedEmails: z.array(z.string().trim().toLowerCase().email()).max(50).default([]),
  allowedRoles: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  allowVersionCompare: z.boolean().default(false),
  allowJourneys: z.boolean().default(true),
  expiresInDays: z.number().int().min(1).max(365).nullable().default(null),
});

export type ShareInput = z.infer<typeof shareInputSchema>;

/** Never send hashes or the allow-list to the reviewer surface. */
export type PublicShareLink = Omit<ShareLinkRow, 'passwordHash' | 'passwordSalt' | 'allowedEmails'> & {
  hasPassword: boolean;
  emailGated: boolean;
};

export function toPublicShare(link: ShareLinkRow): PublicShareLink {
  const { passwordHash, passwordSalt: _salt, allowedEmails, ...rest } = link;
  return {
    ...rest,
    hasPassword: passwordHash !== null,
    emailGated: allowedEmails.length > 0,
  };
}

export async function createShareLink(
  store: Store,
  projectId: Id,
  createdBy: Id,
  input: ShareInput,
): Promise<ShareLinkRow> {
  const parsed = shareInputSchema.parse(input);
  const project = await getProject(store, projectId);

  const existing = await store.count('shareLinks', { match: { projectId } });
  if (existing >= LIMITS.maxShareLinksPerProject) {
    throw tooLarge(
      `This project has ${existing} share links; the limit is ${LIMITS.maxShareLinksPerProject}. Revoke one first.`,
    );
  }

  if (parsed.visibility === 'password' && !parsed.password) {
    throw badRequest('A password-protected link needs a password of at least 6 characters.');
  }
  if (parsed.visibility === 'email' && parsed.allowedEmails.length === 0) {
    throw badRequest('An email-restricted link needs at least one allowed email address.');
  }

  let versionId = parsed.versionId ?? null;
  if (versionId) {
    const version = await store.find('projectVersions', { match: { id: versionId, projectId } });
    if (!version) throw badRequest('That version does not belong to this project.');
  } else {
    // Default to the newest snapshot rather than the live tree, so the reviewer
    // sees something stable.
    versionId = (await latestVersion(store, projectId))?.id ?? null;
  }

  const secret = parsed.password ? await hashSecret(parsed.password) : null;
  const now = new Date().toISOString();

  const link: ShareLinkRow = {
    id: newId('shr'),
    projectId,
    token: newToken(24),
    versionId,
    access: parsed.access,
    visibility: parsed.visibility,
    passwordHash: secret?.hash ?? null,
    passwordSalt: secret?.salt ?? null,
    allowedEmails: parsed.allowedEmails,
    allowedRoles: parsed.allowedRoles,
    allowVersionCompare: parsed.allowVersionCompare,
    allowJourneys: parsed.allowJourneys,
    label: parsed.label || `${project.name} review`,
    expiresAt: parsed.expiresInDays
      ? new Date(Date.now() + parsed.expiresInDays * 86_400_000).toISOString()
      : null,
    revokedAt: null,
    createdBy,
    createdAt: now,
    viewCount: 0,
    lastViewedAt: null,
  };

  await store.insert('shareLinks', link);
  getBus().publish(projectChannel(projectId), RT.shareChanged, { shareId: link.id, created: true });
  await logEvent(store, projectId, {
    kind: 'system',
    name: `Share link created: ${link.label}`,
    payload: { shareId: link.id, versionId, access: link.access, visibility: link.visibility },
  });
  return link;
}

export async function listShareLinks(store: Store, projectId: Id): Promise<ShareLinkRow[]> {
  return store.select('shareLinks', {
    match: { projectId },
    orderBy: [{ col: 'createdAt', dir: 'desc' }],
  });
}

export async function revokeShareLink(
  store: Store,
  projectId: Id,
  shareId: Id,
): Promise<ShareLinkRow> {
  const link = await store.find('shareLinks', { match: { id: shareId, projectId } });
  if (!link) throw notFound('Share link not found.');
  const updated = await store.update('shareLinks', shareId, {
    revokedAt: new Date().toISOString(),
  });
  getBus().publish(projectChannel(projectId), RT.shareChanged, { shareId, revoked: true });
  await logEvent(store, projectId, {
    kind: 'system',
    name: `Share link revoked: ${link.label}`,
    payload: { shareId },
  });
  return updated;
}

/* -------------------------------------------------------------------------- */
/* Reviewer access                                                             */
/* -------------------------------------------------------------------------- */

export type ShareGate =
  | { state: 'ok'; link: ShareLinkRow; project: ProjectRow }
  | { state: 'password-required'; link: PublicShareLink }
  | { state: 'email-required'; link: PublicShareLink };

export interface ShareCredentials {
  password?: string;
  email?: string;
}

/**
 * Resolves a token to a usable link, or to the gate that must be satisfied first.
 * Revoked and expired links are indistinguishable from unknown ones.
 */
export async function openShareLink(
  store: Store,
  token: string,
  credentials: ShareCredentials = {},
): Promise<ShareGate> {
  const link = await store.find('shareLinks', { match: { token } });
  if (!link) throw notFound('This link is not valid.');
  if (link.revokedAt) throw notFound('This link has been revoked.');
  if (link.expiresAt && new Date(link.expiresAt).getTime() <= Date.now()) {
    throw notFound('This link has expired.');
  }

  if (link.visibility === 'password') {
    if (!credentials.password) return { state: 'password-required', link: toPublicShare(link) };
    const ok =
      link.passwordHash !== null &&
      link.passwordSalt !== null &&
      (await verifySecret(credentials.password, link.passwordHash, link.passwordSalt));
    if (!ok) throw forbidden('That password is not correct.');
  }

  if (link.visibility === 'email') {
    const email = credentials.email?.trim().toLowerCase();
    if (!email) return { state: 'email-required', link: toPublicShare(link) };
    if (!link.allowedEmails.includes(email)) {
      throw forbidden('That email address is not on the invite list for this link.');
    }
  }

  const project = await getProject(store, link.projectId);
  return { state: 'ok', link, project };
}

export async function recordShareView(store: Store, link: ShareLinkRow): Promise<void> {
  await store.update('shareLinks', link.id, {
    viewCount: link.viewCount + 1,
    lastViewedAt: new Date().toISOString(),
  });
}

/** Roles a reviewer may switch between: the allow-list, or all project roles. */
export function reviewerRoles(link: ShareLinkRow, projectRoles: readonly string[]): string[] {
  if (link.allowedRoles.length === 0) return [...projectRoles];
  return link.allowedRoles.filter((role) => projectRoles.includes(role));
}
