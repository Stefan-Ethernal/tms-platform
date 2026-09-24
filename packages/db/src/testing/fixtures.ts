import type { $Enums, Permission, PrismaClient, Role, User } from '../index';

let counter = 0;

/** Zero-padded counter: names created inside one test never collide (the database is reset per test). */
export function uniqueSuffix(): string {
  counter += 1;
  return String(counter).padStart(4, '0');
}

export interface RoleOverrides {
  key?: string | null;
  name?: string;
  description?: string;
  isSystem?: boolean;
  appliesTo?: $Enums.UserKind;
}

export function makeRole(prisma: PrismaClient, overrides: RoleOverrides = {}): Promise<Role> {
  const suffix = uniqueSuffix();
  return prisma.role.create({
    data: {
      key: overrides.key ?? null,
      name: overrides.name ?? `Role ${suffix}`,
      description: overrides.description ?? `Test role ${suffix}`,
      isSystem: overrides.isSystem ?? false,
      appliesTo: overrides.appliesTo ?? 'STAFF',
    },
  });
}

export interface UserOverrides {
  roleId?: string;
  username?: string;
  /** `null` stores no email; `undefined` generates a unique one for staff. */
  email?: string | null;
  status?: $Enums.UserStatus;
  createdById?: string;
}

/** STAFF user with a unique email (D1: staff log in with email) and a fresh STAFF role unless given. */
export async function makeStaffUser(
  prisma: PrismaClient,
  overrides: UserOverrides = {},
): Promise<User> {
  const suffix = uniqueSuffix();
  const roleId = overrides.roleId ?? (await makeRole(prisma, { appliesTo: 'STAFF' })).id;
  return prisma.user.create({
    data: {
      kind: 'STAFF',
      username: overrides.username ?? `staff-${suffix}`,
      firstName: 'Test',
      lastName: `Staff ${suffix}`,
      email: overrides.email === undefined ? `staff-${suffix}@example.test` : overrides.email,
      roleId,
      ...(overrides.status ? { status: overrides.status } : {}),
      ...(overrides.createdById ? { createdById: overrides.createdById } : {}),
    },
  });
}

/** DRIVER user without an email unless given (section 7: email optional for drivers). */
export async function makeDriverUser(
  prisma: PrismaClient,
  overrides: UserOverrides = {},
): Promise<User> {
  const suffix = uniqueSuffix();
  const roleId = overrides.roleId ?? (await makeRole(prisma, { appliesTo: 'DRIVER' })).id;
  return prisma.user.create({
    data: {
      kind: 'DRIVER',
      username: overrides.username ?? `driver-${suffix}`,
      firstName: 'Test',
      lastName: `Driver ${suffix}`,
      email: overrides.email ?? null,
      roleId,
      ...(overrides.status ? { status: overrides.status } : {}),
      ...(overrides.createdById ? { createdById: overrides.createdById } : {}),
    },
  });
}

export interface PermissionOverrides {
  code?: string;
  group?: string;
  name?: string;
  description?: string;
  isDeprecated?: boolean;
  syncedAt?: Date;
}

export function makePermission(
  prisma: PrismaClient,
  overrides: PermissionOverrides = {},
): Promise<Permission> {
  const suffix = uniqueSuffix();
  const group = overrides.group ?? 'test';
  return prisma.permission.create({
    data: {
      code: overrides.code ?? `${group}:action-${suffix}`,
      group,
      name: overrides.name ?? `Test permission ${suffix}`,
      description: overrides.description ?? `Test permission ${suffix}`,
      isDeprecated: overrides.isDeprecated ?? false,
      syncedAt: overrides.syncedAt ?? new Date(),
    },
  });
}
