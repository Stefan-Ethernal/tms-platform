import fc from 'fast-check';
import { DEFAULT_SESSION_EXPIRY } from '@tms/auth-core';
import { evaluateStaffSession } from '../../src/admin/auth/sessions/evaluate-session';

const NOW = new Date('2026-09-23T10:00:00Z');
const scopes = ['PRE_MFA', 'ENROLLMENT', 'FULL'] as const;
const statuses = ['INVITED', 'ACTIVE', 'BLOCKED', 'DEACTIVATED'] as const;
const kinds = ['STAFF', 'DRIVER'] as const;

function session(p: {
  scope: (typeof scopes)[number];
  status: (typeof statuses)[number];
  kind: (typeof kinds)[number];
  enrolled: boolean;
  expired?: boolean;
  idle?: boolean;
}) {
  return {
    scope: p.scope,
    expiresAt: new Date(NOW.getTime() + (p.expired ? -1 : 60_000)),
    lastSeenAt: new Date(
      NOW.getTime() - (p.idle ? DEFAULT_SESSION_EXPIRY.idleSeconds * 1000 + 1 : 0),
    ),
    user: { kind: p.kind, status: p.status, totpEnabledAt: p.enrolled ? NOW : null },
  };
}

describe('evaluateStaffSession', () => {
  it('matches the status-per-scope model for every combination', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...scopes),
        fc.constantFrom(...statuses),
        fc.constantFrom(...kinds),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (scope, status, kind, enrolled, expired, idle) => {
          const verdict = evaluateStaffSession(
            session({ scope, status, kind, enrolled, expired, idle }),
            NOW,
            DEFAULT_SESSION_EXPIRY,
          );
          const expected =
            !expired &&
            !idle &&
            kind === 'STAFF' &&
            (scope === 'ENROLLMENT'
              ? status === 'INVITED' || status === 'ACTIVE'
              : status === 'ACTIVE' && enrolled);
          expect(verdict.ok).toBe(expected);
        },
      ),
    );
  });

  it('never grants FULL without ACTIVE and an enrolled TOTP (invariant)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...statuses), fc.boolean(), (status, enrolled) => {
        const verdict = evaluateStaffSession(
          session({ scope: 'FULL', status, kind: 'STAFF', enrolled }),
          NOW,
          DEFAULT_SESSION_EXPIRY,
        );
        if (verdict.ok) expect(status === 'ACTIVE' && enrolled).toBe(true);
      }),
    );
  });

  it('names the reason', () => {
    expect(
      evaluateStaffSession(
        session({ scope: 'FULL', status: 'ACTIVE', kind: 'DRIVER', enrolled: true }),
        NOW,
        DEFAULT_SESSION_EXPIRY,
      ),
    ).toEqual({ ok: false, reason: 'NOT_STAFF' });
    expect(
      evaluateStaffSession(
        session({ scope: 'FULL', status: 'ACTIVE', kind: 'STAFF', enrolled: true, expired: true }),
        NOW,
        DEFAULT_SESSION_EXPIRY,
      ),
    ).toEqual({ ok: false, reason: 'EXPIRED' });
    expect(
      evaluateStaffSession(
        session({ scope: 'FULL', status: 'BLOCKED', kind: 'STAFF', enrolled: true }),
        NOW,
        DEFAULT_SESSION_EXPIRY,
      ),
    ).toEqual({ ok: false, reason: 'STATUS' });
  });
});
