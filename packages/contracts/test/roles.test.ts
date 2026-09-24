import { describe, expect, it } from 'vitest';
import { PERMISSIONS, permissionCodesForAudience } from '../src/permissions.js';
import {
  ADMIN_ROLE_KEY,
  ALL_FOR_AUDIENCE,
  resolveRolePermissions,
  SEEDED_ROLES,
} from '../src/roles.js';

const byKey = Object.fromEntries(SEEDED_ROLES.map((r) => [r.key, r]));

describe('SEEDED_ROLES', () => {
  it('defines admin, operator and driver with the section 9 flags', () => {
    expect(
      SEEDED_ROLES.map((r) => [r.key, r.name, r.appliesTo, r.isSystem, r.permissionsLocked]),
    ).toEqual([
      ['admin', 'Admin', 'STAFF', true, true],
      ['operator', 'Operator', 'STAFF', false, false],
      ['driver', 'Driver', 'DRIVER', true, true],
    ]);
    expect(ADMIN_ROLE_KEY).toBe('admin');
    expect(byKey['admin']?.permissions).toBe(ALL_FOR_AUDIENCE);
  });

  it('references only live codes whose audience matches the role', () => {
    const liveByCode = new Map(PERMISSIONS.map((p) => [p.code, p]));
    for (const role of SEEDED_ROLES) {
      for (const code of resolveRolePermissions(role)) {
        expect(liveByCode.get(code)?.audience, `${role.key} -> ${code}`).toBe(role.appliesTo);
      }
    }
  });

  it('expands Admin to every STAFF permission and Driver to checkin:perform', () => {
    expect(resolveRolePermissions(byKey['admin']!)).toEqual(permissionCodesForAudience('STAFF'));
    expect(resolveRolePermissions(byKey['admin']!)).toEqual(
      expect.arrayContaining(['drivers:reset-pin', 'cards:block']),
    );
    expect(resolveRolePermissions(byKey['driver']!)).toEqual(['checkin:perform']);
  });

  it('gives Operator exactly the section 9 list: orders:*, queue:*, read-only master data, audit', () => {
    const expected = PERMISSIONS.filter(
      (p) =>
        p.group === 'orders' ||
        p.group === 'queue' ||
        ([
          'drivers',
          'cards',
          'vehicles',
          'carriers',
          'products',
          'loading-points',
          'audit',
        ].includes(p.group) &&
          p.code.endsWith(':read')),
    ).map((p) => p.code);
    expect([...resolveRolePermissions(byKey['operator']!)].sort()).toEqual([...expected].sort());
    expect(expected).toHaveLength(15);
  });

  it('does not grant Operator any users, roles or permissions administration', () => {
    const codes = resolveRolePermissions(byKey['operator']!);
    expect(codes.filter((c) => /^(users|roles|permissions):/.test(c))).toEqual([]);
    expect(codes).not.toContain('drivers:reset-pin');
    expect(codes).not.toContain('cards:block');
  });
});
