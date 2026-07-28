import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;

/**
 * Password / share-link-secret hashing.
 *
 * scrypt from node:crypto — no native dependency, memory-hard, and the cost
 * parameters are node's defaults (N=16384, r=8, p=1), which is appropriate for
 * interactive logins.
 */
export async function hashSecret(secret: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(secret, salt, KEY_LENGTH);
  return { hash: derived.toString('hex'), salt };
}

export async function verifySecret(
  secret: string,
  hash: string,
  salt: string,
): Promise<boolean> {
  const derived = await scrypt(secret, salt, KEY_LENGTH);
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

/** For opaque bearer tokens we only need a fast, non-reversible lookup key. */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function sha256Base64Url(input: string): string {
  return createHash('sha256').update(input).digest('base64url');
}

/** Short content hash used to detect whether a preview bundle actually changed. */
export function contentHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
