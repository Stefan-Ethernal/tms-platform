/**
 * Session lifecycle scopes, matching `@tms/contracts`'s `SessionScope` (and the Prisma enum of the
 * same name) value-for-value. Deliberately re-declared here rather than imported: `@tms/auth-core`
 * is a pure, workspace-free algorithms package (`docs/superpowers/plans/2026-09-23-phase-2-auth/index.md`:
 * "it imports nothing from the workspace"; enforced by `test/purity.spec.ts`), so it has no other
 * reason to depend on `@tms/contracts`. Stack B (`@tms/domain/admin`), which already depends on
 * both packages, is the place to assert the two stay identical if that is ever worth a check.
 */
export type SessionScopeName = 'PRE_MFA' | 'ENROLLMENT' | 'FULL';

export interface SessionExpiryConfig {
  preMfaSeconds: number;
  enrollmentSeconds: number;
  fullAbsoluteSeconds: number;
  idleSeconds: number;
  touchIntervalSeconds: number;
}

export const DEFAULT_SESSION_EXPIRY: SessionExpiryConfig = {
  preMfaSeconds: 300,
  enrollmentSeconds: 1800,
  fullAbsoluteSeconds: 43200,
  idleSeconds: 3600,
  touchIntervalSeconds: 60,
};

/**
 * Seconds a session of `scope` lives from issuance, per its config. An exhaustive switch (not a
 * ternary chain falling through to `FULL`'s 12 h duration) so that a scope value the two callers
 * of this function disagree on fails closed with a thrown error instead of silently granting the
 * longest-lived session.
 */
function sessionScopeSeconds(scope: SessionScopeName, cfg: SessionExpiryConfig): number {
  switch (scope) {
    case 'PRE_MFA':
      return cfg.preMfaSeconds;
    case 'ENROLLMENT':
      return cfg.enrollmentSeconds;
    case 'FULL':
      return cfg.fullAbsoluteSeconds;
    default: {
      const exhaustive: never = scope;
      throw new Error(`Unknown session scope: ${String(exhaustive)}`);
    }
  }
}

export function absoluteExpiry(
  scope: SessionScopeName,
  from: Date,
  cfg: SessionExpiryConfig,
): Date {
  return new Date(from.getTime() + sessionScopeSeconds(scope, cfg) * 1000);
}

/**
 * A session is expired once it reaches its absolute limit (`>=`, checked out of caution regardless
 * of activity) or once it has been idle beyond `idleSeconds` (`>`, so a session touched exactly on
 * the idle boundary survives — deliberately not the same operator as the absolute check: see
 * `packages/auth-core/test/session-expiry.spec.ts` for both pinned boundary cases; the absolute
 * check is evaluated with OR regardless, so this asymmetry can never extend a session past its cap).
 */
export function isSessionExpired(
  s: { expiresAt: Date; lastSeenAt: Date },
  now: Date,
  cfg: SessionExpiryConfig,
): boolean {
  return (
    now.getTime() >= s.expiresAt.getTime() ||
    now.getTime() - s.lastSeenAt.getTime() > cfg.idleSeconds * 1000
  );
}

export function shouldTouch(
  lastSeenAt: Date,
  now: Date,
  cfg: SessionExpiryConfig = DEFAULT_SESSION_EXPIRY,
): boolean {
  return now.getTime() - lastSeenAt.getTime() >= cfg.touchIntervalSeconds * 1000;
}
