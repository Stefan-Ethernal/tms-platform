# Phase 2 — Task 22: Admin 2FA reset, admin-sent password reset, sole-admin recovery CLI

> Part of the phase 2 plan: read [index.md](index.md) (constraints, shared interfaces, env) and this file only.


**Files:**
- Create: `packages/domain/src/admin/auth/mfa-reset/mfa-reset.service.ts`, `packages/domain/src/admin/auth/mfa-reset/admin-mfa-recovery.service.ts`; Modify: `packages/domain/src/admin/auth/options.ts` (`mfaReset`), `packages/domain/src/admin/users/user-lifecycle.service.ts` (`sendPasswordReset`), `packages/domain/src/admin/users/last-admin.guard.ts` (`lockForSystemAction`), `packages/domain/src/admin/auth/passwords/password.service.ts` (`reset` re-issues a pending 2FA reset link, D2), `packages/domain/src/admin/admin-auth.module.ts`, `packages/domain/src/admin/index.ts`, `packages/domain/test/admin/support/options.ts` (`mfaReset`)
- Create: `apps/api-admin/src/auth/mfa-reset.controller.ts`, `apps/api-admin/src/cli/reset-mfa.ts`; Modify: `apps/api-admin/src/admin/users/user-admin.controller.ts`, `apps/api-admin/src/auth/dto.ts` (`AcceptMfaResetDto`), `apps/api-admin/src/auth/auth-http.module.ts`, `apps/api-admin/src/env.ts`, `apps/api-admin/src/auth-options.ts`, `apps/api-admin/.env.example`, `apps/api-admin/package.json` (script `admin:reset-mfa`), `infra/docker-compose.yml` (`MFA_RESET_TTL_HOURS` for `api-admin`)
- Create: `apps/api-admin/test/admin-resets.e2e-spec.ts`, `apps/api-admin/test/reset-mfa-cli.e2e-spec.ts`; Modify: `apps/api-admin/test/route-access.snapshot.json`, `apps/api-admin/test/env.spec.ts` (exact `toEqual` defaults gain `MFA_RESET_TTL_HOURS: 72`)

**Interfaces:**
- Consumes: `LastAdminGuard`, `LockedUser`, `preflight`, `refuseAdminAction`, `adminRefusalError`, `AdminDecision`, `AdminRefusal` (20); `ActionTokenService.issue`/`peek`/`consume`/`revokeUnusedTokens` (13); `AccountLockService.lock`/`isLockedNow`/`fail`/`keep`, `invalidCredentials` (16); `SessionService.create`, `revokeAllSessions`, `describe` (11); `PasswordService.issueReset`, `PasswordService.reset` (18, extended here); `MailNotifier` (12, template `mfa-reset`), `AfterCommitError` (12), `waitForMail` (12, fixtures); `PASSWORD_HASHER` (14); the enrollment routes of Task 14, which finish the flow; `maskEmail`, `CliModule`, the CLI entry pattern and the `@tms/api-admin#test` → `build` dependency (15); `ActionTokenIssuedResponse`, `AcceptMfaResetRequestSchema`, `isDomainError` (08); `EmailSchema`, `ADMIN_ROLE_KEY`, `AppTransactionHost`, `envSchema` (phase 1, `envSchema` moved to `src/env.ts` by Task 10).
- Produces:
  - `MfaResetService`: `issue(actor: Principal | null, userId: string, options?: { awaitDelivery?: boolean }): Promise<{ expiresAt: Date; url: string }>` (`actor = null` is the system actor of the recovery CLI: audit `actorUserId: null`, `via: 'CLI'`); `issueLink(user: MfaResetRecipient, createdById: string | null): Promise<{ expiresAt: Date; url: string }>` (token + mail after commit, inside the caller's transaction; reused by `PasswordService.reset`); `accept(token: string, password: string): Promise<IssuedSession>`; `MfaResetRecipient = { id: string; email: string; firstName: string }`.
  - `AdminMfaRecoveryService.run(options: { email: string | undefined; print: boolean; production: boolean }): Promise<{ exitCode: 0 | 1; lines: string[] }>`; entry `dist/cli/reset-mfa.js <email> [--print]`, script `admin:reset-mfa`.
  - `LastAdminGuard.lockForSystemAction(targetId: string): Promise<{ activeAdminIds: string[]; target: LockedUser | null }>`.
  - `UserLifecycleService.sendPasswordReset(actor: Principal, userId: string): Promise<void>`.
  - Routes: `POST /api/users/:id/mfa-reset` (`users:reset-mfa`, step-up) → 202 `{ expiresAt }`; `POST /api/users/:id/password-reset` (`users:update`) → 202, empty body; `POST /api/auth/mfa-reset/accept` (`@Public`, `@AuthThrottle`) → 200 `SessionStateResponse` + ENROLLMENT cookie.
  - `AdminAuthOptions.mfaReset = { ttlSeconds }` (env `MFA_RESET_TTL_HOURS`, default 72, 1–336).

Rules (each has a test):
- **issue (admin route)**: Task 20's preflight (401 / 404 / own account 403). The target must be an ACTIVE STAFF user with an email — enrolled, or with a reset already pending (ACTIVE without `totpEnabledAt` exists only after a 2FA reset; issuing again rotates the link) — otherwise 409 `USER_STATE_CONFLICT`. One transaction clears `totpSecretEnc`, `totpKeyId`, `totpEnabledAt`, `totpLastUsedStep`, deletes the recovery codes, revokes all sessions and unused tokens, issues an MFA_RESET token (72 h, `createdById` = actor) and audits `auth.mfa.reset { via: 'ADMIN', sessionsRevoked, linksRevoked }`; the mail `mfa-reset` with `${webBaseUrl}/mfa-reset#t=<token>` goes out after commit. The user stays ACTIVE; `evaluateStaffSession` refuses FULL and PRE_MFA without an enrolled TOTP, and a correct password at an unlocked login answers 403 `AUTH_MFA_RESET_PENDING` (Task 16) — never a PRE_MFA session (Review Focus 2).
- **accept (public, D1)**: the token is peeked first (unknown, used or expired → 400 `AUTH_TOKEN_INVALID` before any argon2 work). The user's lock columns are read without the row lock (`AccountLockService.isLockedNow`): while the account is locked the password is **not** evaluated — the dummy argon2 hash runs instead, so the work is equal — and under `AccountLockService.lock` the attempt is not counted and answers the generic 401 `AUTH_INVALID_CREDENTIALS`, byte-identical to a wrong password, audit `auth.mfa-reset.accepted { reason: 'ACCOUNT_LOCKED' }`; the token stays valid. The same holds when the row lock shows a lock that a parallel request started after the read. The route never answers 423: it is public, the caller has not proven the account. Not locked: the password is verified outside the transaction; a wrong password counts towards the shared lockout, answers the same 401 (`reason: 'INVALID_CREDENTIALS'`) with the token still valid (Review Focus 4); a correct password consumes the token (the loser of a race gets 400), re-checks ACTIVE STAFF without `totpEnabledAt`, keeps the counter (Review Focus 1: only a completed second factor resets it), revokes other sessions and opens an ENROLLMENT session. Task 14's routes finish: `setPassword` → 409 for an ACTIVE user, TOTP start and confirm → FULL, new recovery codes, `auth.enrollment.completed { flow: 'MFA_RESET' }`, counter and level reset. Completion is a successful sign-in.
- **password reset while a 2FA reset is pending (D2)**: `PasswordService.reset()` keeps revoking all sessions and **all** unused tokens (spec section 8.5), so the pending MFA_RESET link dies with the rest. When the reset target is ACTIVE with `totpEnabledAt = null`, `reset()` then calls `MfaResetService.issueLink` in the same transaction (fresh MFA_RESET token, `MFA_RESET_TTL_HOURS`, `createdById = null`), the `mfa-reset` mail goes out after commit, and the audit row is `auth.password-reset.completed { sessionsRevoked, mfaResetReissued: true }` (the key is absent for an enrolled user). Without this the user would answer 403 `AUTH_MFA_RESET_PENDING` at every login until an admin re-issued the reset. `change()` needs a FULL session, which a user with a pending reset cannot hold, so it stays as Task 18 wrote it.
- **sole-admin recovery CLI (D3)**: `pnpm --dir apps/api-admin run admin:reset-mfa <email> [--print]` = `node --env-file-if-exists=.env dist/cli/reset-mfa.js` (env source `apps/api-admin/.env`, like Task 15's `bootstrap:invite`; in the compose `full` stack `pnpm compose --profile full run --rm bootstrap node dist/cli/reset-mfa.js <email>`). It calls `MfaResetService.issue(null, userId, { awaitDelivery: true })`: lock protocol `lockForSystemAction` (the ACTIVE admin rows, then the target — the same order as every admin action), then the target must be an ACTIVE STAFF holder of the `ADMIN_ROLE_KEY` role with an email, enrolled (`totpEnabledAt ≠ null`) or with a reset already pending; the rest is the admin route's transaction with `actorUserId = null`, `createdById = null` and audit `auth.mfa.reset { via: 'CLI', sessionsRevoked, linksRevoked }`. Output: outside production (or with `--print`) `2FA reset URL: <url>` and `2FA reset link mailed to <email>`; in production `2FA reset link mailed to a***@example.com`. Any other target — unknown email, not an admin, not ACTIVE, a driver — exits 1 with one line of the same shape, `no active admin with the email a***@example.com; nothing changed`, and writes nothing (no audit row: there is no actor and, for an unknown email, no target). A missing or malformed email exits 1 with `usage: admin:reset-mfa <email> [--print]`. A failed delivery revokes the new link and exits 1 with `mail delivery failed; the new 2FA reset link was revoked, run the command again` (Task 15's pattern). Accepting a pending reset as a target is what makes that retry — and a new link after the 72 h expiry — possible; D3's wording names only the enrolled case; this extension is reported to the plan's deviations for the owner.
- **Drivers**: 2FA reset and the admin-sent password reset are staff-only; a DRIVER target (even with an email on file) is 409 `USER_STATE_CONFLICT`, audit reason `STATE_CONFLICT`, no token and no mail. Drivers sign in with card + PIN (phase 5).
- **admin-sent password reset**: preflight, target ACTIVE STAFF (enrolled users always have a password) else 409; `PasswordService.issueReset(userId, actor.userId)` inside the same transaction, audit `admin.user.password-reset-sent`; nothing is revoked when the link is sent (the reset itself revokes, Task 18).

- [ ] **Step 1: Write the failing API tests**

`apps/api-admin/test/admin-resets.e2e-spec.ts`:

```ts
import request from 'supertest';
import { generateTotpCode, type PasswordHasher } from '@tms/auth-core';
import type { PrismaService } from '@tms/db/nest';
import { PASSWORD_HASHER } from '@tms/domain/admin';
import { createAdminTestApp, type AdminTestApp, ORIGIN } from './support/app';
import { createStaffUser, GOOD_PASSWORD, loginAs, seedBase, waitForMail, withCredentials } from './support/fixtures';

const MFA_LINK = /\/mfa-reset#t=([A-Za-z0-9_-]{43})$/m;
const RESET_LINK = /\/reset-password#t=([A-Za-z0-9_-]{43})$/m;
const NEW_PASSWORD = 'Another-Sturdy-Passphrase-77';
const WRONG_PASSWORD = 'Wrong-Password-123456';

describe('admin 2FA reset and password reset (API)', () => {
  let t: AdminTestApp;
  let prisma: PrismaService;
  let admin: { id: string };
  let adminCookie: string;
  const http = () => request(t.app.getHttpServer());
  const post = (path: string, cookie: string | null, body: object = {}) => {
    const req = http().post(path).set('Origin', ORIGIN);
    return (cookie ? req.set('Cookie', cookie) : req).send(body);
  };
  const issueMfaReset = (id: string, cookie = adminCookie) => post(`/api/users/${id}/mfa-reset`, cookie);
  const sendPasswordReset = (id: string, cookie = adminCookie) => post(`/api/users/${id}/password-reset`, cookie);
  const accept = (token: string, password: string) => post('/api/auth/mfa-reset/accept', null, { token, password });
  const login = (email: string, password: string) => post('/api/auth/login', null, { email, password });
  const cookieOf = (res: request.Response) => res.headers['set-cookie']![0]!.split(';')[0]!;
  /** Waits for the mail to `to` (delivery runs after commit), empties the outbox and returns the link's token. */
  const mailedLink = async (link: RegExp, to: string) => {
    const mail = await waitForMail(t.mail, to);
    t.mail.clear();
    return link.exec(mail.text)![1]!;
  };
  async function staff(role: 'admin' | 'operator' = 'operator') {
    const u = await createStaffUser(prisma, { role });
    await withCredentials(t.app, u.id);
    return u;
  }

  beforeAll(async () => { t = await createAdminTestApp(); });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    prisma = await seedBase(t.app);
    t.mail.clear();
    t.clock.set(new Date('2026-09-23T10:00:00Z'));
    admin = await staff('admin');
    adminCookie = await loginAs(t.app, admin.id);
  });

  it('full 2FA reset: revocation, pending login, password step, enrollment again, then a normal sign-in (Review Focus 2)', async () => {
    const u = await staff();
    const oldSession = await loginAs(t.app, u.id);
    const issued = await issueMfaReset(u.id).expect(202);
    expect(Object.keys(issued.body)).toEqual(['expiresAt']);
    await http().get('/api/auth/session').set('Cookie', oldSession).expect(401);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).toMatchObject({
      status: 'ACTIVE', totpSecretEnc: null, totpKeyId: null, totpEnabledAt: null, totpLastUsedStep: null,
    });
    expect(await prisma.recoveryCode.count({ where: { userId: u.id } })).toBe(0);
    expect(await prisma.actionToken.findFirstOrThrow({ where: { userId: u.id, type: 'MFA_RESET', usedAt: null } })).toMatchObject({ createdById: admin.id });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'auth.mfa.reset', outcome: 'SUCCESS', targetId: u.id } });
    expect(audit).toMatchObject({ actorUserId: admin.id, metadata: { via: 'ADMIN', sessionsRevoked: 1, linksRevoked: 0 } });

    expect((await login(u.email!, GOOD_PASSWORD).expect(403)).body.code).toBe('AUTH_MFA_RESET_PENDING');
    const accepted = await accept(await mailedLink(MFA_LINK, u.email!), GOOD_PASSWORD).expect(200);
    expect(accepted.body).toMatchObject({ scope: 'ENROLLMENT', next: 'ENROLL_TOTP' });
    const enrollment = cookieOf(accepted);

    expect((await post('/api/auth/enrollment/password', enrollment, { password: NEW_PASSWORD }).expect(409)).body.code).toBe('USER_STATE_CONFLICT');
    const start = await post('/api/auth/enrollment/totp', enrollment).expect(200);
    const done = await post('/api/auth/enrollment/totp/confirm', enrollment, { code: await generateTotpCode(start.body.secret, t.clock.now()) }).expect(200);
    expect(done.body.recoveryCodes).toHaveLength(10);
    const completed = await prisma.auditLog.findFirstOrThrow({ where: { action: 'auth.enrollment.completed', targetId: u.id } });
    expect(completed.metadata).toEqual({ flow: 'MFA_RESET' });

    t.clock.advance(60_000);
    const pre = cookieOf(await login(u.email!, GOOD_PASSWORD).expect(200));
    await post('/api/auth/mfa', pre, { code: await generateTotpCode(start.body.secret, t.clock.now()) }).expect(200);
  });

  it('wrong passwords at the reset step share the login lockout; while locked the password is not evaluated (D1, Review Focus 4)', async () => {
    const u = await staff();
    await issueMfaReset(u.id).expect(202);
    const token = await mailedLink(MFA_LINK, u.email!);
    for (let i = 0; i < 5; i += 1) {
      expect((await accept(token, WRONG_PASSWORD).expect(401)).body.code).toBe('AUTH_INVALID_CREDENTIALS');
    }
    const { passwordHash } = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    const hasher = t.app.get<PasswordHasher>(PASSWORD_HASHER);
    const spy = jest.spyOn(hasher, 'verify');
    const correct = await accept(token, GOOD_PASSWORD).expect(401);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).not.toBe(passwordHash); // the dummy hash, not the stored one
    spy.mockRestore();
    const wrong = await accept(token, WRONG_PASSWORD).expect(401);
    expect(correct.text).toBe(wrong.text);
    expect(correct.text).toBe(JSON.stringify({ statusCode: 401, code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid email or password' }));
    expect(correct.headers['retry-after']).toBeUndefined();
    expect(correct.headers['set-cookie']).toBeUndefined();
    expect(await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).toMatchObject({ failedLoginCount: 5, lockoutLevel: 1 });
    expect(await prisma.auditLog.count({
      where: { action: 'auth.mfa-reset.accepted', targetId: u.id, metadata: { path: ['reason'], equals: 'ACCOUNT_LOCKED' } },
    })).toBe(2);
    await login(u.email!, GOOD_PASSWORD).expect(401); // the login shares the lock (D1: no 423 on public routes)
    t.clock.advance(15 * 60_000);
    await accept(token, GOOD_PASSWORD).expect(200); // the link survived the lock
  });

  it('the link is single-use: rotation, parallel accepts, reuse and expiry (Review Focus 3)', async () => {
    const u = await staff();
    await issueMfaReset(u.id).expect(202);
    const first = await mailedLink(MFA_LINK, u.email!);
    await issueMfaReset(u.id).expect(202); // pending reset: issuing again rotates the link
    const second = await mailedLink(MFA_LINK, u.email!);
    expect((await accept(first, GOOD_PASSWORD).expect(400)).body.code).toBe('AUTH_TOKEN_INVALID');
    const results = await Promise.all([accept(second, GOOD_PASSWORD), accept(second, GOOD_PASSWORD)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    await accept(second, GOOD_PASSWORD).expect(400);
    expect(await prisma.session.count({ where: { userId: u.id, scope: 'ENROLLMENT' } })).toBe(1);

    const other = await staff();
    await issueMfaReset(other.id).expect(202);
    const late = await mailedLink(MFA_LINK, other.email!);
    t.clock.advance(72 * 3600_000 + 1000);
    await accept(late, GOOD_PASSWORD).expect(400);
  });

  it('an unknown token is rejected before any password work', async () => {
    const hasher = t.app.get<PasswordHasher>(PASSWORD_HASHER);
    const spy = jest.spyOn(hasher, 'verify');
    expect((await accept('A'.repeat(43), GOOD_PASSWORD).expect(400)).body.code).toBe('AUTH_TOKEN_INVALID');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('admin 2FA reset → forgot + reset: the old 2FA link is dead, the new mailed one finishes enrollment (D2)', async () => {
    const u = await staff();
    await issueMfaReset(u.id).expect(202);
    const oldLink = await mailedLink(MFA_LINK, u.email!);
    await post('/api/auth/password/forgot', null, { email: u.email }).expect(202);
    await post('/api/auth/password/reset', null, { token: await mailedLink(RESET_LINK, u.email!), password: NEW_PASSWORD }).expect(204);
    const newLink = await mailedLink(MFA_LINK, u.email!);
    const row = await prisma.actionToken.findFirstOrThrow({ where: { userId: u.id, type: 'MFA_RESET', usedAt: null } });
    expect(row.expiresAt.getTime() - t.clock.now().getTime()).toBe(72 * 3600_000);
    const completedReset = await prisma.auditLog.findFirstOrThrow({ where: { action: 'auth.password-reset.completed', outcome: 'SUCCESS', targetId: u.id } });
    expect(completedReset.metadata).toEqual({ sessionsRevoked: 0, mfaResetReissued: true });

    expect((await accept(oldLink, NEW_PASSWORD).expect(400)).body.code).toBe('AUTH_TOKEN_INVALID');
    const accepted = await accept(newLink, NEW_PASSWORD).expect(200);
    expect(accepted.body).toMatchObject({ scope: 'ENROLLMENT', next: 'ENROLL_TOTP' });
    const enrollment = cookieOf(accepted);
    const start = await post('/api/auth/enrollment/totp', enrollment).expect(200);
    await post('/api/auth/enrollment/totp/confirm', enrollment, { code: await generateTotpCode(start.body.secret, t.clock.now()) }).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).totpEnabledAt).not.toBeNull();
  });

  it('2FA reset needs users:reset-mfa, a fresh step-up and another ACTIVE staff user', async () => {
    const u = await staff();
    const operatorCookie = await loginAs(t.app, (await staff()).id);
    expect((await issueMfaReset(u.id, operatorCookie).expect(403)).body.code).toBe('FORBIDDEN');
    expect((await issueMfaReset(admin.id).expect(403)).body.code).toBe('SELF_ACTION_FORBIDDEN');
    const invited = await createStaffUser(prisma, { status: 'INVITED', enrolled: false });
    expect((await issueMfaReset(invited.id).expect(409)).body.code).toBe('USER_STATE_CONFLICT');
    const driver = await createStaffUser(prisma, { kind: 'DRIVER', role: 'driver', enrolled: false });
    expect((await issueMfaReset(driver.id).expect(409)).body.code).toBe('USER_STATE_CONFLICT');
    t.clock.advance(11 * 60_000);
    expect((await issueMfaReset(u.id).expect(403)).body.code).toBe('AUTH_STEP_UP_REQUIRED');
    expect(await prisma.auditLog.count({ where: { action: 'auth.mfa.reset', outcome: 'FAILURE' } })).toBe(3);
    expect(t.mail.sent).toHaveLength(0); // refusals queue no mail at all
  });

  it('an admin-sent password reset mails a link that works with the self-service reset', async () => {
    const u = await staff();
    const cookie = await loginAs(t.app, u.id);
    const res = await sendPasswordReset(u.id).expect(202);
    expect(res.text).toBe('');
    await http().get('/api/auth/session').set('Cookie', cookie).expect(200); // nothing revoked yet
    expect(await prisma.actionToken.findFirstOrThrow({ where: { userId: u.id, type: 'PASSWORD_RESET' } })).toMatchObject({ createdById: admin.id });
    expect(await prisma.auditLog.count({ where: { action: 'admin.user.password-reset-sent', outcome: 'SUCCESS', actorUserId: admin.id, targetId: u.id } })).toBe(1);
    await post('/api/auth/password/reset', null, { token: await mailedLink(RESET_LINK, u.email!), password: NEW_PASSWORD }).expect(204);
    await http().get('/api/auth/session').set('Cookie', cookie).expect(401);
    await login(u.email!, NEW_PASSWORD).expect(200);
    // an enrolled user gets no 2FA link from a password reset (D2 applies only to a pending 2FA reset)
    expect(await prisma.actionToken.count({ where: { userId: u.id, type: 'MFA_RESET' } })).toBe(0);
    const completed = await prisma.auditLog.findFirstOrThrow({ where: { action: 'auth.password-reset.completed', outcome: 'SUCCESS', targetId: u.id } });
    expect(completed.metadata).not.toHaveProperty('mfaResetReissued');
  });

  it('an admin-sent password reset needs users:update, another user and an ACTIVE staff target', async () => {
    const u = await staff();
    const operatorCookie = await loginAs(t.app, (await staff()).id);
    expect((await sendPasswordReset(u.id, operatorCookie).expect(403)).body.code).toBe('FORBIDDEN');
    expect((await sendPasswordReset(admin.id).expect(403)).body.code).toBe('SELF_ACTION_FORBIDDEN');
    const invited = await createStaffUser(prisma, { status: 'INVITED', enrolled: false });
    expect((await sendPasswordReset(invited.id).expect(409)).body.code).toBe('USER_STATE_CONFLICT');
    const driver = await createStaffUser(prisma, { kind: 'DRIVER', role: 'driver', enrolled: false });
    expect((await sendPasswordReset(driver.id).expect(409)).body.code).toBe('USER_STATE_CONFLICT');
    expect(await prisma.actionToken.count({ where: { userId: driver.id } })).toBe(0);
    expect(t.mail.sent).toHaveLength(0); // refusals queue no mail at all
  });
});
```

`apps/api-admin/test/reset-mfa-cli.e2e-spec.ts` (D3; the service in process for the whole flow, the built entry point as a child process like Task 15's CLI test):

```ts
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import request from 'supertest';
import { generateTotpCode } from '@tms/auth-core';
import type { PrismaService } from '@tms/db/nest';
import { testDatabaseUrl } from '@tms/db/testing';
import { AdminMfaRecoveryService } from '@tms/domain/admin';
import { createAdminTestApp, type AdminTestApp, ORIGIN } from './support/app';
import { createStaffUser, GOOD_PASSWORD, seedBase, waitForMail, withCredentials } from './support/fixtures';

const run = promisify(execFile);
const cli = join(__dirname, '..', 'dist', 'cli', 'reset-mfa.js');
const MFA_LINK = /\/mfa-reset#t=([A-Za-z0-9_-]{43})$/m;

describe('admin:reset-mfa, sole-admin recovery (D3)', () => {
  let t: AdminTestApp;
  let prisma: PrismaService;
  let recovery: AdminMfaRecoveryService;
  const post = (path: string, cookie: string | null, body: object = {}) => {
    const req = request(t.app.getHttpServer()).post(path).set('Origin', ORIGIN);
    return (cookie ? req.set('Cookie', cookie) : req).send(body);
  };
  const cookieOf = (res: request.Response) => res.headers['set-cookie']![0]!.split(';')[0]!;
  const resetMfa = (email: string | undefined, o: Partial<{ print: boolean; production: boolean }> = {}) =>
    recovery.run({ email, print: false, production: false, ...o });
  async function enrolledAdmin(email: string) {
    const u = await createStaffUser(prisma, { role: 'admin', email });
    await withCredentials(t.app, u.id);
    return u;
  }

  beforeAll(async () => {
    t = await createAdminTestApp();
    recovery = t.app.get(AdminMfaRecoveryService);
  });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    prisma = await seedBase(t.app);
    t.mail.clear();
    t.clock.set(new Date('2026-09-23T10:00:00Z'));
  });

  it('resets the only active admin: link mailed, accept → enrollment → FULL', async () => {
    const only = await enrolledAdmin('root@example.com');
    const result = await resetMfa('root@example.com');
    expect(result.exitCode).toBe(0);
    expect(result.lines[0]).toMatch(/^2FA reset URL: \S+\/mfa-reset#t=[A-Za-z0-9_-]{43}$/);
    expect(result.lines[1]).toBe('2FA reset link mailed to root@example.com');
    expect(await prisma.user.findUniqueOrThrow({ where: { id: only.id } })).toMatchObject({ status: 'ACTIVE', totpEnabledAt: null, totpSecretEnc: null });
    expect(await prisma.actionToken.findFirstOrThrow({ where: { userId: only.id, type: 'MFA_RESET', usedAt: null } })).toMatchObject({ createdById: null });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'auth.mfa.reset', targetId: only.id } });
    expect(audit).toMatchObject({ outcome: 'SUCCESS', actorUserId: null, metadata: { via: 'CLI', sessionsRevoked: 0, linksRevoked: 0 } });

    const token = MFA_LINK.exec((await waitForMail(t.mail, 'root@example.com')).text)![1]!;
    const enrollment = cookieOf(await post('/api/auth/mfa-reset/accept', null, { token, password: GOOD_PASSWORD }).expect(200));
    const start = await post('/api/auth/enrollment/totp', enrollment).expect(200);
    const done = await post('/api/auth/enrollment/totp/confirm', enrollment, { code: await generateTotpCode(start.body.secret, t.clock.now()) }).expect(200);
    const session = await request(t.app.getHttpServer()).get('/api/auth/session').set('Cookie', cookieOf(done)).expect(200);
    expect(session.body).toMatchObject({ scope: 'FULL' });
  });

  it('refuses a non-admin, a blocked admin and an unknown email with the same masked line; nothing changes', async () => {
    const operator = await createStaffUser(prisma, { role: 'operator', email: 'olga@example.com' });
    await withCredentials(t.app, operator.id);
    await createStaffUser(prisma, { role: 'admin', status: 'BLOCKED', email: 'bea@example.com' });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: operator.id } });
    expect(await resetMfa('olga@example.com')).toEqual({ exitCode: 1, lines: ['no active admin with the email o***@example.com; nothing changed'] });
    expect(await resetMfa('bea@example.com')).toEqual({ exitCode: 1, lines: ['no active admin with the email b***@example.com; nothing changed'] });
    expect(await resetMfa(' Nobody@Example.com')).toEqual({ exitCode: 1, lines: ['no active admin with the email n***@example.com; nothing changed'] });
    expect(await resetMfa(undefined)).toEqual({ exitCode: 1, lines: ['usage: admin:reset-mfa <email> [--print]'] });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: operator.id } })).toEqual(before);
    expect(await prisma.auditLog.count({ where: { action: 'auth.mfa.reset' } })).toBe(0);
    expect(await prisma.actionToken.count({ where: { type: 'MFA_RESET' } })).toBe(0);
    expect(t.mail.sent).toHaveLength(0);
  });

  it('in production mails the link without printing the URL unless --print', async () => {
    await enrolledAdmin('root@example.com');
    expect(await resetMfa('root@example.com', { production: true })).toEqual({ exitCode: 0, lines: ['2FA reset link mailed to r***@example.com'] });
    await waitForMail(t.mail, 'root@example.com');
    const printed = await resetMfa('root@example.com', { production: true, print: true }); // pending reset: rotates the link
    expect(printed.exitCode).toBe(0);
    expect(printed.lines[0]).toMatch(/^2FA reset URL: /);
  });

  it('a failed delivery revokes the new link; running the command again works', async () => {
    const only = await enrolledAdmin('root@example.com');
    const send = jest.spyOn(t.mail, 'send').mockRejectedValueOnce(new Error('SMTP down'));
    expect(await resetMfa('root@example.com')).toEqual({
      exitCode: 1, lines: ['mail delivery failed; the new 2FA reset link was revoked, run the command again'],
    });
    send.mockRestore();
    expect(await prisma.actionToken.count({ where: { userId: only.id, usedAt: null } })).toBe(0);
    expect((await resetMfa('root@example.com')).exitCode).toBe(0);
    expect(await prisma.actionToken.count({ where: { userId: only.id, type: 'MFA_RESET', usedAt: null } })).toBe(1);
  });

  it('the built CLI exits 1 with plain lines and no secret or stack trace', async () => {
    const env = { ...process.env, NODE_ENV: 'development', DATABASE_URL: testDatabaseUrl(), SMTP_URL: 'smtp://127.0.0.1:1', LOG_FILE_ENABLED: 'false' };
    type Failure = { code: number; stdout: string; stderr: string };
    const usage = (await run('node', [cli], { env }).catch((e: Failure) => e)) as Failure;
    expect(usage).toMatchObject({ code: 1 });
    expect(usage.stdout).toContain('usage: admin:reset-mfa <email> [--print]');
    const unknown = (await run('node', [cli, 'nobody@example.com'], { env }).catch((e: Failure) => e)) as Failure;
    expect(unknown).toMatchObject({ code: 1 });
    expect(unknown.stdout).toContain('no active admin with the email n***@example.com; nothing changed');
    for (const out of [usage, unknown]) expect(`${out.stdout}${out.stderr}`).not.toMatch(/postgresql:\/\/|at .*\.js:\d+/);
  });
});
```

`dist/cli/reset-mfa.js` exists when the tests run: Task 15 made api-admin's `test` depend on its own `build`.

Snapshot additions (in sorted position):

```json
{ "route": "POST /api/auth/mfa-reset/accept", "access": { "kind": "public", "stepUp": false } },
{ "route": "POST /api/users/:id/mfa-reset", "access": { "kind": "permissions", "codes": ["users:reset-mfa"], "stepUp": true } },
{ "route": "POST /api/users/:id/password-reset", "access": { "kind": "permissions", "codes": ["users:update"], "stepUp": false } }
```

After this task the snapshot holds the 23 routes of phase 2, in this order (`localeCompare`): `GET /api/auth/session`, `GET /api/health`, `POST /api/account/password`, `POST /api/account/recovery-codes`, `POST /api/auth/enrollment/password`, `POST /api/auth/enrollment/totp`, `POST /api/auth/enrollment/totp/confirm`, `POST /api/auth/invite/accept`, `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/mfa`, `POST /api/auth/mfa-reset/accept`, `POST /api/auth/password/forgot`, `POST /api/auth/password/reset`, `POST /api/auth/step-up`, `POST /api/users/:id/block`, `POST /api/users/:id/deactivate`, `POST /api/users/:id/invite`, `POST /api/users/:id/mfa-reset`, `POST /api/users/:id/password-reset`, `POST /api/users/:id/unblock`, `POST /api/users/:id/unlock`, `PUT /api/users/:id/role`. The CLI adds no route.

`apps/api-admin/test/env.spec.ts`: the exact `toEqual` of the defaults gains `MFA_RESET_TTL_HOURS: 72`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm turbo run test --filter=@tms/api-admin`
Expected: FAIL — the three routes return 404; `admin-resets.e2e-spec` fails at the first `issueMfaReset`; `AdminMfaRecoveryService` is not exported and `dist/cli/reset-mfa.js` does not exist; `env.spec` misses `MFA_RESET_TTL_HOURS`.

- [ ] **Step 3: Implement `MfaResetService` and the system lock**

`LastAdminGuard` (Task 20) gains the lock for an action without an actor (the recovery CLI), on the same private row locker, so the order stays admin rows → target:

```ts
/** Lock protocol for an action without an actor (the recovery CLI, D3): active admin rows, then the target. */
async lockForSystemAction(targetId: string): Promise<{ activeAdminIds: string[]; target: LockedUser | null }> {
  const activeAdminIds = await this.lockActiveAdmins();
  const [target] = await this.lockUsers([targetId]);
  return { activeAdminIds, target: target ?? null };
}
```

`packages/domain/src/admin/auth/mfa-reset/mfa-reset.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { PasswordHasher } from '@tms/auth-core';
import { ADMIN_ROLE_KEY, DomainError } from '@tms/contracts';
import { type AppTransactionHost, AuditService, MailNotifier, type Principal, TransactionHost, UnitOfWork } from '../../../shared';
import { type AdminDecision, type AdminRefusal, adminRefusalError, preflight, refuseAdminAction } from '../../users/admin-action';
import { LastAdminGuard } from '../../users/last-admin.guard';
import { AccountLockService } from '../login/account-lock.service';
import { invalidCredentials } from '../login/login.service';
import { AUTH_OPTIONS, type AdminAuthOptions } from '../options';
import { PASSWORD_HASHER } from '../ports';
import { type IssuedSession, SessionService } from '../sessions/session.service';
import { ActionTokenService } from '../tokens/action-token.service';

const tokenInvalid = () => new DomainError('AUTH_TOKEN_INVALID', 'This link is invalid or has expired');

export interface MfaResetRecipient {
  id: string;
  email: string;
  firstName: string;
}

type IssuedLink = { expiresAt: Date; url: string };
type TargetCheck = { refusal: AdminRefusal } | { target: MfaResetRecipient };
type AcceptOutcome = { kind: 'ok'; issued: IssuedSession } | { kind: 'invalid' } | { kind: 'invalidToken' };

@Injectable()
export class MfaResetService {
  private dummyHash: Promise<string> | undefined;

  constructor(
    @Inject(TransactionHost) private readonly txHost: AppTransactionHost,
    private readonly uow: UnitOfWork,
    private readonly lastAdmin: LastAdminGuard,
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

  /** Same idea as `LoginService`: a real hash to verify against when the password must not be evaluated (equal work). */
  private dummy(): Promise<string> {
    this.dummyHash ??= this.hasher.hash('timing-equalisation-only-not-a-password');
    return this.dummyHash;
  }

  /**
   * Clears the second factor, revokes access and mails a single-use MFA_RESET link after commit (section 8.5).
   * `actor = null` is the system actor of the recovery CLI (D3): the target must hold the Admin role, and a refusal writes nothing.
   */
  async issue(actor: Principal | null, userId: string, options: { awaitDelivery?: boolean } = {}): Promise<IssuedLink> {
    const outcome = await this.uow.run(
      async (): Promise<AdminDecision<IssuedLink>> => {
        const checked = actor ? await this.checkAdminTarget(actor, userId) : await this.checkRecoveryTarget(userId);
        if ('refusal' in checked) return checked;
        await this.db.user.update({
          where: { id: userId },
          data: { totpSecretEnc: null, totpKeyId: null, totpEnabledAt: null, totpLastUsedStep: null },
        });
        await this.db.recoveryCode.deleteMany({ where: { userId } });
        const sessionsRevoked = await this.sessions.revokeAllSessions(userId);
        const linksRevoked = await this.tokens.revokeUnusedTokens(userId);
        const link = await this.issueLink(checked.target, actor?.userId ?? null);
        await this.audit.record({
          action: 'auth.mfa.reset', outcome: 'SUCCESS', actorUserId: actor?.userId ?? null, target: { type: 'User', id: userId },
          metadata: { via: actor ? 'ADMIN' : 'CLI', sessionsRevoked, linksRevoked },
        });
        return { ok: link };
      },
      { awaitEffects: options.awaitDelivery ?? false },
    );
    if ('refusal' in outcome) throw adminRefusalError(outcome.refusal);
    return outcome.ok;
  }

  /** A fresh MFA_RESET token and its mail after commit; the caller owns the transaction (issue, and PasswordService.reset for D2). */
  async issueLink(user: MfaResetRecipient, createdById: string | null): Promise<IssuedLink> {
    const { token, expiresAt } = await this.tokens.issue(user.id, 'MFA_RESET', this.options.mfaReset.ttlSeconds, createdById);
    const url = `${this.options.webBaseUrl}/mfa-reset#t=${token}`;
    this.mail.afterCommit({
      userId: user.id, to: user.email, template: 'mfa-reset',
      vars: { firstName: user.firstName, url, expiresAt: expiresAt.toISOString() },
    });
    return { expiresAt, url };
  }

  /** Admin route: Task 20's lock protocol and preflight; any ACTIVE staff user with an email (enrolled, or a reset already pending). */
  private async checkAdminTarget(actor: Principal, userId: string): Promise<TargetCheck> {
    const pre = preflight(await this.lastAdmin.lockForAdminAction(actor, userId), actor.userId, userId);
    if ('refusal' in pre) return refuseAdminAction(this.audit, 'auth.mfa.reset', actor, userId, pre.refusal);
    const { target } = pre;
    if (target.kind !== 'STAFF' || target.status !== 'ACTIVE' || !target.email) {
      return refuseAdminAction(this.audit, 'auth.mfa.reset', actor, userId, 'STATE_CONFLICT');
    }
    return { target: { id: target.id, email: target.email, firstName: target.firstName } };
  }

  /** Recovery CLI (D3): no actor to re-check; only an ACTIVE staff holder of the Admin role. Refusals write no audit row. */
  private async checkRecoveryTarget(userId: string): Promise<TargetCheck> {
    const { target } = await this.lastAdmin.lockForSystemAction(userId);
    if (!target) return { refusal: 'NOT_FOUND' };
    if (target.kind !== 'STAFF' || target.status !== 'ACTIVE' || target.roleKey !== ADMIN_ROLE_KEY || !target.email) {
      return { refusal: 'STATE_CONFLICT' };
    }
    return { target: { id: target.id, email: target.email, firstName: target.firstName } };
  }

  /** Public step: the password proves the account (under the shared lockout), then an ENROLLMENT session re-runs Task 14's TOTP steps. */
  async accept(token: string, password: string): Promise<IssuedSession> {
    const peeked = await this.tokens.peek(token, 'MFA_RESET');
    if (!peeked) {
      await this.audit.record({ action: 'auth.mfa-reset.accepted', outcome: 'FAILURE', metadata: { reason: 'INVALID_TOKEN' } });
      throw tokenInvalid();
    }
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: peeked.userId },
      select: { id: true, passwordHash: true, failedLoginCount: true, lockoutLevel: true, lockedUntil: true },
    });
    // D1: while locked the password is not evaluated; the dummy hash keeps the argon2 work equal.
    const lockedAtRead = this.locks.isLockedNow(user);
    const hash = lockedAtRead ? null : user.passwordHash;
    const matches = await this.hasher.verify(hash ?? (await this.dummy()), password);
    const verified = hash !== null && matches;

    const outcome = await this.uow.run(async (): Promise<AcceptOutcome> => {
      const account = await this.locks.lock(user.id);
      const fail = (reason: 'INVALID_TOKEN' | 'INVALID_CREDENTIALS' | 'ACCOUNT_LOCKED') =>
        this.audit.record({ action: 'auth.mfa-reset.accepted', outcome: 'FAILURE', target: { type: 'User', id: user.id }, metadata: { reason } });
      if (lockedAtRead || account.isLocked) {
        await fail('ACCOUNT_LOCKED'); // not counted, the token stays valid, the answer is the generic 401
        return { kind: 'invalid' };
      }
      if (!verified) {
        await this.locks.fail(account);
        await fail('INVALID_CREDENTIALS');
        return { kind: 'invalid' };
      }
      const consumed = await this.tokens.consume(token, 'MFA_RESET');
      if (!consumed || account.status !== 'ACTIVE' || account.totpEnabledAt !== null) {
        await fail('INVALID_TOKEN');
        return { kind: 'invalidToken' };
      }
      await this.locks.keep(account); // Review Focus 1: the password alone never resets the counter
      await this.sessions.revokeAllSessions(user.id);
      const issued = await this.sessions.create(user.id, 'ENROLLMENT', { mfaVerified: false });
      await this.audit.record({ action: 'auth.mfa-reset.accepted', outcome: 'SUCCESS', actorUserId: user.id, target: { type: 'User', id: user.id }, metadata: {} });
      return { kind: 'ok', issued };
    });

    switch (outcome.kind) {
      case 'ok': return outcome.issued;
      case 'invalid': throw invalidCredentials();
      default: throw tokenInvalid();
    }
  }
}
```

`options.ts` adds `mfaReset: { ttlSeconds: number }`; `test/admin/support/options.ts` adds `mfaReset: { ttlSeconds: 72 * 3600 }`. Register `MfaResetService` in `AdminAuthModule` and export it (Nest export and `index.ts`, with the type `MfaResetRecipient`).

- [ ] **Step 4: Password reset during a pending 2FA reset (D2)**

`PasswordService` (Task 18) gains `private readonly mfaResets: MfaResetService` (import from `../mfa-reset/mfa-reset.service`; no cycle: `MfaResetService` does not depend on `PasswordService`). In `reset()`, the success branch inside the unit of work becomes (the token consume and the eligibility check before it stay as Task 18 wrote them):

```ts
await this.db.user.update({ where: { id: current.id }, data: { passwordHash } });
const sessionsRevoked = await this.sessions.revokeAllSessions(current.id);
await this.tokens.revokeUnusedTokens(current.id); // every unused link, the pending MFA_RESET included (section 8.5)
// D2: an ACTIVE user without an enrolled TOTP has a 2FA reset pending; its link just died, so issue a fresh one.
const pendingMfaReset =
  current.totpEnabledAt === null && current.email ? { id: current.id, email: current.email, firstName: current.firstName } : null;
if (pendingMfaReset) await this.mfaResets.issueLink(pendingMfaReset, null);
await this.audit.record({
  action: 'auth.password-reset.completed', outcome: 'SUCCESS', actorUserId: current.id, target: { type: 'User', id: current.id },
  metadata: { sessionsRevoked, ...(pendingMfaReset ? { mfaResetReissued: true } : {}) },
});
```

The mail goes out after commit through `MailNotifier` like the reset mail itself; a rollback sends nothing.

- [ ] **Step 5: Implement the admin-sent password reset**

`UserLifecycleService` gains `private readonly passwords: PasswordService` (import from `../auth/passwords/password.service`) and:

```ts
/** Admin action (section 8.5 "send password reset"): same eligibility and mail as forgot, audited as the admin's action. */
async sendPasswordReset(actor: Principal, userId: string): Promise<void> {
  const outcome = await this.uow.run(async (): Promise<AdminDecision<void>> => {
    const pre = preflight(await this.lastAdmin.lockForAdminAction(actor, userId), actor.userId, userId);
    if ('refusal' in pre) return refuseAdminAction(this.audit, 'admin.user.password-reset-sent', actor, userId, pre.refusal);
    if (pre.target.kind !== 'STAFF' || pre.target.status !== 'ACTIVE' || !pre.target.email) {
      return refuseAdminAction(this.audit, 'admin.user.password-reset-sent', actor, userId, 'STATE_CONFLICT');
    }
    await this.passwords.issueReset(userId, actor.userId);
    await this.audit.record({
      action: 'admin.user.password-reset-sent', outcome: 'SUCCESS', actorUserId: actor.userId, target: { type: 'User', id: userId }, metadata: {},
    });
    return { ok: undefined };
  });
  if ('refusal' in outcome) throw adminRefusalError(outcome.refusal);
}
```

- [ ] **Step 6: The recovery CLI (D3)**

`packages/domain/src/admin/auth/mfa-reset/admin-mfa-recovery.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { EmailSchema, isDomainError } from '@tms/contracts';
import { AfterCommitError, type AppTransactionHost, TransactionHost } from '../../../shared';
import { maskEmail } from '../invites/bootstrap-invite.service';
import { ActionTokenService } from '../tokens/action-token.service';
import { MfaResetService } from './mfa-reset.service';

const USAGE = 'usage: admin:reset-mfa <email> [--print]';

/** Sole-admin recovery (D3): a 2FA reset issued by the system actor from a trusted shell, for an ACTIVE admin only. */
@Injectable()
export class AdminMfaRecoveryService {
  constructor(
    @Inject(TransactionHost) private readonly txHost: AppTransactionHost,
    private readonly resets: MfaResetService,
    private readonly tokens: ActionTokenService,
  ) {}

  async run(o: { email: string | undefined; print: boolean; production: boolean }): Promise<{ exitCode: 0 | 1; lines: string[] }> {
    const parsed = EmailSchema.safeParse(o.email ?? '');
    if (!parsed.success) return { exitCode: 1, lines: [USAGE] };
    const email = parsed.data;
    // One line for an unknown email and for every ineligible user: the output never tells them apart.
    const refused = { exitCode: 1 as const, lines: [`no active admin with the email ${maskEmail(email)}; nothing changed`] };
    const user = await this.txHost.tx.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) return refused;
    try {
      const { url } = await this.resets.issue(null, user.id, { awaitDelivery: true });
      const lines = !o.production || o.print ? [`2FA reset URL: ${url}`, `2FA reset link mailed to ${email}`] : [`2FA reset link mailed to ${maskEmail(email)}`];
      return { exitCode: 0, lines };
    } catch (error) {
      if (isDomainError(error)) return refused; // NOT_FOUND or USER_STATE_CONFLICT: the transaction wrote nothing
      if (!(error instanceof AfterCommitError)) throw error;
      await this.tokens.revokeUnusedTokens(user.id);
      return { exitCode: 1, lines: ['mail delivery failed; the new 2FA reset link was revoked, run the command again'] };
    }
  }
}
```

Register it in `AdminAuthModule`, export it (Nest export and `index.ts`).

`apps/api-admin/src/cli/reset-mfa.ts` (Task 15's entry pattern; `CliModule` already imports `AdminAuthModule`):

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AdminMfaRecoveryService } from '@tms/domain/admin';
import { loadEnv } from '@tms/nest-bootstrap';
import { envSchema } from '../env';
import { CliModule } from './cli.module';

async function main(argv: readonly string[]): Promise<number> {
  const env = loadEnv(envSchema, process.env);
  const app = await NestFactory.createApplicationContext(CliModule.forRoot(env), { logger: ['error', 'warn'] });
  try {
    const result = await app.get(AdminMfaRecoveryService).run({
      email: argv.find((arg) => !arg.startsWith('--')),
      print: argv.includes('--print'),
      production: env.NODE_ENV === 'production',
    });
    for (const line of result.lines) process.stdout.write(`${line}\n`);
    return result.exitCode;
  } finally {
    await app.close();
  }
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (error: unknown) => {
    process.stderr.write(`reset-mfa failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  },
);
```

`apps/api-admin/package.json`: `"admin:reset-mfa": "node --env-file-if-exists=.env dist/cli/reset-mfa.js"` (env source `apps/api-admin/.env`, the file Task 15's `bootstrap:invite` reads). The command is not part of `predev` or compose: an operator runs it by hand when the only admin has lost the authenticator and the recovery codes.

- [ ] **Step 7: Controllers and env**

`dto.ts` adds `export class AcceptMfaResetDto extends zodDto(AcceptMfaResetRequestSchema) {}`.

`apps/api-admin/src/auth/mfa-reset.controller.ts`:

```ts
import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import type { SessionStateResponse } from '@tms/contracts';
import { MfaResetService, SessionCookie, SessionService } from '@tms/domain/admin';
import { AuthThrottle, Public } from '@tms/domain/shared';
import type { Response } from 'express';
import { AcceptMfaResetDto } from './dto';

@Controller('auth/mfa-reset')
export class MfaResetController {
  constructor(private readonly resets: MfaResetService, private readonly sessions: SessionService, private readonly cookie: SessionCookie) {}

  @Public()
  @AuthThrottle()
  @Post('accept')
  @HttpCode(200)
  async accept(@Body() body: AcceptMfaResetDto, @Res({ passthrough: true }) res: Response): Promise<SessionStateResponse> {
    const issued = await this.resets.accept(body.token, body.password);
    this.cookie.write(res, issued.token);
    return this.sessions.describe({ userId: issued.userId, scope: issued.scope });
  }
}
```

Register it in `AuthHttpModule`. `UserAdminController` gains `private readonly mfaResets: MfaResetService` and:

```ts
@RequirePermissions('users:reset-mfa')
@RequireStepUp()
@Post(':id/mfa-reset')
@HttpCode(202)
async resetMfa(@Param() params: UserIdParamDto, @CurrentPrincipal() actor: Principal): Promise<ActionTokenIssuedResponse> {
  const { expiresAt } = await this.mfaResets.issue(actor, params.id);
  return { expiresAt: expiresAt.toISOString() }; // the URL never travels over HTTP
}

@RequirePermissions('users:update')
@Post(':id/password-reset')
@HttpCode(202)
sendPasswordReset(@Param() params: UserIdParamDto, @CurrentPrincipal() actor: Principal): Promise<void> {
  return this.lifecycle.sendPasswordReset(actor, params.id);
}
```

`env.ts` (`envSchema`) adds `MFA_RESET_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 14).default(72)`; `adminAuthOptionsFromEnv` maps it to `mfaReset.ttlSeconds`; `.env.example` and compose `api-admin` list `MFA_RESET_TTL_HOURS=72`; `test/env.spec.ts` gains the default (Step 1).

- [ ] **Step 8: Run the tests and verify**

Run: `pnpm turbo run test --filter=@tms/domain && pnpm turbo run test --filter=@tms/api-admin && pnpm verify`
Expected: `admin-resets.e2e-spec` (8 tests), `reset-mfa-cli.e2e-spec` (5 tests, the child-process one against the built `dist/cli/reset-mfa.js`), `env.spec`, the enrollment, login and password suites (Task 18's reset tests unchanged: an enrolled user gets no `mfaResetReissued`) still green, snapshot updated.

Run (the real entry point once, against the dev stack from `pnpm compose up -d` and `apps/api-admin/.env`):

```bash
pnpm turbo run build --filter=@tms/api-admin
pnpm --dir apps/api-admin run admin:reset-mfa nobody@example.com; echo "exit=$?"
```

Expected: `no active admin with the email n***@example.com; nothing changed` and `exit=1`; no stack trace.

- [ ] **Step 9: Commit**

```bash
git add packages/domain apps/api-admin infra/docker-compose.yml docs/efficiency/critical-path.md
git commit -m "feat(domain): add admin 2FA reset, admin-sent password reset and the admin:reset-mfa CLI"
```

PR body: diagram `sequenceDiagram` (admin or `admin:reset-mfa` → reset → mail → accept with password under lockout → ENROLLMENT → TOTP → FULL; a `forgot` + `reset` branch re-issuing the 2FA link); boundaries: `@tms/domain/admin`, api-admin routes, CLI entry and env; no migration; reviewer: `security-reviewer` (second-factor removal, revocation, the locked accept path answering 401 without evaluating the password, token single use, the system actor of the CLI and its eligibility, the D2 re-issue).
