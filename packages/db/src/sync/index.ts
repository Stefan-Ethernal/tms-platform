export {
  CatalogueInvalidError,
  isEmptyPlan,
  planPermissionSync,
  type Audience,
  type GrantRow,
  type LockedRole,
  type LockedRoleStep,
  type PermissionRow,
  type RenameStep,
  type RoleRow,
  type SyncPlan,
  type SyncState,
} from './plan';
export {
  LOCK_KEY,
  isEmptyReport,
  summarizeSyncReport,
  syncPermissions,
  syncPermissionsInTx,
  type SyncOptions,
  type SyncReport,
} from './apply';
