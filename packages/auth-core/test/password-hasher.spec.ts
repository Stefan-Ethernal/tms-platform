import { inspect } from 'node:util';
import { Argon2idPasswordHasher, DEFAULT_ARGON2_PARAMS } from '../src';

const pepper = Buffer.alloc(32, 7);
const hasher = new Argon2idPasswordHasher({ pepper });

describe('Argon2idPasswordHasher', () => {
  it('produces an argon2id PHC string with the OWASP parameters', async () => {
    expect(await hasher.hash('Correct-Horse-Battery-Staple-42')).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/,
    );
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const h = await hasher.hash('Correct-Horse-Battery-Staple-42');
    expect(await hasher.verify(h, 'Correct-Horse-Battery-Staple-42')).toBe(true);
    expect(await hasher.verify(h, 'correct-horse-battery-staple-42')).toBe(false);
  });

  it('binds hashes to the pepper', async () => {
    const h = await hasher.hash('Correct-Horse-Battery-Staple-42');
    expect(
      await new Argon2idPasswordHasher({ pepper: Buffer.alloc(32, 8) }).verify(
        h,
        'Correct-Horse-Battery-Staple-42',
      ),
    ).toBe(false);
  });

  it('returns false instead of throwing for a malformed hash', async () => {
    expect(await hasher.verify('not-a-phc-string', 'x')).toBe(false);
  });

  it('asks for a rehash when the parameters change', async () => {
    const h = await hasher.hash('x-password-long-enough');
    expect(hasher.needsRehash(h)).toBe(false);
    const stronger = new Argon2idPasswordHasher({
      pepper,
      params: { ...DEFAULT_ARGON2_PARAMS, timeCost: 3 },
    });
    expect(stronger.needsRehash(h)).toBe(true);
    expect(hasher.needsRehash('garbage')).toBe(true);
  });

  it('refuses a pepper shorter than 32 bytes and inputs over 1 KiB', async () => {
    expect(() => new Argon2idPasswordHasher({ pepper: Buffer.alloc(16) })).toThrow(RangeError);
    await expect(hasher.hash('x'.repeat(1025))).rejects.toThrow(RangeError);
    expect(await hasher.verify(await hasher.hash('short-but-fine-123'), 'x'.repeat(1025))).toBe(
      false,
    );
  });

  // Security review (task 04 fix round), finding 1 (MEDIUM): the pepper must not be visible via
  // util.inspect/console.log or JSON.stringify of the hasher instance (a plain Buffer field
  // serialises as {type:'Buffer', data:[...]}, printing every byte).
  it('redacts the pepper from util.inspect and JSON.stringify', () => {
    const rendered = inspect(hasher, { showHidden: true, depth: Infinity });
    expect(rendered).not.toMatch(/Buffer|07 07 07|\[7,7,7/);
    expect(JSON.stringify(hasher)).not.toContain('"data"');
    expect(JSON.parse(JSON.stringify(hasher))).toEqual({
      pepper: {},
      params: { memoryCost: 19456, timeCost: 2, parallelism: 1 },
    });
  });

  // Security review (task 04 fix round), finding 2 (MEDIUM): DEFAULT_ARGON2_PARAMS must be frozen
  // and a caller-supplied params object must be copied, so a later mutation of either cannot
  // silently weaken an already-constructed hasher's cost parameters.
  it('is not affected by a later mutation of DEFAULT_ARGON2_PARAMS or a caller-supplied params object', async () => {
    expect(Object.isFrozen(DEFAULT_ARGON2_PARAMS)).toBe(true);
    expect(() => {
      (DEFAULT_ARGON2_PARAMS as { timeCost: number }).timeCost = 1;
    }).toThrow(TypeError);

    const mutableParams = { ...DEFAULT_ARGON2_PARAMS };
    const isolated = new Argon2idPasswordHasher({ pepper, params: mutableParams });
    mutableParams.timeCost = 1;
    const h = await isolated.hash('x-password-long-enough');
    expect(h).toMatch(/,t=2,/);
    expect(isolated.needsRehash(h)).toBe(false);
  });
});
