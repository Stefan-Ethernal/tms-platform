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
