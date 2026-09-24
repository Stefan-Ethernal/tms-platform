# Phase 2 — Task 05: auth-core — TOTP and recovery codes

> Part of the phase 2 plan: read [index.md](index.md) (constraints, shared interfaces, env) and this file only.


**Files:**
- Create: `packages/auth-core/src/totp.ts`, `packages/auth-core/src/recovery-codes.ts`; Modify: `packages/auth-core/src/index.ts`, `packages/auth-core/package.json` (`otplib`), `pnpm-workspace.yaml` (catalog)
- Create: `packages/auth-core/test/totp.spec.ts`, `packages/auth-core/test/recovery-codes.spec.ts`

**Interfaces:**
- Consumes: `RandomSource` (03).
- Produces: `TotpProvider`, `OtplibTotpProvider`, `TotpVerification`, `generateTotpCode(secret, now): Promise<string>`, `TOTP_PERIOD_SECONDS = 30`; `RECOVERY_CODE_COUNT = 10`, `generateRecoveryCodes(random, count?)`, `normalizeRecoveryCode(input): string | null`, `hashRecoveryCode(normalized): string`.

Facts from spike S1 (otplib 13.5.0): `verify({ secret, token, epoch, epochTolerance, afterTimeStep })` resolves to `{ valid: true, timeStep, delta, epoch }` or `{ valid: false }`; `epoch` is in **seconds**; `epochTolerance: 30` accepts steps −1..+1 and rejects ±2; `afterTimeStep: N` rejects a match at `timeStep <= N`; `generateSecret()` returns 32 base32 characters (20 bytes); `generateURI({ issuer, label, secret })` returns `otpauth://totp/TMS:admin%40example.com?secret=...&issuer=TMS`; the package has a real CommonJS entry.

- [ ] **Step 1: Write the failing tests**

`packages/auth-core/test/totp.spec.ts`:

```ts
import { generate } from 'otplib';
import { generateTotpCode, OtplibTotpProvider, TOTP_PERIOD_SECONDS } from '../src';

const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // ASCII "12345678901234567890" (RFC 6238 test vector) gitleaks:allow
const provider = new OtplibTotpProvider();
const at = (step: number, offsetSeconds = 0) => new Date((step * TOTP_PERIOD_SECONDS + offsetSeconds) * 1000);

describe('OtplibTotpProvider', () => {
  it.each([
    [59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'],
  ])('matches the RFC 6238 SHA1 vector at T=%i', async (epoch, expected) => {
    expect(await generate({ secret: RFC_SECRET, digits: 8, algorithm: 'sha1', period: 30, epoch })).toBe(expected);
  });

  it('generates a 20-byte base32 secret and an otpauth URI', () => {
    const secret = provider.generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(provider.buildUri({ issuer: 'TMS', account: 'admin@example.com', secret })).toBe(
      `otpauth://totp/TMS:admin%40example.com?secret=${secret}&issuer=TMS`,
    );
  });

  it.each([-1, 0, 1])('accepts a code from step offset %i and returns the matched step', async (d) => {
    const step = 60_000_000;
    const code = await generateTotpCode(RFC_SECRET, at(step + d));
    expect(await provider.verify({ secret: RFC_SECRET, code, now: at(step, 7), lastUsedStep: null })).toEqual({ ok: true, step: step + d });
  });

  it.each([-2, 2])('rejects a code from step offset %i', async (d) => {
    const step = 60_000_000;
    const code = await generateTotpCode(RFC_SECRET, at(step + d));
    expect(await provider.verify({ secret: RFC_SECRET, code, now: at(step, 7), lastUsedStep: null })).toEqual({ ok: false });
  });

  it('rejects replay of the last used step and older steps, accepts the next one', async () => {
    const step = 60_000_000;
    const code = await generateTotpCode(RFC_SECRET, at(step));
    expect(await provider.verify({ secret: RFC_SECRET, code, now: at(step, 20), lastUsedStep: step })).toEqual({ ok: false });
    const older = await generateTotpCode(RFC_SECRET, at(step - 1));
    expect(await provider.verify({ secret: RFC_SECRET, code: older, now: at(step, 20), lastUsedStep: step })).toEqual({ ok: false });
    const next = await generateTotpCode(RFC_SECRET, at(step + 1));
    expect(await provider.verify({ secret: RFC_SECRET, code: next, now: at(step + 1, 2), lastUsedStep: step })).toEqual({ ok: true, step: step + 1 });
  });

  it.each(['', '12345', '1234567', 'abcdef', ' 123456'])('rejects malformed code %j without calling the library', async (code) => {
    expect(await provider.verify({ secret: RFC_SECRET, code, now: at(60_000_000), lastUsedStep: null })).toEqual({ ok: false });
  });
});
```

`packages/auth-core/test/recovery-codes.spec.ts`:

```ts
import fc from 'fast-check';
import { cryptoRandomSource, generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode, RECOVERY_CODE_COUNT } from '../src';

const FORMAT = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/;

describe('recovery codes', () => {
  it('generates 10 unique codes of 16 Crockford characters (80 bits)', () => {
    const codes = generateRecoveryCodes(cryptoRandomSource);
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const c of codes) expect(c).toMatch(FORMAT);
  });

  it('maps every 10-byte input to a valid code (entropy is not truncated)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 10, maxLength: 10 }), (bytes) => {
        const [code] = generateRecoveryCodes({ bytes: () => Buffer.from(bytes) }, 1);
        expect(code).toMatch(FORMAT);
      }),
    );
  });

  it.each([
    ['abcd-efgh-jkmn-pqrs', 'ABCDEFGHJKMNPQRS'],
    [' ABCD EFGH JKMN PQRS ', 'ABCDEFGHJKMNPQRS'],
    ['OOOO-IIII-LLLL-0000', '0000111111110000'],
    ['ABCD-EFGH-JKMN-PQR', null],
    ['ABCD-EFGH-JKMN-PQRU', null],
    ['', null],
  ])('normalises %j to %j', (input, expected) => {
    expect(normalizeRecoveryCode(input)).toBe(expected);
  });

  it('hashes deterministically and never returns the code', () => {
    const h = hashRecoveryCode('ABCDEFGHJKMNPQRS');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hashRecoveryCode('ABCDEFGHJKMNPQRS'));
    expect(h).not.toContain('ABCDEFGHJKMNPQRS');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm turbo run test --filter=@tms/auth-core`
Expected: FAIL — `OtplibTotpProvider` and the recovery-code functions are not exported (the RFC vector cases fail to import `otplib` until it is added).

- [ ] **Step 3: Implement**

Catalog: `otplib: 13.5.0`; `@tms/auth-core` → `dependencies: { "otplib": "catalog:" }`.

`packages/auth-core/src/totp.ts`:

```ts
import { generate, generateSecret, generateURI, verify } from 'otplib';

export const TOTP_PERIOD_SECONDS = 30;
const CODE = /^\d{6}$/;

export type TotpVerification = { ok: true; step: number } | { ok: false };

export interface TotpProvider {
  generateSecret(): string;
  buildUri(input: { issuer: string; account: string; secret: string }): string;
  /** ±1 step (section 8); a match at or before `lastUsedStep` is a replay and fails. */
  verify(input: { secret: string; code: string; now: Date; lastUsedStep: number | null }): Promise<TotpVerification>;
}

const epochSeconds = (d: Date) => Math.floor(d.getTime() / 1000);

export class OtplibTotpProvider implements TotpProvider {
  generateSecret(): string {
    return generateSecret();
  }

  buildUri({ issuer, account, secret }: { issuer: string; account: string; secret: string }): string {
    return generateURI({ issuer, label: account, secret });
  }

  async verify({ secret, code, now, lastUsedStep }: { secret: string; code: string; now: Date; lastUsedStep: number | null }): Promise<TotpVerification> {
    if (!CODE.test(code)) return { ok: false };
    const result = await verify({
      secret,
      token: code,
      epoch: epochSeconds(now),
      epochTolerance: TOTP_PERIOD_SECONDS,
      ...(lastUsedStep === null ? {} : { afterTimeStep: lastUsedStep }),
    });
    return result.valid && 'timeStep' in result ? { ok: true, step: result.timeStep } : { ok: false };
  }
}

/** The code an authenticator shows at `now` (tests and the E2E TOTP helper). */
export function generateTotpCode(secret: string, now: Date): Promise<string> {
  return generate({ secret, epoch: epochSeconds(now) });
}
```

`packages/auth-core/src/recovery-codes.ts`:

```ts
import { createHash } from 'node:crypto';
import type { RandomSource } from './random';

export const RECOVERY_CODE_COUNT = 10;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const NORMALISED = /^[0-9A-HJKMNP-TV-Z]{16}$/;

function encode(bytes: Buffer): string {
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < 16; i += 1) out += CROCKFORD[parseInt(bits.slice(i * 5, i * 5 + 5), 2)];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12)}`;
}

/** 10 single-use codes, 80 random bits each, shown once (section 8). */
export function generateRecoveryCodes(random: RandomSource, count = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(encode(random.bytes(10)));
  return [...codes];
}

/** Accepts lower case, spaces and dashes; Crockford aliases I/L → 1 and O → 0. */
export function normalizeRecoveryCode(input: string): string | null {
  const normalised = input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  return NORMALISED.test(normalised) ? normalised : null;
}

/** Codes carry 80 bits and are rate-limited and single-use, so a domain-separated sha256 suffices. */
export function hashRecoveryCode(normalized: string): string {
  return createHash('sha256').update(`tms-recovery:${normalized}`, 'utf8').digest('hex');
}
```

`index.ts` adds `export * from './totp';` and `export * from './recovery-codes';`.

- [ ] **Step 4: Run the tests and verify**

Run: `pnpm turbo run test --filter=@tms/auth-core && pnpm verify`
Expected: 5 RFC vectors, secret/URI, 3 accepted and 2 rejected offsets, replay, 5 malformed codes, recovery-code tests — all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/auth-core pnpm-workspace.yaml pnpm-lock.yaml docs/efficiency/auth-core.md
git commit -m "feat(auth-core): add TOTP with a replay guard and single-use recovery codes"
```

PR body: diagram `sequenceDiagram` (verify with `afterTimeStep` → step returned → caller stores it); boundaries: `@tms/auth-core` public API; no migration; reviewer: `security-reviewer` (window, replay, code entropy).
