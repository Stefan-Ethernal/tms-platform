import { z } from 'zod';
import { AdminFailureSchema } from './admin.js';

const empty = z.strictObject({});
const count = z.number().int().nonnegative();
const at = z.iso.datetime();

export const LoginMethodSchema = z.enum(['PASSWORD', 'TOTP', 'RECOVERY_CODE']);
export type LoginMethod = z.infer<typeof LoginMethodSchema>;

export const LoginFailureReasonSchema = z.enum([
  'INVALID_CREDENTIALS',
  'INVALID_CODE',
  'CODE_REPLAYED',
  'ACCOUNT_LOCKED',
  'ACCOUNT_NOT_ACTIVE',
  'TOO_MANY_MFA_ATTEMPTS',
  // phase 2, password step (Task 16)
  'UNKNOWN_ACCOUNT',
  'NOT_STAFF',
  'MFA_RESET_PENDING',
]);
export type LoginFailureReason = z.infer<typeof LoginFailureReasonSchema>;

/** A TOTP check outside login: enrollment confirmation (Task 14) and step-up (Task 19). */
export const MfaFailureSchema = z.enum([
  'INVALID_CODE',
  'CODE_REPLAYED',
  'TOO_MANY_MFA_ATTEMPTS',
  'ACCOUNT_LOCKED',
]);
export type MfaFailure = z.infer<typeof MfaFailureSchema>;

/** Single-use link and password flows: invite, enrollment password, reset, change, 2FA reset accept. */
export const TokenFailureSchema = z.enum([
  'INVALID_TOKEN',
  'WEAK_PASSWORD',
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
]);
export type TokenFailure = z.infer<typeof TokenFailureSchema>;

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

const tokenRefusal = { reason: TokenFailureSchema.optional() };
const mfaRefusal = { reason: MfaFailureSchema.optional() };

/**
 * Spec section 8, staff authentication. The target is the User; token flows target the
 * ActionToken row instead of carrying its id in metadata (`token` is a sensitive key).
 * `reason` is set only on FAILURE rows.
 */
export const AUTH_AUDIT_ACTIONS = {
  'auth.invite.issued': z.strictObject({
    via: z.enum(['ADMIN', 'BOOTSTRAP']).optional(),
    expiresAt: at.optional(), // omitted on FAILURE rows
    ...tokenRefusal,
  }),
  'auth.invite.accepted': z.strictObject({ ...tokenRefusal }),
  'auth.invite.resent': z.strictObject({ expiresAt: at.optional(), ...tokenRefusal }),
  'auth.password.set': z.strictObject({ ...tokenRefusal }),
  'auth.totp.enrolled': z.strictObject({ ...mfaRefusal }),
  /** Step-up: a TOTP check outside login. */
  'auth.totp.verified': z.strictObject({ ...mfaRefusal }),
  'auth.login.success': z.strictObject({ method: LoginMethodSchema }),
  'auth.login.failure': z.strictObject({
    method: LoginMethodSchema,
    reason: LoginFailureReasonSchema,
  }),
  'auth.lockout.applied': z.strictObject({
    failedAttempts: z.number().int().min(1),
    lockedUntil: at,
    /** Consecutive lockouts (`User.lockoutLevel`, Task 16), 1-based. */
    level: z.number().int().positive().optional(),
  }),
  'auth.session.revoked': z.strictObject({
    reason: SessionRevocationReasonSchema,
    sessionCount: count,
  }),
  'auth.mfa.reset': z.strictObject({
    via: z.enum(['ADMIN', 'CLI']).optional(),
    sessionsRevoked: count.optional(),
    linksRevoked: count.optional(),
    reason: AdminFailureSchema.optional(),
  }),
  'auth.password-reset.requested': z.strictObject({ knownAccount: z.boolean().optional() }),
  'auth.password-reset.completed': z.strictObject({
    sessionsRevoked: count.optional(),
    /** A pending 2FA reset got a fresh MFA_RESET link (Task 22, D2). */
    mfaResetReissued: z.boolean().optional(),
    ...tokenRefusal,
  }),
  // phase 2
  'auth.enrollment.completed': z.strictObject({ flow: z.enum(['INVITE', 'MFA_RESET']) }),
  'auth.password.changed': z.strictObject({ sessionsRevoked: count.optional(), ...tokenRefusal }),
  'auth.recovery-codes.regenerated': empty,
  'auth.mfa-reset.accepted': z.strictObject({ ...tokenRefusal }),
} as const;
