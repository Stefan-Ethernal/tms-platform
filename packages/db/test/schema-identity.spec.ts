import { createPrismaClient, type PrismaClient } from '../src';
import {
  makeDriverUser,
  makePermission,
  makeRole,
  makeStaffUser,
  resetTestDatabase,
  testDatabaseUrl,
} from '../src/testing';
import { expectKnownRequestError } from './support/prisma-errors';

describe('identity, access and audit schema', () => {
  let prisma: PrismaClient;

  beforeEach(async () => {
    await resetTestDatabase();
    prisma = createPrismaClient({ url: testDatabaseUrl() });
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  it('rejects deleting a Permission that a RolePermission references (RESTRICT, P2003)', async () => {
    const role = await makeRole(prisma);
    const permission = await makePermission(prisma, { code: 'users:read', group: 'users' });
    await prisma.rolePermission.create({
      data: { roleId: role.id, permissionCode: permission.code },
    });

    await expectKnownRequestError(prisma.permission.delete({ where: { code: permission.code } }), {
      code: 'P2003',
      constraint: 'RolePermission_permissionCode_fkey',
    });
    expect(await prisma.permission.count()).toBe(1);
  });

  it('cascades RolePermission rows when their Role is deleted', async () => {
    const role = await makeRole(prisma);
    const first = await makePermission(prisma);
    const second = await makePermission(prisma);
    await prisma.rolePermission.createMany({
      data: [
        { roleId: role.id, permissionCode: first.code },
        { roleId: role.id, permissionCode: second.code },
      ],
    });

    await prisma.role.delete({ where: { id: role.id } });

    expect(await prisma.rolePermission.count()).toBe(0);
    expect(await prisma.permission.count()).toBe(2);
  });

  it('rejects a second user with the same email (P2002 on User_email_key)', async () => {
    const role = await makeRole(prisma);
    await makeStaffUser(prisma, { roleId: role.id, email: 'same@example.test' });

    const error = await expectKnownRequestError(
      makeStaffUser(prisma, { roleId: role.id, email: 'same@example.test' }),
      { code: 'P2002', constraint: 'User_email_key' },
    );
    expect(error.meta).toMatchObject({ modelName: 'User' });
    expect(await prisma.user.count()).toBe(1);
  });

  it('lets several DRIVER users exist without an email (nullable unique)', async () => {
    const role = await makeRole(prisma, { appliesTo: 'DRIVER' });
    await makeDriverUser(prisma, { roleId: role.id });
    await makeDriverUser(prisma, { roleId: role.id });

    expect(await prisma.user.count({ where: { email: null } })).toBe(2);
  });

  it('links a user to its creator through createdById (self-relation) and defaults status to INVITED', async () => {
    const admin = await makeStaffUser(prisma);
    const invited = await makeStaffUser(prisma, { roleId: admin.roleId, createdById: admin.id });

    const loaded = await prisma.user.findUniqueOrThrow({
      where: { id: invited.id },
      include: { createdBy: true },
    });
    expect(loaded.createdBy?.id).toBe(admin.id);
    expect(loaded.status).toBe('INVITED');
    expect(admin.createdById).toBeNull();

    const creator = await prisma.user.findUniqueOrThrow({
      where: { id: admin.id },
      include: { createdUsers: true },
    });
    expect(creator.createdUsers.map((user) => user.id)).toEqual([invited.id]);
  });

  it('keeps a user that an AuditLog row names as actor (D9: RESTRICT towards User, P2003)', async () => {
    const actor = await makeStaffUser(prisma);
    await prisma.auditLog.create({
      data: {
        app: 'ADMIN',
        actorUserId: actor.id,
        action: 'test.action',
        outcome: 'SUCCESS',
        metadata: {},
      },
    });

    await expectKnownRequestError(prisma.user.delete({ where: { id: actor.id } }), {
      code: 'P2003',
      constraint: 'AuditLog_actorUserId_fkey',
    });
    expect(await prisma.user.count()).toBe(1);
  });

  it('indexes AuditLog on at, actorUserId, action and (targetType, targetId)', async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'AuditLog'
      ORDER BY indexname`;

    expect(rows.map((row) => row.indexname)).toEqual([
      'AuditLog_action_idx',
      'AuditLog_actorUserId_idx',
      'AuditLog_at_idx',
      'AuditLog_pkey',
      'AuditLog_targetType_targetId_idx',
    ]);
  });
});
