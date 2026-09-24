import { Clock, FixedClock, SystemClock } from '../../src/shared';

describe('Clock', () => {
  it('SystemClock returns the current time', () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it('FixedClock stands still until moved', () => {
    const clock = new FixedClock(new Date('2026-09-24T08:00:00.000Z'));
    expect(clock.now().toISOString()).toBe('2026-09-24T08:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-09-24T08:00:00.000Z');
    clock.advance(90_000);
    expect(clock.now().toISOString()).toBe('2026-09-24T08:01:30.000Z');
    clock.set(new Date('2027-01-01T00:00:00.000Z'));
    expect(clock.now().toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('FixedClock hands out copies, so callers cannot move it', () => {
    const clock = new FixedClock(new Date('2026-09-24T08:00:00.000Z'));
    clock.now().setUTCFullYear(2000);
    expect(clock.now().toISOString()).toBe('2026-09-24T08:00:00.000Z');
  });

  it('both are Clocks (the DI token)', () => {
    expect(new SystemClock()).toBeInstanceOf(Clock);
    expect(new FixedClock(new Date(0))).toBeInstanceOf(Clock);
  });
});
