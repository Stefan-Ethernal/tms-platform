import { createCipheriv, createDecipheriv, createSecretKey, type KeyObject } from 'node:crypto';
import { cryptoRandomSource, type RandomSource } from './random';

/** Encrypts small secrets (TOTP seeds) at rest; `aad` binds the ciphertext to its owner (e.g. `totp:<userId>`). */
export interface SecretCipher {
  readonly activeKeyId: string;
  encrypt(plaintext: string, aad: string): string;
  decrypt(envelope: string, aad: string): string;
}

export class SecretCipherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretCipherError';
  }
}

const VERSION = 'v1';
const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
// An unpaired UTF-16 surrogate collapses to U+FFFD under UTF-8 encoding, so two different
// ill-formed strings (or an ill-formed string and its replacement) could authenticate or decode
// to the same bytes (the same class of bug `safeEqual` was fixed for in this round). The runtime
// has `String.prototype.isWellFormed()` (Node 20+), but the workspace's `lib` is ES2023, so this
// checks the same condition directly instead of widening the tsconfig `lib` for one call site.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function assertWellFormed(value: string, what: string): void {
  if (LONE_SURROGATE.test(value))
    throw new SecretCipherError(`${what} is not a well-formed string`);
}

/** `SECRETS_ENC_KEYS` format: `keyId:base64(32 bytes)` pairs separated by commas. */
export function parseKeyring(spec: string): Record<string, Buffer> {
  // `Object.create(null)` (plus `Object.hasOwn` for the duplicate check below) keeps a
  // maliciously-formatted id such as `__proto__` from being read back off `Object.prototype`.
  const keys: Record<string, Buffer> = Object.create(null) as Record<string, Buffer>;
  for (const entry of spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const separator = entry.indexOf(':');
    if (separator <= 0)
      throw new SecretCipherError('keyring entries must look like <keyId>:<base64 key>');
    const id = entry.slice(0, separator);
    // Follow-up (security review task 03, finding 9, deliberately deferred): `Buffer.from(...,
    // 'base64')` decodes leniently (accepts the URL-safe alphabet, skips characters outside the
    // alphabet), so a mistyped entry can still decode to 32 bytes. Not fixed here: every ciphertext
    // is still rejected on a bad auth tag, and a canonical round-trip check risks rejecting valid
    // keys produced by tools with a different base64 dialect.
    const key = Buffer.from(entry.slice(separator + 1), 'base64');
    if (!KEY_ID.test(id))
      throw new SecretCipherError('keyring key ids may contain only letters, digits, "_" and "-"');
    if (key.length !== KEY_BYTES)
      throw new SecretCipherError(`keyring key "${id}" must decode to ${KEY_BYTES} bytes`);
    if (Object.hasOwn(keys, id)) throw new SecretCipherError(`keyring key "${id}" is listed twice`);
    keys[id] = key;
  }
  if (Object.keys(keys).length === 0) throw new SecretCipherError('keyring is empty');
  return keys;
}

export function envelopeKeyId(envelope: string): string | null {
  const parts = envelope.split('.');
  const keyId = parts[1];
  return parts.length === 5 && parts[0] === VERSION && keyId !== undefined && KEY_ID.test(keyId)
    ? keyId
    : null;
}

/** `v1.<keyId>.` bound into the GCM AAD alongside the caller's own AAD, so an envelope cannot be
 * relabelled to a different key id (or version) without failing authentication, even when the
 * underlying key bytes happen to match (security review, task 03 fix round). `keyId` never
 * contains '.' (enforced by `KEY_ID`), so the boundary between the header and the caller's `aad`
 * is unambiguous. */
function bindAad(keyId: string, aad: string): Buffer {
  return Buffer.from(`${VERSION}.${keyId}.${aad}`, 'utf8');
}

/** AES-256-GCM, envelope `v1.<keyId>.<iv>.<ciphertext>.<tag>` (base64url parts), key id for rotation. */
export class AesGcmSecretCipher implements SecretCipher {
  readonly activeKeyId: string;
  readonly #keys: ReadonlyMap<string, KeyObject>;
  readonly #random: RandomSource;

  constructor(options: {
    keys: Record<string, Buffer>;
    activeKeyId: string;
    /**
     * Test-only seam (spec section 3 DI over ports): every production binding must use the
     * default `cryptoRandomSource`. A deterministic source here repeats the IV for AES-GCM, which
     * breaks both confidentiality and the auth tag; wire this option only from an in-memory test
     * double, never from application config (security review, task 03 fix round).
     */
    random?: RandomSource;
  }) {
    // Every id is validated against the bounded `KEY_ID` shape before any error message that
    // might include it, so a misconfigured env (e.g. `SECRETS_ENC_ACTIVE_KEY_ID` and
    // `SECRETS_ENC_KEYS` swapped) cannot put key material into a boot-time error message.
    for (const [id, key] of Object.entries(options.keys)) {
      if (!KEY_ID.test(id))
        throw new SecretCipherError(
          'keyring key ids may contain only letters, digits, "_" and "-"',
        );
      if (key.length !== KEY_BYTES)
        throw new SecretCipherError(`key "${id}" must be ${KEY_BYTES} bytes`);
    }
    if (!KEY_ID.test(options.activeKeyId)) throw new SecretCipherError('active key id is invalid');
    if (!Object.hasOwn(options.keys, options.activeKeyId))
      throw new SecretCipherError(`active key "${options.activeKeyId}" is not in the keyring`);
    // `KeyObject` instead of the caller's `Buffer`: util.inspect/console.log/JSON.stringify never
    // print its bytes (belt-and-braces alongside the `#keys` private field below), and later
    // zeroing or mutating the caller's own buffer cannot change what this cipher encrypts with.
    this.#keys = new Map(
      Object.entries(options.keys).map(([id, key]) => [id, createSecretKey(key)]),
    );
    this.activeKeyId = options.activeKeyId;
    this.#random = options.random ?? cryptoRandomSource;
  }

  /** Redact key material from `console.log`/`util.inspect` and `JSON.stringify`. */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `AesGcmSecretCipher { activeKeyId: ${JSON.stringify(this.activeKeyId)}, keys: '[redacted]' }`;
  }

  toJSON(): unknown {
    return { activeKeyId: this.activeKeyId, keys: '[redacted]' };
  }

  encrypt(plaintext: string, aad: string): string {
    if (aad.length === 0) throw new SecretCipherError('aad is required');
    assertWellFormed(aad, 'aad');
    assertWellFormed(plaintext, 'plaintext');
    const key = this.#keys.get(this.activeKeyId)!;
    const iv = this.#random.bytes(IV_BYTES);
    if (iv.length !== IV_BYTES)
      throw new SecretCipherError('random source returned the wrong number of bytes for an IV');
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(bindAad(this.activeKeyId, aad));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [
      VERSION,
      this.activeKeyId,
      iv.toString('base64url'),
      ciphertext.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
    ].join('.');
  }

  decrypt(envelope: string, aad: string): string {
    if (aad.length === 0) throw new SecretCipherError('aad is required');
    assertWellFormed(aad, 'aad');
    const parts = envelope.split('.');
    if (parts.length !== 5 || parts[0] !== VERSION)
      throw new SecretCipherError('malformed envelope');
    const [, keyId = '', ivPart = '', ciphertextPart = '', tagPart = ''] = parts;
    // The key id is validated against the same bounded shape before it can appear in an error
    // message or be used to look up a key, so an envelope with a hostile or oversized key-id
    // part cannot echo arbitrary content back into logs.
    if (!KEY_ID.test(keyId)) throw new SecretCipherError('malformed envelope');
    const key = this.#keys.get(keyId);
    if (!key) throw new SecretCipherError(`unknown key id "${keyId}"`);
    // Follow-up (security review task 03, finding 9, deliberately deferred): decoding is lenient
    // here too (non-canonical base64url spellings of the same bytes are accepted), same reasoning
    // as `parseKeyring` above — the auth tag below still rejects any corrupted ciphertext.
    const iv = Buffer.from(ivPart, 'base64url');
    const tag = Buffer.from(tagPart, 'base64url');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES)
      throw new SecretCipherError('malformed envelope');
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(bindAad(keyId, aad));
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextPart, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new SecretCipherError('decryption failed');
    }
  }
}
