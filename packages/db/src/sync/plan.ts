import {
  permissionCodesForAudience,
  validateCatalogue,
  type CatalogueProblem,
  type PermissionDefinition,
} from '@tms/contracts';

export type Audience = 'STAFF' | 'DRIVER';

export interface PermissionRow {
  code: string;
  group: string;
  name: string;
  description: string;
  isDeprecated: boolean;
}
export interface GrantRow {
  roleId: string;
  permissionCode: string;
}
export interface RoleRow {
  id: string;
  key: string | null;
  appliesTo: Audience;
}
export interface SyncState {
  permissions: readonly PermissionRow[];
  grants: readonly GrantRow[];
  roles: readonly RoleRow[];
}
export interface LockedRole {
  key: string;
  appliesTo: Audience;
}
export interface RenameStep {
  from: string;
  to: string;
  grantsToMove: GrantRow[];
  grantsToDrop: GrantRow[];
}
export interface LockedRoleStep {
  roleId: string;
  add: string[];
  remove: string[];
}
export interface SyncPlan {
  inserts: PermissionRow[];
  regroup: { code: string; group: string }[];
  reactivate: string[];
  renames: RenameStep[];
  lockedRoleGrants: LockedRoleStep[];
  deprecate: string[];
  delete: string[];
}

export class CatalogueInvalidError extends Error {
  override readonly name = 'CatalogueInvalidError';

  constructor(readonly problems: readonly CatalogueProblem[]) {
    super(
      `invalid permission catalogue (${problems.length} problem${problems.length === 1 ? '' : 's'}): ${JSON.stringify(problems)}`,
    );
  }
}

/**
 * Computes the writes that bring the database in line with the catalogue. Names and
 * descriptions are written only on insert (section 9: admins own them afterwards).
 */
export function planPermissionSync(
  state: SyncState,
  catalogue: readonly PermissionDefinition[],
  opts: { lockedRoles: readonly LockedRole[] },
): SyncPlan {
  const problems = validateCatalogue(catalogue);
  if (problems.length > 0) throw new CatalogueInvalidError(problems);

  const live = new Map<string, PermissionDefinition>(catalogue.map((d) => [d.code, d]));
  const inDb = new Map<string, PermissionRow>(state.permissions.map((p) => [p.code, p]));

  // Rule 2: insert missing codes with defaults; align group and deprecation of present ones.
  const inserts: PermissionRow[] = [];
  const regroup: { code: string; group: string }[] = [];
  const reactivate: string[] = [];
  for (const d of catalogue) {
    const row = inDb.get(d.code);
    if (!row) {
      inserts.push({
        code: d.code,
        group: d.group,
        name: d.defaultName,
        description: d.defaultDescription,
        isDeprecated: false,
      });
      continue;
    }
    if (row.group !== d.group) regroup.push({ code: d.code, group: d.group });
    if (row.isDeprecated) reactivate.push(d.code);
  }

  // Rule 3: renames move grants to the new code; a role that already holds it drops the old grant.
  let grants: GrantRow[] = state.grants.map((g) => ({ ...g }));
  const renames: RenameStep[] = [];
  for (const d of catalogue) {
    for (const from of d.renamedFrom ?? []) {
      // A live code is never an old name; skipping keeps the planner idempotent on odd input.
      if (!inDb.has(from) || live.has(from)) continue;
      const holdingTarget = new Set(
        grants.filter((g) => g.permissionCode === d.code).map((g) => g.roleId),
      );
      const old = grants.filter((g) => g.permissionCode === from);
      const grantsToMove = old.filter((g) => !holdingTarget.has(g.roleId));
      const grantsToDrop = old.filter((g) => holdingTarget.has(g.roleId));
      renames.push({ from, to: d.code, grantsToMove, grantsToDrop });
      grants = grants
        .filter((g) => g.permissionCode !== from)
        .concat(grantsToMove.map((g) => ({ roleId: g.roleId, permissionCode: d.code })));
    }
  }

  // Rule 4: a locked role holds exactly the active catalogue codes of its audience.
  const lockedRoleGrants: LockedRoleStep[] = [];
  for (const locked of opts.lockedRoles) {
    const role = state.roles.find((r) => r.key === locked.key);
    if (!role) continue;
    const target = new Set<string>(permissionCodesForAudience(locked.appliesTo, catalogue));
    const current = new Set(
      grants.filter((g) => g.roleId === role.id).map((g) => g.permissionCode),
    );
    const add = [...target].filter((c) => !current.has(c)).sort();
    const remove = [...current].filter((c) => !target.has(c)).sort();
    if (add.length === 0 && remove.length === 0) continue;
    lockedRoleGrants.push({ roleId: role.id, add, remove });
    grants = grants
      .filter((g) => !(g.roleId === role.id && remove.includes(g.permissionCode)))
      .concat(add.map((code) => ({ roleId: role.id, permissionCode: code })));
  }

  // Rule 5: codes the catalogue no longer names stay (deprecated) while any role references them.
  const referenced = new Set(grants.map((g) => g.permissionCode));
  const deprecate: string[] = [];
  const toDelete: string[] = [];
  for (const row of state.permissions) {
    if (live.has(row.code)) continue;
    if (referenced.has(row.code)) {
      if (!row.isDeprecated) deprecate.push(row.code);
    } else {
      toDelete.push(row.code);
    }
  }
  deprecate.sort();
  toDelete.sort();

  return { inserts, regroup, reactivate, renames, lockedRoleGrants, deprecate, delete: toDelete };
}

export function isEmptyPlan(plan: SyncPlan): boolean {
  // Object.values on an interface without an index signature resolves to the `any[]` overload;
  // the cast keeps the element type (every field of SyncPlan is an array) instead of `any`.
  return Object.values(plan as unknown as Record<string, unknown[]>).every(
    (list) => list.length === 0,
  );
}
