import fc from 'fast-check';
import {
  DEFAULT_LOCKOUT_CONFIG as CFG,
  isLocked,
  lockDurationSeconds,
  lockRemainingSeconds,
  type LockoutState,
  normalizeLockout,
  registerFailure,
  registerSuccess,
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
    expect(r).toEqual({
      state: { failedCount: 5, level: 1, lockedUntil: plus(T0, 900) },
      counted: true,
      lockedNow: true,
    });
    expect(lockRemainingSeconds(r.state, plus(T0, 1))).toBe(899);
  });

  it('does not count failures while locked', () => {
    const locked = failTimes(clean, T0, 5);
    expect(registerFailure(locked, plus(T0, 60), CFG)).toEqual({
      state: locked,
      counted: false,
      lockedNow: false,
    });
  });

  it('expiry clears the counter but keeps the level, so the next lock doubles, capped at 1 h', () => {
    let s = clean;
    let now = T0;
    for (const minutes of [15, 30, 60, 60, 60]) {
      s = failTimes(normalizeLockout(s, now), now, 5);
      expect((s.lockedUntil!.getTime() - now.getTime()) / 60_000).toBe(minutes);
      now = s.lockedUntil!;
      expect(isLocked(s, now)).toBe(false);
      expect(normalizeLockout(s, now)).toEqual({
        failedCount: 0,
        level: s.level,
        lockedUntil: null,
      });
    }
  });

  it('success resets counter and level', () => {
    expect(registerSuccess(failTimes(clean, T0, 5))).toEqual(clean);
  });

  it('lock duration is monotonic in the level and never exceeds the cap', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 60 }), (level) => {
        expect(lockDurationSeconds(level, CFG)).toBeLessThanOrEqual(CFG.maxLockSeconds);
        expect(lockDurationSeconds(level + 1, CFG)).toBeGreaterThanOrEqual(
          lockDurationSeconds(level, CFG),
        );
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
          if (s.lockedUntil)
            expect(s.lockedUntil.getTime() - now.getTime()).toBeLessThanOrEqual(
              CFG.maxLockSeconds * 1000,
            );
        }
      }),
    );
  });
});
