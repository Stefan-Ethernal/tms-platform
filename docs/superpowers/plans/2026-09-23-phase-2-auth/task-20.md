# Phase 2 — Task 20: Admin user lifecycle — block, unblock, deactivate, unlock, last-admin lock

> Part of the phase 2 plan: read [index.md](index.md) (constraints, shared interfaces, env) and this file only.


**Files:**
- Create: `packages/domain/src/admin/users/last-admin.guard.ts`, `packages/domain/src/admin/users/admin-action.ts`, `packages/domain/src/admin/users/user-transitions.ts`, `packages/domain/src/admin/users/user-lifecycle.service.ts`; Modify: `packages/domain/src/admin/admin-auth.module.ts`, `packages/domain/src/admin/index.ts`
- Create: `packages/domain/test/admin/user-transitions.spec.ts`, `packages/domain/test/admin/last-admin.guard.spec.ts`
- Modify: `apps/api-admin/src/admin/users/user-admin.controller.ts`, `apps/api-admin/test/support/fixtures.ts` (`createRole`, option `roleId`), `apps/api-admin/package.json` (devDependencies `pg`, `@types/pg`: `catalog:`, already in the catalog since phase 1 Task 04), `pnpm-lock.yaml`
- Create: `apps/api-admin/test/user-lifecycle.e2e-spec.ts`, `apps/api-admin/test/last-admin.e2e-spec.ts`; Modify: `apps/api-admin/test/route-access.snapshot.json`

**Interfaces:**
- Consumes: `SessionService.revokeAllSessions` (11), `ActionTokenService.revokeUnusedTokens` (13), `registerSuccess` (06), `UnitOfWork` (12), `waitForMail` (12, fixtures), `UnblockUserResponse` (08), `ADMIN_ROLE_KEY`, `AuditService`, `AppTransactionHost`, `testDatabaseUrl` (phase 1), `RequireStepUp` (10).
- Produces:
  - `LastAdminGuard`: `lockActiveAdmins(): Promise<string[]>`, `lockForAdminAction(actor: Principal, targetId: string): Promise<AdminActionLock>` (Task 22 adds `lockForSystemAction(targetId)` on the same private row locker), `leavesNoActiveAdmin(activeAdminIds: readonly string[], userId: string): boolean`; `AdminActionLock = { activeAdminIds: string[]; actorValid: boolean; target: LockedUser | null }`; `LockedUser = { id; kind; status; roleId; roleKey: string | null; email: string | null; firstName; totpEnabledAt: Date | null; failedLoginCount; lockoutLevel; lockedUntil: Date | null }`. Reused by Tasks 21 and 22.
  - `admin-action.ts`: `AdminRefusal`, `AuditedRefusal`, `AdminDecision<T> = { refusal: AdminRefusal } | { ok: T }`, `preflight(lock, actorUserId, targetId)`, `isAuditedRefusal`, `refuseAdminAction(audit, action, actor: Pick<Principal, 'userId'>, userId, refusal): Promise<{ refusal }>`, `adminRefusalError(refusal): DomainError`, `ReasonOnlyAdminAction`.
  - `lifecycleTransition(action: 'BLOCK' | 'UNBLOCK' | 'DEACTIVATE', user): UserStatus | null` (pure).
  - `UserLifecycleService`: `block(actor, userId): Promise<void>`, `unblock(actor, userId): Promise<UnblockUserResponse>`, `deactivate(actor, userId): Promise<void>`, `unlock(actor, userId): Promise<void>` (Task 21 adds `changeRole`, Task 22 `sendPasswordReset`).
  - Routes in `UserAdminController`: `POST /api/users/:id/block` (`users:block`, step-up) → 204; `POST /api/users/:id/unblock` (`users:block`) → 200 `{ status }`; `POST /api/users/:id/deactivate` (`users:deactivate`, step-up) → 204; `POST /api/users/:id/unlock` (`users:unlock`) → 204.
  - Fixtures: `createRole(prisma, codes, appliesTo = 'STAFF'): Promise<string>`; `StaffUserOptions.roleId`.

Rules (each has a test):
- **Admin actions never target the actor's own account** → 403 `SELF_ACTION_FORBIDDEN` (audit reason `SELF_ACTION`). This covers unlock too: FULL sessions survive a lockout (deviation 15), so a self-unlock would let a locked user clear their own lock.
- Transitions (`lifecycleTransition`): block from INVITED or ACTIVE; unblock only from BLOCKED, to ACTIVE when the staff user has an enrolled TOTP, otherwise to INVITED (a new invite follows; Review Focus 2); deactivate from any status except DEACTIVATED, which is terminal (D9) — block, unblock, unlock and invite of a DEACTIVATED user are 409 `USER_STATE_CONFLICT`. Drivers unblock to ACTIVE (no TOTP).
- **Drivers**: block, unblock and deactivate apply to DRIVER users as well (owner decision: driver block and deactivate reuse `users:block` and `users:deactivate`). Unlock is staff-only: a DRIVER target is 409 `USER_STATE_CONFLICT` (audit reason `STATE_CONFLICT`), because this lock belongs to the staff password login; the driver's PIN lock is cleared by phase 3b's `drivers:reset-pin`.
- Block and deactivate update the status, delete all the target's sessions and unused tokens and write the audit row in **one transaction** (section 8.5); unlock resets `failedLoginCount`, `lockoutLevel` and `lockedUntil` through `registerSuccess` (the next lock is 15 minutes again) and revokes nothing.
- **Last admin**: block or deactivate of an ACTIVE holder of the Admin role is refused with 409 `LAST_ADMIN` when no other ACTIVE admin remains; INVITED admins (the bootstrap admin before enrollment) do not count.
- **Lock protocol** (deadlock-free, one place): inside the unit of work, first `lockActiveAdmins()` — `SELECT u."id" FROM "User" u JOIN "Role" r ON r."id" = u."roleId" WHERE r."key" = ${ADMIN_ROLE_KEY} AND u."status" = 'ACTIVE' ORDER BY u."id" FOR NO KEY UPDATE OF u` (asserts an active transaction; the rows are counted) — then the actor and target rows in id order. Under READ COMMITTED a row that was changed by the transaction we waited for is re-checked, so the loser sees the committed status. `FOR NO KEY UPDATE` is the lock an `UPDATE` of non-key columns takes: it serialises every admin action and every `AccountLockService` credential check on the same rows, but unlike `FOR UPDATE` it does not conflict with the `FOR KEY SHARE` locks that inserting sessions, action tokens and audit rows takes on the referenced user, so an admin re-sending an invite while another admin blocks the same user cannot deadlock (deviation 16).
- **Actor re-check under the lock**: the principal was resolved before the lock, so after locking the actor row the service requires the actor to be ACTIVE and its session row to exist. Every revocation (block, deactivate, role change, password change, 2FA reset) updates the actor's `User` row and deletes its sessions in one transaction, so a revocation that won the race is visible here; the loser gets 401 `UNAUTHENTICATED` (not audited, like a guard rejection).
- Decide inside the transaction, audit refused actions with their reason, throw after commit (Task 13's pattern). An unknown target is 404 `NOT_FOUND` and not audited (no target to reference).

- [ ] **Step 1: Write the failing unit tests**

`packages/domain/test/admin/user-transitions.spec.ts`:

```ts
import fc from 'fast-check';
import { lifecycleTransition } from '../../src/admin/users/user-transitions';

const actions = ['BLOCK', 'UNBLOCK', 'DEACTIVATE'] as const;
const statuses = ['INVITED', 'ACTIVE', 'BLOCKED', 'DEACTIVATED'] as const;
const kinds = ['STAFF', 'DRIVER'] as const;
const enrolled = new Date('2026-01-01T00:00:00Z');

describe('lifecycleTransition', () => {
  it.each([
    ['BLOCK', 'INVITED', 'BLOCKED'],
    ['BLOCK', 'ACTIVE', 'BLOCKED'],
    ['BLOCK', 'BLOCKED', null],
    ['BLOCK', 'DEACTIVATED', null],
    ['UNBLOCK', 'INVITED', null],
    ['UNBLOCK', 'ACTIVE', null],
    ['UNBLOCK', 'BLOCKED', 'ACTIVE'],
    ['UNBLOCK', 'DEACTIVATED', null],
    ['DEACTIVATE', 'INVITED', 'DEACTIVATED'],
    ['DEACTIVATE', 'ACTIVE', 'DEACTIVATED'],
    ['DEACTIVATE', 'BLOCKED', 'DEACTIVATED'],
    ['DEACTIVATE', 'DEACTIVATED', null],
  ] as const)('%s from %s → %s (enrolled staff)', (action, status, expected) => {
    expect(lifecycleTransition(action, { kind: 'STAFF', status, totpEnabledAt: enrolled })).toBe(expected);
  });

  it('unblocks a never-enrolled staff user to INVITED and a driver to ACTIVE (Review Focus 2)', () => {
    expect(lifecycleTransition('UNBLOCK', { kind: 'STAFF', status: 'BLOCKED', totpEnabledAt: null })).toBe('INVITED');
    expect(lifecycleTransition('UNBLOCK', { kind: 'DRIVER', status: 'BLOCKED', totpEnabledAt: null })).toBe('ACTIVE');
  });

  it('never leaves DEACTIVATED and never makes a staff user without TOTP ACTIVE', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...actions), fc.constantFrom(...statuses), fc.constantFrom(...kinds), fc.boolean(),
        (action, status, kind, hasTotp) => {
          const next = lifecycleTransition(action, { kind, status, totpEnabledAt: hasTotp ? enrolled : null });
          if (status === 'DEACTIVATED') expect(next).toBeNull();
          if (kind === 'STAFF' && !hasTotp) expect(next).not.toBe('ACTIVE');
        },
      ),
    );
  });
});
```

`packages/domain/test/admin/last-admin.guard.spec.ts` (module as in Task 15's service spec):

```ts
import { randomBytes, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ADMIN_ROLE_KEY } from '@tms/contracts';
import { seedDatabase } from '@tms/db';
import { PrismaModule, PrismaService } from '@tms/db/nest';
import { resetTestDatabase, testDatabaseUrl } from '@tms/db/testing';
import { AdminAuthModule, LastAdminGuard } from '../../src/admin';
import { InMemoryMailSender, MailModule, MailSender, type Principal, SharedModule, UnitOfWork } from '../../src/shared';
import { testAuthOptions } from './support/options';

describe('LastAdminGuard', () => {
  let guard: LastAdminGuard;
  let uow: UnitOfWork;
  let prisma: PrismaService;

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      imports: [
        PrismaModule.forRoot({ url: testDatabaseUrl() }),
        SharedModule.forRoot({ app: 'SYSTEM' }),
        MailModule.forRoot({ smtpUrl: 'smtp://unused:1025', from: 'TMS <no-reply@tms.local>' }),
        AdminAuthModule.forRoot(testAuthOptions),
      ],
    }).overrideProvider(MailSender).useValue(new InMemoryMailSender()).compile();
    await ref.init();
    guard = ref.get(LastAdminGuard);
    uow = ref.get(UnitOfWork);
    prisma = ref.get(PrismaService);
  });
  beforeEach(async () => {
    await resetTestDatabase();
    await seedDatabase(prisma, { bootstrapAdmin: { email: 'root@example.com' } });
  });

  async function user(roleKey: string, status: 'ACTIVE' | 'BLOCKED') {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    const email = `${randomUUID()}@example.com`;
    return prisma.user.create({
      data: { kind: 'STAFF', username: email, firstName: 'T', lastName: 'U', email, status, roleId: role.id, locale: 'en', totpEnabledAt: new Date() },
    });
  }

  async function principalOf(userId: string): Promise<Principal> {
    const s = await prisma.session.create({
      data: { userId, scope: 'FULL', tokenHash: randomBytes(32).toString('hex'), mfaVerifiedAt: new Date(), mfaAttempts: 0, expiresAt: new Date(Date.now() + 3600_000), lastSeenAt: new Date() },
    });
    return { userId, sessionId: s.id, scope: 'FULL', permissions: new Set(), mfaVerifiedAt: s.mfaVerifiedAt };
  }

  it('refuses to lock outside a transaction (a lock without a transaction is a no-op)', async () => {
    await expect(guard.lockActiveAdmins()).rejects.toThrow('needs an active transaction');
  });

  it('locks exactly the ACTIVE holders of the Admin role, in id order', async () => {
    const a = await user(ADMIN_ROLE_KEY, 'ACTIVE');
    const b = await user(ADMIN_ROLE_KEY, 'ACTIVE');
    await user(ADMIN_ROLE_KEY, 'BLOCKED');
    await user('operator', 'ACTIVE');
    expect(await uow.run(() => guard.lockActiveAdmins())).toEqual([a.id, b.id].sort());
    expect(guard.leavesNoActiveAdmin([a.id, b.id], a.id)).toBe(false);
    expect(guard.leavesNoActiveAdmin([a.id], a.id)).toBe(true);
    expect(guard.leavesNoActiveAdmin([a.id], b.id)).toBe(false);
  });

  it('marks the actor invalid once its session is gone', async () => {
    const actor = await user(ADMIN_ROLE_KEY, 'ACTIVE');
    const target = await user('operator', 'ACTIVE');
    const principal = await principalOf(actor.id);
    expect((await uow.run(() => guard.lockForAdminAction(principal, target.id))).actorValid).toBe(true);
    await prisma.session.deleteMany({ where: { userId: actor.id } });
    expect(await uow.run(() => guard.lockForAdminAction(principal, target.id))).toMatchObject({
      actorValid: false,
      target: { id: target.id, status: 'ACTIVE', roleKey: 'operator' },
    });
  });
});
```

- [ ] **Step 2: Write the failing API tests**

Fixture additions in `apps/api-admin/test/support/fixtures.ts`:

```ts
import type { PermissionCode } from '@tms/contracts';

export interface StaffUserOptions {
  role?: 'admin' | 'operator' | 'driver';
  roleId?: string; // a custom role from createRole; wins over `role`
  status?: UserStatus;
  kind?: UserKind;
  enrolled?: boolean;
  email?: string;
}

/** A custom role row (role CRUD arrives in phase 3b). */
export async function createRole(prisma: PrismaService, codes: PermissionCode[], appliesTo: UserKind = 'STAFF'): Promise<string> {
  const role = await prisma.role.create({
    data: {
      name: `custom-${randomUUID()}`,
      description: 'test role',
      isSystem: false,
      appliesTo,
      permissions: { create: codes.map((permissionCode) => ({ permissionCode })) },
    },
  });
  return role.id;
}
```

and in `createStaffUser`: `roleId: o.roleId ?? (await roleIdByKey(prisma, o.role ?? 'admin'))`.

`apps/api-admin/test/user-lifecycle.e2e-spec.ts`:

```ts
import request from 'supertest';
import type { PrismaService } from '@tms/db/nest';
import { createAdminTestApp, type AdminTestApp, ORIGIN } from './support/app';
import { createStaffUser, GOOD_PASSWORD, loginAs, seedBase, waitForMail, withCredentials } from './support/fixtures';

type Verb = 'block' | 'unblock' | 'deactivate' | 'unlock';
const UNKNOWN_ID = '0190a0b0-0000-7000-8000-000000000000';

describe('admin user lifecycle (API)', () => {
  let t: AdminTestApp;
  let prisma: PrismaService;
  let admin: { id: string };
  let adminCookie: string;
  const http = () => request(t.app.getHttpServer());
  const act = (verb: Verb, id: string, cookie = adminCookie) => http().post(`/api/users/${id}/${verb}`).set('Origin', ORIGIN).set('Cookie', cookie);
  const login = (email: string, password: string) => http().post('/api/auth/login').set('Origin', ORIGIN).send({ email, password });
  const resendInvite = (id: string) => http().post(`/api/users/${id}/invite`).set('Origin', ORIGIN).set('Cookie', adminCookie);
  /** Waits for the mail to `to` (delivery runs after commit), empties the outbox and returns the link's token. */
  const mailedToken = async (to: string) => {
    const mail = await waitForMail(t.mail, to);
    t.mail.clear();
    return /#t=([A-Za-z0-9_-]{43})/.exec(mail.text)![1]!;
  };
  async function staff(o: Parameters<typeof createStaffUser>[1] = {}) {
    const u = await createStaffUser(prisma, o);
    if (o.enrolled !== false) await withCredentials(t.app, u.id);
    return u;
  }

  beforeAll(async () => { t = await createAdminTestApp(); });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    prisma = await seedBase(t.app);
    t.mail.clear();
    t.clock.set(new Date('2026-09-23T10:00:00Z'));
    admin = await staff();
    adminCookie = await loginAs(t.app, admin.id);
  });

  it('block ends every session and unused token of the target in the same transaction', async () => {
    const target = await staff({ role: 'operator' });
    const cookie = await loginAs(t.app, target.id);
    await http().post('/api/auth/password/forgot').set('Origin', ORIGIN).send({ email: target.email }).expect(202);
    const resetToken = await mailedToken(target.email!);
    await act('block', target.id).expect(204);
    await http().get('/api/auth/session').set('Cookie', cookie).expect(401);
    expect(await prisma.session.count({ where: { userId: target.id } })).toBe(0);
    expect(await prisma.actionToken.count({ where: { userId: target.id, usedAt: null } })).toBe(0);
    await http().post('/api/auth/password/reset').set('Origin', ORIGIN).send({ token: resetToken, password: 'Another-Sturdy-Passphrase-77' }).expect(400);
    await login(target.email!, GOOD_PASSWORD).expect(401);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'admin.user.blocked', targetId: target.id } });
    expect(audit).toMatchObject({ outcome: 'SUCCESS', actorUserId: admin.id, metadata: { sessionsRevoked: 1, linksRevoked: 1 } });
  });

  it('unblock restores an enrolled user and sends a never-enrolled or reset-pending one back to INVITED (Review Focus 2)', async () => {
    const enrolled = await staff({ role: 'operator' });
    await act('block', enrolled.id).expect(204);
    expect((await act('unblock', enrolled.id).expect(200)).body).toEqual({ status: 'ACTIVE' });
    await login(enrolled.email!, GOOD_PASSWORD).expect(200);

    const invited = await staff({ role: 'operator', status: 'INVITED', enrolled: false });
    await act('block', invited.id).expect(204);
    expect((await act('unblock', invited.id).expect(200)).body).toEqual({ status: 'INVITED' });
    await resendInvite(invited.id).expect(202);
    const accepted = await http().post('/api/auth/invite/accept').set('Origin', ORIGIN).send({ token: await mailedToken(invited.email!) }).expect(200);
    expect(accepted.body).toMatchObject({ scope: 'ENROLLMENT', next: 'SET_PASSWORD' });

    const resetPending = await staff({ role: 'operator' });
    await prisma.user.update({ where: { id: resetPending.id }, data: { totpEnabledAt: null, totpSecretEnc: null } });
    await act('block', resetPending.id).expect(204);
    expect((await act('unblock', resetPending.id).expect(200)).body).toEqual({ status: 'INVITED' });
    await login(resetPending.email!, GOOD_PASSWORD).expect(401);
  });

  it('deactivation revokes access and is terminal (D9)', async () => {
    const target = await staff({ role: 'operator' });
    const cookie = await loginAs(t.app, target.id);
    await act('deactivate', target.id).expect(204);
    await http().get('/api/auth/session').set('Cookie', cookie).expect(401);
    for (const verb of ['block', 'unblock', 'deactivate', 'unlock'] as const) {
      expect((await act(verb, target.id).expect(409)).body.code).toBe('USER_STATE_CONFLICT');
    }
    expect((await resendInvite(target.id).expect(409)).body.code).toBe('USER_STATE_CONFLICT');
    await login(target.email!, GOOD_PASSWORD).expect(401);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).status).toBe('DEACTIVATED');
  });

  it('refuses transitions the status does not allow (409) and audits the reason', async () => {
    const target = await staff({ role: 'operator' });
    expect((await act('unblock', target.id).expect(409)).body.code).toBe('USER_STATE_CONFLICT');
    await act('block', target.id).expect(204);
    await act('block', target.id).expect(409);
    await act('deactivate', target.id).expect(204); // BLOCKED → DEACTIVATED is allowed
    const refused = await prisma.auditLog.findFirstOrThrow({ where: { action: 'admin.user.blocked', outcome: 'FAILURE', targetId: target.id } });
    expect(refused.metadata).toEqual({ reason: 'STATE_CONFLICT' });
  });

  it('needs the permission, a fresh step-up for block and deactivate, and never targets the actor', async () => {
    const target = await staff({ role: 'operator' });
    const operatorCookie = await loginAs(t.app, (await staff({ role: 'operator' })).id);
    for (const verb of ['block', 'unblock', 'deactivate', 'unlock'] as const) {
      expect((await act(verb, target.id, operatorCookie).expect(403)).body.code).toBe('FORBIDDEN');
      expect((await act(verb, admin.id).expect(403)).body.code).toBe('SELF_ACTION_FORBIDDEN');
    }
    expect(await prisma.auditLog.count({ where: { outcome: 'FAILURE', actorUserId: admin.id, targetId: admin.id } })).toBe(4);
    t.clock.advance(11 * 60_000);
    expect((await act('block', target.id).expect(403)).body.code).toBe('AUTH_STEP_UP_REQUIRED');
    expect((await act('deactivate', target.id).expect(403)).body.code).toBe('AUTH_STEP_UP_REQUIRED');
    await act('unlock', target.id).expect(204); // no step-up for unlock and unblock
    expect((await act('unlock', 'not-a-uuid').expect(422)).body.code).toBe('VALIDATION_FAILED');
    expect((await act('unlock', UNKNOWN_ID).expect(404)).body.code).toBe('NOT_FOUND');
  });

  it('unlock clears the counter and the level: the correct password works and the next lock is 15 minutes', async () => {
    const target = await staff({ role: 'operator' });
    await prisma.user.update({
      where: { id: target.id },
      data: { failedLoginCount: 5, lockoutLevel: 2, lockedUntil: new Date(t.clock.now().getTime() + 30 * 60_000) },
    });
    await login(target.email!, GOOD_PASSWORD).expect(401); // locked: the public login does not evaluate the password (D1)
    await act('unlock', target.id).expect(204);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ failedLoginCount: 0, lockoutLevel: 0, lockedUntil: null });
    await login(target.email!, GOOD_PASSWORD).expect(200);
    for (let i = 0; i < 5; i += 1) await login(target.email!, 'Wrong-Password-123456').expect(401);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.lockedUntil!.getTime() - t.clock.now().getTime()).toBe(15 * 60_000);
    expect(await prisma.auditLog.count({ where: { action: 'admin.user.unlocked', outcome: 'SUCCESS', targetId: target.id } })).toBe(1);
  });

  it('drivers can be blocked, unblocked and deactivated; unlock is staff-only (409)', async () => {
    const driver = await createStaffUser(prisma, { kind: 'DRIVER', role: 'driver', enrolled: false });
    await act('block', driver.id).expect(204);
    expect((await act('unblock', driver.id).expect(200)).body).toEqual({ status: 'ACTIVE' });
    expect((await act('unlock', driver.id).expect(409)).body.code).toBe('USER_STATE_CONFLICT');
    const refused = await prisma.auditLog.findFirstOrThrow({ where: { action: 'admin.user.unlocked', outcome: 'FAILURE', targetId: driver.id } });
    expect(refused.metadata).toEqual({ reason: 'STATE_CONFLICT' });
    await act('deactivate', driver.id).expect(204);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: driver.id } })).status).toBe('DEACTIVATED');
  });
});
```

`apps/api-admin/test/last-admin.e2e-spec.ts`:

```ts
import { Client } from 'pg';
import request from 'supertest';
import type { PrismaService } from '@tms/db/nest';
import { testDatabaseUrl } from '@tms/db/testing';
import { createAdminTestApp, type AdminTestApp, ORIGIN } from './support/app';
import { createRole, createStaffUser, loginAs, seedBase } from './support/fixtures';

async function waitUntil(probe: () => Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (await probe()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe('last active admin (API)', () => {
  let t: AdminTestApp;
  let prisma: PrismaService;
  const http = () => request(t.app.getHttpServer());
  const act = (verb: 'block' | 'deactivate', id: string, cookie: string) => http().post(`/api/users/${id}/${verb}`).set('Origin', ORIGIN).set('Cookie', cookie);
  const activeAdmins = () => prisma.user.count({ where: { status: 'ACTIVE', role: { key: 'admin' } } });

  /** A non-admin actor holding the lifecycle permissions through a custom role, so it never counts as an admin itself. */
  async function userManager(): Promise<string> {
    const manager = await createStaffUser(prisma, { roleId: await createRole(prisma, ['users:block', 'users:deactivate']) });
    return loginAs(t.app, manager.id);
  }

  beforeAll(async () => { t = await createAdminTestApp(); });
  afterAll(() => t.app.close());
  beforeEach(async () => { prisma = await seedBase(t.app); t.clock.set(new Date('2026-09-23T10:00:00Z')); });

  it('refuses to block or deactivate the only active admin (409 LAST_ADMIN, audited)', async () => {
    const onlyAdmin = await createStaffUser(prisma);
    const manager = await userManager();
    for (const verb of ['block', 'deactivate'] as const) {
      expect((await act(verb, onlyAdmin.id, manager).expect(409)).body.code).toBe('LAST_ADMIN');
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: onlyAdmin.id } })).status).toBe('ACTIVE');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'admin.user.blocked', outcome: 'FAILURE', targetId: onlyAdmin.id } });
    expect(audit.metadata).toEqual({ reason: 'LAST_ADMIN' });
  });

  it('allows it while another admin stays active; the INVITED bootstrap admin does not count', async () => {
    const a = await createStaffUser(prisma);
    const b = await createStaffUser(prisma);
    const manager = await userManager();
    await act('block', a.id, manager).expect(204);
    expect((await act('deactivate', b.id, manager).expect(409)).body.code).toBe('LAST_ADMIN');
    expect(await activeAdmins()).toBe(1);
  });

  it('sees a status change committed while the request waits for the row lock (deterministic)', async () => {
    const other = await createStaffUser(prisma);
    const target = await createStaffUser(prisma);
    const manager = await userManager();
    // Our own connection to this worker's database (withAdminClient talks to the maintenance database `postgres`).
    const client = new Client({ connectionString: testDatabaseUrl(), connectionTimeoutMillis: 5000 });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT "id" FROM "User" WHERE "id" = ANY($1::uuid[]) FOR UPDATE', [[other.id, target.id]]);
      const pending = act('block', target.id, manager).then((res) => res);
      await waitUntil(async () => {
        const { rows } = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
        );
        return rows[0]!.n > 0;
      }, 'the request to wait for the admin row lock');
      await client.query(`UPDATE "User" SET "status" = 'BLOCKED' WHERE "id" = $1`, [other.id]);
      await client.query('COMMIT');
      const res = await pending;
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('LAST_ADMIN');
    } finally {
      await client.end();
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).status).toBe('ACTIVE');
  }, 30_000);

  it('two admins blocking each other in parallel: exactly one wins, one active admin remains (Review Focus 3)', async () => {
    for (let round = 0; round < 20; round += 1) {
      await prisma.user.updateMany({ where: { status: 'ACTIVE', role: { key: 'admin' } }, data: { status: 'DEACTIVATED' } });
      const a = await createStaffUser(prisma);
      const b = await createStaffUser(prisma);
      const [cookieA, cookieB] = [await loginAs(t.app, a.id), await loginAs(t.app, b.id)];
      const statuses = (await Promise.all([act('block', b.id, cookieA), act('block', a.id, cookieB)])).map((r) => r.status).sort();
      expect(statuses[0]).toBe(204);
      expect([401, 409]).toContain(statuses[1]);
      expect(await activeAdmins()).toBe(1);
    }
  }, 60_000);
});
```

(The probe opens its own `pg` client on `testDatabaseUrl()`, the worker database the app under test uses, so `datname = current_database()` matches the waiting request; phase 1's `withAdminClient` connects to the maintenance database and cannot see `"User"`. The harness connects as the container's superuser, so other backends' `wait_event_type` is visible in `pg_stat_activity`. `pg` and `@types/pg` become api-admin devDependencies with `catalog:` — the catalog entries exist since phase 1 Task 04.)

Snapshot additions (in sorted position, around `POST /api/users/:id/invite`):

```json
{ "route": "POST /api/users/:id/block", "access": { "kind": "permissions", "codes": ["users:block"], "stepUp": true } },
{ "route": "POST /api/users/:id/deactivate", "access": { "kind": "permissions", "codes": ["users:deactivate"], "stepUp": true } },
{ "route": "POST /api/users/:id/unblock", "access": { "kind": "permissions", "codes": ["users:block"], "stepUp": false } },
{ "route": "POST /api/users/:id/unlock", "access": { "kind": "permissions", "codes": ["users:unlock"], "stepUp": false } }
```

- [ ] **Step 3: Run them to verify they fail**

Add the probe's client first: in `apps/api-admin/package.json` `devDependencies` gain `"pg": "catalog:"` and `"@types/pg": "catalog:"`, then `pnpm install` (the lockfile only gains the api-admin importer entries; no new package versions).

Run: `pnpm turbo run test --filter=@tms/domain && pnpm turbo run test --filter=@tms/api-admin`
Expected: FAIL — `user-transitions` and `LastAdminGuard` cannot be imported; the four routes return 404; `createRole` does not exist.

- [ ] **Step 4: Implement the transitions, the lock protocol and the refusal helpers**

`packages/domain/src/admin/users/user-transitions.ts`:

```ts
import type { UserStatus } from '@tms/contracts';

export type LifecycleAction = 'BLOCK' | 'UNBLOCK' | 'DEACTIVATE';

/** Status after an admin lifecycle action, or null when the current status does not allow it. DEACTIVATED is terminal (D9). */
export function lifecycleTransition(
  action: LifecycleAction,
  user: { kind: string; status: string; totpEnabledAt: Date | null },
): UserStatus | null {
  switch (action) {
    case 'BLOCK':
      return user.status === 'INVITED' || user.status === 'ACTIVE' ? 'BLOCKED' : null;
    case 'UNBLOCK':
      if (user.status !== 'BLOCKED') return null;
      // A staff user without an enrolled TOTP never becomes ACTIVE (Review Focus 2); a new invite follows.
      return user.kind === 'STAFF' && user.totpEnabledAt === null ? 'INVITED' : 'ACTIVE';
    case 'DEACTIVATE':
      return user.status === 'DEACTIVATED' ? null : 'DEACTIVATED';
  }
}
```

`packages/domain/src/admin/users/last-admin.guard.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { ADMIN_ROLE_KEY, type UserKind, type UserStatus } from '@tms/contracts';
import { type AppTransactionHost, type Principal, TransactionHost } from '../../shared';

export interface LockedUser {
  id: string;
  kind: UserKind;
  status: UserStatus;
  roleId: string;
  roleKey: string | null;
  email: string | null;
  firstName: string;
  totpEnabledAt: Date | null;
  failedLoginCount: number;
  lockoutLevel: number;
  lockedUntil: Date | null;
}

export interface AdminActionLock {
  /** ACTIVE holders of the system Admin role, locked, in id order. */
  activeAdminIds: string[];
  /** The actor is still ACTIVE and its session still exists: no revocation won the race. */
  actorValid: boolean;
  target: LockedUser | null;
}

/**
 * Owns the row-lock protocol of admin actions on users and the last-admin rule (section 8.5):
 * active admin rows first (id order), then actor and target (id order). Every multi-row locker
 * uses this order, so admin actions cannot deadlock each other.
 */
@Injectable()
export class LastAdminGuard {
  constructor(@Inject(TransactionHost) private readonly txHost: AppTransactionHost) {}

  async lockActiveAdmins(): Promise<string[]> {
    if (!this.txHost.isTransactionActive()) throw new Error('LastAdminGuard.lockActiveAdmins needs an active transaction');
    const rows = await this.txHost.tx.$queryRaw<Array<{ id: string }>>`
      SELECT u."id" FROM "User" u JOIN "Role" r ON r."id" = u."roleId"
      WHERE r."key" = ${ADMIN_ROLE_KEY} AND u."status" = 'ACTIVE'
      ORDER BY u."id" FOR NO KEY UPDATE OF u`;
    return rows.map((r) => r.id);
  }

  async lockForAdminAction(actor: Pick<Principal, 'userId' | 'sessionId'>, targetId: string): Promise<AdminActionLock> {
    const activeAdminIds = await this.lockActiveAdmins();
    const rows = await this.lockUsers([actor.userId, targetId]);
    const actorRow = rows.find((r) => r.id === actor.userId);
    const sessions = await this.txHost.tx.session.count({ where: { id: actor.sessionId, userId: actor.userId } });
    return {
      activeAdminIds,
      actorValid: actorRow?.status === 'ACTIVE' && sessions === 1,
      target: rows.find((r) => r.id === targetId) ?? null,
    };
  }

  /** True when taking `userId` out of the active admins would leave none. */
  leavesNoActiveAdmin(activeAdminIds: readonly string[], userId: string): boolean {
    return activeAdminIds.includes(userId) && activeAdminIds.length === 1;
  }

  /** Second step of the protocol: the named user rows, in id order. Callers have already taken `lockActiveAdmins()`. */
  private lockUsers(ids: readonly string[]): Promise<LockedUser[]> {
    return this.txHost.tx.$queryRaw<LockedUser[]>`
      SELECT u."id", u."kind", u."status", u."roleId", r."key" AS "roleKey", u."email", u."firstName",
             u."totpEnabledAt", u."failedLoginCount", u."lockoutLevel", u."lockedUntil"
      FROM "User" u JOIN "Role" r ON r."id" = u."roleId"
      WHERE u."id" = ANY(${[...ids]}::uuid[])
      ORDER BY u."id" FOR NO KEY UPDATE OF u`;
  }
}
```

`packages/domain/src/admin/users/admin-action.ts`:

```ts
import { type AdminFailure, DomainError } from '@tms/contracts';
import type { AuditService, Principal } from '../../shared';
import type { AdminActionLock, LockedUser } from './last-admin.guard';

export type AdminRefusal =
  | 'UNAUTHENTICATED' | 'NOT_FOUND' | 'ROLE_NOT_FOUND'
  | 'SELF_ACTION' | 'STATE_CONFLICT' | 'LAST_ADMIN' | 'ROLE_KIND_MISMATCH';
/** The refusals that name a valid actor and target: exactly Task 08's `AdminFailure` audit reasons. */
export type AuditedRefusal = Extract<AdminRefusal, AdminFailure>;
export type AdminDecision<T> = { refusal: AdminRefusal } | { ok: T };
/** Admin actions whose refusal row carries only `{ reason }` (every other metadata field of these schemas is optional). */
export type ReasonOnlyAdminAction =
  | 'admin.user.blocked' | 'admin.user.unblocked' | 'admin.user.deactivated' | 'admin.user.unlocked'
  | 'auth.mfa.reset' | 'admin.user.password-reset-sent';

const AUDITED: ReadonlySet<AdminRefusal> = new Set<AuditedRefusal>(['SELF_ACTION', 'STATE_CONFLICT', 'LAST_ADMIN', 'ROLE_KIND_MISMATCH']);
export const isAuditedRefusal = (refusal: AdminRefusal): refusal is AuditedRefusal => AUDITED.has(refusal);

/** Checks every admin action shares: the actor survived the lock, the target exists, it is not the actor. */
export function preflight(lock: AdminActionLock, actorUserId: string, targetId: string): { refusal: AdminRefusal } | { target: LockedUser } {
  if (!lock.actorValid) return { refusal: 'UNAUTHENTICATED' };
  if (!lock.target) return { refusal: 'NOT_FOUND' };
  if (actorUserId === targetId) return { refusal: 'SELF_ACTION' };
  return { target: lock.target };
}

/** Audits a refused action inside the caller's transaction (when it names a valid actor and target) and returns the refusal to throw after commit. */
export async function refuseAdminAction(
  audit: AuditService,
  action: ReasonOnlyAdminAction,
  actor: Pick<Principal, 'userId'>,
  userId: string,
  refusal: AdminRefusal,
): Promise<{ refusal: AdminRefusal }> {
  if (isAuditedRefusal(refusal)) {
    await audit.record({ action, outcome: 'FAILURE', actorUserId: actor.userId, target: { type: 'User', id: userId }, metadata: { reason: refusal } });
  }
  return { refusal };
}

export function adminRefusalError(refusal: AdminRefusal): DomainError {
  switch (refusal) {
    case 'UNAUTHENTICATED':
      return new DomainError('UNAUTHENTICATED', 'Authentication required');
    case 'NOT_FOUND':
      return new DomainError('NOT_FOUND', 'User not found');
    case 'ROLE_NOT_FOUND':
      return new DomainError('NOT_FOUND', 'Role not found');
    case 'SELF_ACTION':
      return new DomainError('SELF_ACTION_FORBIDDEN', 'Administrative actions cannot target your own account');
    case 'STATE_CONFLICT':
      return new DomainError('USER_STATE_CONFLICT', 'The user is not in a state that allows this action');
    case 'LAST_ADMIN':
      return new DomainError('LAST_ADMIN', 'At least one active administrator must remain');
    case 'ROLE_KIND_MISMATCH':
      return new DomainError('ROLE_KIND_MISMATCH', 'The role does not apply to this kind of user', {
        fields: [{ path: 'roleId', code: 'ROLE_KIND_MISMATCH', message: 'The role does not apply to this kind of user' }],
      });
  }
}
```

- [ ] **Step 5: Implement `UserLifecycleService`**

`packages/domain/src/admin/users/user-lifecycle.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { registerSuccess } from '@tms/auth-core';
import type { UnblockUserResponse } from '@tms/contracts';
import { type AppTransactionHost, AuditService, type Principal, TransactionHost, UnitOfWork } from '../../shared';
import { SessionService } from '../auth/sessions/session.service';
import { ActionTokenService } from '../auth/tokens/action-token.service';
import { type AdminDecision, adminRefusalError, preflight, refuseAdminAction } from './admin-action';
import { LastAdminGuard } from './last-admin.guard';
import { lifecycleTransition } from './user-transitions';

/** Admin actions on a user's status and lock (section 8.5). One transaction each: lock protocol → decision → change, revocation, audit. */
@Injectable()
export class UserLifecycleService {
  constructor(
    @Inject(TransactionHost) private readonly txHost: AppTransactionHost,
    private readonly uow: UnitOfWork,
    private readonly lastAdmin: LastAdminGuard,
    private readonly sessions: SessionService,
    private readonly tokens: ActionTokenService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  block(actor: Principal, userId: string): Promise<void> {
    return this.endAccess(actor, userId, 'BLOCK', 'admin.user.blocked');
  }

  deactivate(actor: Principal, userId: string): Promise<void> {
    return this.endAccess(actor, userId, 'DEACTIVATE', 'admin.user.deactivated');
  }

  async unblock(actor: Principal, userId: string): Promise<UnblockUserResponse> {
    const outcome = await this.uow.run(async (): Promise<AdminDecision<UnblockUserResponse>> => {
      const pre = preflight(await this.lastAdmin.lockForAdminAction(actor, userId), actor.userId, userId);
      if ('refusal' in pre) return refuseAdminAction(this.audit, 'admin.user.unblocked', actor, userId, pre.refusal);
      const next = lifecycleTransition('UNBLOCK', pre.target);
      if (next !== 'ACTIVE' && next !== 'INVITED') return refuseAdminAction(this.audit, 'admin.user.unblocked', actor, userId, 'STATE_CONFLICT');
      await this.db.user.update({ where: { id: userId }, data: { status: next } });
      await this.audit.record({ action: 'admin.user.unblocked', outcome: 'SUCCESS', actorUserId: actor.userId, target: { type: 'User', id: userId }, metadata: { status: next } });
      return { ok: { status: next } };
    });
    if ('refusal' in outcome) throw adminRefusalError(outcome.refusal);
    return outcome.ok;
  }

  async unlock(actor: Principal, userId: string): Promise<void> {
    const outcome = await this.uow.run(async (): Promise<AdminDecision<void>> => {
      const pre = preflight(await this.lastAdmin.lockForAdminAction(actor, userId), actor.userId, userId);
      if ('refusal' in pre) return refuseAdminAction(this.audit, 'admin.user.unlocked', actor, userId, pre.refusal);
      if (pre.target.kind !== 'STAFF' || pre.target.status === 'DEACTIVATED') {
        return refuseAdminAction(this.audit, 'admin.user.unlocked', actor, userId, 'STATE_CONFLICT');
      }
      const { target } = pre;
      const cleared = registerSuccess({ failedCount: target.failedLoginCount, level: target.lockoutLevel, lockedUntil: target.lockedUntil });
      await this.db.user.update({
        where: { id: userId },
        data: { failedLoginCount: cleared.failedCount, lockoutLevel: cleared.level, lockedUntil: cleared.lockedUntil },
      });
      await this.audit.record({ action: 'admin.user.unlocked', outcome: 'SUCCESS', actorUserId: actor.userId, target: { type: 'User', id: userId }, metadata: {} });
      return { ok: undefined };
    });
    if ('refusal' in outcome) throw adminRefusalError(outcome.refusal);
  }

  /** Block and deactivate: status change, revocation of every session and unused token, and the audit row in one transaction. */
  private async endAccess(
    actor: Principal,
    userId: string,
    action: 'BLOCK' | 'DEACTIVATE',
    auditAction: 'admin.user.blocked' | 'admin.user.deactivated',
  ): Promise<void> {
    const outcome = await this.uow.run(async (): Promise<AdminDecision<void>> => {
      const lock = await this.lastAdmin.lockForAdminAction(actor, userId);
      const pre = preflight(lock, actor.userId, userId);
      if ('refusal' in pre) return refuseAdminAction(this.audit, auditAction, actor, userId, pre.refusal);
      const next = lifecycleTransition(action, pre.target);
      if (!next) return refuseAdminAction(this.audit, auditAction, actor, userId, 'STATE_CONFLICT');
      if (this.lastAdmin.leavesNoActiveAdmin(lock.activeAdminIds, userId)) return refuseAdminAction(this.audit, auditAction, actor, userId, 'LAST_ADMIN');
      await this.db.user.update({ where: { id: userId }, data: { status: next } });
      const sessionsRevoked = await this.sessions.revokeAllSessions(userId);
      const linksRevoked = await this.tokens.revokeUnusedTokens(userId);
      await this.audit.record({ action: auditAction, outcome: 'SUCCESS', actorUserId: actor.userId, target: { type: 'User', id: userId }, metadata: { sessionsRevoked, linksRevoked } });
      return { ok: undefined };
    });
    if ('refusal' in outcome) throw adminRefusalError(outcome.refusal);
  }
}
```

`AdminAuthModule` registers `LastAdminGuard` and `UserLifecycleService` and exports `UserLifecycleService`; `packages/domain/src/admin/index.ts` exports `UserLifecycleService`, `LastAdminGuard`, `LockedUser`, `AdminActionLock`, `lifecycleTransition`.

- [ ] **Step 6: Controller**

`apps/api-admin/src/admin/users/user-admin.controller.ts` becomes:

```ts
import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import type { ActionTokenIssuedResponse, UnblockUserResponse } from '@tms/contracts';
import { InviteService, UserLifecycleService } from '@tms/domain/admin';
import { CurrentPrincipal, type Principal, RequirePermissions, RequireStepUp } from '@tms/domain/shared';
import { UserIdParamDto } from '../../auth/dto';

@Controller('users')
export class UserAdminController {
  constructor(private readonly invites: InviteService, private readonly lifecycle: UserLifecycleService) {}

  @RequirePermissions('users:invite')
  @Post(':id/invite')
  @HttpCode(202)
  async resendInvite(@Param() params: UserIdParamDto, @CurrentPrincipal() actor: Principal): Promise<ActionTokenIssuedResponse> {
    const { expiresAt } = await this.invites.issue(params.id, actor.userId);
    return { expiresAt: expiresAt.toISOString() };
  }

  @RequirePermissions('users:block')
  @RequireStepUp()
  @Post(':id/block')
  @HttpCode(204)
  block(@Param() params: UserIdParamDto, @CurrentPrincipal() actor: Principal): Promise<void> {
    return this.lifecycle.block(actor, params.id);
  }

  @RequirePermissions('users:block')
  @Post(':id/unblock')
  @HttpCode(200)
  unblock(@Param() params: UserIdParamDto, @CurrentPrincipal() actor: Principal): Promise<UnblockUserResponse> {
    return this.lifecycle.unblock(actor, params.id);
  }

  @RequirePermissions('users:deactivate')
  @RequireStepUp()
  @Post(':id/deactivate')
  @HttpCode(204)
  deactivate(@Param() params: UserIdParamDto, @CurrentPrincipal() actor: Principal): Promise<void> {
    return this.lifecycle.deactivate(actor, params.id);
  }

  @RequirePermissions('users:unlock')
  @Post(':id/unlock')
  @HttpCode(204)
  unlock(@Param() params: UserIdParamDto, @CurrentPrincipal() actor: Principal): Promise<void> {
    return this.lifecycle.unlock(actor, params.id);
  }
}
```

- [ ] **Step 7: Run the tests and verify**

Run: `pnpm turbo run test --filter=@tms/domain && pnpm turbo run test --filter=@tms/api-admin && pnpm verify`
Expected: `user-transitions` (14 cases), `last-admin.guard` (3), `user-lifecycle.e2e-spec` (7), `last-admin.e2e-spec` (4, the race test runs 20 rounds without a deadlock or a 500) and the snapshot pass; `pnpm verify` green.

- [ ] **Step 8: Commit**

```bash
git add packages/domain apps/api-admin pnpm-lock.yaml docs/efficiency/critical-path.md
git commit -m "feat(domain): add block, unblock, deactivate and unlock with revocation and the last-admin lock"
```

PR body: diagram `sequenceDiagram` (two admins racing: lock admin rows → re-check → one commits, the other sees the committed status); boundaries: `@tms/domain/admin` (new `users/` services), api-admin routes; no migration; reviewer: `security-reviewer` (last-admin lock, self rule, revocation, step-up).
