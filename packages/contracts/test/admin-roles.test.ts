import { describe, expect, it } from 'vitest';
import { RoleDetailResponseSchema, RoleIdParamSchema } from '../src/index.js';

const ID = '0190a0b0-0000-7000-8000-000000000000';

const permission = {
  code: 'checkin:perform',
  name: 'Check in at the kiosk',
  description: 'Identify with card and PIN.',
  isDeprecated: false,
};

const detail = {
  id: ID,
  key: 'driver',
  name: 'Driver',
  description: 'Checks in at the kiosk with card and PIN.',
  appliesTo: 'DRIVER',
  groups: [{ group: 'checkin', permissions: [permission] }],
};

describe('role detail schemas', () => {
  it('accepts a role with grouped permissions and one without any', () => {
    expect(RoleDetailResponseSchema.parse(detail)).toEqual(detail);
    expect(RoleDetailResponseSchema.safeParse({ ...detail, key: null, groups: [] }).success).toBe(
      true,
    );
  });

  it('rejects an unknown group, a missing isDeprecated flag and extra keys', () => {
    expect(
      RoleDetailResponseSchema.safeParse({
        ...detail,
        groups: [{ group: 'nope', permissions: [permission] }],
      }).success,
    ).toBe(false);
    const incomplete = { code: permission.code, name: permission.name, description: 'x' };
    expect(
      RoleDetailResponseSchema.safeParse({
        ...detail,
        groups: [{ group: 'checkin', permissions: [incomplete] }],
      }).success,
    ).toBe(false);
    expect(RoleDetailResponseSchema.safeParse({ ...detail, extra: 1 }).success).toBe(false);
  });

  it('the id param must be a UUID', () => {
    expect(RoleIdParamSchema.safeParse({ id: ID }).success).toBe(true);
    expect(RoleIdParamSchema.safeParse({ id: 'abc' }).success).toBe(false);
    expect(RoleIdParamSchema.safeParse({ id: ID, extra: 1 }).success).toBe(false);
  });
});
