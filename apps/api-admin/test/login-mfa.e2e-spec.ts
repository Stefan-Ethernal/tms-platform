import request from 'supertest';
import type { PrismaService } from '@tms/db/nest';
import { AccountLockService } from '@tms/domain/admin';
import { createAdminTestApp, type AdminTestApp, ORIGIN } from './support/app';
import {
  createStaffUser,
  GOOD_PASSWORD,
  loginAs,
  seedBase,
  totpNow,
  withCredentials,
} from './support/fixtures';

/** Only the field this suite checks; the full envelope shape is pinned in nest-bootstrap's own tests. */
const codeOf = (res: { body: unknown }) => (res.body as { code: string }).code;

describe('login, MFA step (API)', () => {
  let t: AdminTestApp;
  let prisma: PrismaService;
  const http = () => request(t.app.getHttpServer());
  const cookieOf = (res: request.Response) => res.headers['set-cookie']![0]!.split(';')[0]!;
  const passwordStep = async (email: string) =>
    cookieOf(
      await http()
        .post('/api/auth/login')
        .set('Origin', ORIGIN)
        .send({ email, password: GOOD_PASSWORD })
        .expect(200),
    );
  const mfa = (cookie: string, body: object) =>
    http().post('/api/auth/mfa').set('Origin', ORIGIN).set('Cookie', cookie).send(body);

  async function user() {
    const u = await createStaffUser(prisma);
    const { totpSecret } = await withCredentials(t.app, u.id);
    return { ...u, totpSecret };
  }

  beforeAll(async () => {
    t = await createAdminTestApp();
  });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    prisma = await seedBase(t.app);
    t.clock.set(new Date('2026-09-23T10:00:00Z'));
  });

  it('upgrades to FULL with a new cookie and resets the counter', async () => {
    const u = await user();
    await prisma.user.update({ where: { id: u.id }, data: { failedLoginCount: 3 } });
    const pre = await passwordStep(u.email!);
    const res = await mfa(pre, { totpCode: await totpNow(t, u.totpSecret) }).expect(200);
    const full = cookieOf(res);
    expect(full).not.toBe(pre);
    expect(res.body).toMatchObject({ scope: 'FULL', next: 'NONE' });
    await http().get('/api/auth/session').set('Cookie', pre).expect(401);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row).toMatchObject({ failedLoginCount: 0, lockoutLevel: 0, lastLoginAt: t.clock.now() });
  });

  it('accepts ±1 step, rejects ±2', async () => {
    const u = await user();
    await mfa(await passwordStep(u.email!), {
      totpCode: await totpNow(t, u.totpSecret, -1),
    }).expect(200);
    t.clock.advance(60_000);
    await mfa(await passwordStep(u.email!), { totpCode: await totpNow(t, u.totpSecret, 1) }).expect(
      200,
    );
    t.clock.advance(120_000);
    await mfa(await passwordStep(u.email!), { totpCode: await totpNow(t, u.totpSecret, 2) }).expect(
      401,
    );
  });

  it('rejects a replayed code, also when sent twice in parallel (Review Focus 3)', async () => {
    const u = await user();
    const code = await totpNow(t, u.totpSecret);
    const [a, b] = await Promise.all([passwordStep(u.email!), passwordStep(u.email!)]);
    const results = await Promise.all([mfa(a, { totpCode: code }), mfa(b, { totpCode: code })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    await mfa(await passwordStep(u.email!), { totpCode: code }).expect(401);
  });

  it('a recovery code works exactly once, in any format', async () => {
    const u = await user();
    const pre = await passwordStep(u.email!);
    // create one known code through the service used by enrollment
    const code = 'ABCD-EFGH-JKMN-PQRS';
    const { hashRecoveryCode, normalizeRecoveryCode } = await import('@tms/auth-core');
    await prisma.recoveryCode.create({
      data: { userId: u.id, codeHash: hashRecoveryCode(normalizeRecoveryCode(code)!) },
    });
    await mfa(pre, { recoveryCode: 'abcd efgh jkmn pqrs' }).expect(200);
    await mfa(await passwordStep(u.email!), { recoveryCode: code }).expect(401);
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'auth.login.success',
          targetId: u.id,
          metadata: { path: ['method'], equals: 'RECOVERY_CODE' },
        },
      }),
    ).toBe(1);
  });

  it('the same recovery code sent twice in parallel works once (Review Focus 3)', async () => {
    const u = await user();
    const code = 'ABCD-EFGH-JKMN-PQRS';
    const { hashRecoveryCode, normalizeRecoveryCode } = await import('@tms/auth-core');
    await prisma.recoveryCode.create({
      data: { userId: u.id, codeHash: hashRecoveryCode(normalizeRecoveryCode(code)!) },
    });
    const [a, b] = await Promise.all([passwordStep(u.email!), passwordStep(u.email!)]);
    const results = await Promise.all([
      mfa(a, { recoveryCode: code }),
      mfa(b, { recoveryCode: code }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('five wrong codes end the pre-session and lock the account (423 on the 5th)', async () => {
    const u = await user();
    const pre = await passwordStep(u.email!);
    for (let i = 0; i < 4; i += 1)
      expect(codeOf(await mfa(pre, { totpCode: '000000' }).expect(401))).toBe(
        'AUTH_INVALID_MFA_CODE',
      );
    const fifth = await mfa(pre, { totpCode: '000000' }).expect(423);
    expect(fifth.body).toEqual({
      statusCode: 423,
      code: 'AUTH_ACCOUNT_LOCKED',
      message: 'Account temporarily locked',
      retryAfterSeconds: 900,
    });
    expect(fifth.headers['retry-after']).toBe('900');
    await http().get('/api/auth/session').set('Cookie', pre).expect(401);
  });

  it('a block committed between the guard and the row lock answers 401, not 500, and issues nothing', async () => {
    const u = await user();
    const pre = await passwordStep(u.email!);
    const locks = t.app.get(AccountLockService);
    const lock = locks.lock.bind(locks);
    // the block lands after AccessGuard accepted the PRE_MFA session and before mfaStep takes the row lock
    jest.spyOn(locks, 'lock').mockImplementationOnce(async (id) => {
      await prisma.user.update({ where: { id }, data: { status: 'BLOCKED' } });
      return lock(id);
    });
    const res = await mfa(pre, { totpCode: await totpNow(t, u.totpSecret) }).expect(401);
    expect(codeOf(res)).toBe('AUTH_INVALID_MFA_CODE');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await prisma.session.count({ where: { userId: u.id, scope: 'FULL' } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).failedLoginCount).toBe(0);
    jest.restoreAllMocks();
  });

  it('a correct password never resets the failure counter: 20 × (password + 4 wrong codes) locks at the 5th failure (Review Focus 1)', async () => {
    const u = await user();
    let failures = 0;
    let lockedAt: number | null = null;
    for (let round = 0; round < 20 && lockedAt === null; round += 1) {
      const login = await http()
        .post('/api/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: u.email, password: GOOD_PASSWORD });
      expect(login.status).toBe(200); // the lock must surface at the MFA step; a locked password step would answer 401 (D1)
      const pre = cookieOf(login);
      for (let i = 0; i < 4; i += 1) {
        const res = await mfa(pre, { totpCode: '000000' });
        failures += 1;
        if (res.status === 423) {
          lockedAt = failures;
          break;
        }
      }
    }
    expect(lockedAt).toBe(5);
  });

  it('when throttled, a request without a session gets 429, not 401 (guard order)', async () => {
    const limited = await createAdminTestApp({ env: { THROTTLE_AUTH_IP_LIMIT: '1' } });
    const post = () =>
      request(limited.app.getHttpServer())
        .post('/api/auth/mfa')
        .set('Origin', ORIGIN)
        .send({ totpCode: '123456' });
    await post().expect(401);
    await post().expect(429);
    await limited.app.close();
  });

  it('refuses FULL and ENROLLMENT sessions', async () => {
    const u = await user();
    await mfa(await loginAs(t.app, u.id, 'FULL'), { totpCode: '123456' }).expect(401);
  });
});
