import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { PERMISSION_GROUPS, RoleDetailResponseSchema } from '@tms/contracts';
import { seedDatabase } from '@tms/db';
import { PrismaModule, PrismaService } from '@tms/db/nest';
import { makePermission, makeRole, resetTestDatabase, testDatabaseUrl } from '@tms/db/testing';
import { AdminAuthModule, RoleAdminService } from '../../src/admin';
import { InMemoryMailSender, MailModule, MailSender, SharedModule } from '../../src/shared';
import { testAuthOptions } from './support/options';

describe('RoleAdminService.get', () => {
  let roles: RoleAdminService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      imports: [
        PrismaModule.forRoot({ url: testDatabaseUrl() }),
        SharedModule.forRoot({ app: 'ADMIN' }),
        MailModule.forRoot({ smtpUrl: 'smtp://localhost:1025', from: 'TMS <no-reply@tms.local>' }),
        AdminAuthModule.forRoot(testAuthOptions),
      ],
    })
      .overrideProvider(MailSender)
      .useValue(new InMemoryMailSender())
      .compile();
    await ref.init();
    roles = ref.get(RoleAdminService);
    prisma = ref.get(PrismaService);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    await seedDatabase(prisma, { bootstrapAdmin: { email: 'bootstrap@example.com' } });
  });

  const roleIdByKey = async (key: string) =>
    (await prisma.role.findFirstOrThrow({ where: { key } })).id;

  it('returns the driver role with its single permission, matching the contract schema', async () => {
    const detail = await roles.get(await roleIdByKey('driver'));
    expect(RoleDetailResponseSchema.parse(detail)).toEqual(detail);
    expect(detail).toMatchObject({ key: 'driver', name: 'Driver', appliesTo: 'DRIVER' });
    expect(detail.groups).toHaveLength(1);
    expect(detail.groups[0]?.group).toBe('checkin');
    expect(detail.groups[0]?.permissions.map((p) => p.code)).toEqual(['checkin:perform']);
  });

  it('lists the operator groups in PERMISSION_GROUPS order and omits empty groups', async () => {
    const detail = await roles.get(await roleIdByKey('operator'));
    expect(detail.groups.map((g) => g.group)).toEqual([
      'drivers',
      'cards',
      'vehicles',
      'carriers',
      'products',
      'loading-points',
      'orders',
      'queue',
      'audit',
    ]);
    expect(detail.groups.flatMap((g) => g.permissions)).toHaveLength(15);
    const positions = detail.groups.map((g) => PERMISSION_GROUPS.indexOf(g.group));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('orders permissions inside a group by code and flags deprecated ones still linked', async () => {
    const role = await makeRole(prisma, { appliesTo: 'STAFF' });
    const legacy = await makePermission(prisma, {
      code: 'queue:aaa-legacy',
      group: 'queue',
      isDeprecated: true,
    });
    const zed = await makePermission(prisma, { code: 'queue:zzz', group: 'queue' });
    const mid = await makePermission(prisma, { code: 'queue:mmm', group: 'queue' });
    const first = await makePermission(prisma, { code: 'users:read-all', group: 'users' });
    await prisma.rolePermission.createMany({
      data: [zed, mid, legacy, first].map((p) => ({ roleId: role.id, permissionCode: p.code })),
    });

    const detail = await roles.get(role.id);
    expect(detail.groups.map((g) => g.group)).toEqual(['users', 'queue']);
    const queue = detail.groups[1]?.permissions;
    expect(queue?.map((p) => p.code)).toEqual(['queue:aaa-legacy', 'queue:mmm', 'queue:zzz']);
    expect(queue?.map((p) => p.isDeprecated)).toEqual([true, false, false]);
  });

  it('returns a role without permissions as an empty group list', async () => {
    const role = await makeRole(prisma, { appliesTo: 'STAFF' });
    expect(await roles.get(role.id)).toMatchObject({ id: role.id, groups: [] });
  });

  it('throws NOT_FOUND for an unknown id', async () => {
    await expect(roles.get(randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
