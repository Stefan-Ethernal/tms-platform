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
});
