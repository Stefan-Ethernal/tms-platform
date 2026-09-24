import { createHash } from 'node:crypto';
import type { RandomSource } from './random';

export const RECOVERY_CODE_COUNT = 10;
const CODE_BYTES = 10;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const NORMALISED = /^[0-9A-HJKMNP-TV-Z]{16}$/;
// The longest input worth folding: 16 code characters plus 3 separators (dash or space) is 19;
// this leaves generous room for a pasted code with extra surrounding whitespace without letting
// an unbounded string reach the case-fold/replace passes below (security review, task 05 fix
// round, finding 3, MEDIUM).
const MAX_INPUT_LENGTH = 64;

function encode(bytes: Buffer): string {
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < 16; i += 1) out += CROCKFORD[parseInt(bits.slice(i * 5, i * 5 + 5), 2)];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12)}`;
}

/** 10 single-use codes, 80 random bits each, shown once (section 8). */
export function generateRecoveryCodes(random: RandomSource, count = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    const bytes = random.bytes(CODE_BYTES);
    // A `RandomSource` that silently returns the wrong number of bytes must not produce a
    // corrupted or low-entropy code (mirrors the guard `generateToken` already has in
    // `tokens.ts`; security review, task 05 fix round, finding 2, MEDIUM).
    if (bytes.length !== CODE_BYTES)
      throw new RangeError('random source returned the wrong number of bytes');
    codes.add(encode(bytes));
  }
  return [...codes];
}

/** Accepts lower case, spaces and dashes; Crockford aliases I/L → 1 and O → 0. */
export function normalizeRecoveryCode(input: string): string | null {
  if (input.length > MAX_INPUT_LENGTH) return null;
  const normalised = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  return NORMALISED.test(normalised) ? normalised : null;
}

/** Codes carry 80 bits and are rate-limited and single-use, so a domain-separated sha256 suffices. */
export function hashRecoveryCode(normalized: string): string {
  return createHash('sha256').update(`tms-recovery:${normalized}`, 'utf8').digest('hex');
}
