import fc from 'fast-check';
import {
  cryptoRandomSource,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
} from '../src';

const FORMAT = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/;

describe('recovery codes', () => {
  it('generates 10 unique codes of 16 Crockford characters (80 bits)', () => {
    const codes = generateRecoveryCodes(cryptoRandomSource);
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const c of codes) expect(c).toMatch(FORMAT);
  });

  it('maps every 10-byte input to a valid code (entropy is not truncated)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 10, maxLength: 10 }), (bytes) => {
        const [code] = generateRecoveryCodes({ bytes: () => Buffer.from(bytes) }, 1);
        expect(code).toMatch(FORMAT);
      }),
    );
  });

  it.each([
    ['abcd-efgh-jkmn-pqrs', 'ABCDEFGHJKMNPQRS'],
    [' ABCD EFGH JKMN PQRS ', 'ABCDEFGHJKMNPQRS'],
    ['OOOO-IIII-LLLL-0000', '0000111111110000'],
    ['ABCD-EFGH-JKMN-PQR', null],
    ['ABCD-EFGH-JKMN-PQRU', null],
    ['', null],
  ])('normalises %j to %j', (input, expected) => {
    expect(normalizeRecoveryCode(input)).toBe(expected);
  });

  it('hashes deterministically and never returns the code', () => {
    const h = hashRecoveryCode('ABCDEFGHJKMNPQRS');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hashRecoveryCode('ABCDEFGHJKMNPQRS'));
    expect(h).not.toContain('ABCDEFGHJKMNPQRS');
  });

  // Security review (task 05 fix round), finding 2 (MEDIUM): a `RandomSource` that silently
  // returns the wrong number of bytes must not produce a corrupted/low-entropy code (mirrors the
  // guard `tokens.ts` already has for the same class of bug, from the task 03 review).
  it('throws when the random source returns the wrong number of bytes', () => {
    expect(() => generateRecoveryCodes({ bytes: () => Buffer.alloc(9) }, 1)).toThrow(RangeError);
    expect(() => generateRecoveryCodes({ bytes: () => Buffer.alloc(11) }, 1)).toThrow(RangeError);
  });

  // Security review (task 05 fix round), finding 3 (MEDIUM): an unbounded `input` must be
  // rejected before the case-folding/replace passes run, so an unauthenticated recovery-code
  // route (Task 14/17) cannot be made to process arbitrarily large input on every request. A
  // plain `toBeNull()` on the result would also pass against the pre-fix code (a 65-character
  // string of the same letter still fails the final length check), so this spies on
  // `toUpperCase` to prove the length gate actually short-circuits before any string work, not
  // just that the end result happens to be `null` either way (security review, task 05 second
  // fix round, finding 1, LOW: the original version of this test didn't prove the ordering).
  it('rejects an oversized input before doing any string work', () => {
    const toUpperCase = jest.spyOn(String.prototype, 'toUpperCase');
    try {
      expect(normalizeRecoveryCode('A'.repeat(1_000_000))).toBeNull();
      expect(toUpperCase).not.toHaveBeenCalled();

      expect(normalizeRecoveryCode('abcd-efgh-jkmn-pqrs')).toBe('ABCDEFGHJKMNPQRS');
      expect(toUpperCase).toHaveBeenCalledTimes(1);
    } finally {
      toUpperCase.mockRestore();
    }
  });
});
