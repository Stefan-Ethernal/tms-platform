import fc from 'fast-check';
import {
  isStepUpFresh,
  MFA_MAX_ATTEMPTS,
  registerMfaAttempt,
  STEP_UP_WINDOW_SECONDS,
} from '../src';

const T0 = new Date('2026-09-23T10:00:00Z');
const plus = (d: Date, s: number) => new Date(d.getTime() + s * 1000);

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

  it('is fresh exactly on the closed window after mfaVerifiedAt, never before or after', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: -100_000, max: 100_000 }),
        (verifiedOffset, ageSeconds) => {
          const mfaVerifiedAt = plus(T0, verifiedOffset);
          const now = plus(mfaVerifiedAt, ageSeconds);
          const expected = ageSeconds >= 0 && ageSeconds <= STEP_UP_WINDOW_SECONDS;
          expect(isStepUpFresh(mfaVerifiedAt, now)).toBe(expected);
        },
      ),
    );
  });

  it('once stale, stays stale as time advances further', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: STEP_UP_WINDOW_SECONDS + 1, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (verifiedOffset, staleAgeSeconds, extraSeconds) => {
          const mfaVerifiedAt = plus(T0, verifiedOffset);
          const now = plus(mfaVerifiedAt, staleAgeSeconds);
          const later = plus(now, extraSeconds);
          expect(isStepUpFresh(mfaVerifiedAt, now)).toBe(false);
          expect(isStepUpFresh(mfaVerifiedAt, later)).toBe(false);
        },
      ),
    );
  });
});
