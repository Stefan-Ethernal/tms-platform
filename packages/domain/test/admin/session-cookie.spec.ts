import { SessionCookie } from '../../src/admin/auth/sessions/session-cookie';

const token = 'A'.repeat(43);
function fakeRes() {
  const calls: unknown[][] = [];
  return {
    calls,
    res: {
      cookie: (...a: unknown[]) => calls.push(['cookie', ...a]),
      clearCookie: (...a: unknown[]) => calls.push(['clear', ...a]),
    },
  };
}

describe('SessionCookie', () => {
  it('writes a __Host- cookie with strict attributes and no Max-Age', () => {
    const cookie = new SessionCookie({
      session: { idleSeconds: 3600, fullAbsoluteSeconds: 43200, cookieSecure: true },
    });
    const { calls, res } = fakeRes();
    cookie.write(res as never, token);
    expect(calls).toEqual([
      [
        'cookie',
        '__Host-tms_admin_sid',
        token,
        { httpOnly: true, secure: true, sameSite: 'strict', path: '/' },
      ],
    ]);
  });

  it('falls back to a plain name when Secure is disabled (non-production only)', () => {
    const cookie = new SessionCookie({
      session: { idleSeconds: 3600, fullAbsoluteSeconds: 43200, cookieSecure: false },
    });
    expect(cookie.name).toBe('tms_admin_sid');
  });

  it('reads only well-formed tokens', () => {
    const cookie = new SessionCookie({
      session: { idleSeconds: 3600, fullAbsoluteSeconds: 43200, cookieSecure: true },
    });
    expect(cookie.read({ cookies: { '__Host-tms_admin_sid': token } } as never)).toBe(token);
    expect(cookie.read({ cookies: { '__Host-tms_admin_sid': 'x' } } as never)).toBeNull();
    expect(cookie.read({ cookies: {} } as never)).toBeNull();
    expect(cookie.read({ headers: { authorization: `Bearer ${token}` } } as never)).toBeNull();
  });
});
