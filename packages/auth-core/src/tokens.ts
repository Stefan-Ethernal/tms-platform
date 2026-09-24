import { createHash, timingSafeEqual } from 'node:crypto';
import type { RandomSource } from './random';

/** Opaque bearer token (sessions, action tokens): `byteLength` random bytes, base64url, no padding. */
export function generateToken(random: RandomSource, byteLength = 32): string {
  if (byteLength < 16) throw new RangeError('tokens need at least 16 random bytes');
  const bytes = random.bytes(byteLength);
  if (bytes.length !== byteLength)
    throw new RangeError('random source returned the wrong number of bytes');
  return bytes.toString('base64url');
}

/** What the database stores instead of the token (tokens are high-entropy, so a plain hash suffices). */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * Constant-time string comparison for secrets (tokens, codes). Compares fixed-length digests
 * instead of the raw strings: `timingSafeEqual` itself throws on a length mismatch, which would
 * otherwise force a length-dependent branch (a timing oracle) and, hashed as UTF-8, a lone
 * surrogate would collapse to U+FFFD and falsely compare equal to another lone surrogate; hashing
 * as UTF-16 code units keeps the comparison lossless.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf16le').digest();
  const right = createHash('sha256').update(b, 'utf16le').digest();
  return timingSafeEqual(left, right);
}
