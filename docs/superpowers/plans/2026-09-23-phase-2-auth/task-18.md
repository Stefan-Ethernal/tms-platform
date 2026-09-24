# Phase 2 — Task 18: Password reset (self-service) and password change

> Part of the phase 2 plan: read [index.md](index.md) (constraints, shared interfaces, env) and this file only.


**Files:**
- Create: `packages/domain/src/admin/auth/passwords/password.service.ts`; Modify: `packages/domain/src/admin/auth/options.ts` (`passwordReset`), `packages/domain/src/admin/admin-auth.module.ts`, `packages/domain/src/admin/index.ts` (the `password-reset` mail template already exists in `packages/domain/src/shared/mailer/templates.ts`, Task 12)
- Create: `apps/api-admin/src/auth/password.controller.ts`, `apps/api-admin/src/account/account.controller.ts`; Modify: `apps/api-admin/src/auth/dto.ts`, `apps/api-admin/src/auth/auth-http.module.ts`, `apps/api-admin/src/env.ts`, `apps/api-admin/src/auth-options.ts`, `apps/api-admin/.env.example`
- Create: `apps/api-admin/test/password.e2e-spec.ts`; Modify: `apps/api-admin/test/route-access.snapshot.json`, `apps/api-admin/test/env.spec.ts` (exact `toEqual` defaults gain `PASSWORD_RESET_TTL_MINUTES: 60`), `packages/domain/test/admin/support/options.ts` (`passwordReset: { ttlSeconds: 3600 }`)

**Interfaces:**
- Consumes: `ActionTokenService` (13), `AccountLockService` (16), `assertStrongPassword` (14), `PasswordHasher` (04/14), `SessionService.revokeAllSessions` (11), `MailNotifier` (12).
- Produces:
  - `PasswordService`: `forgot(email): Promise<void>`, `reset(token, password): Promise<void>`, `change(principal, currentPassword, newPassword): Promise<void>`, `issueReset(userId, createdById: string | null): Promise<void>` (reused by Task 22).
  - Routes: `POST /api/auth/password/forgot` (`@Public`, `@AuthThrottle`) → 202 always; `POST /api/auth/password/reset` (`@Public`, `@AuthThrottle`) → 204, no cookie; `POST /api/account/password` (`@RequireSession('FULL')`, `@AuthThrottle`) → 204 + cookie cleared.
  - `AdminAuthOptions.passwordReset = { ttlSeconds }` (env `PASSWORD_RESET_TTL_MINUTES`, default 60).

Rules:
- **forgot**: only an ACTIVE STAFF user with a password gets a token (60 min) and a mail with `${webBaseUrl}/reset-password#t=<token>`; every request answers 202 with an empty body and writes `auth.password-reset.requested { knownAccount }`.
- **reset**: the token is peeked first (no strength check for requests without a valid token — zxcvbn cost, Task 04), then the password policy runs (a weak password → 422, token still valid), then one transaction consumes the token (the loser of a race gets `AUTH_TOKEN_INVALID`), re-checks that the user is still an ACTIVE STAFF user (a user blocked or deactivated after the mail → 400 `AUTH_TOKEN_INVALID`, nothing changes, the link is spent), sets the new hash, revokes all sessions and unused tokens; no session is created (the user signs in with password + TOTP). Audit `auth.password-reset.completed { sessionsRevoked }`, on failure `{ reason: 'INVALID_TOKEN' }`. (Task 22 extends `reset()` to re-issue a pending 2FA-reset link, D2.)
- **change**: the caller holds a FULL session, so a lock is answered with 423 `AUTH_ACCOUNT_LOCKED` + `retryAfterSeconds` + `Retry-After` (D1) — for **any** current password: while locked the current password is not evaluated at all (a stolen session gets no guessing oracle) and nothing is counted. Otherwise the current password is verified outside the transaction, then the row lock re-checks the lock and applies the shared lockout counter (a wrong current password counts like a failed login, Review Focus 4); a wrong current password → 422 with field `currentPassword` code `INVALID_PASSWORD`; success sets the new hash and revokes **all** sessions including the current one (section 8.5) and unused tokens; the controller clears the cookie. Audit `auth.password.changed { sessionsRevoked }`, on failure `{ reason: 'INVALID_CREDENTIALS' | 'ACCOUNT_LOCKED' }`.

- [ ] **Step 1: Write the failing API tests**

`apps/api-admin/test/password.e2e-spec.ts`:

```ts
import request from 'supertest';
import type { PrismaService } from '@tms/db/nest';
import { createAdminTestApp, type AdminTestApp, ORIGIN } from './support/app';
import { createStaffUser, GOOD_PASSWORD, loginAs, seedBase, waitForMail, withCredentials } from './support/fixtures';

const NEW_PASSWORD = 'Another-Sturdy-Passphrase-77';
const RESET_LINK = /\/reset-password#t=([A-Za-z0-9_-]{43})$/m;

describe('password reset and change (API)', () => {
  let t: AdminTestApp;
  let prisma: PrismaService;
  const http = () => request(t.app.getHttpServer());
  const forgot = (email: string) => http().post('/api/auth/password/forgot').set('Origin', ORIGIN).send({ email });
  const reset = (token: string, password: string) => http().post('/api/auth/password/reset').set('Origin', ORIGIN).send({ token, password });
  const change = (cookie: string, currentPassword: string, newPassword: string) =>
    http().post('/api/account/password').set('Origin', ORIGIN).set('Cookie', cookie).send({ currentPassword, newPassword });
  const login = (email: string, password: string) => http().post('/api/auth/login').set('Origin', ORIGIN).send({ email, password });
  /** The mail goes out after commit: wait for it; callers `t.mail.clear()` before asking for a second link. */
  const lastResetToken = async (to: string) => RESET_LINK.exec((await waitForMail(t.mail, to)).text)![1]!;
  async function staff(o: Parameters<typeof createStaffUser>[1] = {}) {
    const u = await createStaffUser(prisma, o);
    await withCredentials(t.app, u.id);
    return u;
  }

  beforeAll(async () => { t = await createAdminTestApp(); });
  afterAll(() => t.app.close());
  beforeEach(async () => { prisma = await seedBase(t.app); t.mail.clear(); t.clock.set(new Date('2026-09-23T10:00:00Z')); });

  it('forgot answers 202 with an empty body for every account and mails only an active staff user (Review Focus 4)', async () => {
    const active = await staff();
    const invited = await staff({ status: 'INVITED' });
    const blocked = await staff({ status: 'BLOCKED' });
    const results = await Promise.all([forgot(active.email!), forgot('nobody@example.com'), forgot(invited.email!), forgot(blocked.email!)]);
    for (const r of results) {
      expect(r.status).toBe(202);
      expect(r.text).toBe('');
    }
    await waitForMail(t.mail, active.email!);
    expect(t.mail.sent.map((m) => m.to)).toEqual([active.email]);
    expect(await prisma.auditLog.count({ where: { action: 'auth.password-reset.requested' } })).toBe(4);
  });

  it('reset sets the new password, revokes every session and does not sign in', async () => {
    const u = await staff();
    const full = await loginAs(t.app, u.id);
    await forgot(u.email!).expect(202);
    const res = await reset(await lastResetToken(u.email!), NEW_PASSWORD).expect(204);
    expect(res.headers['set-cookie']).toBeUndefined();
    await http().get('/api/auth/session').set('Cookie', full).expect(401);
    await login(u.email!, GOOD_PASSWORD).expect(401);
    await login(u.email!, NEW_PASSWORD).expect(200);
  });

  it('a weak password keeps the token valid; reuse, expiry and races are rejected', async () => {
    const u = await staff();
    await forgot(u.email!).expect(202);
    const token = await lastResetToken(u.email!);
    expect((await reset(token, 'password1234').expect(422)).body.fields[0]).toMatchObject({ path: 'password', code: 'PASSWORD_TOO_WEAK' });
    const [a, b] = await Promise.all([reset(token, NEW_PASSWORD), reset(token, NEW_PASSWORD)]);
    expect([a.status, b.status].sort()).toEqual([204, 400]);
    await reset(token, NEW_PASSWORD).expect(400);

    t.mail.clear();
    await forgot(u.email!).expect(202);
    const late = await lastResetToken(u.email!);
    t.clock.advance(60 * 60_000 + 1000);
    expect((await reset(late, NEW_PASSWORD).expect(400)).body.code).toBe('AUTH_TOKEN_INVALID');
  });

  it('an invalid token is rejected before the password is scored', async () => {
    expect((await reset('A'.repeat(43), 'password'.repeat(16)).expect(400)).body.code).toBe('AUTH_TOKEN_INVALID');
  });

  it('a link of a user blocked after it was mailed is rejected and changes nothing', async () => {
    const u = await staff();
    await forgot(u.email!).expect(202);
    const token = await lastResetToken(u.email!);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    // Task 20's block also revokes the link; a direct status update pins the service's own re-check under the transaction
    await prisma.user.update({ where: { id: u.id }, data: { status: 'BLOCKED' } });
    expect((await reset(token, NEW_PASSWORD).expect(400)).body.code).toBe('AUTH_TOKEN_INVALID');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).passwordHash).toBe(before.passwordHash);
    expect(await prisma.auditLog.count({ where: { action: 'auth.password-reset.completed', outcome: 'FAILURE', targetId: u.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'auth.password-reset.completed', outcome: 'SUCCESS' } })).toBe(0);
  });

  it('change needs the current password, revokes all sessions and clears the cookie', async () => {
    const u = await staff();
    const cookie = await loginAs(t.app, u.id);
    const other = await loginAs(t.app, u.id);
    const wrong = await change(cookie, 'Wrong-Password-123456', NEW_PASSWORD).expect(422);
    expect(wrong.body.fields[0]).toMatchObject({ path: 'currentPassword', code: 'INVALID_PASSWORD' });
    expect((await change(cookie, GOOD_PASSWORD, 'password1234').expect(422)).body.fields[0]).toMatchObject({ path: 'newPassword', code: 'PASSWORD_TOO_WEAK' });
    const ok = await change(cookie, GOOD_PASSWORD, NEW_PASSWORD).expect(204);
    expect(ok.headers['set-cookie']?.[0]).toMatch(/^__Host-tms_admin_sid=;/);
    await http().get('/api/auth/session').set('Cookie', cookie).expect(401);
    await http().get('/api/auth/session').set('Cookie', other).expect(401);
    await login(u.email!, NEW_PASSWORD).expect(200);
  });

  it('wrong current passwords share the login lockout counter (Review Focus 4)', async () => {
    const u = await staff();
    const cookie = await loginAs(t.app, u.id);
    for (let i = 0; i < 5; i += 1) await change(cookie, 'Wrong-Password-123456', NEW_PASSWORD).expect(422);
    const correct = await change(cookie, GOOD_PASSWORD, NEW_PASSWORD).expect(423);
    expect(correct.body).toEqual({ statusCode: 423, code: 'AUTH_ACCOUNT_LOCKED', message: 'Account temporarily locked', retryAfterSeconds: 900 });
    expect(correct.headers['retry-after']).toBe('900');
    // while locked the current password is not evaluated: a wrong one gets the same answer and is not counted (D1)
    expect((await change(cookie, 'Wrong-Password-123456', NEW_PASSWORD).expect(423)).text).toBe(correct.text);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).failedLoginCount).toBe(5);
    // the public login route never answers 423 (D1)
    expect((await login(u.email!, GOOD_PASSWORD).expect(401)).body.code).toBe('AUTH_INVALID_CREDENTIALS');
    await http().get('/api/auth/session').set('Cookie', cookie).expect(200);
  });

  it('change refuses pre-sessions', async () => {
    const u = await staff();
    await change(await loginAs(t.app, u.id, 'PRE_MFA'), GOOD_PASSWORD, NEW_PASSWORD).expect(401);
  });
});
```

Snapshot additions (sorted: `/api/account/…` before `/api/auth/…`): `POST /api/account/password` → session `["FULL"]`; `POST /api/auth/password/forgot` and `POST /api/auth/password/reset` → public.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm turbo run test --filter=@tms/api-admin`
Expected: FAIL — the three routes return 404.

- [ ] **Step 3: Implement `PasswordService`**

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { PasswordHasher } from '@tms/auth-core';
import { DomainError } from '@tms/contracts';
import { type AppTransactionHost, AuditService, MailNotifier, type Principal, TransactionHost, UnitOfWork } from '../../../shared';
import { assertStrongPassword } from '../credentials';
import { AccountLockService } from '../login/account-lock.service';
import { accountLocked } from '../login/login.service';
import { AUTH_OPTIONS, type AdminAuthOptions } from '../options';
import { PASSWORD_HASHER } from '../ports';
import { SessionService } from '../sessions/session.service';
import { ActionTokenService } from '../tokens/action-token.service';

const tokenInvalid = () => new DomainError('AUTH_TOKEN_INVALID', 'This link is invalid or has expired');

@Injectable()
export class PasswordService {
  constructor(
    @Inject(TransactionHost) private readonly txHost: AppTransactionHost,
    private readonly uow: UnitOfWork,
    private readonly tokens: ActionTokenService,
    private readonly sessions: SessionService,
    private readonly locks: AccountLockService,
    private readonly audit: AuditService,
    private readonly mail: MailNotifier,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(AUTH_OPTIONS) private readonly options: AdminAuthOptions,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  async forgot(email: string): Promise<void> {
    const user = await this.db.user.findUnique({ where: { email } });
    const eligible = !!user && user.kind === 'STAFF' && user.status === 'ACTIVE' && !!user.passwordHash;
    await this.uow.run(async () => {
      if (eligible) await this.issueReset(user.id, null);
      await this.audit.record({
        action: 'auth.password-reset.requested', outcome: 'SUCCESS',
        ...(eligible ? { target: { type: 'User', id: user.id } } : {}),
        metadata: { knownAccount: eligible },
      });
    });
  }

  /** Issues a PASSWORD_RESET token and mails it after commit; callers own the transaction. */
  async issueReset(userId: string, createdById: string | null): Promise<void> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    const { token, expiresAt } = await this.tokens.issue(userId, 'PASSWORD_RESET', this.options.passwordReset.ttlSeconds, createdById);
    this.mail.afterCommit({
      userId, to: user.email ?? '', template: 'password-reset',
      vars: { firstName: user.firstName, url: `${this.options.webBaseUrl}/reset-password#t=${token}`, expiresAt: expiresAt.toISOString() },
    });
  }

  async reset(token: string, password: string): Promise<void> {
    const peeked = await this.tokens.peek(token, 'PASSWORD_RESET');
    if (!peeked) {
      await this.audit.record({ action: 'auth.password-reset.completed', outcome: 'FAILURE', metadata: { reason: 'INVALID_TOKEN' } });
      throw tokenInvalid();
    }
    const user = await this.db.user.findUniqueOrThrow({ where: { id: peeked.userId } });
    assertStrongPassword(password, user);
    const passwordHash = await this.hasher.hash(password);
    const ok = await this.uow.run(async () => {
      const consumed = await this.tokens.consume(token, 'PASSWORD_RESET');
      const current = consumed ? await this.db.user.findUnique({ where: { id: consumed.userId } }) : null;
      // a consumed link of a user blocked or deactivated since the mail is spent without effect
      if (!consumed || !current || current.kind !== 'STAFF' || current.status !== 'ACTIVE') {
        await this.audit.record({ action: 'auth.password-reset.completed', outcome: 'FAILURE', target: { type: 'User', id: peeked.userId }, metadata: { reason: 'INVALID_TOKEN' } });
        return false;
      }
      await this.db.user.update({ where: { id: current.id }, data: { passwordHash } });
      const sessionsRevoked = await this.sessions.revokeAllSessions(current.id);
      await this.tokens.revokeUnusedTokens(current.id);
      await this.audit.record({ action: 'auth.password-reset.completed', outcome: 'SUCCESS', actorUserId: current.id, target: { type: 'User', id: current.id }, metadata: { sessionsRevoked } });
      return true;
    });
    if (!ok) throw tokenInvalid();
  }

  async change(principal: Principal, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: principal.userId } });
    // D1: while locked the current password is not evaluated (no guessing oracle for a stolen session); any input → 423
    const lockedBefore = this.locks.isLockedNow(user);
    const verified = !lockedBefore && !!user.passwordHash && (await this.hasher.verify(user.passwordHash, currentPassword));
    if (verified) assertStrongPassword(newPassword, user, 'newPassword');
    const passwordHash = verified ? await this.hasher.hash(newPassword) : null;

    const outcome = await this.uow.run(async () => {
      const account = await this.locks.lock(user.id);
      const failure = (reason: 'INVALID_CREDENTIALS' | 'ACCOUNT_LOCKED') =>
        this.audit.record({ action: 'auth.password.changed', outcome: 'FAILURE', actorUserId: user.id, target: { type: 'User', id: user.id }, metadata: { reason } });
      if (lockedBefore || account.isLocked) {
        await failure('ACCOUNT_LOCKED');
        // the lock may have expired since the pre-check (password not evaluated): retry in a second
        return { kind: 'locked', retryAfterSeconds: Math.max(account.remainingSeconds, 1) } as const;
      }
      if (!verified || !passwordHash) {
        await this.locks.fail(account);
        await failure('INVALID_CREDENTIALS');
        return { kind: 'wrong' } as const;
      }
      await this.locks.keep(account);
      await this.db.user.update({ where: { id: user.id }, data: { passwordHash } });
      const sessionsRevoked = await this.sessions.revokeAllSessions(user.id);
      await this.tokens.revokeUnusedTokens(user.id);
      await this.audit.record({ action: 'auth.password.changed', outcome: 'SUCCESS', actorUserId: user.id, target: { type: 'User', id: user.id }, metadata: { sessionsRevoked } });
      return { kind: 'ok' } as const;
    });

    if (outcome.kind === 'locked') throw accountLocked(outcome.retryAfterSeconds);
    if (outcome.kind === 'wrong') {
      throw new DomainError('VALIDATION_FAILED', 'Validation failed', {
        fields: [{ path: 'currentPassword', code: 'INVALID_PASSWORD', message: 'The current password is not correct' }],
      });
    }
  }
}
```

Register `PasswordService` in `AdminAuthModule` and export it; `options.ts` adds `passwordReset: { ttlSeconds: number }`; env `PASSWORD_RESET_TTL_MINUTES` (default 60, 5–1440) in `apps/api-admin/src/env.ts`, and `apps/api-admin/test/env.spec.ts` gains `PASSWORD_RESET_TTL_MINUTES: 60` in its exact `toEqual`.

- [ ] **Step 4: Controllers**

`dto.ts` adds `ForgotPasswordDto`, `ResetPasswordDto`, `ChangePasswordDto`.

`apps/api-admin/src/auth/password.controller.ts`:

```ts
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { PasswordService } from '@tms/domain/admin';
import { AuthThrottle, Public } from '@tms/domain/shared';
import { ForgotPasswordDto, ResetPasswordDto } from './dto';

@Controller('auth/password')
export class PasswordController {
  constructor(private readonly passwords: PasswordService) {}

  @Public()
  @AuthThrottle()
  @Post('forgot')
  @HttpCode(202)
  forgot(@Body() body: ForgotPasswordDto): Promise<void> {
    return this.passwords.forgot(body.email);
  }

  @Public()
  @AuthThrottle()
  @Post('reset')
  @HttpCode(204)
  reset(@Body() body: ResetPasswordDto): Promise<void> {
    return this.passwords.reset(body.token, body.password);
  }
}
```

`apps/api-admin/src/account/account.controller.ts`:

```ts
import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import { PasswordService, SessionCookie } from '@tms/domain/admin';
import { AuthThrottle, CurrentPrincipal, type Principal, RequireSession } from '@tms/domain/shared';
import type { Response } from 'express';
import { ChangePasswordDto } from '../auth/dto';

@Controller('account')
export class AccountController {
  constructor(private readonly passwords: PasswordService, private readonly cookie: SessionCookie) {}

  @RequireSession('FULL')
  @AuthThrottle()
  @Post('password')
  @HttpCode(204)
  async changePassword(@CurrentPrincipal() p: Principal, @Body() body: ChangePasswordDto, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.passwords.change(p, body.currentPassword, body.newPassword);
    this.cookie.clear(res);
  }
}
```

Register both controllers in `AuthHttpModule`.

- [ ] **Step 5: Run the tests and verify**

Run: `pnpm turbo run test --filter=@tms/api-admin && pnpm verify`
Expected: `password.e2e-spec` (8 tests), the api-admin env spec and the snapshot pass.

- [ ] **Step 6: Commit**

```bash
git add packages/domain apps/api-admin docs/efficiency/critical-path.md
git commit -m "feat(domain): add self-service password reset and password change with revocation"
```

PR body: diagram `sequenceDiagram` (forgot → mail → reset: peek → policy → consume → revoke); boundaries: `@tms/domain/admin`, api-admin routes, env; no migration; reviewer: `security-reviewer`.
