import { z } from 'zod';

const empty = z.strictObject({});
const count = z.number().int().nonnegative();

export const LoginMethodSchema = z.enum(['PASSWORD', 'TOTP', 'RECOVERY_CODE']);
export type LoginMethod = z.infer<typeof LoginMethodSchema>;

export const LoginFailureReasonSchema = z.enum([
  'INVALID_CREDENTIALS',
  'INVALID_CODE',
  'CODE_REPLAYED',
  'ACCOUNT_LOCKED',
  'ACCOUNT_NOT_ACTIVE',
  'TOO_MANY_MFA_ATTEMPTS',
]);
export type LoginFailureReason = z.infer<typeof LoginFailureReasonSchema>;

export const SessionRevocationReasonSchema = z.enum([
  'LOGOUT',
  'BLOCKED',
  'DEACTIVATED',
  'PASSWORD_CHANGED',
  'ROLE_CHANGED',
  'MFA_RESET',
  'EXPIRED',
]);
export type SessionRevocationReason = z.infer<typeof SessionRevocationReasonSchema>;

/**
 * Spec section 8, staff authentication. The target is the User; token flows target the
 * ActionToken row instead of carrying its id in metadata (`token` is a sensitive key).
 */
export const AUTH_AUDIT_ACTIONS = {
  'auth.invite.issued': empty,
  'auth.invite.accepted': empty,
  'auth.invite.resent': empty,
  'auth.password.set': empty,
  'auth.totp.enrolled': empty,
  'auth.totp.verified': empty,
  'auth.login.success': z.strictObject({ method: LoginMethodSchema }),
  'auth.login.failure': z.strictObject({
    method: LoginMethodSchema,
    reason: LoginFailureReasonSchema,
  }),
  'auth.lockout.applied': z.strictObject({
    failedAttempts: z.number().int().min(1),
    lockedUntil: z.iso.datetime(),
  }),
  'auth.session.revoked': z.strictObject({
    reason: SessionRevocationReasonSchema,
    sessionCount: count,
  }),
  'auth.mfa.reset': empty,
  'auth.password-reset.requested': empty,
  'auth.password-reset.completed': empty,
} as const;
