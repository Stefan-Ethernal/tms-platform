import {
  ADMIN_ROLE_KEY,
  PERMISSIONS,
  resolveRolePermissions,
  SEEDED_ROLES,
  type AuditMetadata,
  type SeededRoleKey,
} from '@tms/contracts';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { syncPermissionsInTx, type SyncReport } from '../sync/apply';
import { SEED_LOADING_POINTS, SEED_PRODUCTS } from './data';

/** Serialises predev and the compose one-shot on one database; the inner sync adds LOCK_KEY. */
export const SEED_LOCK_KEY = 7302;

export interface SeedOptions {
  bootstrapAdmin: { email: string | undefined; username?: string };
  now?: () => Date;
}

export interface SeedReport {
  sync: SyncReport;
  rolesCreated: SeededRoleKey[];
  productsCreated: string[];
  loadingPointsCreated: string[];
  bootstrapAdmin: 'created' | 'exists';
  warnings: string[];
}

export class SeedConfigError extends Error {
  override readonly name = 'SeedConfigError';
}

/** Roles, products, loading points and the one bootstrap admin the seed is responsible for. */
export const SEEDED_ENTITY_COUNT =
  SEEDED_ROLES.length + SEED_PRODUCTS.length + SEED_LOADING_POINTS.length + 1;

/** The `system.seed.applied` audit metadata (recorded from phase 3b on). */
export function summarizeSeedReport(report: SeedReport): AuditMetadata<'system.seed.applied'> {
  const created =
    report.rolesCreated.length +
    report.productsCreated.length +
    report.loadingPointsCreated.length +
    (report.bootstrapAdmin === 'created' ? 1 : 0);
  return { created, unchanged: SEEDED_ENTITY_COUNT - created };
}

/**
 * Create-only and idempotent: rows that exist are never renamed, re-granted or re-activated
 * (admins own them, section 9); only the permission sync keeps locked roles exact.
 */
export async function seedDatabase(
  client: PrismaClient,
  options: SeedOptions,
): Promise<SeedReport> {
  return client.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SEED_LOCK_KEY}::bigint)`;
      const sync = await syncPermissionsInTx(
        tx,
        PERMISSIONS,
        options.now ? { now: options.now } : {},
      );
      const rolesCreated = await seedRoles(tx);
      const productsCreated = await seedProducts(tx);
      const loadingPointsCreated = await seedLoadingPoints(tx);
      const admin = await seedBootstrapAdmin(tx, options.bootstrapAdmin);
      return { sync, rolesCreated, productsCreated, loadingPointsCreated, ...admin };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 10_000,
      timeout: 60_000,
    },
  );
}

async function seedRoles(tx: Prisma.TransactionClient): Promise<SeededRoleKey[]> {
  const created: SeededRoleKey[] = [];
  for (const role of SEEDED_ROLES) {
    const existing = await tx.role.findUnique({ where: { key: role.key }, select: { id: true } });
    if (existing) continue;
    const row = await tx.role.create({
      data: {
        key: role.key,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        appliesTo: role.appliesTo,
      },
    });
    const codes = resolveRolePermissions(role, PERMISSIONS);
    if (codes.length > 0) {
      await tx.rolePermission.createMany({
        data: codes.map((permissionCode) => ({ roleId: row.id, permissionCode })),
      });
    }
    created.push(role.key);
  }
  return created;
}

async function seedProducts(tx: Prisma.TransactionClient): Promise<string[]> {
  const existing = new Set(
    (await tx.product.findMany({ select: { code: true } })).map((p) => p.code),
  );
  const missing = SEED_PRODUCTS.filter((p) => !existing.has(p.code));
  if (missing.length > 0) {
    await tx.product.createMany({
      data: missing.map((p) => ({ code: p.code, name: p.name, isActive: true })),
    });
  }
  return missing.map((p) => p.code);
}

async function seedLoadingPoints(tx: Prisma.TransactionClient): Promise<string[]> {
  const existing = new Set(
    (await tx.loadingPoint.findMany({ select: { code: true } })).map((p) => p.code),
  );
  const missing = SEED_LOADING_POINTS.filter((p) => !existing.has(p.code));
  if (missing.length > 0) {
    await tx.loadingPoint.createMany({
      data: missing.map((p) => ({ code: p.code, name: p.name, kind: p.kind, isActive: true })),
    });
  }
  return missing.map((p) => p.code);
}

async function seedBootstrapAdmin(
  tx: Prisma.TransactionClient,
  { email, username }: SeedOptions['bootstrapAdmin'],
): Promise<{ bootstrapAdmin: 'created' | 'exists'; warnings: string[] }> {
  const adminRole = await tx.role.findUniqueOrThrow({
    where: { key: ADMIN_ROLE_KEY },
    select: { id: true },
  });
  const admins = await tx.user.findMany({
    where: { roleId: adminRole.id },
    select: { email: true },
  });
  if (admins.length > 0) {
    const warnings =
      email && !admins.some((a) => a.email === email)
        ? [
            `BOOTSTRAP_ADMIN_EMAIL (${email}) matches no existing admin account; the seed never modifies existing users`,
          ]
        : [];
    return { bootstrapAdmin: 'exists', warnings };
  }
  if (!email) throw new SeedConfigError('BOOTSTRAP_ADMIN_EMAIL is required while no admin exists');
  // INVITED without a token, URL or email: phase 2 adds them with auth-core (plan deviation 4).
  await tx.user.create({
    data: {
      kind: 'STAFF',
      username: username ?? 'admin',
      firstName: 'Bootstrap',
      lastName: 'Admin',
      email,
      status: 'INVITED',
      roleId: adminRole.id,
      locale: 'en',
    },
  });
  return { bootstrapAdmin: 'created', warnings: [] };
}
