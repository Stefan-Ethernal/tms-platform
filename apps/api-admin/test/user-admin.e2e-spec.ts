import request from 'supertest';
import type { PrismaService } from '@tms/db/nest';
import { createAdminTestApp, type AdminTestApp, ORIGIN } from './support/app';
import { createStaffUser, loginAs, roleIdByKey, seedBase, waitForMail } from './support/fixtures';

const TOKEN_IN_LINK = /\/accept-invite#t=([A-Za-z0-9_-]{43})$/m;

/** Only the field these cases check; the full envelope shape is pinned in nest-bootstrap's own tests. */
const codeOf = (res: { body: unknown }) => (res.body as { code: string }).code;

describe('admin user and role administration (API)', () => {
  let t: AdminTestApp;
  let prisma: PrismaService;
  let adminCookie: string;
  const http = () => request(t.app.getHttpServer());
  const createUser = (body: Record<string, unknown>, cookie = adminCookie) =>
    http().post('/api/users').set('Origin', ORIGIN).set('Cookie', cookie).send(body);
  const listUsers = (cookie = adminCookie) =>
    http().get('/api/users').set('Origin', ORIGIN).set('Cookie', cookie);
  const listRoles = (cookie = adminCookie) =>
    http().get('/api/roles').set('Origin', ORIGIN).set('Cookie', cookie);

  beforeAll(async () => {
    t = await createAdminTestApp();
  });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    prisma = await seedBase(t.app);
    t.mail.clear();
    adminCookie = await loginAs(t.app, (await createStaffUser(prisma, { role: 'admin' })).id);
  });

  it('creates a STAFF user with a role, issues an invite mail and audits it', async () => {
    const roleId = await roleIdByKey(prisma, 'operator');
    const res = await createUser({
      email: 'new.operator@example.com',
      firstName: 'Nova',
      lastName: 'Doe',
      roleId,
    }).expect(201);
    expect(Object.keys(res.body as object).sort()).toEqual(['expiresAt', 'userId']);

    const created = await prisma.user.findUniqueOrThrow({
      where: { id: (res.body as { userId: string }).userId },
    });
    expect(created).toMatchObject({
      kind: 'STAFF',
      status: 'INVITED',
      email: 'new.operator@example.com',
      username: 'new.operator@example.com',
      roleId,
    });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'admin.user.created', targetId: created.id },
    });
    expect(audit.metadata).toEqual({});

    const token = TOKEN_IN_LINK.exec((await waitForMail(t.mail, created.email!)).text)?.[1];
    expect(token).toBeTruthy();
    const invite = await prisma.actionToken.findFirstOrThrow({
      where: { userId: created.id, type: 'INVITE' },
    });
    expect(invite.tokenHash).not.toContain(token);
  });

  it('403 without users:create, users:read or roles:read', async () => {
    const operatorCookie = await loginAs(
      t.app,
      (await createStaffUser(prisma, { role: 'operator' })).id,
    );
    const roleId = await roleIdByKey(prisma, 'operator');
    await createUser(
      { email: 'blocked@example.com', firstName: 'A', lastName: 'B', roleId },
      operatorCookie,
    ).expect(403);
    await listUsers(operatorCookie).expect(403);
    await listRoles(operatorCookie).expect(403);
  });

  it('422 when the role does not apply to STAFF users, and no User row is created', async () => {
    const driverRoleId = await roleIdByKey(prisma, 'driver');
    const res = await createUser({
      email: 'wrong.role@example.com',
      firstName: 'Wrong',
      lastName: 'Role',
      roleId: driverRoleId,
    }).expect(422);
    expect(codeOf(res)).toBe('ROLE_KIND_MISMATCH');
    const created = await prisma.user.findUnique({ where: { email: 'wrong.role@example.com' } });
    expect(created).toBeNull();
  });

  it('409 on a duplicate email', async () => {
    const existing = await createStaffUser(prisma);
    const roleId = await roleIdByKey(prisma, 'operator');
    const res = await createUser({
      email: existing.email,
      firstName: 'Dup',
      lastName: 'Licate',
      roleId,
    }).expect(409);
    expect(codeOf(res)).toBe('CONFLICT');
  });

  it('lists only STAFF users with their role name', async () => {
    await createStaffUser(prisma, { kind: 'DRIVER', role: 'driver' });
    const staff = await createStaffUser(prisma, { role: 'operator', email: 'staffer@example.com' });
    const res = await listUsers().expect(200);
    const emails = (res.body as { users: Array<{ email: string | null }> }).users.map(
      (u) => u.email,
    );
    expect(emails).toContain(staff.email);
    expect(emails).toContain('bootstrap@example.com'); // the seeded admin
    expect(emails.every((e) => e !== null)).toBe(true);
    const found = (
      res.body as { users: Array<{ email: string | null; role: { name: string } }> }
    ).users.find((u) => u.email === staff.email);
    expect(found?.role.name).toBe('Operator');
  });

  it('lists only STAFF-applicable roles', async () => {
    const res = await listRoles().expect(200);
    const keys = (res.body as { roles: Array<{ key: string | null }> }).roles.map((r) => r.key);
    expect(keys.sort()).toEqual(['admin', 'operator']);
  });
});
