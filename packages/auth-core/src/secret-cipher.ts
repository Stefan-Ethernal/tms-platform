import { createCipheriv, createDecipheriv } from 'node:crypto';
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
  return parts.length === 5 && parts[0] === VERSION ? (parts[1] ?? null) : null;
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
  readonly #keys: ReadonlyMap<string, Buffer>;
  readonly #random: RandomSource;

  constructor(options: {
    keys: Record<string, Buffer>;
    activeKeyId: string;
    random?: RandomSource;
  }) {
    for (const [id, key] of Object.entries(options.keys)) {
      if (key.length !== KEY_BYTES)
        throw new SecretCipherError(`key "${id}" must be ${KEY_BYTES} bytes`);
    }
    // The active key id is echoed in the error below only once it is known to match the bounded
    // `KEY_ID` shape, so a misconfigured env (e.g. `SECRETS_ENC_ACTIVE_KEY_ID` and
    // `SECRETS_ENC_KEYS` swapped) cannot put key material into a boot-time error message.
    if (!KEY_ID.test(options.activeKeyId)) throw new SecretCipherError('active key id is invalid');
    if (!Object.hasOwn(options.keys, options.activeKeyId))
      throw new SecretCipherError(`active key "${options.activeKeyId}" is not in the keyring`);
    this.#keys = new Map(Object.entries(options.keys));
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
