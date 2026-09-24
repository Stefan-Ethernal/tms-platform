# Phase 2 — Task 16: Login, password step — PRE_MFA, lockout, rate limits, compose test override

> Part of the phase 2 plan: read [index.md](index.md) (constraints, shared interfaces, env) and this file only.


**Files:**
- Create: `packages/domain/src/admin/auth/login/account-lock.service.ts`, `packages/domain/src/admin/auth/login/login.service.ts`, `packages/domain/src/admin/auth/throttling.ts`
- Modify: `packages/domain/src/admin/auth/options.ts` (`lockout`), `packages/domain/src/admin/admin-auth.module.ts`, `packages/domain/src/admin/index.ts`, `packages/domain/package.json` (`@nestjs/throttler` peer + catalog dev dependency)
- Create: `apps/api-admin/src/auth/login.controller.ts`; Modify: `apps/api-admin/src/auth/dto.ts`, `apps/api-admin/src/auth/auth-http.module.ts`, `apps/api-admin/src/app.module.ts` (ThrottlerModule, `ThrottlerGuard` between the two guards), `apps/api-admin/src/env.ts`, `apps/api-admin/src/auth-options.ts`, `apps/api-admin/package.json`, `apps/api-admin/.env.example`, `pnpm-workspace.yaml`
- Create: `infra/docker-compose.test.yml`; Modify: root `package.json` (script `compose:test`), `.github/workflows/e2e.yml` (stack started with the override)
- Create: `packages/domain/test/admin/account-lock.spec.ts`, `apps/api-admin/test/login-password.e2e-spec.ts`; Modify: `apps/api-admin/test/route-access.snapshot.json`, `apps/api-admin/test/support/app.ts` (`testEnv` throttle defaults), `apps/api-admin/test/env.spec.ts` (exact `toEqual` defaults gain the seven lockout/throttle variables), `packages/domain/test/admin/support/options.ts` (`lockout: DEFAULT_LOCKOUT_CONFIG`)

**Interfaces:**
- Consumes: `normalizeLockout`, `registerFailure`, `registerSuccess`, `isLocked`, `lockRemainingSeconds`, `LockoutConfig` (06); `PasswordHasher` (04, token from 14); `SessionService.create`, `revokePreMfaSessions` (11); `UnitOfWork` (12); `AUTH_THROTTLE_KEY` (08).
- Produces:
  - `AccountLockService`: `lock(userId): Promise<LockedAccount>` (`SELECT ... FOR NO KEY UPDATE`, throws outside a transaction), `isLockedNow(columns: LockColumns): boolean` (non-locking check on a row read without the lock; decides whether a public credential route evaluates the password at all, D1), `fail(account): Promise<{ lockedNow: boolean }>` (counts, persists, audits `auth.lockout.applied`, revokes PRE_MFA sessions when a lock starts), `succeed(account)`, `keep(account)`; `LockColumns = { failedLoginCount; lockoutLevel; lockedUntil }`; `LockedAccount = { userId; now; state: LockoutState; status: UserStatus; totpEnabledAt: Date | null; isLocked: boolean; remainingSeconds: number }`. Reused by Tasks 17, 18, 19, 22.
  - `LoginService.passwordStep(email, password): Promise<IssuedSession>`.
  - `authThrottlers(limits): ThrottlerOptions[]`, `accountThrottleKey(req): string`.
  - Route `POST /api/auth/login` (`@Public`, `@AuthThrottle`) → 200 `SessionStateResponse` + PRE_MFA cookie.
  - `AdminAuthOptions.lockout: LockoutConfig`.
  - `infra/docker-compose.test.yml`, script `compose:test`.

**Decision table** (`passwordStep`; each row has a test):

| Account | Password | Lock | Response | Counted |
|---|---|---|---|---|
| unknown email / DRIVER / no password hash | any | — | 401 `AUTH_INVALID_CREDENTIALS` (dummy argon2 runs) | no |
| STAFF | wrong | not locked | 401 generic; lock starts at the threshold | yes |
| STAFF | any — **not verified** (the dummy argon2 runs instead) | locked | 401 generic, byte-identical to a wrong password (D1) | no |
| STAFF | any | lock started by a parallel request after the hash (seen under the row lock) | 401 generic (the lock wins) | no |
| STAFF, status ≠ ACTIVE | correct | not locked | 401 generic | no |
| STAFF, ACTIVE, `totpEnabledAt = null` | correct | not locked | 403 `AUTH_MFA_RESET_PENDING` | no |
| STAFF, ACTIVE, enrolled | correct | not locked | 200 PRE_MFA (counter **kept**, not reset) | no |

Every row writes one audit row: `auth.login.success { method: 'PASSWORD' }`, or `auth.login.failure { method: 'PASSWORD', reason }` with `reason` one of `UNKNOWN_ACCOUNT`, `NOT_STAFF`, `ACCOUNT_NOT_ACTIVE`, `INVALID_CREDENTIALS`, `ACCOUNT_LOCKED`, `MFA_RESET_PENDING` (Task 08's extended `LoginFailureReasonSchema`). The public route never answers 423 (D1): while locked the password is not evaluated, the attempt is not counted, and the response cannot tell a correct password from a wrong one, so the lock really stops guessing. 423 is reserved for callers that already proved the account (MFA step, Task 17; step-up and password change, Tasks 18–19). The lock state is read once without the row lock to choose between the real hash and the dummy (equal argon2 work on every branch); the argon2 verification runs **outside** the transaction; the row lock is held only for the short counter update and re-checks the lock.

- [ ] **Step 1: Write the failing tests**

`packages/domain/test/admin/account-lock.spec.ts` (Nest testing module as in Task 15's service spec; `locks = ref.get(AccountLockService)`, `txHost = ref.get<AppTransactionHost>(TransactionHost)`, `prisma = ref.get(PrismaService)`, `user` = one STAFF row created in `beforeEach` after `resetTestDatabase()`):

```ts
it('refuses to lock a row outside a transaction (a lock without a transaction is a no-op)', async () => {
  await expect(locks.lock(user.id)).rejects.toThrow('needs an active transaction');
});

it('takes FOR NO KEY UPDATE: rows referencing the user can be inserted while the lock is held', async () => {
  await txHost.withTransaction(async () => {
    await locks.lock(user.id);
    // another connection: the FK check takes FOR KEY SHARE on the user row, which FOR UPDATE would block
    const insert = prisma.recoveryCode.create({ data: { userId: user.id, codeHash: 'a'.repeat(64) } });
    let timer: NodeJS.Timeout | undefined;
    const blocked = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('blocked by the row lock')), 2000); });
    try {
      await expect(Promise.race([insert, blocked])).resolves.toMatchObject({ userId: user.id });
    } finally {
      clearTimeout(timer);
    }
  });
});
```

`apps/api-admin/test/login-password.e2e-spec.ts`:

```ts
import request from 'supertest';
import type { PrismaService } from '@tms/db/nest';
import { PASSWORD_HASHER } from '@tms/domain/admin';
import type { PasswordHasher } from '@tms/auth-core';
import { createAdminTestApp, type AdminTestApp, ORIGIN } from './support/app';
import { createStaffUser, GOOD_PASSWORD, loginAs, seedBase, withCredentials } from './support/fixtures';

describe('login, password step (API)', () => {
  let t: AdminTestApp;
  let prisma: PrismaService;
  const http = () => request(t.app.getHttpServer());
  const login = (email: string, password: string) => http().post('/api/auth/login').set('Origin', ORIGIN).send({ email, password });
  async function staff(o: Parameters<typeof createStaffUser>[1] = {}) {
    const user = await createStaffUser(prisma, o);
    await withCredentials(t.app, user.id);
    if (o.enrolled === false) await prisma.user.update({ where: { id: user.id }, data: { totpEnabledAt: null, totpSecretEnc: null } });
    return user;
  }

  beforeAll(async () => { t = await createAdminTestApp(); });
  afterAll(() => t.app.close());
  beforeEach(async () => { prisma = await seedBase(t.app); t.clock.set(new Date('2026-09-23T10:00:00Z')); });

  it('issues a 5-minute PRE_MFA session for a correct password', async () => {
    const user = await staff();
    const res = await login(user.email!, GOOD_PASSWORD).expect(200);
    expect(res.body).toMatchObject({ scope: 'PRE_MFA', next: 'VERIFY_MFA' });
    const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.expiresAt.getTime() - t.clock.now().getTime()).toBe(5 * 60_000);
    expect(await prisma.auditLog.count({
      where: { action: 'auth.login.success', outcome: 'SUCCESS', targetId: user.id, metadata: { path: ['method'], equals: 'PASSWORD' } },
    })).toBe(1);
  });

  it('answers byte-identically for unknown, wrong, INVITED, BLOCKED, DEACTIVATED and DRIVER (Review Focus 4)', async () => {
    const active = await staff();
    const invited = await staff({ status: 'INVITED' });
    const blocked = await staff({ status: 'BLOCKED' });
    const deactivated = await staff({ status: 'DEACTIVATED' });
    const driver = await staff({ kind: 'DRIVER', role: 'driver' });
    const responses = await Promise.all([
      login('nobody@example.com', GOOD_PASSWORD),
      login(active.email!, 'Wrong-Password-123456'),
      login(invited.email!, GOOD_PASSWORD),
      login(blocked.email!, GOOD_PASSWORD),
      login(deactivated.email!, GOOD_PASSWORD),
      login(driver.email!, GOOD_PASSWORD),
    ]);
    for (const res of responses) {
      expect(res.status).toBe(401);
      expect(res.text).toBe(JSON.stringify({ statusCode: 401, code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid email or password' }));
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  it('runs a dummy hash for unknown accounts (timing equalisation)', async () => {
    const hasher = t.app.get<PasswordHasher>(PASSWORD_HASHER);
    const spy = jest.spyOn(hasher, 'verify');
    await login('nobody@example.com', GOOD_PASSWORD).expect(401);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('never evaluates the password of a locked account: one dummy hash, not the stored one (D1, timing)', async () => {
    const user = await staff();
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 5, lockoutLevel: 1, lockedUntil: new Date(t.clock.now().getTime() + 15 * 60_000) },
    });
    const { passwordHash } = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const hasher = t.app.get<PasswordHasher>(PASSWORD_HASHER);
    const spy = jest.spyOn(hasher, 'verify');
    await login(user.email!, GOOD_PASSWORD).expect(401);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).not.toBe(passwordHash);
    spy.mockRestore();
  });

  it('locks after 5 failures for 15 min; while locked a correct password gets the same 401 as a wrong one, not counted (D1)', async () => {
    const user = await staff();
    for (let i = 0; i < 5; i += 1) await login(user.email!, 'Wrong-Password-123456').expect(401);
    let row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({ failedLoginCount: 5, lockoutLevel: 1 });
    expect(row.lockedUntil?.getTime()).toBe(t.clock.now().getTime() + 15 * 60_000);

    const correct = await login(user.email!, GOOD_PASSWORD).expect(401);
    const wrong = await login(user.email!, 'Wrong-Password-123456').expect(401);
    expect(correct.text).toBe(wrong.text);
    expect(correct.text).toBe(JSON.stringify({ statusCode: 401, code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid email or password' }));
    expect(correct.headers['retry-after']).toBeUndefined();
    expect(correct.headers['set-cookie']).toBeUndefined();
    row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({ failedLoginCount: 5, lockoutLevel: 1 });
    expect(await prisma.auditLog.count({ where: { action: 'auth.lockout.applied', targetId: user.id } })).toBe(1);
    expect(await prisma.auditLog.count({
      where: { action: 'auth.login.failure', targetId: user.id, metadata: { path: ['reason'], equals: 'ACCOUNT_LOCKED' } },
    })).toBe(2);

    t.clock.advance(15 * 60_000);
    await login(user.email!, GOOD_PASSWORD).expect(200); // the lock has expired: the password is evaluated again
  });

  it('doubles the lock on each consecutive lockout and caps it at one hour', async () => {
    const user = await staff();
    const expected = [15, 30, 60, 60];
    for (const minutes of expected) {
      for (let i = 0; i < 5; i += 1) await login(user.email!, 'Wrong-Password-123456').expect(401);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect((row.lockedUntil!.getTime() - t.clock.now().getTime()) / 60_000).toBe(minutes);
      t.clock.advance(minutes * 60_000);
    }
  });

  it('a correct password does not reset the counter (Review Focus 1, password part)', async () => {
    const user = await staff();
    for (let i = 0; i < 4; i += 1) await login(user.email!, 'Wrong-Password-123456').expect(401);
    await login(user.email!, GOOD_PASSWORD).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failedLoginCount).toBe(4);
    await login(user.email!, 'Wrong-Password-123456').expect(401);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).lockoutLevel).toBe(1);
  });

  it('ten parallel wrong passwords at count 4 produce exactly one lock (Review Focus 3)', async () => {
    const user = await staff();
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 4 } });
    await Promise.all(Array.from({ length: 10 }, () => login(user.email!, 'Wrong-Password-123456')));
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({ failedLoginCount: 5, lockoutLevel: 1 });
    expect(await prisma.auditLog.count({ where: { action: 'auth.lockout.applied', targetId: user.id } })).toBe(1);
  });

  it('a lock ends PRE_MFA sessions but keeps FULL ones', async () => {
    const user = await staff();
    const pre = (await login(user.email!, GOOD_PASSWORD).expect(200)).headers['set-cookie']![0]!.split(';')[0]!;
    const full = await loginAs(t.app, user.id, 'FULL');
    for (let i = 0; i < 5; i += 1) await login(user.email!, 'Wrong-Password-123456').expect(401);
    await http().get('/api/auth/session').set('Cookie', pre).expect(401);
    await http().get('/api/auth/session').set('Cookie', full).expect(200);
  });

  it('reports a pending 2FA reset only after a correct password', async () => {
    const user = await staff({ enrolled: false });
    expect((await login(user.email!, GOOD_PASSWORD).expect(403)).body.code).toBe('AUTH_MFA_RESET_PENDING');
    await login(user.email!, 'Wrong-Password-123456').expect(401);
  });

  it('rate-limits per account and per IP on auth routes only', async () => {
    const limited = await createAdminTestApp({ env: { THROTTLE_AUTH_ACCOUNT_LIMIT: '3', THROTTLE_AUTH_IP_LIMIT: '5' } });
    const post = (email: string) => request(limited.app.getHttpServer()).post('/api/auth/login').set('Origin', ORIGIN).send({ email, password: 'x' });
    for (let i = 0; i < 3; i += 1) await post('a@example.com').expect(401);
    const throttled = await post('A@Example.com ').expect(429);
    expect(throttled.body.code).toBe('RATE_LIMITED');
    expect(Number(throttled.headers['retry-after'])).toBeGreaterThan(0);
    await post('b@example.com').expect(401);
    await post('c@example.com').expect(429); // sixth request from this IP
    await request(limited.app.getHttpServer()).get('/api/auth/session').expect(401); // unmarked route: never 429
    await limited.app.close();
  });
});
```

Add `{ "route": "POST /api/auth/login", "access": { "kind": "public", "stepUp": false } }` to the snapshot.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm turbo run test --filter=@tms/domain && pnpm turbo run test --filter=@tms/api-admin`
Expected: FAIL — `AccountLockService` does not exist; `POST /api/auth/login` returns 404.

- [ ] **Step 3: Implement `AccountLockService`**

```ts
import { Inject, Injectable } from '@nestjs/common';
import {
  isLocked, lockRemainingSeconds, type LockoutState, normalizeLockout, registerFailure, registerSuccess,
} from '@tms/auth-core';
import type { UserStatus } from '@tms/contracts';
import { type AppTransactionHost, AuditService, Clock, TransactionHost } from '../../../shared';
import { AUTH_OPTIONS, type AdminAuthOptions } from '../options';
import { SessionService } from '../sessions/session.service';

/** The lockout columns of a `User` row. */
export interface LockColumns {
  failedLoginCount: number;
  lockoutLevel: number;
  lockedUntil: Date | null;
}

const toState = (c: LockColumns): LockoutState => ({ failedCount: c.failedLoginCount, level: c.lockoutLevel, lockedUntil: c.lockedUntil });

export interface LockedAccount {
  userId: string;
  now: Date;
  state: LockoutState;
  status: UserStatus;
  totpEnabledAt: Date | null;
  isLocked: boolean;
  remainingSeconds: number;
}

interface LockRow extends LockColumns {
  status: UserStatus;
  totpEnabledAt: Date | null;
}

/** Serialises every credential check of one account (password, TOTP, recovery code). */
@Injectable()
export class AccountLockService {
  constructor(
    @Inject(TransactionHost) private readonly txHost: AppTransactionHost,
    private readonly clock: Clock,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    @Inject(AUTH_OPTIONS) private readonly options: AdminAuthOptions,
  ) {}

  /**
   * FOR NO KEY UPDATE: the lockout columns are not keys, and the weaker lock does not block the
   * FOR KEY SHARE that inserting a Session, ActionToken or AuditLog row referencing the user takes
   * (same lock strength as the admin actions, deviation 16).
   */
  async lock(userId: string): Promise<LockedAccount> {
    if (!this.txHost.isTransactionActive()) throw new Error('AccountLockService.lock needs an active transaction');
    const rows = await this.txHost.tx.$queryRaw<LockRow[]>`
      SELECT "failedLoginCount", "lockoutLevel", "lockedUntil", "status", "totpEnabledAt"
      FROM "User" WHERE "id" = ${userId}::uuid FOR NO KEY UPDATE`;
    const row = rows[0];
    if (!row) throw new Error(`user ${userId} vanished during a credential check`);
    const now = this.clock.now();
    const state = normalizeLockout(toState(row), now);
    return {
      userId, now, state, status: row.status, totpEnabledAt: row.totpEnabledAt,
      isLocked: isLocked(state, now), remainingSeconds: lockRemainingSeconds(state, now),
    };
  }

  /**
   * Lock check on a row read without the lock (D1): a public credential route calls it before the
   * argon2 step to decide whether the password is evaluated at all. `lock()` re-checks under the lock.
   */
  isLockedNow(columns: LockColumns): boolean {
    const now = this.clock.now();
    return isLocked(normalizeLockout(toState(columns), now), now);
  }

  async fail(account: LockedAccount): Promise<{ lockedNow: boolean }> {
    const result = registerFailure(account.state, account.now, this.options.lockout);
    await this.persist(account.userId, result.state);
    if (result.lockedNow && result.state.lockedUntil) {
      await this.audit.record({
        action: 'auth.lockout.applied', outcome: 'SUCCESS', target: { type: 'User', id: account.userId },
        metadata: {
          failedAttempts: result.state.failedCount,
          lockedUntil: result.state.lockedUntil.toISOString(),
          level: result.state.level,
        },
      });
      await this.sessions.revokePreMfaSessions(account.userId);
    }
    return { lockedNow: result.lockedNow };
  }

  succeed(account: LockedAccount): Promise<void> {
    return this.persist(account.userId, registerSuccess(account.state));
  }

  /** Writes the normalised state (an expired lock clears the counter, keeps the level). */
  keep(account: LockedAccount): Promise<void> {
    return this.persist(account.userId, account.state);
  }

  private async persist(userId: string, s: LockoutState): Promise<void> {
    await this.txHost.tx.user.update({
      where: { id: userId },
      data: { failedLoginCount: s.failedCount, lockoutLevel: s.level, lockedUntil: s.lockedUntil },
    });
  }
}
```

- [ ] **Step 4: Implement `LoginService.passwordStep`**

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { PasswordHasher } from '@tms/auth-core';
import { DomainError } from '@tms/contracts';
import { type AppTransactionHost, AuditService, TransactionHost, UnitOfWork } from '../../../shared';
import { PASSWORD_HASHER } from '../ports';
import { type IssuedSession, SessionService } from '../sessions/session.service';
import { AccountLockService } from './account-lock.service';

export const invalidCredentials = () => new DomainError('AUTH_INVALID_CREDENTIALS', 'Invalid email or password');
/** 423 — only for callers that already proved the account (PRE_MFA or FULL session), never on a public route (D1). */
export const accountLocked = (retryAfterSeconds: number) =>
  new DomainError('AUTH_ACCOUNT_LOCKED', 'Account temporarily locked', { retryAfterSeconds });

type PasswordOutcome =
  | { kind: 'ok'; issued: IssuedSession }
  | { kind: 'invalid' }
  | { kind: 'mfaResetPending' };

type PasswordFailureReason = 'INVALID_CREDENTIALS' | 'ACCOUNT_NOT_ACTIVE' | 'ACCOUNT_LOCKED' | 'MFA_RESET_PENDING';

@Injectable()
export class LoginService {
  private dummyHash: Promise<string> | undefined;

  constructor(
    @Inject(TransactionHost) private readonly txHost: AppTransactionHost,
    private readonly uow: UnitOfWork,
    private readonly sessions: SessionService,
    private readonly locks: AccountLockService,
    private readonly audit: AuditService,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
  ) {}

  /** A real hash to verify against when the account does not exist (equal work, no enumeration). */
  private dummy(): Promise<string> {
    this.dummyHash ??= this.hasher.hash('timing-equalisation-only-not-a-password');
    return this.dummyHash;
  }

  async passwordStep(email: string, password: string): Promise<IssuedSession> {
    const user = await this.txHost.tx.user.findUnique({
      where: { email },
      select: { id: true, kind: true, passwordHash: true, failedLoginCount: true, lockoutLevel: true, lockedUntil: true },
    });
    const candidate = user && user.kind === 'STAFF' && user.passwordHash ? { ...user, passwordHash: user.passwordHash } : null;
    // D1: a locked account's password is never evaluated; the dummy hash keeps the argon2 work equal on every branch.
    const lockedBefore = candidate ? this.locks.isLockedNow(candidate) : false;
    const hash = candidate && !lockedBefore ? candidate.passwordHash : await this.dummy();
    const matches = await this.hasher.verify(hash, password);
    const verified = matches && candidate !== null && !lockedBefore; // a match against the dummy never counts

    if (!candidate) {
      await this.audit.record({
        action: 'auth.login.failure', outcome: 'FAILURE',
        ...(user ? { target: { type: 'User', id: user.id } } : {}),
        metadata: { method: 'PASSWORD', reason: !user ? 'UNKNOWN_ACCOUNT' : user.kind !== 'STAFF' ? 'NOT_STAFF' : 'ACCOUNT_NOT_ACTIVE' },
      });
      throw invalidCredentials();
    }

    const outcome = await this.uow.run(async (): Promise<PasswordOutcome> => {
      const account = await this.locks.lock(candidate.id);
      const fail = (reason: PasswordFailureReason) =>
        this.audit.record({
          action: 'auth.login.failure', outcome: 'FAILURE', target: { type: 'User', id: candidate.id },
          metadata: { method: 'PASSWORD', reason },
        });
      // D1: locked before the hash (password not evaluated) or since (a parallel lock wins) → generic 401, not counted
      if (lockedBefore || account.isLocked) {
        await fail('ACCOUNT_LOCKED');
        return { kind: 'invalid' };
      }
      if (!verified) {
        await this.locks.fail(account);
        await fail('INVALID_CREDENTIALS');
        return { kind: 'invalid' };
      }
      await this.locks.keep(account); // Review Focus 1: a correct password alone never resets the counter
      if (account.status !== 'ACTIVE') {
        await fail('ACCOUNT_NOT_ACTIVE');
        return { kind: 'invalid' };
      }
      if (!account.totpEnabledAt) {
        await fail('MFA_RESET_PENDING');
        return { kind: 'mfaResetPending' };
      }
      const issued = await this.sessions.create(candidate.id, 'PRE_MFA', { mfaVerified: false });
      await this.audit.record({
        action: 'auth.login.success', outcome: 'SUCCESS', actorUserId: candidate.id, target: { type: 'User', id: candidate.id },
        metadata: { method: 'PASSWORD' },
      });
      return { kind: 'ok', issued };
    });

    switch (outcome.kind) {
      case 'ok': return outcome.issued;
      case 'mfaResetPending': throw new DomainError('AUTH_MFA_RESET_PENDING', 'Your authenticator was reset; use the link in your email');
      default: throw invalidCredentials();
    }
  }
}
```

Register `AccountLockService` and `LoginService` in `AdminAuthModule`; export both plus `invalidCredentials`, `accountLocked`.

- [ ] **Step 5: Rate limits**

Catalog: `'@nestjs/throttler': 6.7.0` (plus a `minimumReleaseAgeExclude` entry if pnpm adds one — keep what pnpm writes; spike S5). `@tms/domain`: peer dependency + dev dependency; `@tms/api-admin`: dependency.

`packages/domain/src/admin/auth/throttling.ts`:

```ts
import { createHash } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerOptions } from '@nestjs/throttler';
import { AUTH_THROTTLE_KEY } from '@tms/contracts';

export interface AuthThrottleLimits {
  ipLimit: number;
  ipTtlSeconds: number;
  accountLimit: number;
  accountTtlSeconds: number;
}

const isAuthRoute = (ctx: ExecutionContext) => Reflect.getMetadata(AUTH_THROTTLE_KEY, ctx.getHandler()) === true;

/** The account key: normalised email from the body, else the session cookie, else the IP; hashed so it never lands in memory as plain PII. */
export function accountThrottleKey(req: { body?: unknown; cookies?: Record<string, unknown>; ip?: string }): string {
  const body = req.body as { email?: unknown } | undefined;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : undefined;
  const cookie = Object.entries(req.cookies ?? {}).find(([name]) => name.endsWith('tms_admin_sid'))?.[1];
  const source = email ?? (typeof cookie === 'string' ? cookie : undefined) ?? req.ip ?? 'unknown';
  return createHash('sha256').update(source).digest('hex');
}

/** One bucket per throttler and tracker across all auth routes (the default key is per route). */
const sharedKey = (_ctx: ExecutionContext, tracker: string, name: string) => `${name}:${tracker}`;

export function authThrottlers(l: AuthThrottleLimits): ThrottlerOptions[] {
  return [
    {
      name: 'auth-ip', ttl: l.ipTtlSeconds * 1000, limit: l.ipLimit, skipIf: (ctx) => !isAuthRoute(ctx),
      getTracker: (req) => String((req as { ip?: string }).ip ?? 'unknown'), generateKey: sharedKey,
    },
    {
      name: 'auth-account', ttl: l.accountTtlSeconds * 1000, limit: l.accountLimit, skipIf: (ctx) => !isAuthRoute(ctx),
      getTracker: (req) => accountThrottleKey(req as Parameters<typeof accountThrottleKey>[0]), generateKey: sharedKey,
    },
  ];
}
```

`testEnv` in `apps/api-admin/test/support/app.ts` sets `THROTTLE_AUTH_IP_LIMIT: '10000'` and `THROTTLE_AUTH_ACCOUNT_LIMIT: '10000'` before `...overrides`: every e2e file shares one app and one client IP, and the lockout suites send far more than 10 requests per account, so only the tests that pass small limits (below, Task 17) hit a 429.

Spike N3 confirmed per-throttler `getTracker`, `skipIf`, `generateKey` and a millisecond `ttl` on 6.7.0; a 429 reaches the filter as `ThrottlerException` and carries `retry-after-<name>` headers, which Task 09's filter turns into `Retry-After`.

`apps/api-admin/src/app.module.ts`: import `ThrottlerModule.forRoot({ throttlers: authThrottlers(limitsFromEnv(env)) })` and insert `{ provide: APP_GUARD, useClass: ThrottlerGuard }` between `OriginGuard` and `AccessGuard`. `env.ts` adds `LOCKOUT_THRESHOLD` (default 5, 1–20), `LOCKOUT_BASE_SECONDS` (900, 1–86400), `LOCKOUT_MAX_SECONDS` (3600, ≥ base), `THROTTLE_AUTH_IP_LIMIT` (30), `THROTTLE_AUTH_IP_TTL_SECONDS` (60), `THROTTLE_AUTH_ACCOUNT_LIMIT` (10), `THROTTLE_AUTH_ACCOUNT_TTL_SECONDS` (900); `adminAuthOptionsFromEnv` maps the lockout trio to `lockout`. `.env.example` and compose `api-admin` list them. `apps/api-admin/test/env.spec.ts` (imports `envSchema` from `../src/env` since Task 10): the exact `toEqual` of the defaults gains `LOCKOUT_THRESHOLD: 5, LOCKOUT_BASE_SECONDS: 900, LOCKOUT_MAX_SECONDS: 3600, THROTTLE_AUTH_IP_LIMIT: 30, THROTTLE_AUTH_IP_TTL_SECONDS: 60, THROTTLE_AUTH_ACCOUNT_LIMIT: 10, THROTTLE_AUTH_ACCOUNT_TTL_SECONDS: 900`, plus one case: `LOCKOUT_BASE_SECONDS=900` with `LOCKOUT_MAX_SECONDS=60` → `loadEnv` throws naming `LOCKOUT_MAX_SECONDS`.

- [ ] **Step 6: Controller**

`dto.ts` adds `LoginDto` (`zodDto(LoginRequestSchema)`). `apps/api-admin/src/auth/login.controller.ts`:

```ts
import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import type { SessionStateResponse } from '@tms/contracts';
import { LoginService, SessionCookie, SessionService } from '@tms/domain/admin';
import { AuthThrottle, Public } from '@tms/domain/shared';
import type { Response } from 'express';
import { LoginDto } from './dto';

@Controller('auth')
export class LoginController {
  constructor(private readonly login: LoginService, private readonly sessions: SessionService, private readonly cookie: SessionCookie) {}

  @Public()
  @AuthThrottle()
  @Post('login')
  @HttpCode(200)
  async passwordStep(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response): Promise<SessionStateResponse> {
    const issued = await this.login.passwordStep(body.email, body.password);
    this.cookie.write(res, issued.token);
    return this.sessions.describe({ userId: issued.userId, scope: issued.scope });
  }
}
```

- [ ] **Step 7: Compose test override (deferred from phase 0)**

`infra/docker-compose.test.yml` (profiles select services; they cannot change an existing service's environment, so the spec's "profile test" is an override file — deviation 12):

```yaml
# Short lockouts and generous rate limits for Playwright (spec section 6: profile "test").
services:
  api-admin:
    environment:
      LOCKOUT_BASE_SECONDS: '5'
      LOCKOUT_MAX_SECONDS: '20'
      THROTTLE_AUTH_IP_LIMIT: '1000'
      THROTTLE_AUTH_ACCOUNT_LIMIT: '1000'
```

Root `package.json`: `"compose:test": "docker compose -f infra/docker-compose.yml -f infra/docker-compose.test.yml"`. `.github/workflows/e2e.yml` "Start the full stack" uses `pnpm compose:test --profile full up -d --build` and the matching `logs`/`down` steps.

- [ ] **Step 8: Run the tests and verify**

Run: `pnpm turbo run test --filter=@tms/domain && pnpm turbo run test --filter=@tms/api-admin && pnpm verify`
Expected: `login-password.e2e-spec` (11 tests), `account-lock.spec` (2 tests: outside a transaction, `FOR NO KEY UPDATE`), the api-admin env spec and the snapshot pass.

Run: `pnpm compose:test config --quiet && docker compose -f infra/docker-compose.yml -f infra/docker-compose.test.yml config | grep -A2 LOCKOUT_BASE_SECONDS`
Expected: config valid; the merged `api-admin` environment shows `LOCKOUT_BASE_SECONDS: "5"`.

- [ ] **Step 9: Commit**

```bash
git add packages/domain apps/api-admin infra/docker-compose.test.yml package.json .github/workflows/e2e.yml pnpm-workspace.yaml pnpm-lock.yaml docs/efficiency/critical-path.md
git commit -m "feat(domain): add the password login step with lockout, rate limits and a compose test override"
```

PR body: diagram `flowchart` (decision table); boundaries: `@tms/domain/admin`, api-admin guard chain (throttler), compose override, e2e workflow; no migration; reviewer: `security-reviewer`.
