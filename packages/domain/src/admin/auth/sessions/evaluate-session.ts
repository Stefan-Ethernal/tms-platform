import { isSessionExpired, type SessionExpiryConfig } from '@tms/auth-core';

export interface SessionForEvaluation {
  scope: 'PRE_MFA' | 'ENROLLMENT' | 'FULL';
  expiresAt: Date;
  lastSeenAt: Date;
  user: { kind: string; status: string; totpEnabledAt: Date | null };
}

export type SessionVerdict =
  { ok: true } | { ok: false; reason: 'EXPIRED' | 'NOT_STAFF' | 'STATUS' };

/** Status-per-scope rule (plan Task 11): FULL ⇒ ACTIVE ∧ enrolled; ENROLLMENT ⇒ INVITED ∨ ACTIVE. */
export function evaluateStaffSession(
  s: SessionForEvaluation,
  now: Date,
  expiry: SessionExpiryConfig,
): SessionVerdict {
  if (isSessionExpired(s, now, expiry)) return { ok: false, reason: 'EXPIRED' };
  if (s.user.kind !== 'STAFF') return { ok: false, reason: 'NOT_STAFF' };
  const { status, totpEnabledAt } = s.user;
  const allowed =
    s.scope === 'ENROLLMENT'
      ? status === 'INVITED' || status === 'ACTIVE'
      : status === 'ACTIVE' && totpEnabledAt !== null;
  return allowed ? { ok: true } : { ok: false, reason: 'STATUS' };
}
