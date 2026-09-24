import { z } from 'zod';
import type { UserKind } from './enums.js';

export const PERMISSION_GROUPS = [
  'users',
  'roles',
  'permissions',
  'drivers',
  'cards',
  'vehicles',
  'carriers',
  'products',
  'loading-points',
  'orders',
  'queue',
  'audit',
  'checkin',
] as const;
export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

export interface PermissionDefinition {
  readonly code: `${PermissionGroup}:${string}`;
  readonly group: PermissionGroup;
  /** Which user kind a role granting this permission applies to (Admin = all STAFF codes). */
  readonly audience: UserKind;
  readonly defaultName: string;
  readonly defaultDescription: string;
  /** Codes this permission replaces; the sync migrates RolePermission rows from them. */
  readonly renamedFrom?: readonly string[];
}

const staff = <C extends `${PermissionGroup}:${string}`>(
  code: C,
  defaultName: string,
  defaultDescription: string,
) => ({ code, group: groupOf(code), audience: 'STAFF' as const, defaultName, defaultDescription });

function groupOf<C extends `${PermissionGroup}:${string}`>(code: C): GroupOf<C> {
  return code.slice(0, code.indexOf(':')) as GroupOf<C>;
}
type GroupOf<C extends string> = C extends `${infer G}:${string}` ? G : never;

/** The permission catalogue (spec section 9). Codes are `group:action`, actions in kebab-case. */
export const PERMISSIONS = [
  staff('users:read', 'View users', 'List staff and driver users and open their details.'),
  staff('users:create', 'Create users', 'Create staff and driver users.'),
  staff('users:update', 'Edit users', 'Change user profile data.'),
  staff('users:block', 'Block users', 'Block, unblock and deactivate users.'),
  staff('users:unlock', 'Unlock users', 'Clear a login lockout before it expires.'),
  staff('users:invite', 'Invite users', 'Send and resend invitation and password reset emails.'),
  staff('users:reset-mfa', 'Reset two-factor', 'Reset a user’s two-factor authentication.'),
  staff('roles:read', 'View roles', 'List roles and their permissions.'),
  staff('roles:manage', 'Manage roles', 'Create, edit and delete roles and their permissions.'),
  staff('permissions:read', 'View permissions', 'List the permission catalogue.'),
  staff('permissions:update', 'Edit permissions', 'Edit permission names and descriptions.'),
  staff('drivers:read', 'View drivers', 'List drivers and open their profiles.'),
  staff('drivers:manage', 'Manage drivers', 'Create and edit drivers.'),
  staff('drivers:reset-pin', 'Reset driver PIN', 'Set a new kiosk PIN for a driver.'),
  staff('cards:read', 'View cards', 'List identity cards.'),
  staff('cards:manage', 'Manage cards', 'Issue and replace identity cards.'),
  staff(
    'cards:block',
    'Block identity cards',
    'Block an identity card so it no longer opens the kiosk.',
  ),
  staff('vehicles:read', 'View vehicles', 'List vehicles.'),
  staff('vehicles:manage', 'Manage vehicles', 'Create, edit and block vehicles.'),
  staff('carriers:read', 'View carriers', 'List carriers.'),
  staff('carriers:manage', 'Manage carriers', 'Create and edit carriers.'),
  staff('products:read', 'View products', 'List products.'),
  staff('loading-points:read', 'View loading points', 'List loading islands and rail tracks.'),
  staff('orders:read', 'View orders', 'List loading orders.'),
  staff('orders:manage', 'Manage orders', 'Create, edit and cancel loading orders.'),
  staff('queue:read', 'View queue', 'See the loading queue.'),
  staff(
    'queue:assign-point',
    'Assign loading point',
    'Assign or change the loading point of a queue entry.',
  ),
  staff('queue:call', 'Call to loading', 'Call the next driver to a loading point.'),
  staff('queue:complete', 'Complete loading', 'Mark a called entry as loaded.'),
  staff('queue:remove', 'Remove from queue', 'Remove an entry from the queue with a reason.'),
  staff('queue:manual-checkin', 'Manual check-in', 'Check a driver in on their behalf.'),
  staff('audit:read', 'View audit log', 'Read the audit log.'),
  {
    code: 'checkin:perform',
    group: 'checkin',
    audience: 'DRIVER',
    defaultName: 'Check in at the kiosk',
    defaultDescription: 'Identify with card and PIN and confirm a loading order at the kiosk.',
  },
] as const satisfies readonly PermissionDefinition[];

export type PermissionCode = (typeof PERMISSIONS)[number]['code'];

export const PERMISSION_CODES: readonly PermissionCode[] = PERMISSIONS.map((p) => p.code);

export const PermissionCodeSchema = z.enum(PERMISSION_CODES);

/** Live codes granted to roles of `audience` (what `'ALL_FOR_AUDIENCE'` expands to). */
export function permissionCodesForAudience(
  audience: UserKind,
  catalogue: readonly PermissionDefinition[] = PERMISSIONS,
): PermissionCode[] {
  return catalogue.filter((p) => p.audience === audience).map((p) => p.code as PermissionCode);
}

export interface CatalogueProblem {
  readonly code: string;
  readonly problem: string;
}

const CODE_PATTERN = /^([a-z]+(?:-[a-z]+)*):([a-z]+(?:-[a-z]+)*)$/;
const GROUPS: ReadonlySet<string> = new Set(PERMISSION_GROUPS);

/**
 * Structural invariants of a catalogue; an empty result means valid. The permission sync
 * refuses to write anything when this returns problems.
 */
export function validateCatalogue(catalogue: readonly PermissionDefinition[]): CatalogueProblem[] {
  const problems: CatalogueProblem[] = [];
  const liveCodes = new Set<string>();
  const renamedSeen = new Map<string, string>();

  for (const entry of catalogue) {
    const { code } = entry;
    if (liveCodes.has(code)) problems.push({ code, problem: 'duplicate code' });
    liveCodes.add(code);

    const match = CODE_PATTERN.exec(code);
    if (!match) {
      problems.push({ code, problem: 'code must be <group>:<kebab-case-action>' });
    } else if (match[1] !== entry.group) {
      problems.push({ code, problem: `group "${entry.group}" does not match the code prefix` });
    }
    if (!GROUPS.has(entry.group)) {
      problems.push({ code, problem: `unknown group "${String(entry.group)}"` });
    }

    const expectedAudience: UserKind = entry.group === 'checkin' ? 'DRIVER' : 'STAFF';
    if (entry.audience !== expectedAudience) {
      problems.push({ code, problem: `audience must be ${expectedAudience}` });
    }

    if (entry.defaultName.trim() === '') problems.push({ code, problem: 'defaultName is empty' });
    if (entry.defaultDescription.trim() === '') {
      problems.push({ code, problem: 'defaultDescription is empty' });
    }

    for (const old of entry.renamedFrom ?? []) {
      const owner = renamedSeen.get(old);
      if (owner !== undefined) {
        problems.push({ code, problem: `renamedFrom "${old}" is also claimed by ${owner}` });
      }
      renamedSeen.set(old, code);
    }
  }

  for (const [old, owner] of renamedSeen) {
    if (liveCodes.has(old)) {
      problems.push({ code: owner, problem: `renamedFrom "${old}" is still a live code` });
    }
  }

  return problems;
}
