# Phase 2 — Task 06: auth-core — lockout, session expiry, step-up and MFA-attempt policies

> Part of the phase 2 plan: read [index.md](index.md) (constraints, shared interfaces, env) and this file only.


**Files:**
- Create: `packages/auth-core/src/policies/lockout.ts`, `packages/auth-core/src/policies/session-expiry.ts`, `packages/auth-core/src/policies/step-up.ts`, `packages/auth-core/src/policies/mfa-attempts.ts`; Modify: `packages/auth-core/src/index.ts`
- Create: `packages/auth-core/test/lockout.spec.ts`, `packages/auth-core/test/session-expiry.spec.ts`, `packages/auth-core/test/step-up.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `LockoutState`, `LockoutConfig`, `DEFAULT_LOCKOUT_CONFIG`, `lockDurationSeconds(level, cfg)`, `isLocked(s, now)`, `lockRemainingSeconds(s, now)`, `normalizeLockout(s, now)`, `registerFailure(s, now, cfg): { state; counted; lockedNow }`, `registerSuccess(s)`; `SessionScopeName`, `SessionExpiryConfig`, `DEFAULT_SESSION_EXPIRY`, `absoluteExpiry(scope, from, cfg)`, `isSessionExpired({ expiresAt, lastSeenAt }, now, cfg)`, `shouldTouch(lastSeenAt, now, cfg?)`; `STEP_UP_WINDOW_SECONDS`, `isStepUpFresh(mfaVerifiedAt, now, windowSeconds?)`; `MFA_MAX_ATTEMPTS`, `registerMfaAttempt(attempts)`.

Lockout semantics (owner decision): 5 failures lock the account for `base × 2^(level−1)` capped at 1 h (15 → 30 → 60 → 60 min); `failedCount` resets on success and when a lock expires; `level` counts consecutive locks and resets only on success (successful login, or admin unlock which calls `registerSuccess`); failures while locked are not counted (on the public credential routes the caller does not even verify the password while locked and answers like a wrong password — Task 16).

- [ ] **Step 1: Write the failing tests**

`packages/auth-core/test/lockout.spec.ts`:

```ts
import fc from 'fast-check';
import {
  DEFAULT_LOCKOUT_CONFIG as CFG, isLocked, lockDurationSeconds, lockRemainingSeconds, type LockoutState,
  normalizeLockout, registerFailure, registerSuccess,
} from '../src';

const T0 = new Date('2026-09-23T10:00:00Z');
const clean: LockoutState = { failedCount: 0, level: 0, lockedUntil: null };
const plus = (d: Date, s: number) => new Date(d.getTime() + s * 1000);

function failTimes(state: LockoutState, now: Date, n: number): LockoutState {
  let s = state;
  for (let i = 0; i < n; i += 1) s = registerFailure(s, now, CFG).state;
  return s;
}

describe('lockout policy', () => {
  it('locks on the 5th failure for 15 minutes', () => {
    const four = failTimes(clean, T0, 4);
    expect(four).toEqual({ failedCount: 4, level: 0, lockedUntil: null });
    const r = registerFailure(four, T0, CFG);
    expect(r).toEqual({ state: { failedCount: 5, level: 1, lockedUntil: plus(T0, 900) }, counted: true, lockedNow: true });
    expect(lockRemainingSeconds(r.state, plus(T0, 1))).toBe(899);
  });

  it('does not count failures while locked', () => {
    const locked = failTimes(clean, T0, 5);
    expect(registerFailure(locked, plus(T0, 60), CFG)).toEqual({ state: locked, counted: false, lockedNow: false });
  });

  it('expiry clears the counter but keeps the level, so the next lock doubles, capped at 1 h', () => {
    let s = clean;
    let now = T0;
    for (const minutes of [15, 30, 60, 60, 60]) {
      s = failTimes(normalizeLockout(s, now), now, 5);
      expect((s.lockedUntil!.getTime() - now.getTime()) / 60_000).toBe(minutes);
      now = s.lockedUntil!;
      expect(isLocked(s, now)).toBe(false);
      expect(normalizeLockout(s, now)).toEqual({ failedCount: 0, level: s.level, lockedUntil: null });
    }
  });

  it('success resets counter and level', () => {
    expect(registerSuccess(failTimes(clean, T0, 5))).toEqual(clean);
  });

  it('lock duration is monotonic in the level and never exceeds the cap', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 60 }), (level) => {
        expect(lockDurationSeconds(level, CFG)).toBeLessThanOrEqual(CFG.maxLockSeconds);
        expect(lockDurationSeconds(level + 1, CFG)).toBeGreaterThanOrEqual(lockDurationSeconds(level, CFG));
      }),
    );
  });

  it('under any sequence of failures, successes and time jumps the invariants hold', () => {
    type Op = { kind: 'fail' } | { kind: 'ok' } | { kind: 'wait'; seconds: number };
    const op = fc.oneof(
      fc.constant<Op>({ kind: 'fail' }),
      fc.constant<Op>({ kind: 'ok' }),
      fc.integer({ min: 1, max: 7200 }).map<Op>((seconds) => ({ kind: 'wait', seconds })),
    );
    fc.assert(
      fc.property(fc.array(op, { maxLength: 80 }), (ops) => {
        let s = clean;
        let now = T0;
        for (const o of ops) {
          const before = s;
          if (o.kind === 'wait') now = plus(now, o.seconds);
          else if (o.kind === 'ok') s = registerSuccess(s);
          else {
            const r = registerFailure(s, now, CFG);
            if (isLocked(before, now)) expect(r.state).toEqual(before);
            if (!isLocked(before, now)) expect(r.state.level).toBeGreaterThanOrEqual(before.level);
            s = r.state;
          }
          expect(s.failedCount).toBeGreaterThanOrEqual(0);
          expect(s.failedCount).toBeLessThanOrEqual(CFG.threshold);
          expect(s.level).toBeGreaterThanOrEqual(0);
          if (s.lockedUntil) expect(s.lockedUntil.getTime() - now.getTime()).toBeLessThanOrEqual(CFG.maxLockSeconds * 1000);
        }
      }),
    );
  });
});
```

`packages/auth-core/test/session-expiry.spec.ts`:

```ts
import { absoluteExpiry, DEFAULT_SESSION_EXPIRY as CFG, isSessionExpired, shouldTouch } from '../src';

const T0 = new Date('2026-09-23T10:00:00Z');
const plus = (s: number) => new Date(T0.getTime() + s * 1000);

describe('session expiry policy', () => {
  it.each([
    ['PRE_MFA', 300],
    ['ENROLLMENT', 1800],
    ['FULL', 43200],
  ] as const)('%s lives %i seconds at most', (scope, seconds) => {
    expect(absoluteExpiry(scope, T0, CFG)).toEqual(plus(seconds));
  });

  it('expires at the absolute limit even when active', () => {
    const s = { expiresAt: plus(43200), lastSeenAt: plus(43199) };
    expect(isSessionExpired(s, plus(43199), CFG)).toBe(false);
    expect(isSessionExpired(s, plus(43200), CFG)).toBe(true);
  });

  it('expires after 60 idle minutes', () => {
    const s = { expiresAt: plus(43200), lastSeenAt: T0 };
    expect(isSessionExpired(s, plus(3600), CFG)).toBe(false);
    expect(isSessionExpired(s, plus(3601), CFG)).toBe(true);
  });

  it('touches at most once a minute', () => {
    expect(shouldTouch(T0, plus(59))).toBe(false);
    expect(shouldTouch(T0, plus(60))).toBe(true);
  });
});
```

`packages/auth-core/test/step-up.spec.ts`:

```ts
import { isStepUpFresh, MFA_MAX_ATTEMPTS, registerMfaAttempt } from '../src';

const T0 = new Date('2026-09-23T10:00:00Z');

describe('step-up and MFA attempts', () => {
  it.each([
    [null, false],
    [new Date(T0.getTime() - 600_000), true],
    [new Date(T0.getTime() - 600_001), false],
    [new Date(T0.getTime() + 1000), false],
  ])('mfaVerifiedAt %s → fresh %s', (at, fresh) => {
    expect(isStepUpFresh(at, T0)).toBe(fresh);
  });

  it('exhausts a pre-session on the 5th failure', () => {
    expect(MFA_MAX_ATTEMPTS).toBe(5);
    expect(registerMfaAttempt(3)).toEqual({ attempts: 4, exhausted: false });
    expect(registerMfaAttempt(4)).toEqual({ attempts: 5, exhausted: true });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm turbo run test --filter=@tms/auth-core`
Expected: FAIL — the policy functions are not exported.

- [ ] **Step 3: Implement**

`packages/auth-core/src/policies/lockout.ts`:

```ts
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

export const DEFAULT_LOCKOUT_CONFIG: LockoutConfig = { threshold: 5, baseLockSeconds: 900, maxLockSeconds: 3600 };

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
  if (s.lockedUntil !== null && !isLocked(s, now)) return { failedCount: 0, level: s.level, lockedUntil: null };
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
  if (failedCount < cfg.threshold) return { state: { ...current, failedCount }, counted: true, lockedNow: false };
  const level = current.level + 1;
  return {
    state: { failedCount, level, lockedUntil: new Date(now.getTime() + lockDurationSeconds(level, cfg) * 1000) },
    counted: true,
    lockedNow: true,
  };
}

/** Successful second factor, completed enrollment, or admin unlock. */
export function registerSuccess(_s: LockoutState): LockoutState {
  return { failedCount: 0, level: 0, lockedUntil: null };
}
```

`packages/auth-core/src/policies/session-expiry.ts`:

```ts
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

export function absoluteExpiry(scope: SessionScopeName, from: Date, cfg: SessionExpiryConfig): Date {
  const seconds = scope === 'PRE_MFA' ? cfg.preMfaSeconds : scope === 'ENROLLMENT' ? cfg.enrollmentSeconds : cfg.fullAbsoluteSeconds;
  return new Date(from.getTime() + seconds * 1000);
}

export function isSessionExpired(s: { expiresAt: Date; lastSeenAt: Date }, now: Date, cfg: SessionExpiryConfig): boolean {
  return now.getTime() >= s.expiresAt.getTime() || now.getTime() - s.lastSeenAt.getTime() > cfg.idleSeconds * 1000;
}

export function shouldTouch(lastSeenAt: Date, now: Date, cfg: SessionExpiryConfig = DEFAULT_SESSION_EXPIRY): boolean {
  return now.getTime() - lastSeenAt.getTime() >= cfg.touchIntervalSeconds * 1000;
}
```

`packages/auth-core/src/policies/step-up.ts`:

```ts
export const STEP_UP_WINDOW_SECONDS = 600;

/** A TOTP confirmation within the last 10 minutes (section 8.5); a future timestamp is never fresh. */
export function isStepUpFresh(mfaVerifiedAt: Date | null, now: Date, windowSeconds = STEP_UP_WINDOW_SECONDS): boolean {
  if (!mfaVerifiedAt) return false;
  const age = now.getTime() - mfaVerifiedAt.getTime();
  return age >= 0 && age <= windowSeconds * 1000;
}
```

`packages/auth-core/src/policies/mfa-attempts.ts`:

```ts
export const MFA_MAX_ATTEMPTS = 5;

export function registerMfaAttempt(attempts: number): { attempts: number; exhausted: boolean } {
  const next = attempts + 1;
  return { attempts: next, exhausted: next >= MFA_MAX_ATTEMPTS };
}
```

`index.ts` re-exports the four policy files.

- [ ] **Step 4: Run the tests and verify**

Run: `pnpm turbo run test --filter=@tms/auth-core && pnpm verify`
Expected: lockout (6, incl. two fast-check properties at 100 runs), session expiry (6), step-up (6) pass.

- [ ] **Step 5: Commit**

```bash
git add packages/auth-core docs/efficiency/auth-core.md
git commit -m "feat(auth-core): add lockout, session expiry, step-up and MFA attempt policies"
```

PR body: diagram `stateDiagram-v2` (open → counting → locked(level) → expired → counting; success → open); boundaries: `@tms/auth-core` public API; no migration; reviewer: `security-reviewer`.
