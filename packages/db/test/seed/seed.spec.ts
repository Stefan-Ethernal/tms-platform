import { PERMISSIONS, permissionCodesForAudience } from '@tms/contracts';
import { createPrismaClient, type PrismaClient } from '../../src/index';
import { SEED_LOADING_POINTS, SEED_PRODUCTS } from '../../src/seed/data';
import { SeedConfigError, seedDatabase, summarizeSeedReport } from '../../src/seed/seed';
import { isEmptyReport } from '../../src/sync/apply';
import { resetTestDatabase, testDatabaseUrl } from '../../src/testing';

// Section 9: orders:*, queue:*, and read access to the master data and the audit log.
const OPERATOR_CODES = [
  'audit:read',
  'cards:read',
  'carriers:read',
  'drivers:read',
  'loading-points:read',
  'orders:manage',
  'orders:read',
  'products:read',
  'queue:assign-point',
  'queue:call',
  'queue:complete',
  'queue:manual-checkin',
  'queue:read',
  'queue:remove',
  'vehicles:read',
];

describe('seedDatabase', () => {
  let client: PrismaClient;

  beforeAll(() => {
    client = createPrismaClient({ url: testDatabaseUrl() });
  });
  afterAll(async () => {
    await client.$disconnect();
  });
  beforeEach(async () => {
    await resetTestDatabase();
  });

  const seed = (email: string | undefined = 'admin@example.com') =>
    seedDatabase(client, { bootstrapAdmin: { email } });
  const roleByKey = (key: string) => client.role.findUniqueOrThrow({ where: { key } });
  const grantsOf = async (roleId: string): Promise<string[]> =>
    (await client.rolePermission.findMany({ where: { roleId } }))
      .map((g) => g.permissionCode)
      .sort();
  const snapshot = async () => ({
    roles: await client.role.findMany({ orderBy: { key: 'asc' } }),
    permissions: await client.permission.findMany({ orderBy: { code: 'asc' } }),
    grants: await client.rolePermission.findMany({
      orderBy: [{ roleId: 'asc' }, { permissionCode: 'asc' }],
    }),
    products: await client.product.findMany({ orderBy: { code: 'asc' } }),
    loadingPoints: await client.loadingPoint.findMany({ orderBy: { code: 'asc' } }),
    users: await client.user.findMany({ orderBy: { username: 'asc' } }),
  });

  it('creates roles, permissions, master data and the INVITED bootstrap admin on an empty database', async () => {
    const report = await seed();
    expect([...report.rolesCreated].sort()).toEqual(['admin', 'driver', 'operator']);
    expect(report.productsCreated).toEqual(SEED_PRODUCTS.map((p) => p.code));
    expect(report.loadingPointsCreated).toEqual(SEED_LOADING_POINTS.map((p) => p.code));
    expect(report.bootstrapAdmin).toBe('created');
    expect(report.warnings).toEqual([]);
    expect(report.sync.inserted).toHaveLength(PERMISSIONS.length);
    expect(summarizeSeedReport(report)).toEqual({ created: 17, unchanged: 0 });

    expect(await client.role.count()).toBe(3);
    expect(await client.permission.count()).toBe(PERMISSIONS.length);
    expect(await client.product.count()).toBe(5);
    expect(await client.loadingPoint.count()).toBe(8);
    expect(
      await client.loadingPoint.findMany({ where: { kind: 'RAIL_TRACK' }, select: { code: true } }),
    ).toEqual([{ code: 'TRACK-01' }, { code: 'TRACK-02' }]);
    const admin = await roleByKey('admin');
    expect(await client.user.findMany()).toMatchObject([
      {
        kind: 'STAFF',
        username: 'admin',
        firstName: 'Bootstrap',
        lastName: 'Admin',
        email: 'admin@example.com',
        status: 'INVITED',
        roleId: admin.id,
        locale: 'en',
      },
    ]);
  });

  it('grants Admin every STAFF code, Operator the 15 operational codes and Driver checkin:perform', async () => {
    await seed();
    const [admin, operator, driver] = await Promise.all([
      roleByKey('admin'),
      roleByKey('operator'),
      roleByKey('driver'),
    ]);
    expect(admin).toMatchObject({ isSystem: true, appliesTo: 'STAFF' });
    expect(driver).toMatchObject({ isSystem: true, appliesTo: 'DRIVER' });
    expect(await grantsOf(admin.id)).toEqual([...permissionCodesForAudience('STAFF')].sort());
    expect(await grantsOf(operator.id)).toEqual(OPERATOR_CODES);
    expect(await grantsOf(driver.id)).toEqual(['checkin:perform']);
  });

  it('changes nothing on a second run', async () => {
    await seed();
    const before = await snapshot();
    const report = await seed();
    expect(isEmptyReport(report.sync)).toBe(true);
    expect(report).toMatchObject({
      rolesCreated: [],
      productsCreated: [],
      loadingPointsCreated: [],
      bootstrapAdmin: 'exists',
      warnings: [],
    });
    expect(summarizeSeedReport(report)).toEqual({ created: 0, unchanged: 17 });
    expect(await snapshot()).toEqual(before);
  });

  it('keeps an Operator role that an admin renamed and trimmed', async () => {
    await seed();
    const operator = await roleByKey('operator');
    await client.role.update({
      where: { id: operator.id },
      data: { name: 'Dispatch', description: 'Renamed in the UI' },
    });
    await client.rolePermission.delete({
      where: { roleId_permissionCode: { roleId: operator.id, permissionCode: 'audit:read' } },
    });
    const report = await seed();
    expect(report.rolesCreated).toEqual([]);
    expect(await client.role.findUniqueOrThrow({ where: { id: operator.id } })).toMatchObject({
      name: 'Dispatch',
      description: 'Renamed in the UI',
    });
    expect(await grantsOf(operator.id)).toEqual(OPERATOR_CODES.filter((c) => c !== 'audit:read'));
  });

  it.each(['ACTIVE', 'BLOCKED'] as const)(
    'creates no second admin once the bootstrap admin is %s',
    async (status) => {
      await seed();
      await client.user.updateMany({ data: { status } });
      const report = await seed();
      expect(report.bootstrapAdmin).toBe('exists');
      expect(report.warnings).toEqual([]);
      expect(await client.user.count()).toBe(1);
    },
  );

  it('warns when BOOTSTRAP_ADMIN_EMAIL matches no existing admin and still creates nobody', async () => {
    await seed();
    const report = await seed('someone-else@example.com');
    expect(report.bootstrapAdmin).toBe('exists');
    expect(report.warnings).toEqual([
      'BOOTSTRAP_ADMIN_EMAIL (someone-else@example.com) matches no existing admin account; the seed never modifies existing users',
    ]);
    expect(await client.user.count()).toBe(1);
    expect((await client.user.findFirstOrThrow()).email).toBe('admin@example.com');
  });

  it('rejects a missing BOOTSTRAP_ADMIN_EMAIL on an empty database and writes nothing', async () => {
    // seed(undefined) would fall through to the helper's own default parameter (JS resolves an
    // explicit `undefined` argument the same as an omitted one), so this calls seedDatabase
    // directly to exercise a literal `email: undefined`.
    const seedWithNoEmail = () => seedDatabase(client, { bootstrapAdmin: { email: undefined } });
    await expect(seedWithNoEmail()).rejects.toThrow(
      new SeedConfigError('BOOTSTRAP_ADMIN_EMAIL is required while no admin exists'),
    );
    await expect(seedWithNoEmail()).rejects.toBeInstanceOf(SeedConfigError);
    expect(await client.role.count()).toBe(0);
    expect(await client.permission.count()).toBe(0);
    expect(await client.product.count()).toBe(0);
    expect(await client.loadingPoint.count()).toBe(0);
    expect(await client.user.count()).toBe(0);
  });

  it('creates exactly one admin when two seeds run concurrently', async () => {
    const reports = await Promise.all([seed(), seed()]);
    expect(reports.map((r) => r.bootstrapAdmin).sort()).toEqual(['created', 'exists']);
    expect(await client.user.count()).toBe(1);
    expect(await client.role.count()).toBe(3);
    expect(await client.product.count()).toBe(5);
  });
});
