import { inspect } from 'node:util';
import fc from 'fast-check';
import {
  AesGcmSecretCipher,
  envelopeKeyId,
  parseKeyring,
  type RandomSource,
  SecretCipherError,
} from '../src';

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

  // Security review (task 03 fix round), finding 1 (HIGH): the envelope's own header (version,
  // key id) was not part of the authenticated data, so an envelope could in principle be
  // relabelled to another key id without failing authentication, as long as that key id's bytes
  // happened to match. Binding `v1.<keyId>.` into the AAD closes this even when two ids share key
  // material (e.g. during a rotation window).
  it('binds the key id into the AAD: relabeling an envelope fails even with identical key bytes', () => {
    const sameBytes = new AesGcmSecretCipher({ keys: { k1, k9: k1 }, activeKeyId: 'k1' });
    const envelope = sameBytes.encrypt('secret', 'aad');
    const relabeled = envelope.replace(/^v1\.k1\./, 'v1.k9.');
    expect(envelopeKeyId(relabeled)).toBe('k9');
    expect(() => sameBytes.decrypt(relabeled, 'aad')).toThrow(SecretCipherError);
  });

  // Finding 5 (MEDIUM): an empty AAD binds the ciphertext to no owner at all.
  it('rejects an empty aad on encrypt and decrypt', () => {
    expect(() => cipher.encrypt('secret', '')).toThrow(SecretCipherError);
    const envelope = cipher.encrypt('secret', 'aad');
    expect(() => cipher.decrypt(envelope, '')).toThrow(SecretCipherError);
  });

  // Finding 6 (MEDIUM): the tamper-case tests above only flip one character (same length), so a
  // truncated tag or IV, a bad version and a wrong part count were not covered.
  it.each([
    ['wrong version', (e: string) => 'v2' + e.slice(2)],
    ['too few parts', (e: string) => e.split('.').slice(0, 4).join('.')],
    ['too many parts', (e: string) => e + '.extra'],
    [
      'a truncated tag',
      (e: string) =>
        e.split('.').slice(0, 4).join('.') + '.' + Buffer.alloc(4).toString('base64url'),
    ],
    [
      'a truncated iv',
      (e: string) => {
        const parts = e.split('.');
        parts[2] = Buffer.alloc(4).toString('base64url');
        return parts.join('.');
      },
    ],
  ])('rejects a malformed envelope (%s)', (_label, mutate) => {
    const envelope = cipher.encrypt('secret', 'aad');
    expect(() => cipher.decrypt(mutate(envelope), 'aad')).toThrow(SecretCipherError);
  });

  // Finding 4 (MEDIUM): an invalid active key id, or an invalid key id smuggled into an envelope,
  // must not be echoed back in the thrown message (it could carry key material, e.g. from a
  // misconfigured env where SECRETS_ENC_ACTIVE_KEY_ID and SECRETS_ENC_KEYS were swapped).
  it('never echoes an invalid active key id or an invalid envelope key id in its error', () => {
    const suspicious = Buffer.alloc(32, 255).toString('base64');
    expect(() => new AesGcmSecretCipher({ keys: { k1 }, activeKeyId: suspicious })).toThrow(
      SecretCipherError,
    );
    try {
      new AesGcmSecretCipher({ keys: { k1 }, activeKeyId: suspicious });
      throw new Error('expected a failure');
    } catch (e) {
      expect((e as Error).message).not.toContain(suspicious);
    }

    const envelope = cipher.encrypt('secret', 'aad');
    const parts = envelope.split('.');
    parts[1] = suspicious;
    try {
      cipher.decrypt(parts.join('.'), 'aad');
      throw new Error('expected a failure');
    } catch (e) {
      expect(e).toBeInstanceOf(SecretCipherError);
      expect((e as Error).message).not.toContain(suspicious);
    }
  });

  // Finding 3 (MEDIUM): key material must not be visible via console.log/util.inspect or
  // JSON.stringify of the cipher instance. `showHidden: true` covers non-enumerable properties
  // (what `util.inspect` calls "hidden"); true `#private` class fields are not reachable through
  // any reflection API, which is exactly why this re-review's finding 1 (the previous version of
  // this test passed even before the fix, because it only searched for the key's own bytes,
  // which `util.inspect` never renders that way for a `Buffer`) is now closed by asserting the
  // full rendered/serialised shape instead.
  it('redacts key material from util.inspect and JSON.stringify', () => {
    expect(inspect(cipher, { showHidden: true, depth: Infinity })).not.toMatch(/Buffer|01 01 01/);
    expect(JSON.parse(JSON.stringify(cipher))).toEqual({
      activeKeyId: 'k1',
      keys: '[redacted]',
    });
    expect(Object.keys(cipher)).toEqual(['activeKeyId']);
  });

  // Finding 2 (MEDIUM): a `RandomSource` that returns too few bytes must not silently produce a
  // short IV (Node's GCM implementation accepts any IV length).
  it('refuses an injected random source that returns the wrong number of IV bytes', () => {
    const short: RandomSource = { bytes: () => Buffer.alloc(4) };
    const broken = new AesGcmSecretCipher({ keys: { k1 }, activeKeyId: 'k1', random: short });
    expect(() => broken.encrypt('secret', 'aad')).toThrow(SecretCipherError);
  });

  // Re-review finding 3 (LOW): the constructor validated `activeKeyId`'s shape before echoing it,
  // but a non-active entry in `keys` was echoed unchecked in the "must be 32 bytes" message.
  it('never echoes an invalid non-active key id either', () => {
    const suspicious = Buffer.alloc(32, 255).toString('base64');
    try {
      new AesGcmSecretCipher({ keys: { k1, [suspicious]: Buffer.alloc(16) }, activeKeyId: 'k1' });
      throw new Error('expected a failure');
    } catch (e) {
      expect(e).toBeInstanceOf(SecretCipherError);
      expect((e as Error).message).not.toContain(suspicious);
    }
  });

  // Re-review finding 3 (LOW): `envelopeKeyId` returned whatever sat between the first two dots
  // unchecked, so a caller that logs "envelope uses key <id>" could echo hostile content.
  it('envelopeKeyId returns null for an invalid-shaped key id', () => {
    expect(envelopeKeyId('v1..iv.ct.tag')).toBeNull();
    expect(envelopeKeyId(`v1.${'x'.repeat(64)}.iv.ct.tag`)).toBeNull();
    expect(envelopeKeyId('v1.not a valid id.iv.ct.tag')).toBeNull();
  });

  // Re-review finding 4 (LOW): hashed/encoded as UTF-8, an unpaired surrogate collapses to
  // U+FFFD, so two different ill-formed strings could bind to, or decode from, the same bytes.
  it('rejects ill-formed aad and plaintext (lone surrogates)', () => {
    expect(() => cipher.encrypt('secret', '\uD800')).toThrow(SecretCipherError);
    expect(() => cipher.encrypt('\uD800', 'aad')).toThrow(SecretCipherError);
    expect(() => cipher.decrypt(cipher.encrypt('secret', 'aad'), '\uD800')).toThrow(
      SecretCipherError,
    );
  });

  // Re-review finding 5 (LOW): keys are copied into `KeyObject`s at construction time, so
  // mutating (or zeroing) the caller's original `Buffer` afterwards cannot change what the
  // cipher encrypts or decrypts with.
  it('is not affected by the caller mutating the source key buffer after construction', () => {
    const source = Buffer.from(k1);
    const isolated = new AesGcmSecretCipher({ keys: { k1: source }, activeKeyId: 'k1' });
    const envelope = isolated.encrypt('secret', 'aad');
    source.fill(0);
    expect(isolated.decrypt(envelope, 'aad')).toBe('secret');
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

  // Finding 8 (LOW): a plain `{}` accumulator lets a key id of `__proto__` set the object's
  // prototype instead of an own property (and a subsequent duplicate-id check would then read
  // `Object.prototype`, not the entry). `Object.create(null)` plus `Object.hasOwn` treats
  // `__proto__` as an ordinary id.
  it('treats "__proto__" as an ordinary key id, not a prototype access', () => {
    const parsed = parseKeyring(`__proto__:${b64(k1)}`);
    expect(Object.hasOwn(parsed, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(parsed['__proto__']).toEqual(k1);
  });
});
