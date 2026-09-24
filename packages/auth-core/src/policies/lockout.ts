export interface LockoutState {
  failedCount: number;
  /** Consecutive lockouts since the last success (drives the doubling). */
  level: number;
  lockedUntil: Date | null;
}

export interface LockoutConfig {
  threshold: number;
  baseLockSeconds: number;
  maxLockSeconds: number;
}

export const DEFAULT_LOCKOUT_CONFIG: LockoutConfig = {
  threshold: 5,
  baseLockSeconds: 900,
  maxLockSeconds: 3600,
};

export function lockDurationSeconds(level: number, cfg: LockoutConfig): number {
  if (level < 1) return 0;
  return Math.min(cfg.baseLockSeconds * 2 ** (level - 1), cfg.maxLockSeconds);
}

export function isLocked(s: LockoutState, now: Date): boolean {
  return s.lockedUntil !== null && s.lockedUntil.getTime() > now.getTime();
}

export function lockRemainingSeconds(s: LockoutState, now: Date): number {
  return isLocked(s, now) ? Math.ceil((s.lockedUntil!.getTime() - now.getTime()) / 1000) : 0;
}

/** An expired lock clears the counter and keeps the level (section 8: "resets ... on lock expiry"). */
export function normalizeLockout(s: LockoutState, now: Date): LockoutState {
  if (s.lockedUntil !== null && !isLocked(s, now))
    return { failedCount: 0, level: s.level, lockedUntil: null };
  return s;
}

export function registerFailure(
  s: LockoutState,
  now: Date,
  cfg: LockoutConfig,
): { state: LockoutState; counted: boolean; lockedNow: boolean } {
  const current = normalizeLockout(s, now);
  if (isLocked(current, now)) return { state: current, counted: false, lockedNow: false };
  const failedCount = current.failedCount + 1;
  if (failedCount < cfg.threshold)
    return { state: { ...current, failedCount }, counted: true, lockedNow: false };
  const level = current.level + 1;
  return {
    state: {
      failedCount,
      level,
      lockedUntil: new Date(now.getTime() + lockDurationSeconds(level, cfg) * 1000),
    },
    counted: true,
    lockedNow: true,
  };
}

/** Successful second factor, completed enrollment, or admin unlock. */
export function registerSuccess(_s: LockoutState): LockoutState {
  return { failedCount: 0, level: 0, lockedUntil: null };
}
