import { randomBytes } from 'node:crypto';

/** Port for randomness so tests can be deterministic (spec section 3). */
export interface RandomSource {
  bytes(length: number): Buffer;
}

// Frozen so an importer cannot replace `.bytes` and silently make every caller's "random" IVs
// and tokens deterministic for the rest of the process (security review, task 03 fix round).
export const cryptoRandomSource: RandomSource = Object.freeze({
  bytes: (length: number) => randomBytes(length),
});
