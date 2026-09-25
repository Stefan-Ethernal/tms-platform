import request from 'supertest';
import type { PrismaService } from '@tms/db/nest';
import { createAdminTestApp, type AdminTestApp, ORIGIN } from './support/app';
import { createStaffUser, loginAs, seedBase, waitForMail } from './support/fixtures';

const TOKEN_IN_LINK = /\/accept-invite#t=([A-Za-z0-9_-]{43})$/m;

/** Only the field these cases check; the full envelope shape is pinned in nest-bootstrap's own tests. */
const codeOf = (res: { body: unknown }) => (res.body as { code: string }).code;

describe('invite (API)', () => {
  let t: AdminTestApp;
  let prisma: PrismaService;
  let adminCookie: string;
  const http = () => request(t.app.getHttpServer());
  const resend = (id: string, cookie = adminCookie) =>
    http().post(`/api/users/${id}/invite`).set('Origin', ORIGIN).set('Cookie', cookie);
  const accept = (token: string) =>
    http().post('/api/auth/invite/accept').set('Origin', ORIGIN).send({ token });
  const tokenFromLastMail = async (to: string) => {
    const match = TOKEN_IN_LINK.exec((await waitForMail(t.mail, to)).text);
    if (!match?.[1]) throw new Error(`no invite link in the mail to ${to}`);
    return match[1];
  };

  beforeAll(async () => {
    t = await createAdminTestApp();
  });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    prisma = await seedBase(t.app);
    t.mail.clear();
    adminCookie = await loginAs(t.app, (await createStaffUser(prisma, { role: 'admin' })).id);
  });

  it('issues an invite by mail, stores only the token hash and audits it', async () => {
    const invited = await createStaffUser(prisma, {
      status: 'INVITED',
      enrolled: false,
      role: 'operator',
    });
    const res = await resend(invited.id).expect(202);
    expect(Object.keys(res.body as object)).toEqual(['expiresAt']);
    const token = await tokenFromLastMail(invited.email!);
    const row = await prisma.actionToken.findFirstOrThrow({
      where: { userId: invited.id, type: 'INVITE' },
    });
    expect(row.tokenHash).not.toContain(token);
    expect(row.expiresAt.getTime() - t.clock.now().getTime()).toBe(72 * 3600_000);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'auth.invite.issued', targetId: invited.id },
    });
    expect(audit.metadata).toEqual({ via: 'ADMIN', expiresAt: row.expiresAt.toISOString() });
    expect(JSON.stringify(audit)).not.toContain(token);
  });

  it('403 without users:invite; 409 for a user who is not an INVITED staff member', async () => {
    const operatorCookie = await loginAs(
      t.app,
      (await createStaffUser(prisma, { role: 'operator' })).id,
    );
    const invited = await createStaffUser(prisma, { status: 'INVITED', enrolled: false });
    await resend(invited.id, operatorCookie).expect(403);
    const active = await createStaffUser(prisma);
    expect(codeOf(await resend(active.id).expect(409))).toBe('USER_STATE_CONFLICT');
    const refused = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'auth.invite.issued', outcome: 'FAILURE', targetId: active.id },
    });
    expect(refused.metadata).toEqual({ via: 'ADMIN' }); // no expiresAt: nothing was issued
    // drivers sign in with card + PIN (phase 5) and never get an invite, even with an email on file
    const driver = await createStaffUser(prisma, {
      kind: 'DRIVER',
      role: 'driver',
      status: 'INVITED',
      enrolled: false,
    });
    expect(codeOf(await resend(driver.id).expect(409))).toBe('USER_STATE_CONFLICT');
    expect(t.mail.sent.filter((m) => m.to === driver.email)).toHaveLength(0);
    expect(await prisma.actionToken.count({ where: { userId: driver.id } })).toBe(0);
  });

  it('accept opens an ENROLLMENT session with a strict __Host- cookie', async () => {
    const invited = await createStaffUser(prisma, { status: 'INVITED', enrolled: false });
    await resend(invited.id).expect(202);
    const res = await accept(await tokenFromLastMail(invited.email!)).expect(200);
    expect(res.body).toMatchObject({ scope: 'ENROLLMENT', next: 'SET_PASSWORD' });
    const setCookie = res.headers['set-cookie']?.[0] ?? '';
    expect(setCookie).toMatch(
      /^__Host-tms_admin_sid=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict$/,
    );
    await http().get('/api/auth/session').set('Cookie', setCookie.split(';')[0]!).expect(200);
  });

  it('rejects reused, expired, superseded and malformed tokens with one code', async () => {
    const invited = await createStaffUser(prisma, { status: 'INVITED', enrolled: false });
    await resend(invited.id).expect(202);
    const first = await tokenFromLastMail(invited.email!);
    t.mail.clear(); // the next mail to the same address replaces this one
    await resend(invited.id).expect(202);
    const second = await tokenFromLastMail(invited.email!);
    const resent = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'auth.invite.resent', targetId: invited.id },
    });
    expect(Object.keys(resent.metadata as object)).toEqual(['expiresAt']);
    expect(codeOf(await accept(first).expect(400))).toBe('AUTH_TOKEN_INVALID');
    await accept(second).expect(200);
    expect(codeOf(await accept(second).expect(400))).toBe('AUTH_TOKEN_INVALID');

    const other = await createStaffUser(prisma, { status: 'INVITED', enrolled: false });
    await resend(other.id).expect(202);
    const late = await tokenFromLastMail(other.email!);
    t.clock.advance(72 * 3600_000 + 1000);
    await accept(late).expect(400);
    expect(codeOf(await accept('short').expect(422))).toBe('VALIDATION_FAILED');
  });

  it('a token for a user who is no longer INVITED is invalid', async () => {
    const invited = await createStaffUser(prisma, { status: 'INVITED', enrolled: false });
    await resend(invited.id).expect(202);
    await prisma.user.update({ where: { id: invited.id }, data: { status: 'BLOCKED' } });
    await accept(await tokenFromLastMail(invited.email!)).expect(400);
  });

  it('exactly one of five parallel accepts wins (Review Focus 3)', async () => {
    const invited = await createStaffUser(prisma, { status: 'INVITED', enrolled: false });
    await resend(invited.id).expect(202);
    const token = await tokenFromLastMail(invited.email!);
    const results = await Promise.all(Array.from({ length: 5 }, () => accept(token)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400, 400, 400]);
    expect(await prisma.session.count({ where: { userId: invited.id, scope: 'ENROLLMENT' } })).toBe(
      1,
    );
  });

  it('resend revokes an abandoned enrollment session', async () => {
    const invited = await createStaffUser(prisma, { status: 'INVITED', enrolled: false });
    await resend(invited.id).expect(202);
    const cookie = (await accept(await tokenFromLastMail(invited.email!)).expect(200)).headers[
      'set-cookie'
    ]![0]!.split(';')[0]!;
    await resend(invited.id).expect(202);
    await http().get('/api/auth/session').set('Cookie', cookie).expect(401);
  });

  it('accept without an allowed Origin is rejected', async () => {
    await http()
      .post('/api/auth/invite/accept')
      .send({ token: 'A'.repeat(43) })
      .expect(403);
  });
});
