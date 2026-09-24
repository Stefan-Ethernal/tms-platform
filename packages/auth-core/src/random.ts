import { randomBytes } from 'node:crypto';

/** Port for randomness so tests can be deterministic (spec section 3). */
export interface RandomSource {
  bytes(length: number): Buffer;
}

export const cryptoRandomSource: RandomSource = { bytes: (length) => randomBytes(length) };
