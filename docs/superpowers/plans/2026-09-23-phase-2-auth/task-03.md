# Phase 2 — Task 03: auth-core — package, random source, tokens, secret cipher

> Part of the phase 2 plan: read [index.md](index.md) (constraints, shared interfaces, env) and this file only.


**Files:**
- Create: `packages/auth-core/package.json`, `packages/auth-core/tsconfig.json`, `packages/auth-core/tsconfig.build.json`, `packages/auth-core/jest.config.mjs`, `packages/auth-core/eslint.config.mjs`
- Create: `packages/auth-core/src/index.ts`, `packages/auth-core/src/random.ts`, `packages/auth-core/src/tokens.ts`, `packages/auth-core/src/secret-cipher.ts`
- Create: `packages/auth-core/test/purity.spec.ts`, `packages/auth-core/test/tokens.spec.ts`, `packages/auth-core/test/secret-cipher.spec.ts`
- Modify: `docs/architecture.md` (prose section "Packages and module format": one appended sentence on auth-core)

**Interfaces:**
- Consumes: phase 1 presets `@tms/config/tsconfig/nest-library.json` (CommonJS library) and `createJestConfig({ rootDir })`.
- Produces: `RandomSource`, `cryptoRandomSource`; `generateToken(random, byteLength = 32): string`; `hashToken(raw): string`; `safeEqual(a, b): boolean`; `SecretCipher`, `AesGcmSecretCipher`, `SecretCipherError`, `parseKeyring(spec): Record<string, Buffer>`, `envelopeKeyId(envelope): string | null`.

`@tms/auth-core` is CommonJS like every other backend library (phase 1 T1: dual-build dependencies load once per process; `otplib` ships a real dual `exports` map, `@node-rs/argon2` and `@zxcvbn-ts/core` are CommonJS — spike S1–S3), tested with Jest (section 13 "Jest backend"). It imports nothing from the workspace, no Nest and no Prisma; `purity.spec.ts` enforces that on the source text, in addition to the boundaries rule `policy('auth-core', ['contracts'])`.

- [ ] **Step 1: Create the package skeleton**

`packages/auth-core/package.json`:

```json
{
  "name": "@tms/auth-core",
  "version": "0.0.0",
  "private": true,
  "type": "commonjs",
  "description": "Nest-free, Prisma-free authentication algorithms and ports: tokens, secret cipher, password hashing and policy, TOTP, recovery codes, lockout/session/step-up policies",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' jest"
  },
  "devDependencies": {
    "@tms/config": "workspace:*",
    "@types/jest": "catalog:",
    "@types/node": "catalog:",
    "eslint": "catalog:",
    "fast-check": "catalog:",
    "jest": "catalog:",
    "ts-jest": "catalog:",
    "typescript": "catalog:nest-ts6"
  }
}
```

`tsconfig.json`: `{ "extends": "@tms/config/tsconfig/nest-library.json", "compilerOptions": { "rootDir": ".", "outDir": "dist", "types": ["node", "jest"] }, "include": ["src", "test"] }`. `tsconfig.build.json`: extends it with `"rootDir": "src"`, `"include": ["src"]`, `"exclude": ["test", "dist"]`, `"types": ["node"]`. `jest.config.mjs`: `export default createJestConfig({ rootDir: import.meta.dirname });`. `eslint.config.mjs` (boundaries stops `db`/`domain` imports but does not check npm specifiers, so the package gets its own rule — journal input D10-6; phase 1 Task 02's note in the "Dependency rule" paragraph defers it to this task):

```js
import { nodeConfig } from '@tms/config/eslint/node';

export default [
  ...nodeConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ['**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@nestjs/*', '@prisma/*', 'prisma', '@tms/*'],
              message: 'auth-core stays Nest-free, Prisma-free and imports no workspace package (spec section 3)',
            },
          ],
        },
      ],
    },
  },
];
```

The message has no final period because the stylish formatter drops it. `purity.spec.ts` stays: it also covers files the lint config might not match later. `fast-check: ^4.10.2` is already in the catalog (phase 1 Task 03 adds it; stack A starts after `phase-1/03-contracts` merged), so this task does not touch `pnpm-workspace.yaml`. `typescript` comes from `catalog:nest-ts6` (TypeScript 6) like every Nest library: ts-jest needs the classic compiler API, which TypeScript 7 drops until 7.1 (CLAUDE.md "Stack"); `tsc` for build and typecheck then runs the same compiler.

Run: `pnpm install && pnpm turbo run build --filter=@tms/auth-core`
Expected: install adds the package; build fails with "No inputs were found" (no `src` yet) — the skeleton is wired.

- [ ] **Step 2: Write the failing tests**

`packages/auth-core/test/purity.spec.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );
}

describe('auth-core purity (spec section 3)', () => {
  it.each(sources(join(__dirname, '..', 'src')))('%s imports no workspace package, Nest or Prisma', (file) => {
    const text = readFileSync(file, 'utf8');
    expect(text).not.toMatch(/from ['"]@tms\//);
    expect(text).not.toMatch(/from ['"]@nestjs\//);
    expect(text).not.toMatch(/from ['"](@prisma\/|prisma)/);
  });
});
```

`packages/auth-core/test/tokens.spec.ts`:

```ts
import fc from 'fast-check';
import { cryptoRandomSource, generateToken, hashToken, type RandomSource, safeEqual } from '../src';

describe('tokens', () => {
  it('generates 32 random bytes as 43 base64url characters', () => {
    const token = generateToken(cryptoRandomSource);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken(cryptoRandomSource)).not.toBe(token);
  });

  it('uses the injected random source', () => {
    const zeros: RandomSource = { bytes: (n) => Buffer.alloc(n) };
    expect(generateToken(zeros)).toBe('A'.repeat(43));
  });

  it('refuses tokens shorter than 16 bytes', () => {
    expect(() => generateToken(cryptoRandomSource, 8)).toThrow(RangeError);
  });

  it('hashes with sha256 hex', () => {
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('compares in constant time and handles length mismatch', () => {
    fc.assert(fc.property(fc.string(), fc.string(), (a, b) => expect(safeEqual(a, b)).toBe(a === b)));
  });
});
```

`packages/auth-core/test/secret-cipher.spec.ts`:

```ts
import fc from 'fast-check';
import { AesGcmSecretCipher, envelopeKeyId, parseKeyring, SecretCipherError } from '../src';

const k1 = Buffer.alloc(32, 1);
const k2 = Buffer.alloc(32, 2);

describe('AesGcmSecretCipher', () => {
  const cipher = new AesGcmSecretCipher({ keys: { k1 }, activeKeyId: 'k1' });

  it('round-trips any plaintext bound to its AAD', () => {
    fc.assert(
      fc.property(fc.string(), fc.string({ minLength: 1 }), (plain, aad) => {
        expect(cipher.decrypt(cipher.encrypt(plain, aad), aad)).toBe(plain);
      }),
    );
  });

  it('produces v1.<keyId>.<iv>.<ct>.<tag> with a fresh IV each time', () => {
    const a = cipher.encrypt('secret', 'totp:u1');
    const b = cipher.encrypt('secret', 'totp:u1');
    expect(a).toMatch(/^v1\.k1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
    expect(a).not.toBe(b);
    expect(envelopeKeyId(a)).toBe('k1');
    expect(envelopeKeyId('garbage')).toBeNull();
  });

  it('rejects a different AAD (a secret moved to another user)', () => {
    expect(() => cipher.decrypt(cipher.encrypt('secret', 'totp:u1'), 'totp:u2')).toThrow(SecretCipherError);
  });

  it.each([1, 2, 3, 4])('rejects tampering with part %i', (index) => {
    const parts = cipher.encrypt('secret', 'aad').split('.');
    const part = parts[index]!;
    parts[index] = (part[0] === 'A' ? 'B' : 'A') + part.slice(1);
    expect(() => cipher.decrypt(parts.join('.'), 'aad')).toThrow(SecretCipherError);
  });

  it('decrypts envelopes of a retired key after rotation, encrypts with the active one', () => {
    const old = cipher.encrypt('secret', 'aad');
    const rotated = new AesGcmSecretCipher({ keys: { k1, k2 }, activeKeyId: 'k2' });
    expect(rotated.decrypt(old, 'aad')).toBe('secret');
    expect(envelopeKeyId(rotated.encrypt('secret', 'aad'))).toBe('k2');
    expect(() => new AesGcmSecretCipher({ keys: { k2 }, activeKeyId: 'k2' }).decrypt(old, 'aad')).toThrow(/unknown key id/);
  });

  it('refuses a missing active key or a key that is not 32 bytes', () => {
    expect(() => new AesGcmSecretCipher({ keys: { k1 }, activeKeyId: 'k9' })).toThrow(SecretCipherError);
    expect(() => new AesGcmSecretCipher({ keys: { k1: Buffer.alloc(16) }, activeKeyId: 'k1' })).toThrow(SecretCipherError);
  });
});

describe('parseKeyring', () => {
  const b64 = (b: Buffer) => b.toString('base64');
  it('parses "id:base64" pairs', () => {
    expect(parseKeyring(` k1:${b64(k1)} , k2:${b64(k2)} `)).toEqual({ k1, k2 });
  });
  it.each([
    ['', 'empty'],
    ['k1', 'no separator'],
    [`k1:${b64(Buffer.alloc(16))}`, 'short key'],
    [`bad id:${b64(k1)}`, 'invalid id'],
    [`k1:${b64(k1)},k1:${b64(k2)}`, 'duplicate id'],
  ])('rejects %j (%s) without echoing key material', (spec) => {
    try {
      parseKeyring(spec);
      throw new Error('expected a failure');
    } catch (e) {
      expect(e).toBeInstanceOf(SecretCipherError);
      expect((e as Error).message).not.toContain(b64(k1));
    }
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm turbo run test --filter=@tms/auth-core`
Expected: FAIL — `Cannot find module '../src'`.

- [ ] **Step 4: Implement**

`packages/auth-core/src/random.ts`:

```ts
import { randomBytes } from 'node:crypto';

/** Port for randomness so tests can be deterministic (spec section 3). */
export interface RandomSource {
  bytes(length: number): Buffer;
}

export const cryptoRandomSource: RandomSource = { bytes: (length) => randomBytes(length) };
```

`packages/auth-core/src/tokens.ts`:

```ts
import { createHash, timingSafeEqual } from 'node:crypto';
import type { RandomSource } from './random';

/** Opaque bearer token (sessions, action tokens): `byteLength` random bytes, base64url, no padding. */
export function generateToken(random: RandomSource, byteLength = 32): string {
  if (byteLength < 16) throw new RangeError('tokens need at least 16 random bytes');
  return random.bytes(byteLength).toString('base64url');
}

/** What the database stores instead of the token (tokens are high-entropy, so a plain hash suffices). */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}
```

`packages/auth-core/src/secret-cipher.ts`:

```ts
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
  for (const entry of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const separator = entry.indexOf(':');
    if (separator <= 0) throw new SecretCipherError('keyring entries must look like <keyId>:<base64 key>');
    const id = entry.slice(0, separator);
    const key = Buffer.from(entry.slice(separator + 1), 'base64');
    if (!KEY_ID.test(id)) throw new SecretCipherError('keyring key ids may contain only letters, digits, "_" and "-"');
    if (key.length !== KEY_BYTES) throw new SecretCipherError(`keyring key "${id}" must decode to ${KEY_BYTES} bytes`);
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

  constructor(options: { keys: Record<string, Buffer>; activeKeyId: string; random?: RandomSource }) {
    for (const [id, key] of Object.entries(options.keys)) {
      if (key.length !== KEY_BYTES) throw new SecretCipherError(`key "${id}" must be ${KEY_BYTES} bytes`);
    }
    if (!Object.hasOwn(options.keys, options.activeKeyId)) throw new SecretCipherError(`active key "${options.activeKeyId}" is not in the keyring`);
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
    return [VERSION, this.activeKeyId, iv.toString('base64url'), ciphertext.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
  }

  decrypt(envelope: string, aad: string): string {
    const parts = envelope.split('.');
    if (parts.length !== 5 || parts[0] !== VERSION) throw new SecretCipherError('malformed envelope');
    const [, keyId = '', ivPart = '', ciphertextPart = '', tagPart = ''] = parts;
    const key = this.keys.get(keyId);
    if (!key) throw new SecretCipherError(`unknown key id "${keyId}"`);
    const iv = Buffer.from(ivPart, 'base64url');
    const tag = Buffer.from(tagPart, 'base64url');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new SecretCipherError('malformed envelope');
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(Buffer.from(ciphertextPart, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      throw new SecretCipherError('decryption failed');
    }
  }
}
```

`packages/auth-core/src/index.ts`:

```ts
export * from './random';
export * from './tokens';
export * from './secret-cipher';
```

- [ ] **Step 5: Run the tests and verify**

Run: `pnpm turbo run test --filter=@tms/auth-core && pnpm turbo run lint --filter=@tms/auth-core && pnpm turbo run typecheck --filter=@tms/auth-core && pnpm turbo run build --filter=@tms/auth-core && pnpm verify`
Expected: purity (3 files), tokens (5), cipher (7 + 4 tamper cases) and keyring (6) pass; `dist/index.js` and `dist/index.d.ts` exist; `pnpm verify` green with no `[boundaries]` warning.

Run: `printf "import '@nestjs/common';\nimport '@prisma/client';\nimport '@tms/contracts';\n" > packages/auth-core/src/lint-probe.ts && pnpm turbo run lint --filter=@tms/auth-core; echo exit=$?`
Expected: `exit=1` with three `no-restricted-imports` errors in `src/lint-probe.ts` (lines 1–3), each reading `'<specifier>' import is restricted from being used by a pattern. auth-core stays Nest-free, Prisma-free and imports no workspace package (spec section 3)`; `pnpm turbo run lint --filter=@tms/auth-core 2>&1 | grep -c no-restricted-imports` prints `3` (a boundaries error on line 3 may come on top).

Run: `rm packages/auth-core/src/lint-probe.ts && pnpm turbo run lint --filter=@tms/auth-core; echo exit=$?`
Expected: `exit=0`. The PR's verification results list the probe (`lint rule | lint probe | 3 errors, then clean`).

`docs/architecture.md`: append one sentence to the end of the prose section "Packages and module format" (phase 1 Task 03 wrote it as prose, no table):

```md
`auth-core` is CommonJS and tested with Jest like the other Nest-aware libraries, but imports no
workspace package, no Nest and no Prisma (its own `no-restricted-imports` rule plus
`purity.spec.ts`): it holds ports and pure algorithms, and `@tms/domain/admin` binds the adapters.
```

- [ ] **Step 6: Commit**

```bash
git add packages/auth-core pnpm-lock.yaml docs/architecture.md docs/efficiency/auth-core.md
git commit -m "feat(auth-core): add the package with tokens, a random source and an AES-GCM secret cipher"
```

PR body: diagram `classDiagram` (`SecretCipher` ← `AesGcmSecretCipher`, `RandomSource`); boundaries: new package `@tms/auth-core` (no consumers yet); no migration; reviewer: `security-reviewer` (crypto choices: GCM IV size, AAD, tag length, key rotation).
