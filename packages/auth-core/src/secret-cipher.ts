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
  const keys: Record<string, Buffer> = {};
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
    if (keys[id]) throw new SecretCipherError(`keyring key "${id}" is listed twice`);
    keys[id] = key;
  }
  if (Object.keys(keys).length === 0) throw new SecretCipherError('keyring is empty');
  return keys;
}

export function envelopeKeyId(envelope: string): string | null {
  const parts = envelope.split('.');
  return parts.length === 5 && parts[0] === VERSION ? (parts[1] ?? null) : null;
}

/** AES-256-GCM, envelope `v1.<keyId>.<iv>.<ciphertext>.<tag>` (base64url parts), key id for rotation. */
export class AesGcmSecretCipher implements SecretCipher {
  readonly activeKeyId: string;
  private readonly keys: ReadonlyMap<string, Buffer>;
  private readonly random: RandomSource;

  constructor(options: {
    keys: Record<string, Buffer>;
    activeKeyId: string;
    random?: RandomSource;
  }) {
    for (const [id, key] of Object.entries(options.keys)) {
      if (key.length !== KEY_BYTES)
        throw new SecretCipherError(`key "${id}" must be ${KEY_BYTES} bytes`);
    }
    if (!Object.hasOwn(options.keys, options.activeKeyId))
      throw new SecretCipherError(`active key "${options.activeKeyId}" is not in the keyring`);
    this.keys = new Map(Object.entries(options.keys));
    this.activeKeyId = options.activeKeyId;
    this.random = options.random ?? cryptoRandomSource;
  }

  encrypt(plaintext: string, aad: string): string {
    const key = this.keys.get(this.activeKeyId)!;
    const iv = this.random.bytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
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
    const parts = envelope.split('.');
    if (parts.length !== 5 || parts[0] !== VERSION)
      throw new SecretCipherError('malformed envelope');
    const [, keyId = '', ivPart = '', ciphertextPart = '', tagPart = ''] = parts;
    const key = this.keys.get(keyId);
    if (!key) throw new SecretCipherError(`unknown key id "${keyId}"`);
    const iv = Buffer.from(ivPart, 'base64url');
    const tag = Buffer.from(tagPart, 'base64url');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES)
      throw new SecretCipherError('malformed envelope');
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(Buffer.from(aad, 'utf8'));
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
