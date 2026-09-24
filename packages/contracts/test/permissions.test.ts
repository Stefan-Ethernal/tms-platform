import { describe, expect, it } from 'vitest';
import {
  PERMISSION_GROUPS,
  PERMISSIONS,
  PermissionCodeSchema,
  permissionCodesForAudience,
  validateCatalogue,
  type PermissionDefinition,
} from '../src/permissions.js';

const entry = (over: Partial<Record<keyof PermissionDefinition, unknown>>): PermissionDefinition =>
  ({
    code: 'users:read',
    group: 'users',
    audience: 'STAFF',
    defaultName: 'View users',
    defaultDescription: 'List users.',
    ...over,
  }) as PermissionDefinition;

describe('PERMISSIONS', () => {
  it('is a valid catalogue of 33 codes covering the 13 groups', () => {
    expect(validateCatalogue(PERMISSIONS)).toEqual([]);
    expect(PERMISSIONS).toHaveLength(33);
    expect(new Set(PERMISSIONS.map((p) => p.group))).toEqual(new Set(PERMISSION_GROUPS));
  });

  it('contains every code named in spec section 9', () => {
    const codes = PERMISSIONS.map((p) => p.code);
    for (const code of [
      'users:read',
      'users:create',
      'users:update',
      'users:block',
      'users:unlock',
      'users:invite',
      'users:reset-mfa',
      'roles:read',
      'roles:manage',
      'permissions:read',
      'permissions:update',
      'orders:read',
      'orders:manage',
      'queue:read',
      'queue:assign-point',
      'queue:call',
      'queue:complete',
      'queue:remove',
      'queue:manual-checkin',
      'audit:read',
      'checkin:perform',
    ]) {
      expect(codes).toContain(code);
    }
  });

  it('gives checkin:perform to DRIVER and everything else to STAFF', () => {
    expect(permissionCodesForAudience('DRIVER')).toEqual(['checkin:perform']);
    expect(permissionCodesForAudience('STAFF')).toHaveLength(32);
  });

  it('splits the PIN reset and the card block out of drivers:manage and cards:manage', () => {
    const byCode = new Map<string, PermissionDefinition>(PERMISSIONS.map((p) => [p.code, p]));
    expect(byCode.get('drivers:reset-pin')).toMatchObject({
      audience: 'STAFF',
      defaultName: 'Reset driver PIN',
    });
    expect(byCode.get('cards:block')).toMatchObject({
      audience: 'STAFF',
      defaultName: 'Block identity cards',
    });
    expect(byCode.get('drivers:manage')?.defaultDescription).toBe('Create and edit drivers.');
    expect(byCode.get('cards:manage')?.defaultDescription).toBe(
      'Issue and replace identity cards.',
    );
  });

  it('PermissionCodeSchema accepts live codes only', () => {
    expect(PermissionCodeSchema.parse('queue:call')).toBe('queue:call');
    expect(PermissionCodeSchema.safeParse('queue:fly').success).toBe(false);
  });
});

describe('validateCatalogue', () => {
  it('reports a duplicate code once, on the second occurrence', () => {
    expect(validateCatalogue([entry({}), entry({})])).toEqual([
      { code: 'users:read', problem: 'duplicate code' },
    ]);
  });

  it.each(['users:Read', 'users:read_all', 'users', 'users:read:all', 'Users:read', 'users:-read'])(
    'rejects the malformed code %s',
    (code) => {
      expect(validateCatalogue([entry({ code })])).toContainEqual({
        code,
        problem: 'code must be <group>:<kebab-case-action>',
      });
    },
  );

  it('rejects a group that does not match the code prefix', () => {
    expect(validateCatalogue([entry({ group: 'roles' })])).toEqual([
      { code: 'users:read', problem: 'group "roles" does not match the code prefix' },
    ]);
  });

  it('rejects an unknown group', () => {
    const problems = validateCatalogue([entry({ code: 'reports:read', group: 'reports' })]);
    expect(problems).toContainEqual({ code: 'reports:read', problem: 'unknown group "reports"' });
  });

  it('requires DRIVER audience for checkin:* and STAFF elsewhere', () => {
    expect(validateCatalogue([entry({ code: 'checkin:perform', group: 'checkin' })])).toEqual([
      { code: 'checkin:perform', problem: 'audience must be DRIVER' },
    ]);
    expect(validateCatalogue([entry({ audience: 'DRIVER' })])).toEqual([
      { code: 'users:read', problem: 'audience must be STAFF' },
    ]);
  });

  it('rejects empty names and descriptions', () => {
    expect(validateCatalogue([entry({ defaultName: ' ', defaultDescription: '' })])).toEqual([
      { code: 'users:read', problem: 'defaultName is empty' },
      { code: 'users:read', problem: 'defaultDescription is empty' },
    ]);
  });

  it('rejects renamedFrom entries that are live or claimed twice', () => {
    const catalogue = [
      entry({ code: 'users:read', renamedFrom: ['users:list', 'users:view'] }),
      entry({ code: 'users:list', group: 'users' }),
      entry({ code: 'roles:read', group: 'roles', renamedFrom: ['users:view'] }),
    ];
    expect(validateCatalogue(catalogue)).toEqual([
      { code: 'roles:read', problem: 'renamedFrom "users:view" is also claimed by users:read' },
      { code: 'users:read', problem: 'renamedFrom "users:list" is still a live code' },
    ]);
  });

  it('accepts a rename whose old code is gone', () => {
    expect(validateCatalogue([entry({ renamedFrom: ['users:list'] })])).toEqual([]);
  });
});
