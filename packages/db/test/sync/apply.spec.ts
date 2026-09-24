import {
  PERMISSION_CODES,
  PERMISSIONS,
  permissionCodesForAudience,
  type PermissionDefinition,
} from '@tms/contracts';
import { createPrismaClient, type PrismaClient } from '../../src/index';
import { isEmptyReport, summarizeSyncReport, syncPermissions } from '../../src/sync/apply';
import { CatalogueInvalidError } from '../../src/sync/plan';
import { makePermission, makeRole, resetTestDatabase, testDatabaseUrl } from '../../src/testing';

const FIXED = new Date('2026-09-23T10:00:00.000Z');
const ALL_CODES: string[] = [...PERMISSION_CODES].sort();
const STAFF_CODES: string[] = [...permissionCodesForAudience('STAFF')].sort();
const withRename = (from: string, to: string): PermissionDefinition[] =>
  // PERMISSIONS elements keep their literal `as const satisfies` types, which omit `renamedFrom`
  // entirely when unset; the cast restores the declared (optional) shape so it can be read/added.
  PERMISSIONS.map((entry) => {
    const d = entry as PermissionDefinition;
    return d.code === to ? { ...d, renamedFrom: [...(d.renamedFrom ?? []), from] } : d;
  });

describe('syncPermissions (database)', () => {
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

  const codes = async (): Promise<string[]> =>
    (await client.permission.findMany({ select: { code: true } })).map((p) => p.code).sort();
  const grantsOf = async (roleId: string): Promise<string[]> =>
    (await client.rolePermission.findMany({ where: { roleId } }))
      .map((g) => g.permissionCode)
      .sort();

  it('inserts the whole catalogue into an empty database with default texts', async () => {
    const report = await syncPermissions(client, PERMISSIONS, { now: () => FIXED });
    expect([...report.inserted].sort()).toEqual(ALL_CODES);
    expect(isEmptyReport({ ...report, inserted: [] })).toBe(true);
    expect(summarizeSyncReport(report)).toEqual({
      inserted: PERMISSIONS.length,
      reactivated: 0,
      deprecated: 0,
      deleted: 0,
      renamed: 0,
    });
    const def = PERMISSIONS.find((p) => p.code === 'queue:call')!;
    expect(
      await client.permission.findUniqueOrThrow({ where: { code: 'queue:call' } }),
    ).toMatchObject({
      group: 'queue',
      name: def.defaultName,
      description: def.defaultDescription,
      isDeprecated: false,
      syncedAt: FIXED,
    });
  });

  it('does zero writes on a second run (syncedAt and updatedAt untouched)', async () => {
    await syncPermissions(client);
    const before = await client.permission.findMany({ orderBy: { code: 'asc' } });
    const report = await syncPermissions(client);
    expect(isEmptyReport(report)).toBe(true);
    expect(await client.permission.findMany({ orderBy: { code: 'asc' } })).toEqual(before);
  });

  it('keeps a name and description edited by an admin', async () => {
    await syncPermissions(client);
    await client.permission.update({
      where: { code: 'queue:call' },
      data: { name: 'Call the next driver', description: 'Edited in the UI' },
    });
    expect(isEmptyReport(await syncPermissions(client))).toBe(true);
    expect(
      await client.permission.findUniqueOrThrow({ where: { code: 'queue:call' } }),
    ).toMatchObject({
      name: 'Call the next driver',
      description: 'Edited in the UI',
    });
  });

  it('migrates grants through renamedFrom and removes the old code', async () => {
    await syncPermissions(client);
    await makePermission(client, { code: 'queue:summon', group: 'queue' });
    const operator = await makeRole(client, {
      key: 'operator',
      name: 'Operator',
      appliesTo: 'STAFF',
    });
    const custom = await makeRole(client, { name: 'Dispatcher', appliesTo: 'STAFF' });
    await client.rolePermission.createMany({
      data: [
        { roleId: operator.id, permissionCode: 'queue:summon' },
        { roleId: custom.id, permissionCode: 'queue:summon' },
        { roleId: custom.id, permissionCode: 'queue:call' },
      ],
    });
    const report = await syncPermissions(client, withRename('queue:summon', 'queue:call'));
    expect(report.renamed).toEqual([
      { from: 'queue:summon', to: 'queue:call', grantsMoved: 1, grantsDropped: 1 },
    ]);
    expect(report.deleted).toEqual(['queue:summon']);
    expect(summarizeSyncReport(report)).toEqual({
      inserted: 0,
      reactivated: 0,
      deprecated: 0,
      deleted: 1,
      renamed: 1,
    });
    expect(await grantsOf(operator.id)).toEqual(['queue:call']);
    expect(await grantsOf(custom.id)).toEqual(['queue:call']);
    expect(await client.permission.findUnique({ where: { code: 'queue:summon' } })).toBeNull();
  });

  it('keeps a referenced retired code as deprecated and deletes an unreferenced one', async () => {
    await syncPermissions(client);
    await makePermission(client, { code: 'legacy:referenced', group: 'legacy' });
    await makePermission(client, { code: 'legacy:orphan', group: 'legacy' });
    const custom = await makeRole(client, { name: 'Dispatcher', appliesTo: 'STAFF' });
    await client.rolePermission.create({
      data: { roleId: custom.id, permissionCode: 'legacy:referenced' },
    });
    const report = await syncPermissions(client, PERMISSIONS, { now: () => FIXED });
    expect(report.deprecated).toEqual(['legacy:referenced']);
    expect(report.deleted).toEqual(['legacy:orphan']);
    expect(
      await client.permission.findUniqueOrThrow({ where: { code: 'legacy:referenced' } }),
    ).toMatchObject({
      isDeprecated: true,
      syncedAt: FIXED,
    });
    expect(await client.permission.findUnique({ where: { code: 'legacy:orphan' } })).toBeNull();
    expect(isEmptyReport(await syncPermissions(client))).toBe(true);
  });

  it('makes the locked Admin role hold exactly the active STAFF codes', async () => {
    await makePermission(client, { code: 'legacy:old', group: 'legacy' });
    const admin = await makeRole(client, {
      key: 'admin',
      name: 'Admin',
      appliesTo: 'STAFF',
      isSystem: true,
    });
    await client.rolePermission.create({
      data: { roleId: admin.id, permissionCode: 'legacy:old' },
    });
    const report = await syncPermissions(client);
    expect(report.lockedRoleGrants).toEqual([
      { roleKey: 'admin', added: STAFF_CODES, removed: ['legacy:old'] },
    ]);
    expect(report.deleted).toEqual(['legacy:old']);
    expect(await grantsOf(admin.id)).toEqual(STAFF_CODES);
    expect(STAFF_CODES).not.toContain('checkin:perform');
  });

  it('serialises two concurrent runs through the advisory lock', async () => {
    const reports = await Promise.all([syncPermissions(client), syncPermissions(client)]);
    expect(reports.filter(isEmptyReport)).toHaveLength(1);
    expect([...reports.find((r) => !isEmptyReport(r))!.inserted].sort()).toEqual(ALL_CODES);
    expect(await codes()).toEqual(ALL_CODES);
  });

  it('writes nothing for an invalid catalogue', async () => {
    await expect(syncPermissions(client, [...PERMISSIONS, PERMISSIONS[0]])).rejects.toBeInstanceOf(
      CatalogueInvalidError,
    );
    expect(await client.permission.count()).toBe(0);
  });
});
