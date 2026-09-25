import request from 'supertest';
import type { PrismaService } from '@tms/db/nest';
import { createAdminTestApp, type AdminTestApp, ORIGIN } from './support/app';
import { createStaffUser, loginAs, seedBase } from './support/fixtures';
import { ProbeModule } from './support/probe.module';

/** Only the field these cases check; the full envelope shape is pinned in nest-bootstrap's own tests. */
const codeOf = (res: { body: unknown }) => (res.body as { code: string }).code;

describe('staff sessions (API)', () => {
  let t: AdminTestApp;
  let prisma: PrismaService;
  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    t = await createAdminTestApp({ extraImports: [ProbeModule] });
  });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    prisma = await seedBase(t.app);
    t.clock.set(new Date('2026-09-23T10:00:00Z'));
  });

  it('401 without a cookie; the Authorization header is ignored', async () => {
    expect(codeOf(await http().get('/api/probe/any').expect(401))).toBe('UNAUTHENTICATED');
    await http().get('/api/probe/any').set('Authorization', 'Bearer abc').expect(401);
  });

  it('every response is no-store, including health and errors', async () => {
    expect((await http().get('/api/health').expect(200)).headers['cache-control']).toBe('no-store');
    expect((await http().get('/api/probe/any').expect(401)).headers['cache-control']).toBe(
      'no-store',
    );
    expect((await http().get('/api/does-not-exist').expect(404)).headers['cache-control']).toBe(
      'no-store',
    );
  });

  it('describes a FULL session with no-store', async () => {
    const user = await createStaffUser(prisma);
    const cookie = await loginAs(t.app, user.id);
    const res = await http().get('/api/auth/session').set('Cookie', cookie).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      scope: 'FULL',
      next: 'NONE',
      user: { id: user.id, email: user.email, firstName: 'Test', lastName: 'User' },
    });
  });

  it('expires after 60 idle minutes, extends on activity, ends at 12 hours', async () => {
    const user = await createStaffUser(prisma);
    const cookie = await loginAs(t.app, user.id);
    // 15 steps of 50 minutes: steps 1-14 end before 720 minutes (200), step 15 ends at 750 (401)
    let sawAbsoluteExpiry = false;
    for (let i = 0; i < 15; i += 1) {
      t.clock.advance(50 * 60_000);
      const expected = (i + 1) * 50 < 12 * 60 ? 200 : 401;
      await http().get('/api/probe/any').set('Cookie', cookie).expect(expected);
      if (expected === 401) {
        sawAbsoluteExpiry = true;
        break;
      }
    }
    expect(sawAbsoluteExpiry).toBe(true);
    const idle = await loginAs(t.app, user.id);
    t.clock.advance(61 * 60_000);
    await http().get('/api/probe/any').set('Cookie', idle).expect(401);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it('polling GET /auth/session does not extend the idle timeout', async () => {
    const user = await createStaffUser(prisma);
    const cookie = await loginAs(t.app, user.id);
    t.clock.advance(40 * 60_000);
    await http().get('/api/auth/session').set('Cookie', cookie).expect(200);
    t.clock.advance(21 * 60_000);
    await http().get('/api/auth/session').set('Cookie', cookie).expect(401);
  });

  it.each(['BLOCKED', 'DEACTIVATED'] as const)(
    'rejects a %s user on the next request and deletes the session',
    async (status) => {
      const user = await createStaffUser(prisma);
      const cookie = await loginAs(t.app, user.id);
      await prisma.user.update({ where: { id: user.id }, data: { status } });
      const res = await http().get('/api/probe/any').set('Cookie', cookie).expect(401);
      expect(res.headers['set-cookie']?.[0]).toMatch(/^__Host-tms_admin_sid=;/);
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    },
  );

  it('rejects a DRIVER user even with a session row', async () => {
    const driver = await createStaffUser(prisma, { kind: 'DRIVER', role: 'driver' });
    await http()
      .get('/api/probe/any')
      .set('Cookie', await loginAs(t.app, driver.id))
      .expect(401);
  });

  it('pre-sessions cannot reach FULL routes', async () => {
    const user = await createStaffUser(prisma);
    await http()
      .get('/api/probe/full')
      .set('Cookie', await loginAs(t.app, user.id, 'PRE_MFA'))
      .expect(401);
    await http()
      .get('/api/probe/any')
      .set('Cookie', await loginAs(t.app, user.id, 'PRE_MFA'))
      .expect(200);
  });

  it('403 when the role lacks the permission', async () => {
    const operator = await createStaffUser(prisma, { role: 'operator' });
    expect(
      codeOf(
        await http()
          .get('/api/probe/users-read')
          .set('Cookie', await loginAs(t.app, operator.id))
          .expect(403),
      ),
    ).toBe('FORBIDDEN');
    const admin = await createStaffUser(prisma, { role: 'admin' });
    await http()
      .get('/api/probe/users-read')
      .set('Cookie', await loginAs(t.app, admin.id))
      .expect(200);
  });

  it('rejects an unknown token and clears the cookie', async () => {
    const res = await http()
      .get('/api/probe/any')
      .set('Cookie', `__Host-tms_admin_sid=${'B'.repeat(43)}`)
      .expect(401);
    expect(res.headers['set-cookie']?.[0]).toMatch(/^__Host-tms_admin_sid=;/);
  });

  it('logout deletes the session, clears the cookie and is audited', async () => {
    const user = await createStaffUser(prisma);
    const cookie = await loginAs(t.app, user.id);
    const res = await http()
      .post('/api/auth/logout')
      .set('Origin', ORIGIN)
      .set('Cookie', cookie)
      .expect(204);
    expect(res.headers['set-cookie']?.[0]).toMatch(
      /^__Host-tms_admin_sid=; Path=\/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict$/,
    );
    await http().get('/api/probe/any').set('Cookie', cookie).expect(401);
    const rows = await prisma.auditLog.findMany({
      where: { action: 'auth.session.revoked', actorUserId: user.id, outcome: 'SUCCESS' },
    });
    expect(rows.map((r) => r.metadata)).toEqual([{ reason: 'LOGOUT', sessionCount: 1 }]);
  });
});
