import type { UserKind } from './enums.js';
import {
  PERMISSIONS,
  permissionCodesForAudience,
  type PermissionCode,
  type PermissionDefinition,
} from './permissions.js';

export const ADMIN_ROLE_KEY = 'admin' as const;
export const ALL_FOR_AUDIENCE = 'ALL_FOR_AUDIENCE' as const;

export type SeededRoleKey = 'admin' | 'operator' | 'driver';

export interface SeededRole {
  /** Stable identity across renames (`Role.key`, spec deviation 3). */
  readonly key: SeededRoleKey;
  readonly name: string;
  readonly description: string;
  readonly appliesTo: UserKind;
  readonly isSystem: boolean;
  /** The sync keeps a locked role equal to its definition; unlocked roles are admin-editable. */
  readonly permissionsLocked: boolean;
  readonly permissions: typeof ALL_FOR_AUDIENCE | readonly PermissionCode[];
}

/** Roles created by the seed (spec section 9). Operator is editable and therefore not a system role. */
export const SEEDED_ROLES = [
  {
    key: 'admin',
    name: 'Admin',
    description: 'Full access to every back-office function.',
    appliesTo: 'STAFF',
    isSystem: true,
    permissionsLocked: true,
    permissions: ALL_FOR_AUDIENCE,
  },
  {
    key: 'operator',
    name: 'Operator',
    description: 'Runs the loading queue and reads master data.',
    appliesTo: 'STAFF',
    isSystem: false,
    permissionsLocked: false,
    permissions: [
      'orders:read',
      'orders:manage',
      'queue:read',
      'queue:assign-point',
      'queue:call',
      'queue:complete',
      'queue:remove',
      'queue:manual-checkin',
      'drivers:read',
      'cards:read',
      'vehicles:read',
      'carriers:read',
      'products:read',
      'loading-points:read',
      'audit:read',
    ],
  },
  {
    key: 'driver',
    name: 'Driver',
    description: 'Checks in at the kiosk with card and PIN.',
    appliesTo: 'DRIVER',
    isSystem: true,
    permissionsLocked: true,
    permissions: ['checkin:perform'],
  },
] as const satisfies readonly SeededRole[];

/** Expands `'ALL_FOR_AUDIENCE'` against `catalogue`; explicit lists are returned as given. */
export function resolveRolePermissions(
  role: SeededRole,
  catalogue: readonly PermissionDefinition[] = PERMISSIONS,
): PermissionCode[] {
  return role.permissions === ALL_FOR_AUDIENCE
    ? permissionCodesForAudience(role.appliesTo, catalogue)
    : [...role.permissions];
}
