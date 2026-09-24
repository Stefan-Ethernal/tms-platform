import { createSecretKey, type KeyObject } from 'node:crypto';
import type { Algorithm } from '@node-rs/argon2';
import { hash, parseOptions, verify } from '@node-rs/argon2';

/** `Algorithm` is a const enum; `isolatedModules` forbids reading its members, so the value is spelled out. */
const ARGON2ID = 2 as Algorithm;
const MAX_INPUT_BYTES = 1024;

export interface Argon2Params {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

/** OWASP Password Storage Cheat Sheet minimum for argon2id. Frozen: a mutation of the shared
 * default object must not silently weaken the cost parameters of every hasher that uses it
 * (security review, task 04 fix round; same reasoning as `cryptoRandomSource` in `random.ts`). */
export const DEFAULT_ARGON2_PARAMS: Argon2Params = Object.freeze({
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(hash: string, plain: string): Promise<boolean>;
  needsRehash(hash: string): boolean;
}

export class Argon2idPasswordHasher implements PasswordHasher {
  // `KeyObject` instead of the caller's `Buffer`: util.inspect/console.log/JSON.stringify never
  // print its bytes, and later mutating the caller's own buffer cannot change what this hasher
  // hashes or verifies with (security review, task 04 fix round; same pattern as
  // `AesGcmSecretCipher` in `secret-cipher.ts`). `@node-rs/argon2` takes `secret` as a
  // `Uint8Array`, so it is exported back to bytes only transiently at each call site.
  private readonly pepper: KeyObject;
  private readonly params: Argon2Params;

  constructor(options: { pepper: Buffer; params?: Argon2Params }) {
    if (options.pepper.length < 32) throw new RangeError('the pepper must be at least 32 bytes');
    this.pepper = createSecretKey(options.pepper);
    // Copied rather than aliased: a caller that later mutates the params object it passed in
    // (or the shared `DEFAULT_ARGON2_PARAMS`) must not silently change an already-constructed
    // hasher's cost parameters (security review, task 04 fix round).
    this.params = { ...(options.params ?? DEFAULT_ARGON2_PARAMS) };
  }

  async hash(plain: string): Promise<string> {
    if (Buffer.byteLength(plain, 'utf8') > MAX_INPUT_BYTES)
      throw new RangeError('input too long to hash');
    return hash(plain, { algorithm: ARGON2ID, ...this.params, secret: this.pepper.export() });
  }

  async verify(hashed: string, plain: string): Promise<boolean> {
    if (Buffer.byteLength(plain, 'utf8') > MAX_INPUT_BYTES) return false;
    try {
      return await verify(hashed, plain, { secret: this.pepper.export() });
    } catch {
      return false;
    }
  }

  needsRehash(hashed: string): boolean {
    try {
      const p = parseOptions(hashed);
      // Deliberately deferred (security review, task 04, finding 3, LOW): `parseOptions` also
      // returns `version`, which is not compared here. Every hash this class itself produces
      // uses the library's current default version (never overridden via `Options.version`), so
      // this can only under-flag a hash created by an older library version or crafted outside
      // this class — the four compared parameters still force a rehash on any real policy change.
      return (
        p.algorithm !== ARGON2ID ||
        p.memoryCost !== this.params.memoryCost ||
        p.timeCost !== this.params.timeCost ||
        p.parallelism !== this.params.parallelism
      );
    } catch {
      return true;
    }
  }
}
