# Phase 2 — Task 14: Enrollment — password, TOTP, recovery codes, ACTIVE + FULL

> Part of the phase 2 plan: read [index.md](index.md) (constraints, shared interfaces, env) and this file only.


**Files:**
- Create: `packages/domain/src/admin/auth/enrollment/enrollment.service.ts`, `packages/domain/src/admin/auth/credentials.ts` (password policy → field errors, AAD helper)
- Modify: `packages/domain/src/admin/auth/options.ts` (`secrets`, `passwordPepper`, `totpIssuer`), `packages/domain/src/admin/auth/ports.ts` (`SECRET_CIPHER`, `PASSWORD_HASHER`, `TOTP_PROVIDER`), `packages/domain/src/admin/admin-auth.module.ts`, `packages/domain/src/admin/index.ts`
- Create: `apps/api-admin/src/auth/enrollment.controller.ts`; Modify: `apps/api-admin/src/auth/dto.ts`, `apps/api-admin/src/auth/auth-http.module.ts`, `apps/api-admin/src/env.ts`, `apps/api-admin/test/env.spec.ts` (defaults `toEqual` + refinement cases), `apps/api-admin/src/app.module.ts`, `apps/api-admin/.env.example`, `infra/docker-compose.yml`, `.gitleaks.toml`
- Modify: `infra/.env.example`, `apps/api-admin/test/support/fixtures.ts` (`withCredentials`, `totpNow`); Create: `apps/api-admin/test/enrollment.e2e-spec.ts`; Modify: `apps/api-admin/test/route-access.snapshot.json`

**Interfaces:**
- Consumes: `AesGcmSecretCipher`, `parseKeyring`, `Argon2idPasswordHasher`, `checkPassword`, `OtplibTotpProvider`, `generateTotpCode`, `generateRecoveryCodes`, `hashRecoveryCode`, `normalizeRecoveryCode`, `MFA_MAX_ATTEMPTS` (03–06); `SessionService.upgrade`, `recordMfaFailure`, `destroy` (11); `UnitOfWork`, `waitForMail` (12); audit actions `auth.password.set`, `auth.totp.enrolled` (reason `MfaFailure`), `auth.enrollment.completed { flow }` (08); `AppTransactionHost` (phase 1).
- Produces:
  - `EnrollmentService`: `setPassword(principal, password): Promise<void>`, `startTotp(principal): Promise<{ otpauthUri: string; secret: string }>`, `confirmTotp(principal, code): Promise<{ issued: IssuedSession; recoveryCodes: string[] }>`.
  - `totpAad(userId: string): string` (`totp:<userId>`), `passwordFieldErrors(violations): ApiFieldError[]` (codes `PASSWORD_TOO_SHORT`, `PASSWORD_TOO_LONG`, `PASSWORD_TOO_WEAK`), `assertStrongPassword(password, user)` in `credentials.ts`.
  - Tokens `SECRET_CIPHER`, `PASSWORD_HASHER`, `TOTP_PROVIDER` bound in `AdminAuthModule`.
  - Routes (all `@RequireSession('ENROLLMENT')`): `POST /api/auth/enrollment/password` → 204; `POST /api/auth/enrollment/totp` → 200 `TotpEnrollmentResponse`; `POST /api/auth/enrollment/totp/confirm` (`@AuthThrottle`) → 200 `RecoveryCodesResponse` + rotated FULL cookie.
  - Fixtures: `GOOD_PASSWORD`, `withCredentials(app, userId): Promise<{ password: string; totpSecret: string }>`, `totpNow(t, secret, offsetSteps = 0): Promise<string>`.

Rules: `setPassword` only for an INVITED user (an ACTIVE user in a 2FA-reset ENROLLMENT keeps the password verified at accept, Task 22); `startTotp` needs `passwordHash` and stores the secret only in `Session.totpPendingSecretEnc` (encrypted, AAD `totp:<userId>`); `confirmTotp` verifies with `lastUsedStep = null`, and on success first claims the pending secret with one conditional update (`totpPendingSecretEnc IS NOT NULL` → null; count 0 = a parallel confirm already won → 409 `USER_STATE_CONFLICT`), then writes the encrypted secret, `totpKeyId`, `totpEnabledAt`, `totpLastUsedStep = step` (the enrollment code cannot be replayed at login), replaces the recovery codes (10, stored as sha256), sets `status = ACTIVE`, resets `failedLoginCount`, `lockoutLevel`, `lockedUntil`, sets `lastLoginAt`, and upgrades the session to FULL with `mfaVerifiedAt = now`; 5 wrong codes destroy the ENROLLMENT session.

- [ ] **Step 1: Write the failing API tests**

Fixture additions in `apps/api-admin/test/support/fixtures.ts`:

```ts
import { generateTotpCode, type PasswordHasher, type SecretCipher } from '@tms/auth-core';
import { PASSWORD_HASHER, SECRET_CIPHER, totpAad } from '@tms/domain/admin';
import type { AdminTestApp } from './app';

export const GOOD_PASSWORD = 'Correct-Horse-Battery-Staple-42'; // gitleaks:allow (test fixture, not a secret)
const FIXTURE_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

/** Gives an existing user a real password and TOTP secret (bypassing the flows). */
export async function withCredentials(app: INestApplication, userId: string) {
  const hasher = app.get<PasswordHasher>(PASSWORD_HASHER);
  const cipher = app.get<SecretCipher>(SECRET_CIPHER);
  await app.get(PrismaService).user.update({
    where: { id: userId },
    data: {
      passwordHash: await hasher.hash(GOOD_PASSWORD),
      totpSecretEnc: cipher.encrypt(FIXTURE_TOTP_SECRET, totpAad(userId)),
      totpKeyId: cipher.activeKeyId,
      totpEnabledAt: new Date('2026-01-01T00:00:00Z'),
      totpLastUsedStep: null,
    },
  });
  return { password: GOOD_PASSWORD, totpSecret: FIXTURE_TOTP_SECRET };
}

export function totpNow(t: AdminTestApp, secret: string, offsetSteps = 0): Promise<string> {
  return generateTotpCode(secret, new Date(t.clock.now().getTime() + offsetSteps * 30_000));
}
```

`apps/api-admin/test/enrollment.e2e-spec.ts`:

```ts
import request from 'supertest';
import type { PrismaService } from '@tms/db/nest';
import { generateTotpCode, hashRecoveryCode, normalizeRecoveryCode } from '@tms/auth-core';
import { EnrollmentService } from '@tms/domain/admin';
import type { Principal } from '@tms/domain/shared';
import { createAdminTestApp, type AdminTestApp, ORIGIN } from './support/app';
import { createStaffUser, GOOD_PASSWORD, loginAs, seedBase, waitForMail } from './support/fixtures';

describe('enrollment (API)', () => {
  let t: AdminTestApp;
  let prisma: PrismaService;
  let adminCookie: string;
  const http = () => request(t.app.getHttpServer());
  const post = (path: string, cookie: string, body?: object) => http().post(path).set('Origin', ORIGIN).set('Cookie', cookie).send(body ?? {});
  const inviteToken = async (email: string) => /#t=([A-Za-z0-9_-]{43})/.exec((await waitForMail(t.mail, email)).text)![1]!;

  async function acceptedInvite(): Promise<{ userId: string; email: string; cookie: string }> {
    const invited = await createStaffUser(prisma, { status: 'INVITED', enrolled: false });
    await http().post(`/api/users/${invited.id}/invite`).set('Origin', ORIGIN).set('Cookie', adminCookie).expect(202);
    const token = await inviteToken(invited.email!);
    const res = await http().post('/api/auth/invite/accept').set('Origin', ORIGIN).send({ token }).expect(200);
    return { userId: invited.id, email: invited.email!, cookie: res.headers['set-cookie']![0]!.split(';')[0]! };
  }

  beforeAll(async () => { t = await createAdminTestApp(); });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    prisma = await seedBase(t.app);
    t.mail.clear();
    adminCookie = await loginAs(t.app, (await createStaffUser(prisma)).id);
  });

  it('completes password → TOTP → recovery codes → ACTIVE with a rotated FULL cookie', async () => {
    const { userId, cookie } = await acceptedInvite();
    await post('/api/auth/enrollment/password', cookie, { password: GOOD_PASSWORD }).expect(204);
    expect((await http().get('/api/auth/session').set('Cookie', cookie).expect(200)).body.next).toBe('ENROLL_TOTP');

    const start = await post('/api/auth/enrollment/totp', cookie).expect(200);
    expect(start.body.otpauthUri).toMatch(/^otpauth:\/\/totp\/TMS:.+\?.*secret=/);
    const code = await generateTotpCode(start.body.secret, t.clock.now());

    const done = await post('/api/auth/enrollment/totp/confirm', cookie, { code }).expect(200);
    const fullCookie = done.headers['set-cookie']![0]!.split(';')[0]!;
    expect(fullCookie).not.toBe(cookie);
    await http().get('/api/auth/session').set('Cookie', cookie).expect(401);
    expect((await http().get('/api/auth/session').set('Cookie', fullCookie).expect(200)).body).toMatchObject({ scope: 'FULL', next: 'NONE' });

    const codes: string[] = done.body.recoveryCodes;
    expect(new Set(codes).size).toBe(10);
    const stored = await prisma.recoveryCode.findMany({ where: { userId } });
    expect(stored.map((r) => r.codeHash).sort()).toEqual(codes.map((c) => hashRecoveryCode(normalizeRecoveryCode(c)!)).sort());

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user).toMatchObject({ status: 'ACTIVE', failedLoginCount: 0, lockoutLevel: 0 });
    expect(user.totpSecretEnc).toMatch(/^v1\./);
    expect(user.totpSecretEnc).not.toContain(start.body.secret);
    expect(user.totpLastUsedStep).toBe(Math.floor(t.clock.now().getTime() / 30_000));
    expect(await prisma.auditLog.count({ where: { action: 'auth.password.set', targetId: userId, outcome: 'SUCCESS' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'auth.totp.enrolled', targetId: userId, outcome: 'SUCCESS' } })).toBe(1);
    const completed = await prisma.auditLog.findFirstOrThrow({ where: { action: 'auth.enrollment.completed', targetId: userId } });
    expect(completed.metadata).toEqual({ flow: 'INVITE' });
  });

  it('rejects a weak password with field codes and keeps the session', async () => {
    const { cookie } = await acceptedInvite();
    const res = await post('/api/auth/enrollment/password', cookie, { password: 'password1234' }).expect(422);
    expect(res.body.fields).toEqual([expect.objectContaining({ path: 'password', code: 'PASSWORD_TOO_WEAK' })]);
    const short = await post('/api/auth/enrollment/password', cookie, { password: 'Sh0rt!' }).expect(422);
    expect(short.body.fields[0].code).toBe('PASSWORD_TOO_SHORT');
    expect((await http().get('/api/auth/session').set('Cookie', cookie).expect(200)).body).toMatchObject({ scope: 'ENROLLMENT', next: 'SET_PASSWORD' });
  });

  it('needs a password before TOTP, and a pending secret before confirm', async () => {
    const { cookie } = await acceptedInvite();
    expect((await post('/api/auth/enrollment/totp', cookie).expect(409)).body.code).toBe('USER_STATE_CONFLICT');
    await post('/api/auth/enrollment/password', cookie, { password: GOOD_PASSWORD }).expect(204);
    await post('/api/auth/enrollment/totp/confirm', cookie, { code: '123456' }).expect(409);
  });

  it('destroys the enrollment session after 5 wrong codes', async () => {
    const { userId, cookie } = await acceptedInvite();
    await post('/api/auth/enrollment/password', cookie, { password: GOOD_PASSWORD }).expect(204);
    await post('/api/auth/enrollment/totp', cookie).expect(200);
    for (let i = 0; i < 4; i += 1) {
      expect((await post('/api/auth/enrollment/totp/confirm', cookie, { code: '000000' }).expect(401)).body.code).toBe('AUTH_INVALID_MFA_CODE');
    }
    expect((await post('/api/auth/enrollment/totp/confirm', cookie, { code: '000000' }).expect(401)).body.code).toBe('AUTH_MFA_ATTEMPTS_EXHAUSTED');
    await http().get('/api/auth/session').set('Cookie', cookie).expect(401);
    // the fixed clock gives every row the same `at`, so compare the sorted reasons
    const reasons = (await prisma.auditLog.findMany({ where: { action: 'auth.totp.enrolled', outcome: 'FAILURE', targetId: userId } })).map((r) => (r.metadata as { reason: string }).reason);
    expect(reasons.sort()).toEqual(['INVALID_CODE', 'INVALID_CODE', 'INVALID_CODE', 'INVALID_CODE', 'TOO_MANY_MFA_ATTEMPTS']);
  });

  it('two parallel confirms with the same code: one wins, the other gets 409 USER_STATE_CONFLICT (Review Focus 3)', async () => {
    const { userId, cookie } = await acceptedInvite();
    await post('/api/auth/enrollment/password', cookie, { password: GOOD_PASSWORD }).expect(204);
    const start = await post('/api/auth/enrollment/totp', cookie).expect(200);
    const code = await generateTotpCode(start.body.secret, t.clock.now());
    // Called on the service: over HTTP the loser may instead reach the guard after the winner rotated
    // the token (401), which would hide the race this test pins.
    const session = await prisma.session.findFirstOrThrow({ where: { userId, scope: 'ENROLLMENT' } });
    const principal: Principal = { userId, sessionId: session.id, scope: 'ENROLLMENT', permissions: new Set(), mfaVerifiedAt: null };
    const service = t.app.get(EnrollmentService);
    const results = await Promise.allSettled([service.confirmTotp(principal, code), service.confirmTotp(principal, code)]);
    const won = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    const lost = results.flatMap((r) => (r.status === 'rejected' ? [r.reason as { code?: string }] : []));
    expect(won).toHaveLength(1);
    expect(lost.map((e) => e.code)).toEqual(['USER_STATE_CONFLICT']);
    const stored = await prisma.recoveryCode.findMany({ where: { userId } });
    expect(stored.map((r) => r.codeHash).sort()).toEqual(won[0]!.recoveryCodes.map((c) => hashRecoveryCode(normalizeRecoveryCode(c)!)).sort());
    expect(await prisma.session.count({ where: { userId } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'auth.enrollment.completed', targetId: userId } })).toBe(1);
  });

  it('abandoned enrollment: resend + accept starts clean (spec section 17 step 3)', async () => {
    const { userId, email, cookie } = await acceptedInvite();
    await post('/api/auth/enrollment/password', cookie, { password: GOOD_PASSWORD }).expect(204);
    t.mail.clear(); // the resend's mail replaces the first invite
    await http().post(`/api/users/${userId}/invite`).set('Origin', ORIGIN).set('Cookie', adminCookie).expect(202);
    const token = await inviteToken(email);
    const again = await http().post('/api/auth/invite/accept').set('Origin', ORIGIN).send({ token }).expect(200);
    expect(again.body.next).toBe('SET_PASSWORD');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash).toBeNull();
  });

  it('enrollment routes refuse FULL and PRE_MFA sessions', async () => {
    const active = await createStaffUser(prisma);
    await post('/api/auth/enrollment/totp', await loginAs(t.app, active.id, 'FULL')).expect(401);
    await post('/api/auth/enrollment/totp', await loginAs(t.app, active.id, 'PRE_MFA')).expect(401);
  });
});
```

Add the three routes to `route-access.snapshot.json` as `{ "kind": "session", "scopes": ["ENROLLMENT"], "stepUp": false }`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm turbo run test --filter=@tms/api-admin`
Expected: FAIL — the enrollment routes return 404; `PASSWORD_HASHER` is not exported.

- [ ] **Step 3: Bind the auth-core adapters**

`ports.ts` adds:

```ts
export const SECRET_CIPHER = 'tms:SecretCipher';
export const PASSWORD_HASHER = 'tms:PasswordHasher';
export const TOTP_PROVIDER = 'tms:TotpProvider';
```

`options.ts` adds `secrets: { keyring: Record<string, Buffer>; activeKeyId: string }`, `passwordPepper: Buffer`, `totpIssuer: string`. `AdminAuthModule.forRoot` adds:

```ts
{ provide: SECRET_CIPHER, useFactory: () => new AesGcmSecretCipher({ keys: options.secrets.keyring, activeKeyId: options.secrets.activeKeyId }) },
{ provide: PASSWORD_HASHER, useFactory: () => new Argon2idPasswordHasher({ pepper: options.passwordPepper }) },
{ provide: TOTP_PROVIDER, useValue: new OtplibTotpProvider() },
EnrollmentService,
```

and exports the three tokens and `EnrollmentService`.

`packages/domain/src/admin/auth/credentials.ts`:

```ts
import { checkPassword, type PasswordViolation } from '@tms/auth-core';
import { type ApiFieldError, DomainError } from '@tms/contracts';

export const totpAad = (userId: string): string => `totp:${userId}`;

const MESSAGES: Record<PasswordViolation, string> = {
  TOO_SHORT: 'Use at least 12 characters',
  TOO_LONG: 'Use at most 128 characters',
  TOO_WEAK: 'Password is too easy to guess',
};

export function passwordFieldErrors(violations: readonly PasswordViolation[], path = 'password'): ApiFieldError[] {
  return violations.map((v) => ({ path, code: `PASSWORD_${v}`, message: MESSAGES[v] }));
}

export function assertStrongPassword(
  password: string,
  user: { email: string | null; username: string; firstName: string; lastName: string },
  path = 'password',
): void {
  const result = checkPassword(password, [user.email ?? '', user.username, user.firstName, user.lastName]);
  if (!result.ok) throw new DomainError('VALIDATION_FAILED', 'Validation failed', { fields: passwordFieldErrors(result.violations, path) });
}
```

- [ ] **Step 4: Implement `EnrollmentService`**

`packages/domain/src/admin/auth/enrollment/enrollment.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import {
  generateRecoveryCodes, hashRecoveryCode, MFA_MAX_ATTEMPTS, normalizeRecoveryCode,
  type PasswordHasher, type RandomSource, type SecretCipher, type TotpProvider,
} from '@tms/auth-core';
import { DomainError } from '@tms/contracts';
import { type AppTransactionHost, AuditService, Clock, type Principal, TransactionHost, UnitOfWork } from '../../../shared';
import { assertStrongPassword, totpAad } from '../credentials';
import { AUTH_OPTIONS, type AdminAuthOptions } from '../options';
import { PASSWORD_HASHER, RANDOM_SOURCE, SECRET_CIPHER, TOTP_PROVIDER } from '../ports';
import { type IssuedSession, SessionService } from '../sessions/session.service';

@Injectable()
export class EnrollmentService {
  constructor(
    @Inject(TransactionHost) private readonly txHost: AppTransactionHost,
    private readonly uow: UnitOfWork,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(SECRET_CIPHER) private readonly cipher: SecretCipher,
    @Inject(TOTP_PROVIDER) private readonly totp: TotpProvider,
    @Inject(RANDOM_SOURCE) private readonly random: RandomSource,
    @Inject(AUTH_OPTIONS) private readonly options: AdminAuthOptions,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  async setPassword(principal: Principal, password: string): Promise<void> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: principal.userId } });
    if (user.status !== 'INVITED') throw new DomainError('USER_STATE_CONFLICT', 'The password was already verified');
    assertStrongPassword(password, user);
    const passwordHash = await this.hasher.hash(password);
    await this.uow.run(async () => {
      await this.db.user.update({ where: { id: user.id }, data: { passwordHash } });
      await this.audit.record({ action: 'auth.password.set', outcome: 'SUCCESS', actorUserId: user.id, target: { type: 'User', id: user.id }, metadata: {} });
    });
  }

  async startTotp(principal: Principal): Promise<{ otpauthUri: string; secret: string }> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: principal.userId } });
    if (!user.passwordHash || !user.email) throw new DomainError('USER_STATE_CONFLICT', 'Set a password first');
    const secret = this.totp.generateSecret();
    await this.db.session.update({
      where: { id: principal.sessionId },
      data: { totpPendingSecretEnc: this.cipher.encrypt(secret, totpAad(user.id)) },
    });
    return { otpauthUri: this.totp.buildUri({ issuer: this.options.totpIssuer, account: user.email, secret }), secret };
  }

  async confirmTotp(principal: Principal, code: string): Promise<{ issued: IssuedSession; recoveryCodes: string[] }> {
    const session = await this.db.session.findUniqueOrThrow({ where: { id: principal.sessionId } });
    if (!session.totpPendingSecretEnc) throw new DomainError('USER_STATE_CONFLICT', 'Start the authenticator setup first');
    const secret = this.cipher.decrypt(session.totpPendingSecretEnc, totpAad(principal.userId));
    const now = this.clock.now();
    const verification = await this.totp.verify({ secret, code, now, lastUsedStep: null });

    const outcome = await this.uow.run(async () => {
      if (!verification.ok) {
        const attempts = await this.sessions.recordMfaFailure(session.id);
        await this.audit.record({ action: 'auth.totp.enrolled', outcome: 'FAILURE', actorUserId: principal.userId, target: { type: 'User', id: principal.userId }, metadata: { reason: attempts >= MFA_MAX_ATTEMPTS ? 'TOO_MANY_MFA_ATTEMPTS' : 'INVALID_CODE' } });
        if (attempts >= MFA_MAX_ATTEMPTS) {
          await this.sessions.destroy(session.id);
          return { kind: 'exhausted' as const };
        }
        return { kind: 'invalid' as const };
      }
      // Single use of the pending secret: the first statement of the winning transaction row-locks the
      // session; a parallel confirm waits here, re-reads the row after the commit and finds nothing to claim.
      const claimed = await this.db.session.updateMany({
        where: { id: session.id, totpPendingSecretEnc: { not: null } },
        data: { totpPendingSecretEnc: null },
      });
      if (claimed.count !== 1) return { kind: 'conflict' as const };
      const user = await this.db.user.findUniqueOrThrow({ where: { id: principal.userId } });
      const recoveryCodes = generateRecoveryCodes(this.random);
      await this.db.user.update({
        where: { id: user.id },
        data: {
          totpSecretEnc: this.cipher.encrypt(secret, totpAad(user.id)),
          totpKeyId: this.cipher.activeKeyId,
          totpEnabledAt: now,
          totpLastUsedStep: verification.step,
          status: 'ACTIVE',
          failedLoginCount: 0,
          lockoutLevel: 0,
          lockedUntil: null,
          lastLoginAt: now,
        },
      });
      await this.db.recoveryCode.deleteMany({ where: { userId: user.id } });
      await this.db.recoveryCode.createMany({
        data: recoveryCodes.map((c) => ({ userId: user.id, codeHash: hashRecoveryCode(normalizeRecoveryCode(c)!) })),
      });
      const issued = await this.sessions.upgrade(session.id, 'FULL', { mfaVerified: true });
      const target = { type: 'User', id: user.id } as const;
      await this.audit.record({ action: 'auth.totp.enrolled', outcome: 'SUCCESS', actorUserId: user.id, target, metadata: {} });
      await this.audit.record({ action: 'auth.enrollment.completed', outcome: 'SUCCESS', actorUserId: user.id, target, metadata: { flow: user.status === 'INVITED' ? 'INVITE' : 'MFA_RESET' } });
      return { kind: 'ok' as const, issued, recoveryCodes };
    });

    if (outcome.kind === 'conflict') throw new DomainError('USER_STATE_CONFLICT', 'The authenticator setup was already confirmed');
    if (outcome.kind === 'exhausted') throw new DomainError('AUTH_MFA_ATTEMPTS_EXHAUSTED', 'Too many wrong codes; start again');
    if (outcome.kind === 'invalid') throw new DomainError('AUTH_INVALID_MFA_CODE', 'The code is not valid');
    return { issued: outcome.issued, recoveryCodes: outcome.recoveryCodes };
  }
}
```

- [ ] **Step 5: Controller, env, secrets**

`dto.ts` adds `SetPasswordDto`, `TotpConfirmDto` (`zodDto(SetPasswordRequestSchema)`, `zodDto(TotpConfirmRequestSchema)`).

`apps/api-admin/src/auth/enrollment.controller.ts`:

```ts
import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import { EnrollmentService, SessionCookie } from '@tms/domain/admin';
import { AuthThrottle, CurrentPrincipal, type Principal, RequireSession } from '@tms/domain/shared';
import type { Response } from 'express';
import { SetPasswordDto, TotpConfirmDto } from './dto';

@Controller('auth/enrollment')
export class EnrollmentController {
  constructor(private readonly enrollment: EnrollmentService, private readonly cookie: SessionCookie) {}

  @RequireSession('ENROLLMENT')
  @Post('password')
  @HttpCode(204)
  setPassword(@CurrentPrincipal() p: Principal, @Body() body: SetPasswordDto): Promise<void> {
    return this.enrollment.setPassword(p, body.password);
  }

  @RequireSession('ENROLLMENT')
  @Post('totp')
  @HttpCode(200)
  start(@CurrentPrincipal() p: Principal): Promise<{ otpauthUri: string; secret: string }> {
    return this.enrollment.startTotp(p);
  }

  @RequireSession('ENROLLMENT')
  @AuthThrottle()
  @Post('totp/confirm')
  @HttpCode(200)
  async confirm(@CurrentPrincipal() p: Principal, @Body() body: TotpConfirmDto, @Res({ passthrough: true }) res: Response): Promise<{ recoveryCodes: string[] }> {
    const { issued, recoveryCodes } = await this.enrollment.confirmTotp(p, body.code);
    this.cookie.write(res, issued.token);
    return { recoveryCodes };
  }
}
```

`apps/api-admin/src/env.ts` adds (dev defaults are fixed, public, and rejected in production; the keys go inside the `.extend({ … })` literal, the refinements onto the chain after it):

```ts
// Both decode to exactly 32 bytes: 'dev-only-secrets-enc-key-32-byte' and 'dev-only-password-pepper-32bytes'.
export const DEV_KEYRING = 'dev1:ZGV2LW9ubHktc2VjcmV0cy1lbmMta2V5LTMyLWJ5dGU=';
export const DEV_PEPPER = 'ZGV2LW9ubHktcGFzc3dvcmQtcGVwcGVyLTMyYnl0ZXM=';

SECRETS_ENC_KEYS: z.string().default(DEV_KEYRING),
SECRETS_ENC_ACTIVE_KEY_ID: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/).default('dev1'),
PASSWORD_PEPPER: z.string().default(DEV_PEPPER),
TOTP_ISSUER: z.string().min(1).max(40).default('TMS'),
```

with refinements: `parseKeyring(SECRETS_ENC_KEYS)` succeeds and contains `SECRETS_ENC_ACTIVE_KEY_ID`; `Buffer.from(PASSWORD_PEPPER, 'base64').length >= 32`; in production neither `SECRETS_ENC_KEYS` equals `DEV_KEYRING` nor `PASSWORD_PEPPER` equals `DEV_PEPPER` (error names the variable, never its value). `apps/api-admin/test/env.spec.ts`: the defaults `toEqual` gains `SECRETS_ENC_KEYS: DEV_KEYRING, SECRETS_ENC_ACTIVE_KEY_ID: 'dev1', PASSWORD_PEPPER: DEV_PEPPER, TOTP_ISSUER: 'TMS'` (constants imported from `../src/env`), plus one case per refinement (the thrown message names the variable and contains neither value), and a case that both dev constants decode to 32 bytes (`Buffer.from(DEV_PEPPER, 'base64').length === 32`, same for the key after `dev1:`). Phase 0's `.gitleaks.toml` holds only `title` and `[extend] useDefault = true`; add a new `[allowlist]` table with the exact strings (the two dev defaults here, the two `stack1` values below):

```toml
[allowlist]
description = "Public dev-only defaults (rejected by loadEnv in production)"
regexes = [
  '''ZGV2LW9ubHktc2VjcmV0cy1lbmMta2V5LTMyLWJ5dGU=''',
  '''ZGV2LW9ubHktcGFzc3dvcmQtcGVwcGVyLTMyYnl0ZXM=''',
  '''c3RhY2sxLWNvbXBvc2UtY2ktc2VjcmV0cy1rZXktMzI=''',
  '''c3RhY2sxLWNvbXBvc2UtY2ktcGVwcGVyLTMyYnl0ZXM=''',
]
```

`AppModule.forRoot` maps them to `secrets.keyring = parseKeyring(...)`, `passwordPepper = Buffer.from(PASSWORD_PEPPER, 'base64')`, `totpIssuer`. `apps/api-admin/.env.example` documents generating real values (`openssl rand -base64 32`). The compose `full` profile runs with `NODE_ENV: production`, so it must not use the dev defaults: compose `api-admin` passes `SECRETS_ENC_KEYS: ${SECRETS_ENC_KEYS:?set in infra/.env}`, `SECRETS_ENC_ACTIVE_KEY_ID: ${SECRETS_ENC_ACTIVE_KEY_ID:-stack1}`, `PASSWORD_PEPPER: ${PASSWORD_PEPPER:?set in infra/.env}`, and `infra/.env.example` gains a second pair of fixed 32-byte values under the comment "local compose and CI only — replace for any shared environment":

```ini
SECRETS_ENC_KEYS=stack1:c3RhY2sxLWNvbXBvc2UtY2ktc2VjcmV0cy1rZXktMzI=
SECRETS_ENC_ACTIVE_KEY_ID=stack1
PASSWORD_PEPPER=c3RhY2sxLWNvbXBvc2UtY2ktcGVwcGVyLTMyYnl0ZXM= # gitleaks:allow (public CI value)
```

(`stack1-compose-ci-secrets-key-32` and `stack1-compose-ci-pepper-32bytes`, 32 bytes each.) The ` # gitleaks:allow` marker keeps the plan document itself green before this task's allowlist exists; compose's `.env` parser and bash both read ` #` after an unquoted value as a comment, so the value is unchanged. CI's `cp infra/.env.example infra/.env` picks them up; both strings are in the allowlist above.

- [ ] **Step 6: Run the tests and verify**

Run: `pnpm turbo run test --filter=@tms/domain && pnpm turbo run test --filter=@tms/api-admin && pnpm verify`
Expected: `enrollment.e2e-spec` (7 tests), the env spec (defaults, refinement cases, 32-byte check) and the snapshot pass; gitleaks stays green with the allowlist.

- [ ] **Step 7: Commit**

```bash
git add packages/domain apps/api-admin infra/docker-compose.yml infra/.env.example .gitleaks.toml docs/efficiency/critical-path.md
git commit -m "feat(domain): add enrollment with password policy, TOTP setup and recovery codes"
```

PR body: diagram `sequenceDiagram` (ENROLLMENT: password → totp start → confirm → FULL rotation); boundaries: `@tms/domain/admin`, api-admin routes and env (secrets); no migration; reviewer: `security-reviewer` (secret handling, AAD, rotation).
