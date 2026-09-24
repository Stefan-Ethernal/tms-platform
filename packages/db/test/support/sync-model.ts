import type { GrantRow, PermissionRow, SyncPlan, SyncState } from '../../src/sync/plan';

/** Applies a plan to an in-memory state exactly as syncPermissionsInTx applies it to the database. */
export function applyPlanToState(state: SyncState, plan: SyncPlan): SyncState {
  const permissions = new Map<string, PermissionRow>(
    state.permissions.map((p) => [p.code, { ...p }]),
  );
  for (const row of plan.inserts) permissions.set(row.code, { ...row });
  for (const { code, group } of plan.regroup) permissions.get(code)!.group = group;
  for (const code of plan.reactivate) permissions.get(code)!.isDeprecated = false;

  let grants: GrantRow[] = state.grants.map((g) => ({ ...g }));
  for (const rename of plan.renames) {
    grants = grants
      .filter((g) => g.permissionCode !== rename.from)
      .concat(rename.grantsToMove.map((g) => ({ roleId: g.roleId, permissionCode: rename.to })));
  }
  for (const locked of plan.lockedRoleGrants) {
    grants = grants
      .filter((g) => !(g.roleId === locked.roleId && locked.remove.includes(g.permissionCode)))
      .concat(locked.add.map((code) => ({ roleId: locked.roleId, permissionCode: code })));
  }

  for (const code of plan.deprecate) permissions.get(code)!.isDeprecated = true;
  for (const code of plan.delete) permissions.delete(code);

  return { permissions: [...permissions.values()], grants, roles: state.roles };
}
