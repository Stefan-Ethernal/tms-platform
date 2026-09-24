import fc from 'fast-check';
import { cryptoRandomSource, generateToken, hashToken, type RandomSource, safeEqual } from '../src';

describe('tokens', () => {
  it('generates 32 random bytes as 43 base64url characters', () => {
    const token = generateToken(cryptoRandomSource);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken(cryptoRandomSource)).not.toBe(token);
  });

  it('uses the injected random source', () => {
    const zeros: RandomSource = { bytes: (n) => Buffer.alloc(n) };
    expect(generateToken(zeros)).toBe('A'.repeat(43));
  });

  it('refuses tokens shorter than 16 bytes', () => {
    expect(() => generateToken(cryptoRandomSource, 8)).toThrow(RangeError);
  });

  it('hashes with sha256 hex', () => {
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('compares in constant time and handles length mismatch', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => expect(safeEqual(a, b)).toBe(a === b)),
    );
  });
});
