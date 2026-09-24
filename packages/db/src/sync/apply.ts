import {
  PERMISSIONS,
  SEEDED_ROLES,
  type AuditMetadata,
  type PermissionDefinition,
} from '@tms/contracts';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import {
  planPermissionSync,
  type LockedRole,
  type RoleRow,
  type SyncPlan,
  type SyncState,
} from './plan';

/** Fixed advisory-lock key: every sync in every process serialises on it (predev, compose, seed). */
export const LOCK_KEY = 7301;

export interface SyncOptions {
  lockedRoles?: readonly LockedRole[];
  now?: () => Date;
}

export interface SyncReport {
  inserted: string[];
  regrouped: string[];
  reactivated: string[];
  renamed: { from: string; to: string; grantsMoved: number; grantsDropped: number }[];
  lockedRoleGrants: { roleKey: string; added: string[]; removed: string[] }[];
  deprecated: string[];
  deleted: string[];
}

const DEFAULT_LOCKED_ROLES: readonly LockedRole[] = SEEDED_ROLES.filter(
  (r) => r.permissionsLocked,
).map((r) => ({
  key: r.key,
  appliesTo: r.appliesTo,
}));

export function isEmptyReport(report: SyncReport): boolean {
  // Object.values on an interface without an index signature resolves to the `any[]` overload;
  // the cast keeps the element type (every field of SyncReport is an array) instead of `any`.
  return Object.values(report as unknown as Record<string, unknown[]>).every(
    (list) => list.length === 0,
  );
}

/** The five counters of the `system.permissions.synced` audit metadata (recorded from phase 3b on). */
export function summarizeSyncReport(
  report: SyncReport,
): AuditMetadata<'system.permissions.synced'> {
  return {
    inserted: report.inserted.length,
    reactivated: report.reactivated.length,
    deprecated: report.deprecated.length,
    deleted: report.deleted.length,
    renamed: report.renamed.length,
  };
}

/**
 * Synchronises the catalogue in one transaction. ReadCommitted, not Serializable, on purpose:
 * the advisory lock is the first statement, and under snapshot isolation the snapshot would be
 * taken before the lock is granted, so a run that waited for a concurrent run would still see the
 * old rows and try to insert them again. Under ReadCommitted every statement after the lock sees
 * the previous run's commit and plans an empty diff.
 */
export async function syncPermissions(
  client: PrismaClient,
  catalogue: readonly PermissionDefinition[] = PERMISSIONS,
  opts: SyncOptions = {},
): Promise<SyncReport> {
  return client.$transaction((tx) => syncPermissionsInTx(tx, catalogue, opts), {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 10_000,
    timeout: 60_000,
  });
}

/** The body of syncPermissions for callers that already hold a transaction (the seed). */
export async function syncPermissionsInTx(
  tx: Prisma.TransactionClient,
  catalogue: readonly PermissionDefinition[] = PERMISSIONS,
  opts: SyncOptions = {},
): Promise<SyncReport> {
  const lockedRoles = opts.lockedRoles ?? DEFAULT_LOCKED_ROLES;
  const now = opts.now ?? ((): Date => new Date());

  // Re-entrant within the session: the seed may already hold it through its own transaction.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY}::bigint)`;
  const state = await readState(tx);
  const plan = planPermissionSync(state, catalogue, { lockedRoles });
  await applyPlan(tx, plan, now());
  return toReport(plan, state.roles);
}

async function readState(tx: Prisma.TransactionClient): Promise<SyncState> {
  const permissions = await tx.permission.findMany({
    select: { code: true, group: true, name: true, description: true, isDeprecated: true },
    orderBy: { code: 'asc' },
  });
  const grants = await tx.rolePermission.findMany({
    select: { roleId: true, permissionCode: true },
  });
  const roles = await tx.role.findMany({ select: { id: true, key: true, appliesTo: true } });
  return { permissions, grants, roles };
}

// Same order as test/support/sync-model.ts applyPlanToState; syncedAt only on rows that change.
async function applyPlan(tx: Prisma.TransactionClient, plan: SyncPlan, at: Date): Promise<void> {
  if (plan.inserts.length > 0) {
    await tx.permission.createMany({ data: plan.inserts.map((row) => ({ ...row, syncedAt: at })) });
  }
  for (const { code, group } of plan.regroup) {
    await tx.permission.update({ where: { code }, data: { group, syncedAt: at } });
  }
  if (plan.reactivate.length > 0) {
    await tx.permission.updateMany({
      where: { code: { in: plan.reactivate } },
      data: { isDeprecated: false, syncedAt: at },
    });
  }
  for (const rename of plan.renames) {
    if (rename.grantsToMove.length > 0) {
      await tx.rolePermission.createMany({
        data: rename.grantsToMove.map((g) => ({ roleId: g.roleId, permissionCode: rename.to })),
      });
    }
    await tx.rolePermission.deleteMany({ where: { permissionCode: rename.from } });
  }
  for (const locked of plan.lockedRoleGrants) {
    if (locked.remove.length > 0) {
      await tx.rolePermission.deleteMany({
        where: { roleId: locked.roleId, permissionCode: { in: locked.remove } },
      });
    }
    if (locked.add.length > 0) {
      await tx.rolePermission.createMany({
        data: locked.add.map((code) => ({ roleId: locked.roleId, permissionCode: code })),
      });
    }
  }
  if (plan.deprecate.length > 0) {
    await tx.permission.updateMany({
      where: { code: { in: plan.deprecate } },
      data: { isDeprecated: true, syncedAt: at },
    });
  }
  if (plan.delete.length > 0) {
    await tx.permission.deleteMany({ where: { code: { in: plan.delete } } });
  }
}

function toReport(plan: SyncPlan, roles: readonly RoleRow[]): SyncReport {
  const keyOf = new Map(roles.map((r) => [r.id, r.key ?? r.id]));
  return {
    inserted: plan.inserts.map((row) => row.code),
    regrouped: plan.regroup.map((r) => r.code),
    reactivated: [...plan.reactivate],
    renamed: plan.renames.map((r) => ({
      from: r.from,
      to: r.to,
      grantsMoved: r.grantsToMove.length,
      grantsDropped: r.grantsToDrop.length,
    })),
    lockedRoleGrants: plan.lockedRoleGrants.map((l) => ({
      roleKey: keyOf.get(l.roleId) ?? l.roleId,
      added: [...l.add],
      removed: [...l.remove],
    })),
    deprecated: [...plan.deprecate],
    deleted: [...plan.delete],
  };
}
