import { z } from 'zod';

const empty = z.strictObject({});
const id = z.string().min(1).max(64);
const code = z.string().min(1).max(80);
const count = z.number().int().nonnegative();
/** A list's entity key (`drivers`, `loading-orders`) and a filter field name; never a value. */
const listKey = z
  .string()
  .regex(/^[a-z]+(-[a-z]+)*$/)
  .max(40);
const fieldName = z
  .string()
  .regex(/^[a-z][A-Za-z0-9]*$/)
  .max(64);

export const UserProfileFieldSchema = z.enum([
  'username',
  'firstName',
  'lastName',
  'dateOfBirth',
  'phone',
  'email',
  'locale',
]);
export type UserProfileField = z.infer<typeof UserProfileFieldSchema>;

/** Spec sections 7 to 9 and 12, back-office administration; loading orders live in `ops.ts`. */
export const ADMIN_AUDIT_ACTIONS = {
  'admin.user.created': empty,
  'admin.user.updated': z.strictObject({ changedFields: z.array(UserProfileFieldSchema).max(16) }),
  'admin.user.blocked': empty,
  'admin.user.unblocked': empty,
  'admin.user.deactivated': empty,
  'admin.user.unlocked': empty,
  'admin.user.role-changed': z.strictObject({ fromRoleId: id, toRoleId: id }),
  'admin.role.created': empty,
  'admin.role.updated': z.strictObject({
    permissionsAdded: z.array(code).max(200).optional(),
    permissionsRemoved: z.array(code).max(200).optional(),
  }),
  'admin.role.deleted': empty,
  'admin.permission.updated': empty,
  'admin.permission.deleted': z.strictObject({ code }),
  'admin.driver.created': empty,
  'admin.driver.updated': empty,
  // The PIN never goes into metadata.
  'admin.driver.pin-reset': empty,
  'admin.card.issued': empty,
  'admin.card.blocked': empty,
  'admin.carrier.created': empty,
  'admin.carrier.updated': empty,
  'admin.vehicle.created': empty,
  'admin.vehicle.updated': empty,
  // Every CSV export (spec section 12): the filtered field names, never the filter values.
  'admin.list.exported': z.strictObject({
    list: listKey,
    rowCount: count,
    filterFields: z.array(fieldName).max(32),
  }),
} as const;
