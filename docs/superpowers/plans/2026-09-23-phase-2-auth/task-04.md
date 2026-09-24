# Phase 2 — Task 04: auth-core — password hashing and password policy

> Part of the phase 2 plan: read [index.md](index.md) (constraints, shared interfaces, env) and this file only.


**Files:**
- Create: `packages/auth-core/src/password-hasher.ts`, `packages/auth-core/src/password-policy.ts`; Modify: `packages/auth-core/src/index.ts`, `packages/auth-core/package.json`, `pnpm-workspace.yaml` (catalog)
- Create: `packages/auth-core/test/password-hasher.spec.ts`, `packages/auth-core/test/password-policy.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `PasswordHasher`, `Argon2idPasswordHasher`, `Argon2Params`, `DEFAULT_ARGON2_PARAMS`; `checkPassword(password, userInputs)`, `PasswordViolation`, `PASSWORD_MIN_LENGTH = 12`, `PASSWORD_MAX_LENGTH = 128`, `PASSWORD_MIN_SCORE = 3`.

Facts from spikes S2/S3/S3b:
- `@node-rs/argon2` 2.2.1 is CommonJS with prebuilt binaries (no install script, no `allowBuilds`). `Algorithm` is a `const enum`, so under `isolatedModules` the value is written as `2 as Algorithm` with `import type { Algorithm }`. `hash`/`verify` accept `secret` (the argon2 key input K, used here as the pepper; a missing or different pepper makes `verify` return false). The output is a PHC string; `parseOptions(phc)` returns its parameters. OWASP parameters (m = 19456 KiB, t = 2, p = 1) take a median of 18.9 ms on the dev machine. The API images are `node:26-bookworm-slim` (glibc), so the musl caveat from the spike does not apply.
- `@zxcvbn-ts/core` 4.2.0 is synchronous: `new ZxcvbnFactory(options).check(password, userInputs)`. With default options, 128 random characters take ~1.1 s; `{ l33tMaxSubstitutions: 16, maxLength: 64 }` brings that to ~74 ms with unchanged scores on the reference passwords, but repeated patterns of 128 characters still cost 200–400 ms. So the policy runs only after authentication or a valid token (enrollment, change, reset after a token peek), behind the auth rate limits (the policy runs in Tasks 14, 18 and 22; `@AuthThrottle` arrives in Task 16), never on the unauthenticated login path.

Deviation 13: the pepper is argon2's own `secret` input instead of an HMAC pre-hash (section 8 describes HMAC for the PIN); both are keyed hashing, the native input avoids a second primitive, and phase 5 reuses this hasher for the PIN with `PIN_PEPPER`.

- [ ] **Step 1: Write the failing tests**

`packages/auth-core/test/password-hasher.spec.ts`:

```ts
import { Argon2idPasswordHasher, DEFAULT_ARGON2_PARAMS } from '../src';

const pepper = Buffer.alloc(32, 7);
const hasher = new Argon2idPasswordHasher({ pepper });

describe('Argon2idPasswordHasher', () => {
  it('produces an argon2id PHC string with the OWASP parameters', async () => {
    expect(await hasher.hash('Correct-Horse-Battery-Staple-42')).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const h = await hasher.hash('Correct-Horse-Battery-Staple-42');
    expect(await hasher.verify(h, 'Correct-Horse-Battery-Staple-42')).toBe(true);
    expect(await hasher.verify(h, 'correct-horse-battery-staple-42')).toBe(false);
  });

  it('binds hashes to the pepper', async () => {
    const h = await hasher.hash('Correct-Horse-Battery-Staple-42');
    expect(await new Argon2idPasswordHasher({ pepper: Buffer.alloc(32, 8) }).verify(h, 'Correct-Horse-Battery-Staple-42')).toBe(false);
  });

  it('returns false instead of throwing for a malformed hash', async () => {
    expect(await hasher.verify('not-a-phc-string', 'x')).toBe(false);
  });

  it('asks for a rehash when the parameters change', async () => {
    const h = await hasher.hash('x-password-long-enough');
    expect(hasher.needsRehash(h)).toBe(false);
    const stronger = new Argon2idPasswordHasher({ pepper, params: { ...DEFAULT_ARGON2_PARAMS, timeCost: 3 } });
    expect(stronger.needsRehash(h)).toBe(true);
    expect(hasher.needsRehash('garbage')).toBe(true);
  });

  it('refuses a pepper shorter than 32 bytes and inputs over 1 KiB', async () => {
    expect(() => new Argon2idPasswordHasher({ pepper: Buffer.alloc(16) })).toThrow(RangeError);
    await expect(hasher.hash('x'.repeat(1025))).rejects.toThrow(RangeError);
    expect(await hasher.verify(await hasher.hash('short-but-fine-123'), 'x'.repeat(1025))).toBe(false);
  });
});
```

`packages/auth-core/test/password-policy.spec.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { checkPassword } from '../src';

describe('checkPassword (section 8: min 12 characters, zxcvbn ≥ 3)', () => {
  it.each([
    ['Correct-Horse-Battery-Staple-42', []],
    ['correct horse battery staple', []],
    ['Tr0ub4dor&3xK!9q', []],
  ])('accepts %j', (password, userInputs) => {
    expect(checkPassword(password, userInputs)).toEqual({ ok: true });
  });

  it.each([
    ['Sh0rt!', ['TOO_SHORT']],
    ['password1234', ['TOO_WEAK']],
    ['P@ssw0rd!P@ssw0rd!', ['TOO_WEAK']],
    ['x'.repeat(129), ['TOO_LONG']],
  ])('rejects %j with %j', (password, violations) => {
    expect(checkPassword(password, [])).toEqual({ ok: false, violations });
  });

  it('treats personal data as guessable', () => {
    expect(checkPassword('ada.lovelace1815', ['ada.lovelace1815@example.com', 'ada.lovelace1815', 'Ada', 'Lovelace'])).toEqual({
      ok: false,
      violations: ['TOO_WEAK'],
    });
  });

  it('checks the length before scoring (an oversized input costs nothing)', () => {
    const started = performance.now();
    expect(checkPassword('a'.repeat(100_000), [])).toEqual({ ok: false, violations: ['TOO_LONG'] });
    expect(performance.now() - started).toBeLessThan(20);
  });

  it('bounds the scoring cost of a 128-character input', () => {
    for (const input of [randomBytes(96).toString('base64'), 'password'.repeat(16), 'a'.repeat(128)]) {
      const started = performance.now();
      checkPassword(input, []);
      expect(performance.now() - started).toBeLessThan(1000);
    }
  });
});
```

(The 1000 ms bound is a CI-safe ceiling that fails loudly if the tuning is lost — the default options take over a second on random input; the measured tuned values are 74 ms random, ≤ 405 ms patterned.)

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm turbo run test --filter=@tms/auth-core`
Expected: FAIL — `Argon2idPasswordHasher` and `checkPassword` are not exported.

- [ ] **Step 3: Implement**

Catalog: `'@node-rs/argon2': 2.2.1`, `'@zxcvbn-ts/core': 4.2.0`, `'@zxcvbn-ts/language-common': 4.1.3`, `'@zxcvbn-ts/language-en': 4.1.1`; add all four to `@tms/auth-core` `dependencies`.

`packages/auth-core/src/password-hasher.ts`:

```ts
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
export const DEFAULT_ARGON2_PARAMS: Argon2Params = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

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
    if (Buffer.byteLength(plain, 'utf8') > MAX_INPUT_BYTES) throw new RangeError('input too long to hash');
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
```

`packages/auth-core/src/password-policy.ts`:

```ts
import { type OptionsType, ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';
import * as en from '@zxcvbn-ts/language-en';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_MIN_SCORE = 3;

export type PasswordViolation = 'TOO_SHORT' | 'TOO_LONG' | 'TOO_WEAK';

/** Tuned per spike S3b: bounds the l33t enumeration and the scored prefix (scores unchanged on the reference set). */
const options: OptionsType = {
  translations: en.translations,
  graphs: common.adjacencyGraphs,
  dictionary: { ...common.dictionary, ...en.dictionary },
  l33tMaxSubstitutions: 16,
  maxLength: 64,
};
const zxcvbn = new ZxcvbnFactory(options);

/** Length first (cheap), then strength with the user's own data as guessable inputs. */
export function checkPassword(
  password: string,
  userInputs: readonly string[],
): { ok: true } | { ok: false; violations: PasswordViolation[] } {
  if (password.length > PASSWORD_MAX_LENGTH) return { ok: false, violations: ['TOO_LONG'] };
  if (password.length < PASSWORD_MIN_LENGTH) return { ok: false, violations: ['TOO_SHORT'] };
  const inputs = userInputs.flatMap((v) => [v, ...v.split(/[@.\s_-]+/)]).filter((v) => v.length >= 3);
  return zxcvbn.check(password, inputs).score >= PASSWORD_MIN_SCORE ? { ok: true } : { ok: false, violations: ['TOO_WEAK'] };
}
```

`index.ts` adds `export * from './password-hasher';` and `export * from './password-policy';`.

- [ ] **Step 4: Run the tests and verify**

Run: `pnpm turbo run test --filter=@tms/auth-core && pnpm verify`
Expected: hasher (6) and policy (3 + 4 + 3) tests pass; the timing assertions hold; `pnpm install` printed no `ERR_PNPM_IGNORED_BUILDS` for `@node-rs/argon2`.

- [ ] **Step 5: Commit**

```bash
git add packages/auth-core pnpm-workspace.yaml pnpm-lock.yaml docs/efficiency/auth-core.md
git commit -m "feat(auth-core): add argon2id password hashing with a pepper and a bounded zxcvbn policy"
```

PR body: diagram — none; boundaries: `@tms/auth-core` public API, new catalog entries; no migration; reviewer: `security-reviewer` (parameters, pepper handling, zxcvbn cost bound).
