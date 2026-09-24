# Phase 2 — Task 08: contracts — error envelope, route-access keys, auth DTOs, permissions, audit actions

> Part of the phase 2 plan: read [index.md](index.md) (constraints, shared interfaces, env) and this file only.


**Files:**
- Create: `packages/contracts/src/errors.ts`, `packages/contracts/src/auth/schemas.ts`, `packages/contracts/src/auth/index.ts`
- Modify: `packages/contracts/src/routing.ts` (phase 1, holds `PUBLIC_ROUTE_KEY`), `packages/contracts/src/permissions.ts`, `packages/contracts/src/audit/auth.ts`, `packages/contracts/src/audit/admin.ts`, `packages/contracts/src/security/scrub.ts`, `packages/contracts/src/index.ts`
- Create: `packages/contracts/test/errors.test.ts`, `packages/contracts/test/auth-schemas.test.ts`
- Modify (phase 1 Task 03 files): `packages/contracts/test/permissions.test.ts`, `packages/contracts/test/audit.test.ts`, `packages/contracts/test/scrub.test.ts`
- Create: `docs/adr/0009-api-error-envelope.md`; Modify: `docs/adr/README.md`

**Interfaces:**
- Consumes: phase 1 `EmailSchema` (`common.ts`), `SessionScopeSchema` (zod) and `SessionScope` (type) from `enums.ts`, `PERMISSIONS` and its `staff()` helper, `SEEDED_ROLES`/`resolveRolePermissions`, `AUTH_AUDIT_ACTIONS`/`ADMIN_AUDIT_ACTIONS` (action → `z.strictObject` metadata, merged into `AUDIT_ACTIONS`), `LoginFailureReasonSchema`, `parseAuditMetadata`, `SENSITIVE_KEY_TOKENS`/`isSensitiveKey` (whole-word matching).
- Produces: `API_ERROR_CODES`, `ApiErrorCode`, `ApiErrorSchema`, `ApiFieldError`, `DomainError`, `isDomainError`; `SESSION_SCOPES_KEY`, `REQUIRED_PERMISSIONS_KEY`, `STEP_UP_KEY`, `AUTH_THROTTLE_KEY`; the auth DTO schemas (requests and the responses `SessionStateResponseSchema`, `RecoveryCodesResponseSchema`, `TotpEnrollmentResponseSchema`, `ActionTokenIssuedResponseSchema` `{ expiresAt }`, `UnblockUserResponseSchema` `{ status }`) and `SESSION_NEXT_STEPS`; permission codes `users:deactivate`, `users:assign-role` (catalogue 33 → 35); the canonical phase 2 audit catalogue of Step 3 (5 new actions, 50 → 55; phase 1 keys keep their names and get extended, all-optional schemas) with `MfaFailureSchema`/`MfaFailure`, `TokenFailureSchema`/`TokenFailure`, `AdminFailureSchema`/`AdminFailure` and the extended `LoginFailureReasonSchema`; the sensitive word `otpauth`. All exported from the package root. Every later task uses exactly these action names and metadata keys.

- [ ] **Step 1: Write the failing tests**

`packages/contracts/test/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { API_ERROR_CODES, ApiErrorSchema, DomainError, isDomainError } from '../src/index.js';

describe('API error envelope', () => {
  it('maps every code to an HTTP error status', () => {
    for (const [code, status] of Object.entries(API_ERROR_CODES)) {
      expect(status, code).toBeGreaterThanOrEqual(400);
      expect(status, code).toBeLessThan(600);
    }
  });

  it('pins the statuses the clients depend on', () => {
    expect(API_ERROR_CODES).toMatchObject({
      VALIDATION_FAILED: 422,
      CONFLICT: 409,
      REFERENCE_CONFLICT: 409,
      UNAUTHENTICATED: 401,
      FORBIDDEN: 403,
      ORIGIN_REJECTED: 403,
      ROUTE_NOT_DECLARED: 403,
      RATE_LIMITED: 429,
      REQUEST_REJECTED: 400,
      AUTH_INVALID_CREDENTIALS: 401,
      AUTH_ACCOUNT_LOCKED: 423,
      AUTH_MFA_RESET_PENDING: 403,
      AUTH_TOKEN_INVALID: 400,
      AUTH_STEP_UP_REQUIRED: 403,
      LAST_ADMIN: 409,
      INTERNAL: 500,
    });
  });

  it('lets the generic REQUEST_REJECTED code carry any 4xx status', () => {
    expect(
      ApiErrorSchema.safeParse({ statusCode: 405, code: 'REQUEST_REJECTED', message: 'Method Not Allowed' })
        .success,
    ).toBe(true);
  });

  it('parses a validation envelope and rejects unknown codes and keys', () => {
    const ok = ApiErrorSchema.safeParse({
      statusCode: 422,
      code: 'VALIDATION_FAILED',
      message: 'Validation failed',
      fields: [{ path: 'password', code: 'PASSWORD_TOO_WEAK', message: 'Password is too weak' }],
    });
    expect(ok.success).toBe(true);
    expect(ApiErrorSchema.safeParse({ statusCode: 400, code: 'NOPE', message: 'x' }).success).toBe(false);
    expect(
      ApiErrorSchema.safeParse({ statusCode: 500, code: 'INTERNAL', message: 'x', stack: 'at' }).success,
    ).toBe(false);
  });

  it('recognises domain errors by brand, not by class identity', () => {
    const err = new DomainError('AUTH_ACCOUNT_LOCKED', 'Account locked', { retryAfterSeconds: 60 });
    expect(err.statusCode).toBe(423);
    expect(isDomainError(err)).toBe(true);
    expect(isDomainError({ isDomainError: true, code: 'AUTH_ACCOUNT_LOCKED', message: 'x' })).toBe(true);
    expect(isDomainError({ isDomainError: true, code: 'NOPE' })).toBe(false);
    expect(isDomainError(new Error('x'))).toBe(false);
  });
});
```

`packages/contracts/test/auth-schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  AcceptInviteRequestSchema,
  ChangeRoleRequestSchema,
  LoginRequestSchema,
  MfaRequestSchema,
  RecoveryCodesResponseSchema,
  SessionStateResponseSchema,
  UnblockUserResponseSchema,
} from '../src/index.js';

const token = 'A'.repeat(43);

describe('auth DTO schemas', () => {
  it('normalises the login email and bounds the password length', () => {
    const parsed = LoginRequestSchema.parse({ email: '  Ada@Example.COM ', password: 'x' });
    expect(parsed.email).toBe('ada@example.com');
    expect(LoginRequestSchema.safeParse({ email: 'a@b.co', password: 'x'.repeat(129) }).success).toBe(false);
    expect(LoginRequestSchema.safeParse({ email: 'a@b.co', password: 'x', extra: 1 }).success).toBe(false);
  });

  it('accepts exactly one second factor', () => {
    expect(MfaRequestSchema.safeParse({ code: '123456' }).success).toBe(true);
    expect(MfaRequestSchema.safeParse({ recoveryCode: 'ABCD-EFGH-JKMN-PQRS' }).success).toBe(true);
    expect(MfaRequestSchema.safeParse({ code: '12345' }).success).toBe(false);
    expect(MfaRequestSchema.safeParse({ code: '123456', recoveryCode: 'ABCD-EFGH-JKMN-PQRS' }).success).toBe(false);
  });

  it('accepts only 32-byte base64url tokens', () => {
    expect(AcceptInviteRequestSchema.safeParse({ token }).success).toBe(true);
    expect(AcceptInviteRequestSchema.safeParse({ token: `${token}=` }).success).toBe(false);
    expect(AcceptInviteRequestSchema.safeParse({ token: token.slice(1) }).success).toBe(false);
  });

  it('describes recovery codes and session state', () => {
    const codes = Array.from({ length: 10 }, () => 'ABCD-EFGH-JKMN-PQRS');
    expect(RecoveryCodesResponseSchema.safeParse({ recoveryCodes: codes }).success).toBe(true);
    expect(RecoveryCodesResponseSchema.safeParse({ recoveryCodes: codes.slice(1) }).success).toBe(false);
    expect(
      SessionStateResponseSchema.safeParse({
        scope: 'ENROLLMENT',
        next: 'ENROLL_TOTP',
        user: { id: '0190a0b0-0000-7000-8000-000000000000', email: 'a@b.co', firstName: 'A', lastName: 'B' },
      }).success,
    ).toBe(true);
    expect(ChangeRoleRequestSchema.safeParse({ roleId: 'admin' }).success).toBe(false);
    expect(UnblockUserResponseSchema.safeParse({ status: 'INVITED' }).success).toBe(true);
    expect(UnblockUserResponseSchema.safeParse({ status: 'BLOCKED' }).success).toBe(false);
  });
});
```

In the phase 1 permissions test (`packages/contracts/test/permissions.test.ts`), change the catalogue test to `it('is a valid catalogue of 35 codes covering the 13 groups', …)` with `expect(PERMISSIONS).toHaveLength(35)`, change `expect(permissionCodesForAudience('STAFF')).toHaveLength(32)` to `toHaveLength(34)`, add `import { resolveRolePermissions, SEEDED_ROLES } from '../src/roles.js';` and append to `describe('PERMISSIONS')`:

```ts
it('has dedicated codes for deactivation and role assignment (phase 2)', () => {
  const byCode = new Map<string, PermissionDefinition>(PERMISSIONS.map((p) => [p.code, p]));
  for (const code of ['users:deactivate', 'users:assign-role']) {
    expect(byCode.get(code), code).toMatchObject({ group: 'users', audience: 'STAFF' });
  }
  expect(byCode.get('users:block')?.defaultDescription).toBe('Block and unblock users.');
  const admin = SEEDED_ROLES.find((r) => r.key === 'admin');
  const operator = SEEDED_ROLES.find((r) => r.key === 'operator');
  expect(resolveRolePermissions(admin!)).toEqual(expect.arrayContaining(['users:deactivate', 'users:assign-role']));
  expect(resolveRolePermissions(operator!)).not.toContain('users:assign-role');
});
```

In the phase 1 audit test (`packages/contracts/test/audit.test.ts`), change `expect(AUDIT_ACTION_NAMES).toHaveLength(50)` to `toHaveLength(55)` (5 new actions) and append (no phase 1 fixture breaks: `auth.login.failure { method, reason }` and `admin.user.role-changed { fromRoleId: 'role-a', toRoleId: 'role-b' }` stay valid):

```ts
describe('phase 2 auth and admin metadata (Task 08)', () => {
  it('adds five actions and accepts {} wherever every field is optional', () => {
    for (const action of [
      'auth.enrollment.completed',
      'auth.password.changed',
      'auth.recovery-codes.regenerated',
      'auth.mfa-reset.accepted',
      'admin.user.password-reset-sent',
    ]) {
      expect(AUDIT_ACTIONS, action).toHaveProperty(action);
    }
    for (const action of [
      'auth.invite.issued',
      'auth.invite.resent',
      'auth.invite.accepted',
      'auth.password.set',
      'auth.totp.enrolled',
      'auth.totp.verified',
      'auth.mfa.reset',
      'auth.password-reset.requested',
      'auth.password-reset.completed',
      'auth.password.changed',
      'auth.recovery-codes.regenerated',
      'auth.mfa-reset.accepted',
      'admin.user.blocked',
      'admin.user.unblocked',
      'admin.user.deactivated',
      'admin.user.unlocked',
      'admin.user.password-reset-sent',
    ] as const) {
      expect(parseAuditMetadata(action, {}), action).toEqual({});
    }
  });

  it('extends the login failure reasons and adds the optional lockout level', () => {
    for (const reason of ['UNKNOWN_ACCOUNT', 'NOT_STAFF', 'MFA_RESET_PENDING'] as const) {
      expect(parseAuditMetadata('auth.login.failure', { method: 'PASSWORD', reason })).toEqual({
        method: 'PASSWORD',
        reason,
      });
    }
    const lock = { failedAttempts: 5, lockedUntil: '2026-09-23T10:15:00.000Z' };
    expect(parseAuditMetadata('auth.lockout.applied', lock)).toEqual(lock);
    expect(parseAuditMetadata('auth.lockout.applied', { ...lock, level: 2 })).toEqual({ ...lock, level: 2 });
    expect(() => parseAuditMetadata('auth.lockout.applied', { ...lock, level: 0 })).toThrow(/level: Too small/);
  });

  it('writes FAILURE rows without expiresAt and counts revoked links, never tokens', () => {
    expect(parseAuditMetadata('auth.invite.issued', { via: 'ADMIN' })).toEqual({ via: 'ADMIN' });
    expect(parseAuditMetadata('admin.user.blocked', { sessionsRevoked: 2, linksRevoked: 1 })).toEqual({
      sessionsRevoked: 2,
      linksRevoked: 1,
    });
    expect(() => parseAuditMetadata('admin.user.blocked', { tokensRevoked: 1 })).toThrow(
      /Unrecognized key: "tokensRevoked"/,
    );
    expect(isSensitiveKey('tokensRevoked')).toBe(true);
    expect(isSensitiveKey('linksRevoked')).toBe(false);
  });

  it('keeps the role ids required, the flow required and every reason a closed enum', () => {
    expect(() => parseAuditMetadata('admin.user.role-changed', { toRoleId: 'role-b' })).toThrow(
      /fromRoleId: Invalid input/,
    );
    expect(
      parseAuditMetadata('admin.user.role-changed', { fromRoleId: 'role-a', toRoleId: 'role-b', reason: 'LAST_ADMIN' }),
    ).toEqual({ fromRoleId: 'role-a', toRoleId: 'role-b', reason: 'LAST_ADMIN' });
    expect(parseAuditMetadata('auth.mfa.reset', { via: 'CLI', sessionsRevoked: 1, linksRevoked: 0 })).toEqual({
      via: 'CLI',
      sessionsRevoked: 1,
      linksRevoked: 0,
    });
    expect(
      parseAuditMetadata('auth.password-reset.completed', { sessionsRevoked: 3, mfaResetReissued: true }),
    ).toEqual({ sessionsRevoked: 3, mfaResetReissued: true });
    expect(() => parseAuditMetadata('auth.enrollment.completed', {})).toThrow(/flow: Invalid option/);
    expect(() => parseAuditMetadata('auth.totp.verified', { reason: 'BAD_CODE' })).toThrow(/reason: Invalid option/);
  });
});
```

In the phase 1 scrub test (`packages/contracts/test/scrub.test.ts`), inside `describe('isSensitiveKey')` (`secret`, `totpSecret` and `totpPendingSecretEnc` are already sensitive through phase 1's whole words `secret` and `totp`):

```ts
it.each(['otpauthUri', 'otpauth_uri', 'OtpauthURI'])('matches the TOTP enrollment URI key %s (phase 2)', (key) => {
  expect(isSensitiveKey(key)).toBe(true);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm turbo run test --filter=@tms/contracts`
Expected: FAIL — `errors.test.ts` and `auth-schemas.test.ts` cannot import the new names; `permissions.test.ts`: the 35/34 counts and the phase 2 test fail (33/32, no `users:deactivate`); `audit.test.ts`: `toHaveLength(55)` receives 50 and the four phase 2 tests fail (unknown actions, unrecognized keys `via`/`linksRevoked`/`level`, `UNKNOWN_ACCOUNT` is an invalid option); `scrub.test.ts`: the three `otpauth` keys are not sensitive. Every other phase 1 test stays green.

While the catalogue is still phase 1's, prepare the throwaway database for Step 5 (migrate deploy, drift check, sync, seed of the Admin, Operator and Driver roles): `pnpm turbo run build --filter=@tms/db && DATABASE_URL=postgresql://tms:tms@localhost:56432/tms BOOTSTRAP_ADMIN_EMAIL=admin@example.com node packages/db/dist/cli/dev-setup.js`
Expected: a `permissions.synced` line, then `seed.applied` with `"bootstrapAdmin":"created"` (`"exists"` on a rerun); exit 0.

- [ ] **Step 3: Implement**

`packages/contracts/src/errors.ts`:

```ts
import { z } from 'zod';

/** Stable machine codes of the API error envelope and their HTTP status (ADR 0009). */
export const API_ERROR_CODES = {
  VALIDATION_FAILED: 422,
  CONFLICT: 409,
  REFERENCE_CONFLICT: 409,
  NOT_FOUND: 404,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  ORIGIN_REJECTED: 403,
  ROUTE_NOT_DECLARED: 403,
  RATE_LIMITED: 429,
  /** Any other 4xx (405, 406, 431, ...): the envelope keeps the original status, this is only the nominal one. */
  REQUEST_REJECTED: 400,
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_ACCOUNT_LOCKED: 423,
  AUTH_MFA_RESET_PENDING: 403,
  AUTH_INVALID_MFA_CODE: 401,
  AUTH_MFA_ATTEMPTS_EXHAUSTED: 401,
  AUTH_TOKEN_INVALID: 400,
  AUTH_STEP_UP_REQUIRED: 403,
  USER_STATE_CONFLICT: 409,
  LAST_ADMIN: 409,
  SELF_ACTION_FORBIDDEN: 403,
  ROLE_KIND_MISMATCH: 422,
  INTERNAL: 500,
} as const satisfies Record<string, number>;

export type ApiErrorCode = keyof typeof API_ERROR_CODES;

const codes = Object.keys(API_ERROR_CODES) as [ApiErrorCode, ...ApiErrorCode[]];

export const ApiFieldErrorSchema = z.strictObject({
  path: z.string(),
  code: z.string(),
  message: z.string(),
});
export type ApiFieldError = z.infer<typeof ApiFieldErrorSchema>;

export const ApiErrorSchema = z.strictObject({
  statusCode: z.number().int().min(400).max(599),
  code: z.enum(codes),
  message: z.string(),
  fields: z.array(ApiFieldErrorSchema).optional(),
  retryAfterSeconds: z.number().int().positive().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export interface DomainErrorDetails {
  fields?: ApiFieldError[];
  retryAfterSeconds?: number;
}

/**
 * Typed business error thrown by services and mapped to the envelope by the API filter.
 * Recognised with `isDomainError` (a brand), never `instanceof`, so a second copy of this
 * package in a process cannot break the mapping.
 */
export class DomainError extends Error {
  readonly isDomainError = true as const;

  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details: DomainErrorDetails = {},
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'DomainError';
  }

  get statusCode(): number {
    return API_ERROR_CODES[this.code];
  }
}

export function isDomainError(value: unknown): value is DomainError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { isDomainError?: unknown; code?: unknown };
  return (
    candidate.isDomainError === true &&
    typeof candidate.code === 'string' &&
    Object.hasOwn(API_ERROR_CODES, candidate.code)
  );
}
```

In `packages/contracts/src/routing.ts` (next to `PUBLIC_ROUTE_KEY`; the package root already re-exports `./routing.js`):

```ts
/** Metadata keys of the route-access markers (ADR 0010). Plain strings so every package can read them. */
export const SESSION_SCOPES_KEY = 'tms:session-scopes';
export const REQUIRED_PERMISSIONS_KEY = 'tms:required-permissions';
export const STEP_UP_KEY = 'tms:step-up';
export const AUTH_THROTTLE_KEY = 'tms:auth-throttle';
```

`packages/contracts/src/auth/schemas.ts`:

```ts
import { z } from 'zod';
import { EmailSchema } from '../common.js';
import { SessionScopeSchema } from '../enums.js';

const Password = z.string().min(1).max(128);
const TotpCode = z.string().regex(/^\d{6}$/);
/** 32 random bytes, base64url without padding. */
const RawToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const RecoveryCode = z.string().min(16).max(32);
const CROCKFORD_GROUP = '[0-9A-HJKMNP-TV-Z]{4}';

export const LoginRequestSchema = z.strictObject({ email: EmailSchema, password: Password });
export const MfaRequestSchema = z.union([
  z.strictObject({ code: TotpCode }),
  z.strictObject({ recoveryCode: RecoveryCode }),
]);
export const AcceptInviteRequestSchema = z.strictObject({ token: RawToken });
export const SetPasswordRequestSchema = z.strictObject({ password: Password });
export const TotpEnrollmentResponseSchema = z.strictObject({
  otpauthUri: z.string().startsWith('otpauth://totp/'),
  secret: z.string().regex(/^[A-Z2-7]+=*$/),
});
export const TotpConfirmRequestSchema = z.strictObject({ code: TotpCode });
export const RecoveryCodesResponseSchema = z.strictObject({
  recoveryCodes: z
    .array(z.string().regex(new RegExp(`^${CROCKFORD_GROUP}(-${CROCKFORD_GROUP}){3}$`)))
    .length(10),
});
export const SESSION_NEXT_STEPS = ['SET_PASSWORD', 'ENROLL_TOTP', 'VERIFY_MFA', 'NONE'] as const;
export const SessionStateResponseSchema = z.strictObject({
  scope: SessionScopeSchema,
  next: z.enum(SESSION_NEXT_STEPS),
  user: z.strictObject({
    id: z.uuid(),
    email: z.email(),
    firstName: z.string(),
    lastName: z.string(),
  }),
});
export const ForgotPasswordRequestSchema = z.strictObject({ email: EmailSchema });
export const ResetPasswordRequestSchema = z.strictObject({ token: RawToken, password: Password });
export const ChangePasswordRequestSchema = z.strictObject({
  currentPassword: Password,
  newPassword: Password,
});
export const StepUpRequestSchema = z.strictObject({ code: TotpCode });
export const AcceptMfaResetRequestSchema = z.strictObject({ token: RawToken, password: Password });
export const ChangeRoleRequestSchema = z.strictObject({ roleId: z.uuid() });
export const UserIdParamSchema = z.strictObject({ id: z.uuid() });
/** 202 body of admin actions that mail a single-use link (the link itself never travels over HTTP). */
export const ActionTokenIssuedResponseSchema = z.strictObject({ expiresAt: z.iso.datetime() });
/** Unblock returns INVITED when the user never enrolled TOTP (Task 20). */
export const UnblockUserResponseSchema = z.strictObject({ status: z.enum(['ACTIVE', 'INVITED']) });

export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type MfaRequest = z.infer<typeof MfaRequestSchema>;
export type SessionStateResponse = z.infer<typeof SessionStateResponseSchema>;
export type SessionNextStep = (typeof SESSION_NEXT_STEPS)[number];
export type ActionTokenIssuedResponse = z.infer<typeof ActionTokenIssuedResponseSchema>;
export type UnblockUserResponse = z.infer<typeof UnblockUserResponseSchema>;
```

`packages/contracts/src/auth/index.ts`: `export * from './schemas.js';`. In `packages/contracts/src/index.ts` add `export * from './errors.js';` and `export * from './auth/index.js';`.

In `packages/contracts/src/permissions.ts`, change the `users:block` description (it no longer covers deactivation) and add the two codes right after `users:reset-mfa`, with phase 1's `staff()` helper:

```ts
  staff('users:block', 'Block users', 'Block and unblock users.'),
  // ... users:unlock, users:invite, users:reset-mfa unchanged ...
  staff('users:deactivate', 'Deactivate users', 'Permanently deactivate a user account (terminal, no undo).'),
  staff('users:assign-role', 'Assign roles to users', 'Change a user’s role. Requires a recent TOTP confirmation.'),
```

The Admin role (`ALL_FOR_AUDIENCE`, permissions locked) picks both up through the sync; Operator's explicit list is unchanged (phase 1's `roles.test.ts` keeps its 15 codes).

**Canonical audit catalogue (phase 2).** Phase 1 already defines most auth and admin actions with empty schemas; this task keeps every phase 1 key and **replaces its schema** with the extended one below. Every added field is optional, so phase 1's fixtures and parses of `{}` stay valid; five actions are new. Tasks 11–22 use exactly these names and keys:

| Event (phase 2) | Action | Metadata |
|---|---|---|
| password step ok / refused | `auth.login.success` / `auth.login.failure` | `{ method: 'PASSWORD' }` / `{ method: 'PASSWORD', reason }` |
| MFA step ok / refused | `auth.login.success` / `auth.login.failure` | `{ method: 'TOTP' \| 'RECOVERY_CODE' }` / `+ reason` |
| lockout applied | `auth.lockout.applied` | `{ failedAttempts, lockedUntil, level? }` |
| logout | `auth.session.revoked` | `{ reason: 'LOGOUT', sessionCount: 1 }` |
| invite issued (admin, bootstrap CLI) | `auth.invite.issued` | `{ via?, expiresAt?, reason? }` — no `expiresAt` on FAILURE rows |
| invite resent | `auth.invite.resent` | `{ expiresAt?, reason? }` |
| invite accepted | `auth.invite.accepted` | `{ reason? }` |
| password set during enrollment | `auth.password.set` | `{ reason? }` |
| TOTP enrolled | `auth.totp.enrolled` | `{ reason? }` (`MfaFailure`) |
| enrollment finished (**new**) | `auth.enrollment.completed` | `{ flow: 'INVITE' \| 'MFA_RESET' }` |
| forgot password | `auth.password-reset.requested` | `{ knownAccount? }` |
| password reset | `auth.password-reset.completed` | `{ sessionsRevoked?, mfaResetReissued?, reason? }` |
| password change (**new**) | `auth.password.changed` | `{ sessionsRevoked?, reason? }` |
| step-up (TOTP check outside login) | `auth.totp.verified` | `{ reason? }` (`MfaFailure`) |
| recovery codes regenerated (**new**) | `auth.recovery-codes.regenerated` | `{}` |
| 2FA reset issued (admin or CLI) | `auth.mfa.reset` | `{ via?, sessionsRevoked?, linksRevoked?, reason? }` (`AdminFailure`) |
| 2FA reset link accepted (**new**) | `auth.mfa-reset.accepted` | `{ reason? }` |
| block / deactivate | `admin.user.blocked` / `admin.user.deactivated` | `{ sessionsRevoked?, linksRevoked?, reason? }` |
| unblock | `admin.user.unblocked` | `{ status?, reason? }` |
| unlock | `admin.user.unlocked` | `{ reason? }` |
| role change | `admin.user.role-changed` | `{ fromRoleId, toRoleId, sessionsRevoked?, linksRevoked?, reason? }` — ids stay required (phase 1); a missing user is a 404 without an audit row |
| admin sends a password reset (**new**) | `admin.user.password-reset-sent` | `{ reason? }` |

`reason` is set only on FAILURE rows. Revoked single-use links are counted as `linksRevoked`, never `tokensRevoked`: `tokens` is a sensitive word, so phase 1's "no sensitive key anywhere in any schema" test would fail. Token flows target the `ActionToken` row where phase 1 says so; token ids never go into metadata.

`packages/contracts/src/audit/admin.ts` — add the admin refusal reasons and replace these five entries; add the new one after `admin.user.role-changed` (every other entry unchanged):

```ts
/** Refusals of an admin action on a user (Tasks 20–22). */
export const AdminFailureSchema = z.enum(['LAST_ADMIN', 'SELF_ACTION', 'STATE_CONFLICT', 'ROLE_KIND_MISMATCH']);
export type AdminFailure = z.infer<typeof AdminFailureSchema>;

/** What an admin action ended. `linksRevoked`, not `tokensRevoked`: `tokens` is a sensitive word. */
const revoked = { sessionsRevoked: count.optional(), linksRevoked: count.optional() };
const refusal = { reason: AdminFailureSchema.optional() };

  'admin.user.blocked': z.strictObject({ ...revoked, ...refusal }),
  'admin.user.unblocked': z.strictObject({ status: z.enum(['ACTIVE', 'INVITED']).optional(), ...refusal }),
  'admin.user.deactivated': z.strictObject({ ...revoked, ...refusal }),
  'admin.user.unlocked': z.strictObject({ ...refusal }),
  'admin.user.role-changed': z.strictObject({ fromRoleId: id, toRoleId: id, ...revoked, ...refusal }),
  'admin.user.password-reset-sent': z.strictObject({ ...refusal }),
```

`packages/contracts/src/audit/auth.ts` — whole file (`LoginMethodSchema`, `SessionRevocationReasonSchema`, `auth.login.success`, `auth.login.failure` and `auth.session.revoked` are phase 1's, unchanged):

```ts
import { z } from 'zod';
import { AdminFailureSchema } from './admin.js';

const empty = z.strictObject({});
const count = z.number().int().nonnegative();
const at = z.iso.datetime();

export const LoginMethodSchema = z.enum(['PASSWORD', 'TOTP', 'RECOVERY_CODE']);
export type LoginMethod = z.infer<typeof LoginMethodSchema>;

export const LoginFailureReasonSchema = z.enum([
  'INVALID_CREDENTIALS',
  'INVALID_CODE',
  'CODE_REPLAYED',
  'ACCOUNT_LOCKED',
  'ACCOUNT_NOT_ACTIVE',
  'TOO_MANY_MFA_ATTEMPTS',
  // phase 2, password step (Task 16)
  'UNKNOWN_ACCOUNT',
  'NOT_STAFF',
  'MFA_RESET_PENDING',
]);
export type LoginFailureReason = z.infer<typeof LoginFailureReasonSchema>;

/** A TOTP check outside login: enrollment confirmation (Task 14) and step-up (Task 19). */
export const MfaFailureSchema = z.enum(['INVALID_CODE', 'CODE_REPLAYED', 'TOO_MANY_MFA_ATTEMPTS', 'ACCOUNT_LOCKED']);
export type MfaFailure = z.infer<typeof MfaFailureSchema>;

/** Single-use link and password flows: invite, enrollment password, reset, change, 2FA reset accept. */
export const TokenFailureSchema = z.enum(['INVALID_TOKEN', 'WEAK_PASSWORD', 'INVALID_CREDENTIALS', 'ACCOUNT_LOCKED']);
export type TokenFailure = z.infer<typeof TokenFailureSchema>;

export const SessionRevocationReasonSchema = z.enum([
  'LOGOUT',
  'BLOCKED',
  'DEACTIVATED',
  'PASSWORD_CHANGED',
  'ROLE_CHANGED',
  'MFA_RESET',
  'EXPIRED',
]);
export type SessionRevocationReason = z.infer<typeof SessionRevocationReasonSchema>;

const tokenRefusal = { reason: TokenFailureSchema.optional() };
const mfaRefusal = { reason: MfaFailureSchema.optional() };

/**
 * Spec section 8, staff authentication. The target is the User; token flows target the
 * ActionToken row instead of carrying its id in metadata (`token` is a sensitive key).
 * `reason` is set only on FAILURE rows.
 */
export const AUTH_AUDIT_ACTIONS = {
  'auth.invite.issued': z.strictObject({
    via: z.enum(['ADMIN', 'BOOTSTRAP']).optional(),
    expiresAt: at.optional(), // omitted on FAILURE rows
    ...tokenRefusal,
  }),
  'auth.invite.accepted': z.strictObject({ ...tokenRefusal }),
  'auth.invite.resent': z.strictObject({ expiresAt: at.optional(), ...tokenRefusal }),
  'auth.password.set': z.strictObject({ ...tokenRefusal }),
  'auth.totp.enrolled': z.strictObject({ ...mfaRefusal }),
  /** Step-up: a TOTP check outside login. */
  'auth.totp.verified': z.strictObject({ ...mfaRefusal }),
  'auth.login.success': z.strictObject({ method: LoginMethodSchema }),
  'auth.login.failure': z.strictObject({
    method: LoginMethodSchema,
    reason: LoginFailureReasonSchema,
  }),
  'auth.lockout.applied': z.strictObject({
    failedAttempts: z.number().int().min(1),
    lockedUntil: at,
    /** Consecutive lockouts (`User.lockoutLevel`, Task 16), 1-based. */
    level: z.number().int().positive().optional(),
  }),
  'auth.session.revoked': z.strictObject({
    reason: SessionRevocationReasonSchema,
    sessionCount: count,
  }),
  'auth.mfa.reset': z.strictObject({
    via: z.enum(['ADMIN', 'CLI']).optional(),
    sessionsRevoked: count.optional(),
    linksRevoked: count.optional(),
    reason: AdminFailureSchema.optional(),
  }),
  'auth.password-reset.requested': z.strictObject({ knownAccount: z.boolean().optional() }),
  'auth.password-reset.completed': z.strictObject({
    sessionsRevoked: count.optional(),
    /** A pending 2FA reset got a fresh MFA_RESET link (Task 22, D2). */
    mfaResetReissued: z.boolean().optional(),
    ...tokenRefusal,
  }),
  // phase 2
  'auth.enrollment.completed': z.strictObject({ flow: z.enum(['INVITE', 'MFA_RESET']) }),
  'auth.password.changed': z.strictObject({ sessionsRevoked: count.optional(), ...tokenRefusal }),
  'auth.recovery-codes.regenerated': empty,
  'auth.mfa-reset.accepted': z.strictObject({ ...tokenRefusal }),
} as const;
```

(`auth.ts` importing `admin.ts` is one-way; `audit/index.ts` is unchanged and still spreads both maps into `AUDIT_ACTIONS`.) Phase 1's "strict object and no sensitive key anywhere in any schema" test covers every new key (`via`, `expiresAt`, `reason`, `flow`, `knownAccount`, `sessionsRevoked`, `mfaResetReissued`, `linksRevoked`, `level`, `status`).

In `packages/contracts/src/security/scrub.ts`, add the whole word `'otpauth'` to `SENSITIVE_KEY_TOKENS` (after `'otp'`), so `otpauthUri` (`['otpauth', 'uri']`) is redacted. Nothing else changes: `secret`, `secrets`, `totp` and `otp` are already whole words in phase 1, matching stays whole-word (never substrings), and the over-redaction of `totpKeyId`/`totpEnabledAt` through `totp` is phase 1's accepted risk.

`docs/adr/0009-api-error-envelope.md` (template `0000-template.md`): context (section 12 asks for 422 with fields and 409 with the field; the SPA maps errors to i18n keys; Nest's default body has `message: string | string[]`); decision (`{ statusCode, code, message, fields?, retryAfterSeconds? }`, `code` from `API_ERROR_CODES`, services throw `DomainError`, one global filter, a Prisma unique violation (P2002) → `CONFLICT` with the constraint's fields, a foreign-key RESTRICT (P2003, e.g. deleting a role that users still hold, phase 3b) → `REFERENCE_CONFLICT` without details, a Nest HTTP exception with an unlisted 4xx status keeps that status under the generic code `REQUEST_REJECTED`, unknown errors → `INTERNAL` without details); alternatives (RFC 9457 problem+json, Nest default + code) with the reason they were not chosen; consequences (the FE `code → i18n key` map is exhaustive by type; adding a code is a contracts change). Add `0009 API error envelope` to the `Accepted:` sentence of `docs/adr/README.md` (the index is prose: `Accepted: … Planned: …`).

- [ ] **Step 4: Run the tests**

Run: `pnpm turbo run test --filter=@tms/contracts && pnpm turbo run lint --filter=@tms/contracts && pnpm turbo run typecheck --filter=@tms/contracts`
Expected: all contracts tests pass, including phase 1's catalogue invariants (`validateCatalogue` returns `[]` for the 35 codes), `AUDIT_ACTION_NAMES` of length 55, "strict object and no sensitive key anywhere in any schema" over the extended schemas, and the fast-check scrub property.

- [ ] **Step 5: Sync check against a database**

Against the database prepared in Step 2 (phase 1's 33 codes and seeded roles):

Run: `pnpm turbo run build --filter=@tms/db && DATABASE_URL=postgresql://tms:tms@localhost:56432/tms node packages/db/dist/cli/sync-permissions.js | tail -n 1`
Expected: one JSON line `{"event":"permissions.synced","inserted":["users:deactivate","users:assign-role"],"regrouped":[],"reactivated":[],"renamed":[],"lockedRoleGrants":[{"roleKey":"admin","added":["users:assign-role","users:deactivate"],"removed":[]}],"deprecated":[],"deleted":[]}` — the locked Admin role gains both codes, Operator (not locked) gains nothing (`inserted` follows catalogue order, `added` is sorted). Run it again: every list is empty.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts docs/adr/0009-api-error-envelope.md docs/adr/README.md docs/efficiency/critical-path.md
git commit -m "feat(contracts): add the error envelope, route-access keys, auth schemas and audit actions"
```

PR body: diagram `classDiagram` (DomainError → envelope → HTTP status); boundaries: `@tms/contracts` public API (new exports), no migration; verification: test counts and sync output; reviewer: `security-reviewer` (permission catalogue, scrub list).
