import { randomUUID } from 'node:crypto';
import {
  PERMISSION_GROUPS,
  RoleDetailResponseSchema,
  type RoleDetailResponse,
  type SeededRoleKey,
} from '@tms/contracts';
import type { PrismaService } from '@tms/db/nest';
import request from 'supertest';
import { createAdminTestApp, type AdminTestApp, ORIGIN } from './support/app';
import { createStaffUser, loginAs, roleIdByKey, seedBase } from './support/fixtures';

/** Only the field these cases check; the full envelope shape is pinned in nest-bootstrap's own tests. */
const codeOf = (res: { body: unknown }) => (res.body as { code: string }).code;

describe('GET /api/roles/:id (API)', () => {
  let t: AdminTestApp;
  let prisma: PrismaService;
  let adminCookie: string;
  const http = () => request(t.app.getHttpServer());
  const getRole = (id: string, cookie = adminCookie) =>
    http().get(`/api/roles/${id}`).set('Origin', ORIGIN).set('Cookie', cookie);
  const detailOf = async (key: SeededRoleKey): Promise<RoleDetailResponse> => {
    const res = await getRole(await roleIdByKey(prisma, key)).expect(200);
    return RoleDetailResponseSchema.parse(res.body);
  };
  const codesOf = (d: RoleDetailResponse) =>
    d.groups.flatMap((g) => g.permissions.map((p) => p.code));

  beforeAll(async () => {
    t = await createAdminTestApp();
  });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    prisma = await seedBase(t.app);
    adminCookie = await loginAs(t.app, (await createStaffUser(prisma, { role: 'admin' })).id);
  });

  it('returns the admin role with every STAFF permission, grouped in catalogue order', async () => {
    const admin = await detailOf('admin');
    expect(admin).toMatchObject({ key: 'admin', name: 'Admin', appliesTo: 'STAFF' });
    const live = await prisma.permission.findMany({
      where: { isDeprecated: false, NOT: { group: 'checkin' } },
    });
    expect(codesOf(admin).sort()).toEqual(live.map((p) => p.code).sort());
    const positions = admin.groups.map((g) => PERMISSION_GROUPS.indexOf(g.group));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(admin.groups.every((g) => g.permissions.every((p) => !p.isDeprecated))).toBe(true);
  });

  it('returns the operator role with its 15 permissions in the expected groups', async () => {
    const operator = await detailOf('operator');
    expect(operator).toMatchObject({ key: 'operator', appliesTo: 'STAFF' });
    expect(operator.groups.map((g) => g.group)).toEqual([
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
    expect(codesOf(operator)).toHaveLength(15);
  });

  it('returns the driver role with only checkin:perform', async () => {
    const driver = await detailOf('driver');
    expect(driver).toMatchObject({ key: 'driver', appliesTo: 'DRIVER' });
    expect(driver.groups).toEqual([
      {
        group: 'checkin',
        permissions: [expect.objectContaining({ code: 'checkin:perform', isDeprecated: false })],
      },
    ]);
  });

  it('403 without roles:read', async () => {
    const operatorCookie = await loginAs(
      t.app,
      (await createStaffUser(prisma, { role: 'operator' })).id,
    );
    const res = await getRole(await roleIdByKey(prisma, 'admin'), operatorCookie).expect(403);
    expect(codeOf(res)).toBe('FORBIDDEN');
  });

  it('401 without a session', async () => {
    const res = await http()
      .get(`/api/roles/${await roleIdByKey(prisma, 'admin')}`)
      .set('Origin', ORIGIN)
      .expect(401);
    expect(codeOf(res)).toBe('UNAUTHENTICATED');
  });

  it.each(['PRE_MFA', 'ENROLLMENT'] as const)(
    '401 for an admin whose session scope is %s, not FULL',
    async (scope) => {
      const admin = await createStaffUser(prisma, { role: 'admin' });
      const cookie = await loginAs(t.app, admin.id, scope);
      const res = await getRole(await roleIdByKey(prisma, 'admin'), cookie).expect(401);
      expect(codeOf(res)).toBe('UNAUTHENTICATED');
    },
  );

  it('404 for an unknown UUID', async () => {
    const res = await getRole(randomUUID()).expect(404);
    expect(codeOf(res)).toBe('NOT_FOUND');
  });

  it('rejects a malformed id with the validation envelope (ADR 0009: 422, field id)', async () => {
    const res = await getRole('abc').expect(422);
    expect(codeOf(res)).toBe('VALIDATION_FAILED');
    expect((res.body as { fields: Array<{ path: string }> }).fields[0]?.path).toBe('id');
  });
});
