import request from 'supertest';
import type { PrismaService } from '@tms/db/nest';
import { PASSWORD_HASHER } from '@tms/domain/admin';
import type { PasswordHasher } from '@tms/auth-core';
import { createAdminTestApp, type AdminTestApp, ORIGIN } from './support/app';
import {
  createStaffUser,
  GOOD_PASSWORD,
  loginAs,
  seedBase,
  withCredentials,
} from './support/fixtures';

/** Only the field this suite checks; the full envelope shape is pinned in nest-bootstrap's own tests. */
const codeOf = (res: { body: unknown }) => (res.body as { code: string }).code;

describe('login, password step (API)', () => {
  let t: AdminTestApp;
  let prisma: PrismaService;
  const http = () => request(t.app.getHttpServer());
  const login = (email: string, password: string) =>
    http().post('/api/auth/login').set('Origin', ORIGIN).send({ email, password });
  async function staff(o: Parameters<typeof createStaffUser>[1] = {}) {
    const user = await createStaffUser(prisma, o);
    await withCredentials(t.app, user.id);
    if (o.enrolled === false)
      await prisma.user.update({
        where: { id: user.id },
        data: { totpEnabledAt: null, totpSecretEnc: null },
      });
    return user;
  }

  beforeAll(async () => {
    t = await createAdminTestApp();
  });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    prisma = await seedBase(t.app);
    t.clock.set(new Date('2026-09-23T10:00:00Z'));
  });

  it('issues a 5-minute PRE_MFA session for a correct password', async () => {
    const user = await staff();
    const res = await login(user.email!, GOOD_PASSWORD).expect(200);
    expect(res.body).toMatchObject({ scope: 'PRE_MFA', next: 'VERIFY_MFA' });
    const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.expiresAt.getTime() - t.clock.now().getTime()).toBe(5 * 60_000);
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'auth.login.success',
          outcome: 'SUCCESS',
          targetId: user.id,
          metadata: { path: ['method'], equals: 'PASSWORD' },
        },
      }),
    ).toBe(1);
  });

  it('answers byte-identically for unknown, wrong, INVITED, BLOCKED, DEACTIVATED and DRIVER (Review Focus 4)', async () => {
    const active = await staff();
    const invited = await staff({ status: 'INVITED' });
    const blocked = await staff({ status: 'BLOCKED' });
    const deactivated = await staff({ status: 'DEACTIVATED' });
    const driver = await staff({ kind: 'DRIVER', role: 'driver' });
    const responses = await Promise.all([
      login('nobody@example.com', GOOD_PASSWORD),
      login(active.email!, 'Wrong-Password-123456'),
      login(invited.email!, GOOD_PASSWORD),
      login(blocked.email!, GOOD_PASSWORD),
      login(deactivated.email!, GOOD_PASSWORD),
      login(driver.email!, GOOD_PASSWORD),
    ]);
    for (const res of responses) {
      expect(res.status).toBe(401);
      expect(res.text).toBe(
        JSON.stringify({
          statusCode: 401,
          code: 'AUTH_INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        }),
      );
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  it('runs a dummy hash for unknown accounts (timing equalisation)', async () => {
    const hasher = t.app.get<PasswordHasher>(PASSWORD_HASHER);
    const spy = jest.spyOn(hasher, 'verify');
    await login('nobody@example.com', GOOD_PASSWORD).expect(401);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('never evaluates the password of a locked account: one dummy hash, not the stored one (D1, timing)', async () => {
    const user = await staff();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 5,
        lockoutLevel: 1,
        lockedUntil: new Date(t.clock.now().getTime() + 15 * 60_000),
      },
    });
    const { passwordHash } = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const hasher = t.app.get<PasswordHasher>(PASSWORD_HASHER);
    const spy = jest.spyOn(hasher, 'verify');
    await login(user.email!, GOOD_PASSWORD).expect(401);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).not.toBe(passwordHash);
    spy.mockRestore();
  });

  it('locks after 5 failures for 15 min; while locked a correct password gets the same 401 as a wrong one, not counted (D1)', async () => {
    const user = await staff();
    for (let i = 0; i < 5; i += 1) await login(user.email!, 'Wrong-Password-123456').expect(401);
    let row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({ failedLoginCount: 5, lockoutLevel: 1 });
    expect(row.lockedUntil?.getTime()).toBe(t.clock.now().getTime() + 15 * 60_000);

    const correct = await login(user.email!, GOOD_PASSWORD).expect(401);
    const wrong = await login(user.email!, 'Wrong-Password-123456').expect(401);
    expect(correct.text).toBe(wrong.text);
    expect(correct.text).toBe(
      JSON.stringify({
        statusCode: 401,
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      }),
    );
    expect(correct.headers['retry-after']).toBeUndefined();
    expect(correct.headers['set-cookie']).toBeUndefined();
    row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({ failedLoginCount: 5, lockoutLevel: 1 });
    expect(
      await prisma.auditLog.count({ where: { action: 'auth.lockout.applied', targetId: user.id } }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'auth.login.failure',
          targetId: user.id,
          metadata: { path: ['reason'], equals: 'ACCOUNT_LOCKED' },
        },
      }),
    ).toBe(2);

    t.clock.advance(15 * 60_000);
    await login(user.email!, GOOD_PASSWORD).expect(200); // the lock has expired: the password is evaluated again
  });

  it('doubles the lock on each consecutive lockout and caps it at one hour', async () => {
    const user = await staff();
    const expected = [15, 30, 60, 60];
    for (const minutes of expected) {
      for (let i = 0; i < 5; i += 1) await login(user.email!, 'Wrong-Password-123456').expect(401);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect((row.lockedUntil!.getTime() - t.clock.now().getTime()) / 60_000).toBe(minutes);
      t.clock.advance(minutes * 60_000);
    }
  });

  it('a correct password does not reset the counter (Review Focus 1, password part)', async () => {
    const user = await staff();
    for (let i = 0; i < 4; i += 1) await login(user.email!, 'Wrong-Password-123456').expect(401);
    await login(user.email!, GOOD_PASSWORD).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failedLoginCount).toBe(
      4,
    );
    await login(user.email!, 'Wrong-Password-123456').expect(401);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).lockoutLevel).toBe(1);
  });

  it('ten parallel wrong passwords at count 4 produce exactly one lock (Review Focus 3)', async () => {
    const user = await staff();
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 4 } });
    await Promise.all(
      Array.from({ length: 10 }, () => login(user.email!, 'Wrong-Password-123456')),
    );
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({ failedLoginCount: 5, lockoutLevel: 1 });
    expect(
      await prisma.auditLog.count({ where: { action: 'auth.lockout.applied', targetId: user.id } }),
    ).toBe(1);
  });

  it('a lock ends PRE_MFA sessions but keeps FULL ones', async () => {
    const user = await staff();
    const pre = (await login(user.email!, GOOD_PASSWORD).expect(200)).headers[
      'set-cookie'
    ]![0]!.split(';')[0]!;
    const full = await loginAs(t.app, user.id, 'FULL');
    for (let i = 0; i < 5; i += 1) await login(user.email!, 'Wrong-Password-123456').expect(401);
    await http().get('/api/auth/session').set('Cookie', pre).expect(401);
    await http().get('/api/auth/session').set('Cookie', full).expect(200);
  });

  it('reports a pending 2FA reset only after a correct password', async () => {
    const user = await staff({ enrolled: false });
    expect(codeOf(await login(user.email!, GOOD_PASSWORD).expect(403))).toBe(
      'AUTH_MFA_RESET_PENDING',
    );
    await login(user.email!, 'Wrong-Password-123456').expect(401);
  });

  it('rate-limits per account and per IP on auth routes only', async () => {
    const limited = await createAdminTestApp({
      env: { THROTTLE_AUTH_ACCOUNT_LIMIT: '3', THROTTLE_AUTH_IP_LIMIT: '5' },
    });
    const post = (email: string) =>
      request(limited.app.getHttpServer())
        .post('/api/auth/login')
        .set('Origin', ORIGIN)
        .send({ email, password: 'x' });
    for (let i = 0; i < 3; i += 1) await post('a@example.com').expect(401);
    const throttled = await post('A@Example.com ').expect(429);
    expect(codeOf(throttled)).toBe('RATE_LIMITED');
    expect(Number(throttled.headers['retry-after'])).toBeGreaterThan(0);
    await post('b@example.com').expect(401);
    await post('c@example.com').expect(429); // sixth request from this IP
    await request(limited.app.getHttpServer()).get('/api/auth/session').expect(401); // unmarked route: never 429
    await limited.app.close();
  });
});
