/**
 * Lockout counter state for one account. Pure data: the caller owns loading and persisting it as
 * a single atomic unit per account (a row lock such as `SELECT ... FOR UPDATE`, or one conditional
 * `UPDATE ... WHERE failedCount = $expected`) — never a plain read, call, write-back, or two
 * concurrent failures can both observe the pre-failure state and undercount (phase 2 plan, Review
 * Focus item 3: "ten parallel wrong passwords when the counter is at 4 — exactly one request
 * succeeds"). Mirrors the atomic-consumption contract `secret-cipher.ts` and `totp.ts` document for
 * their own ports.
 */
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

/**
 * Registers one failed credential check. Caller contract: load `s`, call this, and persist the
 * returned `state` as one atomic unit per account (see {@link LockoutState}) — a read-modify-write
 * split across two round trips lets concurrent failures race past the threshold.
 */
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

/** The three legitimate triggers that may clear a lockout counter — never a correct password alone. */
export type LockoutSuccessReason = 'MFA_SUCCESS' | 'ENROLLMENT_COMPLETE' | 'ADMIN_UNLOCK';

/**
 * Resets the failure counter and the lockout level. Call this only after the *second* factor has
 * succeeded (TOTP or recovery code), enrollment has completed, or an admin has explicitly unlocked
 * the account — a correct password alone must never by itself clear or lower the failure counter
 * (spec section 8; phase 2 plan, Review Focus item 1: "a correct password must not reset the
 * failure counter"). `reason` is required, not optional, so every call site states — and a
 * reviewer can grep for — which of the three legitimate triggers applies.
 */
export function registerSuccess(_s: LockoutState, _reason: LockoutSuccessReason): LockoutState {
  return { failedCount: 0, level: 0, lockedUntil: null };
}
