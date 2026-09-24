import type {
  $Enums,
  Carrier,
  DriverProfile,
  IdentityCard,
  LoadingOrder,
  LoadingPoint,
  Permission,
  PrismaClient,
  Product,
  Role,
  User,
  Vehicle,
} from '../index';

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

/** Calendar day used by queue tests; DATE columns round-trip as UTC midnight. */
export const TEST_DAY = new Date('2026-09-23T00:00:00.000Z');

export function makeCarrier(
  prisma: PrismaClient,
  overrides: { name?: string; isActive?: boolean } = {},
): Promise<Carrier> {
  const suffix = uniqueSuffix();
  return prisma.carrier.create({
    data: { name: overrides.name ?? `Carrier ${suffix}`, isActive: overrides.isActive ?? true },
  });
}

export function makeVehicle(
  prisma: PrismaClient,
  overrides: {
    carrierId: string;
    registration?: string;
    kind?: $Enums.VehicleKind;
    isBlocked?: boolean;
  },
): Promise<Vehicle> {
  const suffix = uniqueSuffix();
  return prisma.vehicle.create({
    data: {
      registration: overrides.registration ?? `TS-${suffix}-AA`,
      carrierId: overrides.carrierId,
      kind: overrides.kind ?? 'TRUCK',
      isBlocked: overrides.isBlocked ?? false,
    },
  });
}

export function makeProduct(
  prisma: PrismaClient,
  overrides: { code?: string; name?: string; isActive?: boolean } = {},
): Promise<Product> {
  const suffix = uniqueSuffix();
  return prisma.product.create({
    data: {
      code: overrides.code ?? `P${suffix}`,
      name: overrides.name ?? `Product ${suffix}`,
      isActive: overrides.isActive ?? true,
    },
  });
}

export function makeLoadingPoint(
  prisma: PrismaClient,
  overrides: {
    code?: string;
    name?: string;
    kind?: $Enums.LoadingPointKind;
    isActive?: boolean;
  } = {},
): Promise<LoadingPoint> {
  const suffix = uniqueSuffix();
  return prisma.loadingPoint.create({
    data: {
      code: overrides.code ?? `LP${suffix}`,
      name: overrides.name ?? `Loading point ${suffix}`,
      kind: overrides.kind ?? 'TRUCK_ISLAND',
      isActive: overrides.isActive ?? true,
    },
  });
}

export function makeDriverProfile(
  prisma: PrismaClient,
  overrides: {
    userId: string;
    carrierId: string;
    driverType?: $Enums.DriverType;
    pinHash?: string;
  },
): Promise<DriverProfile> {
  return prisma.driverProfile.create({
    data: {
      userId: overrides.userId,
      carrierId: overrides.carrierId,
      driverType: overrides.driverType ?? 'TRUCK',
      pinHash: overrides.pinHash ?? 'not-a-real-hash',
      pinUpdatedAt: new Date(),
    },
  });
}

/** ACTIVE by default with `activeUserId = userId`; a BLOCKED card gets `activeUserId = null`. */
export function makeIdentityCard(
  prisma: PrismaClient,
  overrides: { userId: string; serial?: string; status?: $Enums.IdentityCardStatus },
): Promise<IdentityCard> {
  const suffix = uniqueSuffix();
  const status = overrides.status ?? 'ACTIVE';
  return prisma.identityCard.create({
    data: {
      serial: overrides.serial ?? `CARD-${suffix}`,
      userId: overrides.userId,
      activeUserId: status === 'ACTIVE' ? overrides.userId : null,
      status,
      issuedAt: new Date(),
    },
  });
}

export interface LoadingOrderOverrides {
  driverId: string;
  vehicleId: string;
  carrierId: string;
  productId: string;
  orderNumber?: string;
  transportKind?: $Enums.TransportKind;
  quantityLiters?: number;
  plannedDate?: Date;
  createdById?: string;
}

export function makeLoadingOrder(
  prisma: PrismaClient,
  overrides: LoadingOrderOverrides,
): Promise<LoadingOrder> {
  const suffix = uniqueSuffix();
  return prisma.loadingOrder.create({
    data: {
      orderNumber: overrides.orderNumber ?? `LO-${suffix}`,
      transportKind: overrides.transportKind ?? 'TRUCK',
      driverId: overrides.driverId,
      vehicleId: overrides.vehicleId,
      carrierId: overrides.carrierId,
      productId: overrides.productId,
      quantityLiters: overrides.quantityLiters ?? 20000,
      plannedDate: overrides.plannedDate ?? TEST_DAY,
      ...(overrides.createdById ? { createdById: overrides.createdById } : {}),
    },
  });
}
