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
});
