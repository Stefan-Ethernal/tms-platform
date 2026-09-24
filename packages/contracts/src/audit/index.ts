import { z } from 'zod';
import { ADMIN_AUDIT_ACTIONS } from './admin.js';
import { AUTH_AUDIT_ACTIONS } from './auth.js';
import { CHECKIN_AUDIT_ACTIONS } from './checkin.js';
import { OPS_AUDIT_ACTIONS } from './ops.js';
import { SYSTEM_AUDIT_ACTIONS } from './system.js';

export * from './admin.js';
export * from './auth.js';
export * from './checkin.js';
export * from './ops.js';
export * from './system.js';

/** `<area>.<entity>.<event>`, kebab-case segments; every value is a fail-closed strict object. */
export const AUDIT_ACTIONS = {
  ...AUTH_AUDIT_ACTIONS,
  ...ADMIN_AUDIT_ACTIONS,
  ...OPS_AUDIT_ACTIONS,
  ...CHECKIN_AUDIT_ACTIONS,
  ...SYSTEM_AUDIT_ACTIONS,
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export const AUDIT_ACTION_NAMES = Object.keys(AUDIT_ACTIONS) as readonly AuditAction[];

export const AuditActionSchema = z.enum(AUDIT_ACTION_NAMES);

export type AuditMetadata<A extends AuditAction> = z.output<(typeof AUDIT_ACTIONS)[A]>;

export const AuditTargetTypeSchema = z.enum([
  'User',
  'Role',
  'Permission',
  'DriverProfile',
  'IdentityCard',
  'Carrier',
  'Vehicle',
  'Product',
  'LoadingPoint',
  'LoadingOrder',
  'QueueEntry',
  'Session',
  'ActionToken',
]);
export type AuditTargetType = z.infer<typeof AuditTargetTypeSchema>;

export class AuditMetadataError extends Error {
  override readonly name = 'AuditMetadataError';

  constructor(
    readonly action: string,
    readonly issues: readonly z.core.$ZodIssue[],
  ) {
    super(
      `Invalid audit metadata for ${action}: ${issues
        .map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`)
        .join('; ')}`,
    );
  }
}

/**
 * Validates `value` against the action's strict schema. `undefined` means "no metadata" and is
 * accepted only where the schema is empty. Throws `AuditMetadataError` on any issue, including an
 * action that is not in `AUDIT_ACTIONS` (the caller's transaction then rolls back).
 */
export function parseAuditMetadata<A extends AuditAction>(
  action: A,
  value: unknown,
): AuditMetadata<A> {
  const schema = (AUDIT_ACTIONS as Record<string, z.ZodType | undefined>)[action];
  if (schema === undefined) {
    throw new AuditMetadataError(action, [
      {
        code: 'invalid_value',
        values: [...AUDIT_ACTION_NAMES],
        path: [],
        message: 'unknown audit action',
        input: action,
      },
    ]);
  }
  const result = schema.safeParse(value ?? {});
  if (!result.success) throw new AuditMetadataError(action, result.error.issues);
  return result.data as AuditMetadata<A>;
}
