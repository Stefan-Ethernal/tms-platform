# Phase 2 — Task 19: Step-up and recovery-code regeneration

> Part of the phase 2 plan: read [index.md](index.md) (constraints, shared interfaces, env) and this file only.


**Files:**
- Create: `packages/domain/src/admin/auth/step-up/step-up.service.ts`, `packages/domain/src/admin/auth/recovery/recovery-code.service.ts`; Modify: `packages/domain/src/admin/admin-auth.module.ts`, `packages/domain/src/admin/index.ts`, `packages/domain/src/admin/auth/enrollment/enrollment.service.ts` (reuse `RecoveryCodeService.replaceAll`)
- Create: `apps/api-admin/src/auth/step-up.controller.ts`; Modify: `apps/api-admin/src/account/account.controller.ts`, `apps/api-admin/src/auth/dto.ts`, `apps/api-admin/src/auth/auth-http.module.ts`
- Create: `apps/api-admin/test/step-up.e2e-spec.ts`; Modify: `apps/api-admin/test/route-access.snapshot.json`

**Interfaces:**
- Consumes: `TotpProvider`, `SecretCipher`, `totpAad`, `AccountLockService`, `SessionService.markMfaVerified`, `isStepUpFresh` via `AccessGuard` (Task 10's `@RequireStepUp`).
- Produces: `StepUpService.confirm(principal, code): Promise<void>`; `RecoveryCodeService.replaceAll(userId): Promise<string[]>`, `RecoveryCodeService.regenerate(principal): Promise<string[]>`; routes `POST /api/auth/step-up` (`@RequireSession('FULL')`, `@AuthThrottle`) → 204; `POST /api/account/recovery-codes` (`@RequireSession('FULL')`, `@RequireStepUp`) → 200 `RecoveryCodesResponse`.

Rules: step-up verifies the TOTP (outside the transaction) against `totpLastUsedStep`, then under the row lock re-checks `status` (a block or deactivation committed after the guard → 401 `AUTH_INVALID_MFA_CODE`, not a 500 from marking a deleted session; no audit row, `MfaFailure` has no not-active reason and the block itself is audited), applies the replay guard and the shared lockout counter (Review Focus 4); success sets `Session.mfaVerifiedAt = now` for that session only, resets the counter (`succeed`) and is audited as `auth.totp.verified` (failures `{ reason: 'INVALID_CODE' | 'CODE_REPLAYED' | 'ACCOUNT_LOCKED' }`); a lock while FULL returns 423 for any code (the session already proves the account, D1) but keeps FULL sessions (a lockout must not become a remote logout). Regeneration is audited as `auth.recovery-codes.regenerated`. `@RequireStepUp` routes accept `mfaVerifiedAt` within 10 minutes — a fresh login or completed enrollment also counts.

- [ ] **Step 1: Write the failing API tests**

`apps/api-admin/test/step-up.e2e-spec.ts`:

```ts
import request from 'supertest';
import type { PrismaService } from '@tms/db/nest';
import { AccountLockService } from '@tms/domain/admin';
import { createAdminTestApp, type AdminTestApp, ORIGIN } from './support/app';
import { createStaffUser, loginAs, seedBase, totpNow, withCredentials } from './support/fixtures';

describe('step-up and recovery codes (API)', () => {
  let t: AdminTestApp;
  let prisma: PrismaService;
  const http = () => request(t.app.getHttpServer());
  const stepUp = (cookie: string, code: string) => http().post('/api/auth/step-up').set('Origin', ORIGIN).set('Cookie', cookie).send({ code });
  const regenerate = (cookie: string) => http().post('/api/account/recovery-codes').set('Origin', ORIGIN).set('Cookie', cookie);

  async function signedIn() {
    const u = await createStaffUser(prisma);
    const { totpSecret } = await withCredentials(t.app, u.id);
    return { user: u, totpSecret, cookie: await loginAs(t.app, u.id) };
  }

  beforeAll(async () => { t = await createAdminTestApp(); });
  afterAll(() => t.app.close());
  beforeEach(async () => { prisma = await seedBase(t.app); t.clock.set(new Date('2026-09-23T10:00:00Z')); });

  it('a fresh sign-in counts as step-up; after 10 minutes a TOTP confirmation is needed again', async () => {
    const { cookie, totpSecret } = await signedIn();
    const first = await regenerate(cookie).expect(200);
    expect(first.body.recoveryCodes).toHaveLength(10);
    t.clock.advance(11 * 60_000);
    expect((await regenerate(cookie).expect(403)).body.code).toBe('AUTH_STEP_UP_REQUIRED');
    await stepUp(cookie, await totpNow(t, totpSecret)).expect(204);
    const second = await regenerate(cookie).expect(200);
    expect(second.body.recoveryCodes).not.toEqual(first.body.recoveryCodes);
  });

  it('step-up is per session', async () => {
    const { user, cookie, totpSecret } = await signedIn();
    const other = await loginAs(t.app, user.id);
    t.clock.advance(11 * 60_000);
    await stepUp(cookie, await totpNow(t, totpSecret)).expect(204);
    await regenerate(cookie).expect(200);
    await regenerate(other).expect(403);
  });

  it('regeneration invalidates the old codes', async () => {
    const { user, cookie } = await signedIn();
    const old = (await regenerate(cookie).expect(200)).body.recoveryCodes as string[];
    await regenerate(cookie).expect(200);
    const { hashRecoveryCode, normalizeRecoveryCode } = await import('@tms/auth-core');
    expect(await prisma.recoveryCode.count({ where: { userId: user.id, codeHash: { in: old.map((c) => hashRecoveryCode(normalizeRecoveryCode(c)!)) } } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'auth.recovery-codes.regenerated', targetId: user.id } })).toBe(2);
  });

  it('rejects a replayed code and locks after 5 wrong codes without ending the FULL session', async () => {
    const { cookie, totpSecret } = await signedIn();
    const code = await totpNow(t, totpSecret);
    await stepUp(cookie, code).expect(204);
    expect((await stepUp(cookie, code).expect(401)).body.code).toBe('AUTH_INVALID_MFA_CODE');
    for (let i = 0; i < 3; i += 1) await stepUp(cookie, '000000').expect(401);
    const locked = await stepUp(cookie, '000000').expect(423);
    expect(locked.body.code).toBe('AUTH_ACCOUNT_LOCKED');
    expect(locked.headers['retry-after']).toBe('900');
    expect(await prisma.auditLog.count({
      where: { action: 'auth.totp.verified', outcome: 'FAILURE', metadata: { path: ['reason'], equals: 'CODE_REPLAYED' } },
    })).toBe(1);
    await http().get('/api/auth/session').set('Cookie', cookie).expect(200);
  });

  it('a block committed between the guard and the row lock answers 401, not 500, and marks nothing', async () => {
    const { user, cookie, totpSecret } = await signedIn();
    t.clock.advance(11 * 60_000);
    const locks = t.app.get(AccountLockService);
    const lock = locks.lock.bind(locks);
    jest.spyOn(locks, 'lock').mockImplementationOnce(async (id) => {
      await prisma.user.update({ where: { id }, data: { status: 'BLOCKED' } });
      return lock(id);
    });
    expect((await stepUp(cookie, await totpNow(t, totpSecret)).expect(401)).body.code).toBe('AUTH_INVALID_MFA_CODE');
    expect(await prisma.auditLog.count({ where: { action: 'auth.totp.verified', outcome: 'SUCCESS', targetId: user.id } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failedLoginCount).toBe(0);
    jest.restoreAllMocks();
  });

  it('refuses pre-sessions', async () => {
    const { user, totpSecret } = await signedIn();
    await stepUp(await loginAs(t.app, user.id, 'PRE_MFA'), await totpNow(t, totpSecret)).expect(401);
  });
});
```

Snapshot additions (sorted): `POST /api/account/recovery-codes` → session `["FULL"]`, `"stepUp": true`; `POST /api/auth/step-up` → session `["FULL"]`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm turbo run test --filter=@tms/api-admin`
Expected: FAIL — both routes return 404.

- [ ] **Step 3: Implement**

`packages/domain/src/admin/auth/recovery/recovery-code.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode, type RandomSource } from '@tms/auth-core';
import { type AppTransactionHost, AuditService, type Principal, TransactionHost, UnitOfWork } from '../../../shared';
import { RANDOM_SOURCE } from '../ports';

@Injectable()
export class RecoveryCodeService {
  constructor(
    @Inject(TransactionHost) private readonly txHost: AppTransactionHost,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    @Inject(RANDOM_SOURCE) private readonly random: RandomSource,
  ) {}

  /** Replaces all codes of the user inside the caller's transaction; returns the plain codes once. */
  async replaceAll(userId: string): Promise<string[]> {
    const codes = generateRecoveryCodes(this.random);
    await this.txHost.tx.recoveryCode.deleteMany({ where: { userId } });
    await this.txHost.tx.recoveryCode.createMany({
      data: codes.map((c) => ({ userId, codeHash: hashRecoveryCode(normalizeRecoveryCode(c)!) })),
    });
    return codes;
  }

  regenerate(principal: Principal): Promise<string[]> {
    return this.uow.run(async () => {
      const codes = await this.replaceAll(principal.userId);
      await this.audit.record({ action: 'auth.recovery-codes.regenerated', outcome: 'SUCCESS', actorUserId: principal.userId, target: { type: 'User', id: principal.userId }, metadata: {} });
      return codes;
    });
  }
}
```

`EnrollmentService.confirmTotp` replaces its inline `deleteMany`/`createMany` with `await this.recoveryCodes.replaceAll(user.id)`.

`packages/domain/src/admin/auth/step-up/step-up.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { SecretCipher, TotpProvider } from '@tms/auth-core';
import { DomainError } from '@tms/contracts';
import { type AppTransactionHost, AuditService, Clock, type Principal, TransactionHost, UnitOfWork } from '../../../shared';
import { totpAad } from '../credentials';
import { AccountLockService } from '../login/account-lock.service';
import { accountLocked } from '../login/login.service';
import { SECRET_CIPHER, TOTP_PROVIDER } from '../ports';
import { SessionService } from '../sessions/session.service';

@Injectable()
export class StepUpService {
  constructor(
    @Inject(TransactionHost) private readonly txHost: AppTransactionHost,
    private readonly uow: UnitOfWork,
    private readonly locks: AccountLockService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    @Inject(SECRET_CIPHER) private readonly cipher: SecretCipher,
    @Inject(TOTP_PROVIDER) private readonly totp: TotpProvider,
  ) {}

  async confirm(principal: Principal, code: string): Promise<void> {
    const user = await this.txHost.tx.user.findUniqueOrThrow({
      where: { id: principal.userId },
      select: { id: true, totpSecretEnc: true, totpLastUsedStep: true },
    });
    const secret = user.totpSecretEnc ? this.cipher.decrypt(user.totpSecretEnc, totpAad(user.id)) : null;
    const v = secret ? await this.totp.verify({ secret, code, now: this.clock.now(), lastUsedStep: user.totpLastUsedStep }) : ({ ok: false } as const);

    const outcome = await this.uow.run(async () => {
      const account = await this.locks.lock(user.id);
      const failure = (reason: 'INVALID_CODE' | 'CODE_REPLAYED' | 'ACCOUNT_LOCKED') =>
        this.audit.record({ action: 'auth.totp.verified', outcome: 'FAILURE', actorUserId: user.id, target: { type: 'User', id: user.id }, metadata: { reason } });
      // blocked or deactivated after the guard: the session is gone, so never reach markMfaVerified() (P2025 → 500)
      if (account.status !== 'ACTIVE') return { kind: 'invalid' } as const;
      if (account.isLocked) {
        await failure('ACCOUNT_LOCKED');
        return { kind: 'locked', retryAfterSeconds: account.remainingSeconds } as const;
      }
      const accepted = v.ok
        ? (await this.txHost.tx.user.updateMany({
            where: { id: user.id, OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: v.step } }] },
            data: { totpLastUsedStep: v.step },
          })).count === 1
        : false;
      if (!accepted) {
        const { lockedNow } = await this.locks.fail(account);
        await failure(v.ok ? 'CODE_REPLAYED' : 'INVALID_CODE');
        if (lockedNow) return { kind: 'locked', retryAfterSeconds: (await this.locks.lock(user.id)).remainingSeconds } as const;
        return { kind: 'invalid' } as const;
      }
      await this.locks.succeed(account);
      await this.sessions.markMfaVerified(principal.sessionId);
      await this.audit.record({ action: 'auth.totp.verified', outcome: 'SUCCESS', actorUserId: user.id, target: { type: 'User', id: user.id }, metadata: {} });
      return { kind: 'ok' } as const;
    });

    if (outcome.kind === 'locked') throw accountLocked(outcome.retryAfterSeconds);
    if (outcome.kind === 'invalid') throw new DomainError('AUTH_INVALID_MFA_CODE', 'The code is not valid');
  }
}
```

`AccountLockService.fail` revokes only PRE_MFA sessions when a lock starts (Task 16), so FULL sessions survive the lock.

- [ ] **Step 4: Controllers**

`dto.ts` adds `StepUpDto`. `apps/api-admin/src/auth/step-up.controller.ts`:

```ts
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { StepUpService } from '@tms/domain/admin';
import { AuthThrottle, CurrentPrincipal, type Principal, RequireSession } from '@tms/domain/shared';
import { StepUpDto } from './dto';

@Controller('auth')
export class StepUpController {
  constructor(private readonly stepUp: StepUpService) {}

  @RequireSession('FULL')
  @AuthThrottle()
  @Post('step-up')
  @HttpCode(204)
  confirm(@CurrentPrincipal() p: Principal, @Body() body: StepUpDto): Promise<void> {
    return this.stepUp.confirm(p, body.code);
  }
}
```

`AccountController` adds:

```ts
@RequireSession('FULL')
@RequireStepUp()
@Post('recovery-codes')
@HttpCode(200)
async regenerateRecoveryCodes(@CurrentPrincipal() p: Principal): Promise<{ recoveryCodes: string[] }> {
  return { recoveryCodes: await this.recoveryCodes.regenerate(p) };
}
```

- [ ] **Step 5: Run the tests and verify**

Run: `pnpm turbo run test --filter=@tms/api-admin && pnpm verify`
Expected: `step-up.e2e-spec` (6 tests), enrollment tests still green (shared `replaceAll`), snapshot updated.

- [ ] **Step 6: Commit**

```bash
git add packages/domain apps/api-admin docs/efficiency/critical-path.md
git commit -m "feat(domain): add TOTP step-up and recovery-code regeneration"
```

PR body: diagram `sequenceDiagram` (stale → 403 → step-up → retry); boundaries: `@tms/domain/admin`, api-admin routes; no migration; reviewer: `security-reviewer`.
