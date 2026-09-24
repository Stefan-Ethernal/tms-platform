import fc from 'fast-check';
import { AesGcmSecretCipher, envelopeKeyId, parseKeyring, SecretCipherError } from '../src';

const k1 = Buffer.alloc(32, 1);
const k2 = Buffer.alloc(32, 2);

describe('AesGcmSecretCipher', () => {
  const cipher = new AesGcmSecretCipher({ keys: { k1 }, activeKeyId: 'k1' });

  it('round-trips any plaintext bound to its AAD', () => {
    fc.assert(
      fc.property(fc.string(), fc.string({ minLength: 1 }), (plain, aad) => {
        expect(cipher.decrypt(cipher.encrypt(plain, aad), aad)).toBe(plain);
      }),
    );
  });

  it('produces v1.<keyId>.<iv>.<ct>.<tag> with a fresh IV each time', () => {
    const a = cipher.encrypt('secret', 'totp:u1');
    const b = cipher.encrypt('secret', 'totp:u1');
    expect(a).toMatch(/^v1\.k1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
    expect(a).not.toBe(b);
    expect(envelopeKeyId(a)).toBe('k1');
    expect(envelopeKeyId('garbage')).toBeNull();
  });

  it('rejects a different AAD (a secret moved to another user)', () => {
    expect(() => cipher.decrypt(cipher.encrypt('secret', 'totp:u1'), 'totp:u2')).toThrow(
      SecretCipherError,
    );
  });

  it.each([1, 2, 3, 4])('rejects tampering with part %i', (index) => {
    const parts = cipher.encrypt('secret', 'aad').split('.');
    const part = parts[index]!;
    parts[index] = (part[0] === 'A' ? 'B' : 'A') + part.slice(1);
    expect(() => cipher.decrypt(parts.join('.'), 'aad')).toThrow(SecretCipherError);
  });

  it('decrypts envelopes of a retired key after rotation, encrypts with the active one', () => {
    const old = cipher.encrypt('secret', 'aad');
    const rotated = new AesGcmSecretCipher({ keys: { k1, k2 }, activeKeyId: 'k2' });
    expect(rotated.decrypt(old, 'aad')).toBe('secret');
    expect(envelopeKeyId(rotated.encrypt('secret', 'aad'))).toBe('k2');
    expect(() =>
      new AesGcmSecretCipher({ keys: { k2 }, activeKeyId: 'k2' }).decrypt(old, 'aad'),
    ).toThrow(/unknown key id/);
  });

  it('refuses a missing active key or a key that is not 32 bytes', () => {
    expect(() => new AesGcmSecretCipher({ keys: { k1 }, activeKeyId: 'k9' })).toThrow(
      SecretCipherError,
    );
    expect(
      () => new AesGcmSecretCipher({ keys: { k1: Buffer.alloc(16) }, activeKeyId: 'k1' }),
    ).toThrow(SecretCipherError);
  });
});

describe('parseKeyring', () => {
  const b64 = (b: Buffer) => b.toString('base64');
  it('parses "id:base64" pairs', () => {
    expect(parseKeyring(` k1:${b64(k1)} , k2:${b64(k2)} `)).toEqual({ k1, k2 });
  });
  it.each([
    ['', 'empty'],
    ['k1', 'no separator'],
    [`k1:${b64(Buffer.alloc(16))}`, 'short key'],
    [`bad id:${b64(k1)}`, 'invalid id'],
    [`k1:${b64(k1)},k1:${b64(k2)}`, 'duplicate id'],
  ])('rejects %j (%s) without echoing key material', (spec) => {
    try {
      parseKeyring(spec);
      throw new Error('expected a failure');
    } catch (e) {
      expect(e).toBeInstanceOf(SecretCipherError);
      expect((e as Error).message).not.toContain(b64(k1));
    }
  });
});
