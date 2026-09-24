import { createHash, timingSafeEqual } from 'node:crypto';
import type { RandomSource } from './random';

/** Opaque bearer token (sessions, action tokens): `byteLength` random bytes, base64url, no padding. */
export function generateToken(random: RandomSource, byteLength = 32): string {
  if (byteLength < 16) throw new RangeError('tokens need at least 16 random bytes');
  return random.bytes(byteLength).toString('base64url');
}

/** What the database stores instead of the token (tokens are high-entropy, so a plain hash suffices). */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}
