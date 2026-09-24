import { z } from 'zod';

const count = z.number().int().nonnegative();

/** Written by the permission sync and the seed (app SYSTEM, no actor). */
export const SYSTEM_AUDIT_ACTIONS = {
  'system.permissions.synced': z.strictObject({
    inserted: count,
    reactivated: count,
    deprecated: count,
    deleted: count,
    renamed: count,
  }),
  'system.seed.applied': z.strictObject({ created: count, unchanged: count }),
} as const;
