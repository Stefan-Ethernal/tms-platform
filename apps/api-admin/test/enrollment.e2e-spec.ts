import request from 'supertest';
import type { PrismaService } from '@tms/db/nest';
import { generateTotpCode, hashRecoveryCode, normalizeRecoveryCode } from '@tms/auth-core';
import { EnrollmentService } from '@tms/domain/admin';
import type { Principal } from '@tms/domain/shared';
import { createAdminTestApp, type AdminTestApp, ORIGIN } from './support/app';
import { createStaffUser, GOOD_PASSWORD, loginAs, seedBase, waitForMail } from './support/fixtures';

/** Only the fields these cases check; the full envelope/DTO shapes are pinned in their own tests. */
const codeOf = (res: { body: unknown }) => (res.body as { code: string }).code;
interface EnrollmentBody {
  next?: string;
  otpauthUri?: string;
  secret?: string;
  recoveryCodes?: string[];
  fields?: Array<{ path: string; code: string; message: string }>;
}
const bodyOf = (res: { body: unknown }): EnrollmentBody => res.body as EnrollmentBody;

describe('enrollment (API)', () => {
  let t: AdminTestApp;
  let prisma: PrismaService;
  let adminCookie: string;
  const http = () => request(t.app.getHttpServer());
  const post = (path: string, cookie: string, body?: object) =>
    http()
      .post(path)
      .set('Origin', ORIGIN)
      .set('Cookie', cookie)
      .send(body ?? {});
  const inviteToken = async (email: string) =>
    /#t=([A-Za-z0-9_-]{43})/.exec((await waitForMail(t.mail, email)).text)![1]!;

  async function acceptedInvite(): Promise<{ userId: string; email: string; cookie: string }> {
    const invited = await createStaffUser(prisma, { status: 'INVITED', enrolled: false });
    await http()
      .post(`/api/users/${invited.id}/invite`)
      .set('Origin', ORIGIN)
      .set('Cookie', adminCookie)
      .expect(202);
    const token = await inviteToken(invited.email!);
    const res = await http()
      .post('/api/auth/invite/accept')
      .set('Origin', ORIGIN)
      .send({ token })
      .expect(200);
    return {
      userId: invited.id,
      email: invited.email!,
      cookie: res.headers['set-cookie']![0]!.split(';')[0]!,
    };
  }

  beforeAll(async () => {
    t = await createAdminTestApp();
  });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    prisma = await seedBase(t.app);
    t.mail.clear();
    adminCookie = await loginAs(t.app, (await createStaffUser(prisma)).id);
  });

  it('completes password → TOTP → recovery codes → ACTIVE with a rotated FULL cookie', async () => {
    const { userId, cookie } = await acceptedInvite();
    await post('/api/auth/enrollment/password', cookie, { password: GOOD_PASSWORD }).expect(204);
    expect(
      bodyOf(await http().get('/api/auth/session').set('Cookie', cookie).expect(200)).next,
    ).toBe('ENROLL_TOTP');

    const start = await post('/api/auth/enrollment/totp', cookie).expect(200);
    expect(bodyOf(start).otpauthUri).toMatch(/^otpauth:\/\/totp\/TMS:.+\?.*secret=/);
    const secret = bodyOf(start).secret!;
    const code = await generateTotpCode(secret, t.clock.now());

    const done = await post('/api/auth/enrollment/totp/confirm', cookie, { totpCode: code }).expect(
      200,
    );
    const fullCookie = done.headers['set-cookie']![0]!.split(';')[0]!;
    expect(fullCookie).not.toBe(cookie);
    await http().get('/api/auth/session').set('Cookie', cookie).expect(401);
    expect(
      (await http().get('/api/auth/session').set('Cookie', fullCookie).expect(200)).body,
    ).toMatchObject({ scope: 'FULL', next: 'NONE' });

    const codes: string[] = bodyOf(done).recoveryCodes!;
    expect(new Set(codes).size).toBe(10);
    const stored = await prisma.recoveryCode.findMany({ where: { userId } });
    expect(stored.map((r) => r.codeHash).sort()).toEqual(
      codes.map((c) => hashRecoveryCode(normalizeRecoveryCode(c)!)).sort(),
    );

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user).toMatchObject({ status: 'ACTIVE', failedLoginCount: 0, lockoutLevel: 0 });
    expect(user.totpSecretEnc).toMatch(/^v1\./);
    expect(user.totpSecretEnc).not.toContain(secret);
    expect(user.totpLastUsedStep).toBe(Math.floor(t.clock.now().getTime() / 30_000));
    expect(
      await prisma.auditLog.count({
        where: { action: 'auth.password.set', targetId: userId, outcome: 'SUCCESS' },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'auth.totp.enrolled', targetId: userId, outcome: 'SUCCESS' },
      }),
    ).toBe(1);
    const completed = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'auth.enrollment.completed', targetId: userId },
    });
    expect(completed.metadata).toEqual({ flow: 'INVITE' });
  });

  it('rejects a weak password with field codes and keeps the session', async () => {
    const { cookie } = await acceptedInvite();
    const res = await post('/api/auth/enrollment/password', cookie, {
      password: 'password1234',
    }).expect(422);
    expect(bodyOf(res).fields).toEqual([
      expect.objectContaining({ path: 'password', code: 'PASSWORD_TOO_WEAK' }),
    ]);
    const short = await post('/api/auth/enrollment/password', cookie, {
      password: 'Sh0rt!',
    }).expect(422);
    expect(bodyOf(short).fields![0]!.code).toBe('PASSWORD_TOO_SHORT');
    expect(
      (await http().get('/api/auth/session').set('Cookie', cookie).expect(200)).body,
    ).toMatchObject({ scope: 'ENROLLMENT', next: 'SET_PASSWORD' });
  });

  it('needs a password before TOTP, and a pending secret before confirm', async () => {
    const { cookie } = await acceptedInvite();
    expect(codeOf(await post('/api/auth/enrollment/totp', cookie).expect(409))).toBe(
      'USER_STATE_CONFLICT',
    );
    await post('/api/auth/enrollment/password', cookie, { password: GOOD_PASSWORD }).expect(204);
    await post('/api/auth/enrollment/totp/confirm', cookie, { totpCode: '123456' }).expect(409);
  });

  it('destroys the enrollment session after 5 wrong codes', async () => {
    const { userId, cookie } = await acceptedInvite();
    await post('/api/auth/enrollment/password', cookie, { password: GOOD_PASSWORD }).expect(204);
    await post('/api/auth/enrollment/totp', cookie).expect(200);
    for (let i = 0; i < 4; i += 1) {
      expect(
        codeOf(
          await post('/api/auth/enrollment/totp/confirm', cookie, { totpCode: '000000' }).expect(
            401,
          ),
        ),
      ).toBe('AUTH_INVALID_MFA_CODE');
    }
    expect(
      codeOf(
        await post('/api/auth/enrollment/totp/confirm', cookie, { totpCode: '000000' }).expect(401),
      ),
    ).toBe('AUTH_MFA_ATTEMPTS_EXHAUSTED');
    await http().get('/api/auth/session').set('Cookie', cookie).expect(401);
    // the fixed clock gives every row the same `at`, so compare the sorted reasons
    const reasons = (
      await prisma.auditLog.findMany({
        where: { action: 'auth.totp.enrolled', outcome: 'FAILURE', targetId: userId },
      })
    ).map((r) => (r.metadata as { reason: string }).reason);
    expect(reasons.sort()).toEqual([
      'INVALID_CODE',
      'INVALID_CODE',
      'INVALID_CODE',
      'INVALID_CODE',
      'TOO_MANY_MFA_ATTEMPTS',
    ]);
  });

  it('two parallel confirms with the same code: one wins, the other gets 409 USER_STATE_CONFLICT (Review Focus 3)', async () => {
    const { userId, cookie } = await acceptedInvite();
    await post('/api/auth/enrollment/password', cookie, { password: GOOD_PASSWORD }).expect(204);
    const start = await post('/api/auth/enrollment/totp', cookie).expect(200);
    const code = await generateTotpCode(bodyOf(start).secret!, t.clock.now());
    // Called on the service: over HTTP the loser may instead reach the guard after the winner rotated
    // the token (401), which would hide the race this test pins.
    const session = await prisma.session.findFirstOrThrow({
      where: { userId, scope: 'ENROLLMENT' },
    });
    const principal: Principal = {
      userId,
      sessionId: session.id,
      scope: 'ENROLLMENT',
      permissions: new Set(),
      mfaVerifiedAt: null,
    };
    const service = t.app.get(EnrollmentService);
    const results = await Promise.allSettled([
      service.confirmTotp(principal, code),
      service.confirmTotp(principal, code),
    ]);
    const won = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    const lost = results.flatMap((r) =>
      r.status === 'rejected' ? [r.reason as { code?: string }] : [],
    );
    expect(won).toHaveLength(1);
    expect(lost.map((e) => e.code)).toEqual(['USER_STATE_CONFLICT']);
    const stored = await prisma.recoveryCode.findMany({ where: { userId } });
    expect(stored.map((r) => r.codeHash).sort()).toEqual(
      won[0]!.recoveryCodes.map((c) => hashRecoveryCode(normalizeRecoveryCode(c)!)).sort(),
    );
    expect(await prisma.session.count({ where: { userId } })).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'auth.enrollment.completed', targetId: userId },
      }),
    ).toBe(1);
  });

  it('abandoned enrollment: resend + accept starts clean (spec section 17 step 3)', async () => {
    const { userId, email, cookie } = await acceptedInvite();
    await post('/api/auth/enrollment/password', cookie, { password: GOOD_PASSWORD }).expect(204);
    t.mail.clear(); // the resend's mail replaces the first invite
    await http()
      .post(`/api/users/${userId}/invite`)
      .set('Origin', ORIGIN)
      .set('Cookie', adminCookie)
      .expect(202);
    const token = await inviteToken(email);
    const again = await http()
      .post('/api/auth/invite/accept')
      .set('Origin', ORIGIN)
      .send({ token })
      .expect(200);
    expect(bodyOf(again).next).toBe('SET_PASSWORD');
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash,
    ).toBeNull();
  });

  it('enrollment routes refuse FULL and PRE_MFA sessions', async () => {
    const active = await createStaffUser(prisma);
    await post('/api/auth/enrollment/totp', await loginAs(t.app, active.id, 'FULL')).expect(401);
    await post('/api/auth/enrollment/totp', await loginAs(t.app, active.id, 'PRE_MFA')).expect(401);
  });
});
