# Phase 2 — Task 17: Login, MFA step — TOTP or recovery code → FULL

> Part of the phase 2 plan: read [index.md](index.md) (constraints, shared interfaces, env) and this file only.


**Files:**
- Modify: `packages/domain/src/admin/auth/login/login.service.ts` (`mfaStep`), `apps/api-admin/src/auth/login.controller.ts`, `apps/api-admin/src/auth/dto.ts`
- Create: `apps/api-admin/test/login-mfa.e2e-spec.ts`; Modify: `apps/api-admin/test/route-access.snapshot.json`

**Interfaces:**
- Consumes: `TotpProvider.verify` (05), `SecretCipher.decrypt` + `totpAad` (14), `normalizeRecoveryCode`, `hashRecoveryCode`, `MFA_MAX_ATTEMPTS` (05, 06), `AccountLockService` (16), `SessionService.upgrade`, `recordMfaFailure`, `destroy` (11).
- Produces: `LoginService.mfaStep(principal, input: { code: string } | { recoveryCode: string }): Promise<IssuedSession>`; route `POST /api/auth/mfa` (`@RequireSession('PRE_MFA')`, `@AuthThrottle`) → 200 `SessionStateResponse` + rotated FULL cookie.

Rules: the TOTP check runs outside the transaction; inside it the row is locked, `status` is re-checked (a block or deactivation committed after the guard answers `AUTH_INVALID_MFA_CODE`, never a 500 from upgrading a deleted session), the lock is re-read (a lock started meanwhile wins), the replay guard is one conditional update (`totpLastUsedStep IS NULL OR totpLastUsedStep < step`), and a recovery code is consumed by one conditional update (`usedAt IS NULL`). A failure increments both the account counter (lockout) and the pre-session attempts; the 5th pre-session failure destroys it (`AUTH_MFA_ATTEMPTS_EXHAUSTED`); if the account locks, the response is 423 with `retryAfterSeconds` and `Retry-After` (the PRE_MFA session proves the password, so the lock tells nothing new — D1, deviation 4) and all PRE_MFA sessions end. Audit: `auth.login.success { method: 'TOTP' | 'RECOVERY_CODE' }` / `auth.login.failure { method, reason }` with `reason` one of `INVALID_CODE`, `CODE_REPLAYED`, `TOO_MANY_MFA_ATTEMPTS`, `ACCOUNT_LOCKED`, `ACCOUNT_NOT_ACTIVE`. Success resets the counter and level (`succeed`), sets `lastLoginAt`, upgrades to FULL with a new token and `mfaVerifiedAt = now`.

- [ ] **Step 1: Write the failing tests**

`apps/api-admin/test/login-mfa.e2e-spec.ts`:

```ts
import request from 'supertest';
import type { PrismaService } from '@tms/db/nest';
import { AccountLockService } from '@tms/domain/admin';
import { createAdminTestApp, type AdminTestApp, ORIGIN } from './support/app';
import { createStaffUser, GOOD_PASSWORD, seedBase, totpNow, withCredentials } from './support/fixtures';

describe('login, MFA step (API)', () => {
  let t: AdminTestApp;
  let prisma: PrismaService;
  const http = () => request(t.app.getHttpServer());
  const cookieOf = (res: request.Response) => res.headers['set-cookie']![0]!.split(';')[0]!;
  const passwordStep = async (email: string) => cookieOf(await http().post('/api/auth/login').set('Origin', ORIGIN).send({ email, password: GOOD_PASSWORD }).expect(200));
  const mfa = (cookie: string, body: object) => http().post('/api/auth/mfa').set('Origin', ORIGIN).set('Cookie', cookie).send(body);

  async function user() {
    const u = await createStaffUser(prisma);
    const { totpSecret } = await withCredentials(t.app, u.id);
    return { ...u, totpSecret };
  }

  beforeAll(async () => { t = await createAdminTestApp(); });
  afterAll(() => t.app.close());
  beforeEach(async () => { prisma = await seedBase(t.app); t.clock.set(new Date('2026-09-23T10:00:00Z')); });

  it('upgrades to FULL with a new cookie and resets the counter', async () => {
    const u = await user();
    await prisma.user.update({ where: { id: u.id }, data: { failedLoginCount: 3 } });
    const pre = await passwordStep(u.email!);
    const res = await mfa(pre, { code: await totpNow(t, u.totpSecret) }).expect(200);
    const full = cookieOf(res);
    expect(full).not.toBe(pre);
    expect(res.body).toMatchObject({ scope: 'FULL', next: 'NONE' });
    await http().get('/api/auth/session').set('Cookie', pre).expect(401);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row).toMatchObject({ failedLoginCount: 0, lockoutLevel: 0, lastLoginAt: t.clock.now() });
  });

  it('accepts ±1 step, rejects ±2', async () => {
    const u = await user();
    await mfa(await passwordStep(u.email!), { code: await totpNow(t, u.totpSecret, -1) }).expect(200);
    t.clock.advance(60_000);
    await mfa(await passwordStep(u.email!), { code: await totpNow(t, u.totpSecret, 1) }).expect(200);
    t.clock.advance(120_000);
    await mfa(await passwordStep(u.email!), { code: await totpNow(t, u.totpSecret, 2) }).expect(401);
  });

  it('rejects a replayed code, also when sent twice in parallel (Review Focus 3)', async () => {
    const u = await user();
    const code = await totpNow(t, u.totpSecret);
    const [a, b] = await Promise.all([passwordStep(u.email!), passwordStep(u.email!)]);
    const results = await Promise.all([mfa(a, { code }), mfa(b, { code })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    await mfa(await passwordStep(u.email!), { code }).expect(401);
  });

  it('a recovery code works exactly once, in any format', async () => {
    const u = await user();
    const pre = await passwordStep(u.email!);
    // create one known code through the service used by enrollment
    const code = 'ABCD-EFGH-JKMN-PQRS';
    const { hashRecoveryCode, normalizeRecoveryCode } = await import('@tms/auth-core');
    await prisma.recoveryCode.create({ data: { userId: u.id, codeHash: hashRecoveryCode(normalizeRecoveryCode(code)!) } });
    await mfa(pre, { recoveryCode: 'abcd efgh jkmn pqrs' }).expect(200);
    await mfa(await passwordStep(u.email!), { recoveryCode: code }).expect(401);
    expect(await prisma.auditLog.count({
      where: { action: 'auth.login.success', targetId: u.id, metadata: { path: ['method'], equals: 'RECOVERY_CODE' } },
    })).toBe(1);
  });

  it('the same recovery code sent twice in parallel works once (Review Focus 3)', async () => {
    const u = await user();
    const code = 'ABCD-EFGH-JKMN-PQRS';
    const { hashRecoveryCode, normalizeRecoveryCode } = await import('@tms/auth-core');
    await prisma.recoveryCode.create({ data: { userId: u.id, codeHash: hashRecoveryCode(normalizeRecoveryCode(code)!) } });
    const [a, b] = await Promise.all([passwordStep(u.email!), passwordStep(u.email!)]);
    const results = await Promise.all([mfa(a, { recoveryCode: code }), mfa(b, { recoveryCode: code })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('five wrong codes end the pre-session and lock the account (423 on the 5th)', async () => {
    const u = await user();
    const pre = await passwordStep(u.email!);
    for (let i = 0; i < 4; i += 1) expect((await mfa(pre, { code: '000000' }).expect(401)).body.code).toBe('AUTH_INVALID_MFA_CODE');
    const fifth = await mfa(pre, { code: '000000' }).expect(423);
    expect(fifth.body).toEqual({ statusCode: 423, code: 'AUTH_ACCOUNT_LOCKED', message: 'Account temporarily locked', retryAfterSeconds: 900 });
    expect(fifth.headers['retry-after']).toBe('900');
    await http().get('/api/auth/session').set('Cookie', pre).expect(401);
  });

  it('a block committed between the guard and the row lock answers 401, not 500, and issues nothing', async () => {
    const u = await user();
    const pre = await passwordStep(u.email!);
    const locks = t.app.get(AccountLockService);
    const lock = locks.lock.bind(locks);
    // the block lands after AccessGuard accepted the PRE_MFA session and before mfaStep takes the row lock
    jest.spyOn(locks, 'lock').mockImplementationOnce(async (id) => {
      await prisma.user.update({ where: { id }, data: { status: 'BLOCKED' } });
      return lock(id);
    });
    const res = await mfa(pre, { code: await totpNow(t, u.totpSecret) }).expect(401);
    expect(res.body.code).toBe('AUTH_INVALID_MFA_CODE');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await prisma.session.count({ where: { userId: u.id, scope: 'FULL' } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).failedLoginCount).toBe(0);
    jest.restoreAllMocks();
  });

  it('a correct password never resets the failure counter: 20 × (password + 4 wrong codes) locks at the 5th failure (Review Focus 1)', async () => {
    const u = await user();
    let failures = 0;
    let lockedAt: number | null = null;
    for (let round = 0; round < 20 && lockedAt === null; round += 1) {
      const login = await http().post('/api/auth/login').set('Origin', ORIGIN).send({ email: u.email, password: GOOD_PASSWORD });
      expect(login.status).toBe(200); // the lock must surface at the MFA step; a locked password step would answer 401 (D1)
      const pre = cookieOf(login);
      for (let i = 0; i < 4; i += 1) {
        const res = await mfa(pre, { code: '000000' });
        failures += 1;
        if (res.status === 423) { lockedAt = failures; break; }
      }
    }
    expect(lockedAt).toBe(5);
  });

  it('when throttled, a request without a session gets 429, not 401 (guard order)', async () => {
    const limited = await createAdminTestApp({ env: { THROTTLE_AUTH_IP_LIMIT: '1' } });
    const post = () => request(limited.app.getHttpServer()).post('/api/auth/mfa').set('Origin', ORIGIN).send({ code: '123456' });
    await post().expect(401);
    await post().expect(429);
    await limited.app.close();
  });

  it('refuses FULL and ENROLLMENT sessions', async () => {
    const u = await user();
    const { loginAs } = await import('./support/fixtures');
    await mfa(await loginAs(t.app, u.id, 'FULL'), { code: '123456' }).expect(401);
  });
});
```

Add `{ "route": "POST /api/auth/mfa", "access": { "kind": "session", "scopes": ["PRE_MFA"], "stepUp": false } }` to the snapshot.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm turbo run test --filter=@tms/api-admin`
Expected: FAIL — `/api/auth/mfa` 404.

- [ ] **Step 3: Implement `mfaStep`**

Add to `LoginService` (constructor gains `@Inject(SECRET_CIPHER) cipher: SecretCipher`, `@Inject(TOTP_PROVIDER) totp: TotpProvider`, `clock: Clock`; imports gain `type LoginFailureReason` from `@tms/contracts` and `type Principal` from `../../../shared`):

```ts
type MfaOutcome =
  | { kind: 'ok'; issued: IssuedSession }
  | { kind: 'invalid' }
  | { kind: 'exhausted' }
  | { kind: 'locked'; retryAfterSeconds: number };

async mfaStep(principal: Principal, input: { code: string } | { recoveryCode: string }): Promise<IssuedSession> {
  const method = 'code' in input ? 'TOTP' : 'RECOVERY_CODE';
  const user = await this.txHost.tx.user.findUniqueOrThrow({
    where: { id: principal.userId },
    select: { id: true, totpSecretEnc: true, totpLastUsedStep: true },
  });
  let step: number | null = null;
  let recoveryHash: string | null = null;
  if ('code' in input) {
    if (user.totpSecretEnc) {
      const secret = this.cipher.decrypt(user.totpSecretEnc, totpAad(user.id));
      const v = await this.totp.verify({ secret, code: input.code, now: this.clock.now(), lastUsedStep: user.totpLastUsedStep });
      step = v.ok ? v.step : null;
    }
  } else {
    const normalized = normalizeRecoveryCode(input.recoveryCode);
    recoveryHash = normalized ? hashRecoveryCode(normalized) : null;
  }

  const outcome = await this.uow.run(async (): Promise<MfaOutcome> => {
    const account = await this.locks.lock(user.id);
    const failure = (reason: LoginFailureReason) =>
      this.audit.record({ action: 'auth.login.failure', outcome: 'FAILURE', target: { type: 'User', id: user.id }, metadata: { method, reason } });
    if (account.status !== 'ACTIVE') {
      // blocked or deactivated after the guard: its sessions are gone, so never reach upgrade() (P2025 → 500)
      await failure('ACCOUNT_NOT_ACTIVE');
      return { kind: 'invalid' };
    }
    if (account.isLocked) {
      await this.sessions.revokePreMfaSessions(user.id);
      await failure('ACCOUNT_LOCKED');
      return { kind: 'locked', retryAfterSeconds: account.remainingSeconds };
    }
    let success = false;
    let reason: 'INVALID_CODE' | 'CODE_REPLAYED' = 'INVALID_CODE';
    if (step !== null) {
      const { count } = await this.txHost.tx.user.updateMany({
        where: { id: user.id, OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: step } }] },
        data: { totpLastUsedStep: step },
      });
      success = count === 1;
      if (!success) reason = 'CODE_REPLAYED';
    } else if (recoveryHash) {
      const { count } = await this.txHost.tx.recoveryCode.updateMany({
        where: { userId: user.id, codeHash: recoveryHash, usedAt: null },
        data: { usedAt: account.now },
      });
      success = count === 1;
    }
    if (!success) {
      const { lockedNow } = await this.locks.fail(account);
      const attempts = await this.sessions.recordMfaFailure(principal.sessionId);
      await failure(lockedNow ? 'ACCOUNT_LOCKED' : attempts >= MFA_MAX_ATTEMPTS ? 'TOO_MANY_MFA_ATTEMPTS' : reason);
      if (lockedNow) {
        const relocked = await this.locks.lock(user.id);
        return { kind: 'locked', retryAfterSeconds: relocked.remainingSeconds };
      }
      if (attempts >= MFA_MAX_ATTEMPTS) {
        await this.sessions.destroy(principal.sessionId);
        return { kind: 'exhausted' };
      }
      return { kind: 'invalid' };
    }
    await this.locks.succeed(account);
    await this.txHost.tx.user.update({ where: { id: user.id }, data: { lastLoginAt: account.now } });
    const issued = await this.sessions.upgrade(principal.sessionId, 'FULL', { mfaVerified: true });
    await this.audit.record({ action: 'auth.login.success', outcome: 'SUCCESS', actorUserId: user.id, target: { type: 'User', id: user.id }, metadata: { method } });
    return { kind: 'ok', issued };
  });

  switch (outcome.kind) {
    case 'ok': return outcome.issued;
    case 'locked': throw accountLocked(outcome.retryAfterSeconds);
    case 'exhausted': throw new DomainError('AUTH_MFA_ATTEMPTS_EXHAUSTED', 'Too many wrong codes; sign in again');
    default: throw new DomainError('AUTH_INVALID_MFA_CODE', 'The code is not valid');
  }
}
```

- [ ] **Step 4: Controller**

`dto.ts` adds `MfaDto` (`zodDto(MfaRequestSchema)`). In `LoginController`:

```ts
@RequireSession('PRE_MFA')
@AuthThrottle()
@Post('mfa')
@HttpCode(200)
async mfaStep(@CurrentPrincipal() p: Principal, @Body() body: MfaDto, @Res({ passthrough: true }) res: Response): Promise<SessionStateResponse> {
  const issued = await this.login.mfaStep(p, body);
  this.cookie.write(res, issued.token);
  return this.sessions.describe({ userId: issued.userId, scope: issued.scope });
}
```

- [ ] **Step 5: Run the tests and verify**

Run: `pnpm turbo run test --filter=@tms/api-admin && pnpm verify`
Expected: `login-mfa.e2e-spec` (10 tests) and the snapshot pass.

- [ ] **Step 6: Commit**

```bash
git add packages/domain apps/api-admin docs/efficiency/critical-path.md
git commit -m "feat(domain): add the MFA login step with replay guard, recovery codes and attempt limits"
```

PR body: diagram `sequenceDiagram` (login → PRE_MFA → mfa → FULL, failure branches); boundaries: `@tms/domain/admin`, api-admin route; no migration; reviewer: `security-reviewer`.
