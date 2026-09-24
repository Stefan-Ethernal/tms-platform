# Phase 2 — Task 21: Admin role change

> Part of the phase 2 plan: read [index.md](index.md) (constraints, shared interfaces, env) and this file only.


**Files:**
- Modify: `packages/domain/src/admin/users/user-lifecycle.service.ts` (`changeRole`)
- Modify: `apps/api-admin/src/admin/users/user-admin.controller.ts`, `apps/api-admin/src/auth/dto.ts` (`ChangeRoleDto`)
- Create: `apps/api-admin/test/user-role.e2e-spec.ts`; Modify: `apps/api-admin/test/route-access.snapshot.json`

**Interfaces:**
- Consumes: `LastAdminGuard`, `preflight`, `adminRefusalError`, `isAuditedRefusal`, `AdminDecision` (20); `ChangeRoleRequestSchema` (08); `ADMIN_ROLE_KEY` (phase 1); fixtures `createRole`, `roleIdByKey` (11, 20).
- Produces: `UserLifecycleService.changeRole(actor: Principal, userId: string, roleId: string): Promise<void>`; route `PUT /api/users/:id/role` (`users:assign-role`, step-up) → 204.

Rules, in this order (each has a test): the Task 20 preflight (actor still valid → 401; unknown user → 404; own account → 403 `SELF_ACTION_FORBIDDEN`); unknown role → 404 `NOT_FOUND`; DEACTIVATED target → 409 `USER_STATE_CONFLICT`; `role.appliesTo !== user.kind` → 422 `ROLE_KIND_MISMATCH` with field `roleId` (section 7); the current role → 204 no-op (no revocation, no audit row); demoting an ACTIVE admin (new role is not the Admin role) when no other ACTIVE admin remains → 409 `LAST_ADMIN`; otherwise update `roleId`, revoke all sessions and unused tokens (so the new permissions apply from the next session, and an INVITED user's pending invite must be re-sent) and audit `admin.user.role-changed { fromRoleId, toRoleId, sessionsRevoked, linksRevoked }`. Refusals with a valid actor and target are audited with `fromRoleId` (the target's current role), the requested `toRoleId` and the reason; both ids are always present (phase 1's schema requires them, and every audited refusal has found the target).

- [ ] **Step 1: Write the failing API tests**

`apps/api-admin/test/user-role.e2e-spec.ts`:

```ts
import request from 'supertest';
import type { PrismaService } from '@tms/db/nest';
import { createAdminTestApp, type AdminTestApp, ORIGIN } from './support/app';
import { createRole, createStaffUser, loginAs, roleIdByKey, seedBase } from './support/fixtures';

const UNKNOWN_ID = '0190a0b0-0000-7000-8000-000000000000';

describe('admin role change (API)', () => {
  let t: AdminTestApp;
  let prisma: PrismaService;
  let admin: { id: string };
  let adminCookie: string;
  const http = () => request(t.app.getHttpServer());
  const changeRole = (id: string, roleId: string, cookie = adminCookie) =>
    http().put(`/api/users/${id}/role`).set('Origin', ORIGIN).set('Cookie', cookie).send({ roleId });
  const unlock = (id: string, cookie: string) => http().post(`/api/users/${id}/unlock`).set('Origin', ORIGIN).set('Cookie', cookie);
  const activeAdmins = () => prisma.user.count({ where: { status: 'ACTIVE', role: { key: 'admin' } } });

  beforeAll(async () => { t = await createAdminTestApp(); });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    prisma = await seedBase(t.app);
    t.mail.clear();
    t.clock.set(new Date('2026-09-23T10:00:00Z'));
    admin = await createStaffUser(prisma);
    adminCookie = await loginAs(t.app, admin.id);
  });

  it('changes the role, revokes sessions, and the next session carries the new permissions', async () => {
    const target = await createStaffUser(prisma, { role: 'operator' });
    const third = await createStaffUser(prisma, { role: 'operator' });
    const before = await loginAs(t.app, target.id);
    await unlock(third.id, before).expect(403);
    await changeRole(target.id, await roleIdByKey(prisma, 'admin')).expect(204);
    await http().get('/api/auth/session').set('Cookie', before).expect(401);
    await unlock(third.id, await loginAs(t.app, target.id)).expect(204);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'admin.user.role-changed', outcome: 'SUCCESS', targetId: target.id } });
    expect(audit).toMatchObject({ actorUserId: admin.id });
    expect(audit.metadata).toEqual({
      fromRoleId: await roleIdByKey(prisma, 'operator'),
      toRoleId: await roleIdByKey(prisma, 'admin'),
      sessionsRevoked: 1,
      linksRevoked: 0,
    });
  });

  it('revokes the pending invite of an INVITED user; a resend works', async () => {
    const invited = await createStaffUser(prisma, { role: 'operator', status: 'INVITED', enrolled: false });
    await http().post(`/api/users/${invited.id}/invite`).set('Origin', ORIGIN).set('Cookie', adminCookie).expect(202);
    await changeRole(invited.id, await roleIdByKey(prisma, 'admin')).expect(204);
    expect(await prisma.actionToken.count({ where: { userId: invited.id, usedAt: null } })).toBe(0);
    await http().post(`/api/users/${invited.id}/invite`).set('Origin', ORIGIN).set('Cookie', adminCookie).expect(202);
  });

  it('assigning the current role is a no-op: 204, sessions kept, nothing audited', async () => {
    const target = await createStaffUser(prisma, { role: 'operator' });
    const cookie = await loginAs(t.app, target.id);
    await changeRole(target.id, await roleIdByKey(prisma, 'operator')).expect(204);
    await http().get('/api/auth/session').set('Cookie', cookie).expect(200);
    expect(await prisma.auditLog.count({ where: { action: 'admin.user.role-changed' } })).toBe(0);
  });

  it('rejects the own account, unknown ids, a deactivated user and a role of the other user kind', async () => {
    const operatorRole = await roleIdByKey(prisma, 'operator');
    expect((await changeRole(admin.id, operatorRole).expect(403)).body.code).toBe('SELF_ACTION_FORBIDDEN');
    const target = await createStaffUser(prisma, { role: 'operator' });
    expect((await changeRole(target.id, UNKNOWN_ID).expect(404)).body.code).toBe('NOT_FOUND');
    expect((await changeRole(UNKNOWN_ID, operatorRole).expect(404)).body.code).toBe('NOT_FOUND');
    expect((await changeRole(target.id, 'admin').expect(422)).body.code).toBe('VALIDATION_FAILED');
    const mismatch = await changeRole(target.id, await roleIdByKey(prisma, 'driver')).expect(422);
    expect(mismatch.body).toMatchObject({ code: 'ROLE_KIND_MISMATCH', fields: [{ path: 'roleId', code: 'ROLE_KIND_MISMATCH' }] });
    const driver = await createStaffUser(prisma, { kind: 'DRIVER', role: 'driver', enrolled: false });
    expect((await changeRole(driver.id, operatorRole).expect(422)).body.code).toBe('ROLE_KIND_MISMATCH');
    await prisma.user.update({ where: { id: target.id }, data: { status: 'DEACTIVATED' } });
    expect((await changeRole(target.id, await roleIdByKey(prisma, 'admin')).expect(409)).body.code).toBe('USER_STATE_CONFLICT');
    const reasons = (await prisma.auditLog.findMany({ where: { action: 'admin.user.role-changed', outcome: 'FAILURE' } }))
      .map((a) => (a.metadata as { reason: string }).reason).sort();
    expect(reasons).toEqual(['ROLE_KIND_MISMATCH', 'ROLE_KIND_MISMATCH', 'SELF_ACTION', 'STATE_CONFLICT']);
    const self = await prisma.auditLog.findFirstOrThrow({ where: { action: 'admin.user.role-changed', outcome: 'FAILURE', targetId: admin.id } });
    expect(self.metadata).toEqual({ fromRoleId: await roleIdByKey(prisma, 'admin'), toRoleId: operatorRole, reason: 'SELF_ACTION' });
  });

  it('needs users:assign-role and a fresh step-up', async () => {
    const target = await createStaffUser(prisma, { role: 'operator' });
    const adminRole = await roleIdByKey(prisma, 'admin');
    const blocker = await createStaffUser(prisma, { roleId: await createRole(prisma, ['users:block']) });
    expect((await changeRole(target.id, adminRole, await loginAs(t.app, blocker.id)).expect(403)).body.code).toBe('FORBIDDEN');
    t.clock.advance(11 * 60_000);
    expect((await changeRole(target.id, adminRole).expect(403)).body.code).toBe('AUTH_STEP_UP_REQUIRED');
  });

  it('refuses to demote the only active admin; with a second admin the demotion works and takes effect', async () => {
    const assigner = await createStaffUser(prisma, { roleId: await createRole(prisma, ['users:assign-role']) });
    const cookie = await loginAs(t.app, assigner.id);
    const operatorRole = await roleIdByKey(prisma, 'operator');
    expect((await changeRole(admin.id, operatorRole, cookie).expect(409)).body.code).toBe('LAST_ADMIN');
    const second = await createStaffUser(prisma);
    await changeRole(admin.id, operatorRole, cookie).expect(204);
    await unlock(second.id, await loginAs(t.app, admin.id)).expect(403);
    expect((await changeRole(second.id, operatorRole, cookie).expect(409)).body.code).toBe('LAST_ADMIN');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'admin.user.role-changed', outcome: 'FAILURE', targetId: second.id } });
    expect(audit.metadata).toEqual({ fromRoleId: await roleIdByKey(prisma, 'admin'), toRoleId: operatorRole, reason: 'LAST_ADMIN' });
    expect(await activeAdmins()).toBe(1);
  });

  it('two admins demoting each other in parallel: exactly one succeeds (Review Focus 3)', async () => {
    const operatorRole = await roleIdByKey(prisma, 'operator');
    for (let round = 0; round < 10; round += 1) {
      await prisma.user.updateMany({ where: { status: 'ACTIVE', role: { key: 'admin' } }, data: { status: 'DEACTIVATED' } });
      const a = await createStaffUser(prisma);
      const b = await createStaffUser(prisma);
      const [cookieA, cookieB] = [await loginAs(t.app, a.id), await loginAs(t.app, b.id)];
      const statuses = (await Promise.all([changeRole(b.id, operatorRole, cookieA), changeRole(a.id, operatorRole, cookieB)])).map((r) => r.status).sort();
      expect(statuses[0]).toBe(204);
      expect([401, 409]).toContain(statuses[1]);
      expect(await activeAdmins()).toBe(1);
    }
  }, 60_000);
});
```

Snapshot addition (after every `POST` route): `{ "route": "PUT /api/users/:id/role", "access": { "kind": "permissions", "codes": ["users:assign-role"], "stepUp": true } }`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm turbo run test --filter=@tms/api-admin`
Expected: FAIL — `PUT /api/users/:id/role` returns 404; snapshot mismatch.

- [ ] **Step 3: Implement `changeRole`**

Add to `UserLifecycleService` (imports gain `ADMIN_ROLE_KEY` from `@tms/contracts` and `type AdminRefusal`, `isAuditedRefusal` from `./admin-action`):

```ts
async changeRole(actor: Principal, userId: string, roleId: string): Promise<void> {
  const outcome = await this.uow.run(async (): Promise<AdminDecision<void>> => {
    const lock = await this.lastAdmin.lockForAdminAction(actor, userId);
    const pre = preflight(lock, actor.userId, userId);
    // Audited refusals (SELF_ACTION and the checks below) always have a locked target, so `fromRoleId` is known.
    const fromRoleId = lock.target?.roleId;
    const refuse = async (refusal: AdminRefusal): Promise<{ refusal: AdminRefusal }> => {
      if (isAuditedRefusal(refusal) && fromRoleId) {
        await this.audit.record({
          action: 'admin.user.role-changed', outcome: 'FAILURE', actorUserId: actor.userId, target: { type: 'User', id: userId },
          metadata: { fromRoleId, toRoleId: roleId, reason: refusal },
        });
      }
      return { refusal };
    };
    if ('refusal' in pre) return refuse(pre.refusal);
    const { target } = pre;
    const role = await this.db.role.findUnique({ where: { id: roleId }, select: { id: true, key: true, appliesTo: true } });
    if (!role) return refuse('ROLE_NOT_FOUND');
    if (target.status === 'DEACTIVATED') return refuse('STATE_CONFLICT');
    if (role.appliesTo !== target.kind) return refuse('ROLE_KIND_MISMATCH');
    if (role.id === target.roleId) return { ok: undefined };
    if (role.key !== ADMIN_ROLE_KEY && this.lastAdmin.leavesNoActiveAdmin(lock.activeAdminIds, userId)) return refuse('LAST_ADMIN');
    await this.db.user.update({ where: { id: userId }, data: { roleId: role.id } });
    const sessionsRevoked = await this.sessions.revokeAllSessions(userId);
    const linksRevoked = await this.tokens.revokeUnusedTokens(userId);
    await this.audit.record({
      action: 'admin.user.role-changed', outcome: 'SUCCESS', actorUserId: actor.userId, target: { type: 'User', id: userId },
      metadata: { fromRoleId: target.roleId, toRoleId: role.id, sessionsRevoked, linksRevoked },
    });
    return { ok: undefined };
  });
  if ('refusal' in outcome) throw adminRefusalError(outcome.refusal);
}
```

The self refusal is audited with the actor's own current role as `fromRoleId` (the target row is locked even when it is the actor), so every `admin.user.role-changed` row satisfies phase 1's schema, which requires both ids; a missing user or role is a 404 without an audit row.

- [ ] **Step 4: Controller**

`dto.ts` adds `export class ChangeRoleDto extends zodDto(ChangeRoleRequestSchema) {}`. `UserAdminController` adds (imports gain `Body`, `Put`, `ChangeRoleDto`):

```ts
@RequirePermissions('users:assign-role')
@RequireStepUp()
@Put(':id/role')
@HttpCode(204)
changeRole(@Param() params: UserIdParamDto, @Body() body: ChangeRoleDto, @CurrentPrincipal() actor: Principal): Promise<void> {
  return this.lifecycle.changeRole(actor, params.id, body.roleId);
}
```

- [ ] **Step 5: Run the tests and verify**

Run: `pnpm turbo run test --filter=@tms/api-admin && pnpm verify`
Expected: `user-role.e2e-spec` (7 tests, the race test 10 rounds), Task 20's lifecycle tests still green, snapshot updated.

- [ ] **Step 6: Commit**

```bash
git add packages/domain apps/api-admin docs/efficiency/critical-path.md
git commit -m "feat(domain): add the admin role change with kind check, last-admin rule and revocation"
```

PR body: diagram `flowchart` (the rule order from preflight to update + revocation); boundaries: `@tms/domain/admin`, api-admin route; no migration; reviewer: `security-reviewer` (privilege change, last admin, revocation).
