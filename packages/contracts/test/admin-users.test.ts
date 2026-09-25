import { describe, expect, it } from 'vitest';
import {
  CreateUserRequestSchema,
  CreateUserResponseSchema,
  RoleListResponseSchema,
  RoleSummarySchema,
  UserListResponseSchema,
  UserSummarySchema,
} from '../src/index.js';

describe('admin user/role schemas', () => {
  it('normalises the new user email and requires non-empty names and a role id', () => {
    const parsed = CreateUserRequestSchema.parse({
      email: '  Ana@Example.COM ',
      firstName: 'Ana',
      lastName: 'Doe',
      roleId: '0190a0b0-0000-7000-8000-000000000000',
    });
    expect(parsed.email).toBe('ana@example.com');
    expect(
      CreateUserRequestSchema.safeParse({
        email: 'a@b.co',
        firstName: '',
        lastName: 'Doe',
        roleId: '0190a0b0-0000-7000-8000-000000000000',
      }).success,
    ).toBe(false);
    expect(
      CreateUserRequestSchema.safeParse({
        email: 'a@b.co',
        firstName: 'Ana',
        lastName: 'Doe',
        roleId: 'not-a-uuid',
      }).success,
    ).toBe(false);
    expect(
      CreateUserRequestSchema.safeParse({
        email: 'a@b.co',
        firstName: 'Ana',
        lastName: 'Doe',
        roleId: '0190a0b0-0000-7000-8000-000000000000',
        kind: 'STAFF',
      }).success,
    ).toBe(false); // strict: kind is never accepted from the client
  });

  it('describes the created user id and expiry', () => {
    expect(
      CreateUserResponseSchema.safeParse({
        userId: '0190a0b0-0000-7000-8000-000000000000',
        expiresAt: new Date().toISOString(),
      }).success,
    ).toBe(true);
  });

  it('describes a user summary with its role and rejects unknown statuses', () => {
    const user = {
      id: '0190a0b0-0000-7000-8000-000000000000',
      email: 'a@b.co',
      firstName: 'Ana',
      lastName: 'Doe',
      status: 'INVITED',
      kind: 'STAFF',
      role: { id: '0190a0b0-0000-7000-8000-000000000001', key: 'operator', name: 'Operator' },
    };
    expect(UserSummarySchema.safeParse(user).success).toBe(true);
    expect(UserSummarySchema.safeParse({ ...user, status: 'MISSING' }).success).toBe(false);
    expect(UserListResponseSchema.safeParse({ users: [user] }).success).toBe(true);
  });

  it('describes a role summary and a role list', () => {
    const role = {
      id: '0190a0b0-0000-7000-8000-000000000001',
      key: 'operator',
      name: 'Operator',
      appliesTo: 'STAFF',
    };
    expect(RoleSummarySchema.safeParse(role).success).toBe(true);
    expect(RoleSummarySchema.safeParse({ ...role, key: null }).success).toBe(true);
    expect(RoleListResponseSchema.safeParse({ roles: [role] }).success).toBe(true);
  });
});
