import fc from 'fast-check';
import {
  absoluteExpiry,
  DEFAULT_SESSION_EXPIRY as CFG,
  isSessionExpired,
  type SessionScopeName,
  shouldTouch,
} from '../src';

const T0 = new Date('2026-09-23T10:00:00Z');
const plus = (s: number) => new Date(T0.getTime() + s * 1000);
const plusFrom = (d: Date, s: number) => new Date(d.getTime() + s * 1000);
const SCOPES: readonly SessionScopeName[] = ['PRE_MFA', 'ENROLLMENT', 'FULL'];

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

  it('absoluteExpiry translates by exactly the same offset as `from`', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SCOPES),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (scope, fromOffset, delta) => {
          const from1 = plus(fromOffset);
          const from2 = plusFrom(from1, delta);
          const diff =
            absoluteExpiry(scope, from2, CFG).getTime() -
            absoluteExpiry(scope, from1, CFG).getTime();
          expect(diff).toBe(delta * 1000);
        },
      ),
    );
  });

  it('once expired, stays expired as time advances further (independent of the idle/absolute split)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (expiresOffset, lastSeenOffset, nowOffset, laterDelta) => {
          const s = { expiresAt: plus(expiresOffset), lastSeenAt: plus(lastSeenOffset) };
          const now = plus(nowOffset);
          const later = plusFrom(now, laterDelta);
          if (isSessionExpired(s, now, CFG)) expect(isSessionExpired(s, later, CFG)).toBe(true);
        },
      ),
    );
  });

  it('the absolute limit expires the session even when activity is simultaneous', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (expiresOffset, extra) => {
          const expiresAt = plus(expiresOffset);
          const now = plusFrom(expiresAt, extra); // now >= expiresAt
          const lastSeenAt = now; // maximally recent activity
          expect(isSessionExpired({ expiresAt, lastSeenAt }, now, CFG)).toBe(true);
        },
      ),
    );
  });

  it('never expires before the absolute limit while within the idle window', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 0, max: CFG.idleSeconds }),
        (nowOffset, buffer, idleGapSeconds) => {
          const now = plus(nowOffset);
          const expiresAt = plusFrom(now, buffer); // strictly after `now`
          const lastSeenAt = new Date(now.getTime() - idleGapSeconds * 1000);
          expect(isSessionExpired({ expiresAt, lastSeenAt }, now, CFG)).toBe(false);
        },
      ),
    );
  });
});
