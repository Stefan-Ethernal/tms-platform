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

/** OWASP Password Storage Cheat Sheet minimum for argon2id. */
export const DEFAULT_ARGON2_PARAMS: Argon2Params = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(hash: string, plain: string): Promise<boolean>;
  needsRehash(hash: string): boolean;
}

export class Argon2idPasswordHasher implements PasswordHasher {
  private readonly pepper: Buffer;
  private readonly params: Argon2Params;

  constructor(options: { pepper: Buffer; params?: Argon2Params }) {
    if (options.pepper.length < 32) throw new RangeError('the pepper must be at least 32 bytes');
    this.pepper = options.pepper;
    this.params = options.params ?? DEFAULT_ARGON2_PARAMS;
  }

  async hash(plain: string): Promise<string> {
    if (Buffer.byteLength(plain, 'utf8') > MAX_INPUT_BYTES)
      throw new RangeError('input too long to hash');
    return hash(plain, { algorithm: ARGON2ID, ...this.params, secret: this.pepper });
  }

  async verify(hashed: string, plain: string): Promise<boolean> {
    if (Buffer.byteLength(plain, 'utf8') > MAX_INPUT_BYTES) return false;
    try {
      return await verify(hashed, plain, { secret: this.pepper });
    } catch {
      return false;
    }
  }

  needsRehash(hashed: string): boolean {
    try {
      const p = parseOptions(hashed);
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
