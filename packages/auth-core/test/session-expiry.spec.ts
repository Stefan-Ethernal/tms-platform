import {
  absoluteExpiry,
  DEFAULT_SESSION_EXPIRY as CFG,
  isSessionExpired,
  shouldTouch,
} from '../src';

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
