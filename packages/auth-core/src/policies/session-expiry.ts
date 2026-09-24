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

export function absoluteExpiry(
  scope: SessionScopeName,
  from: Date,
  cfg: SessionExpiryConfig,
): Date {
  const seconds =
    scope === 'PRE_MFA'
      ? cfg.preMfaSeconds
      : scope === 'ENROLLMENT'
        ? cfg.enrollmentSeconds
        : cfg.fullAbsoluteSeconds;
  return new Date(from.getTime() + seconds * 1000);
}

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
