import type { PrismaService } from '@tms/db/nest';
import { toApiError } from '@tms/nest-bootstrap';
import { createAdminTestApp, type AdminTestApp } from './support/app';
import { createStaffUser, seedBase } from './support/fixtures';

async function rejection(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error('expected the operation to be rejected');
}

describe('Prisma errors from real Postgres', () => {
  let t: AdminTestApp;
  let prisma: PrismaService;

  beforeAll(async () => {
    t = await createAdminTestApp();
  });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    prisma = await seedBase(t.app);
  });

  it('a duplicate email (P2002 on User_email_key) maps to 409 CONFLICT with the field', async () => {
    const first = await createStaffUser(prisma);
    const second = await createStaffUser(prisma);
    // update, not create: only the email collides (createStaffUser derives the unique username from the email)
    const error = await rejection(
      prisma.user.update({ where: { id: second.id }, data: { email: first.email } }),
    );
    expect(toApiError(error)).toEqual({
      statusCode: 409,
      code: 'CONFLICT',
      message: 'Already exists',
      fields: [{ path: 'email', code: 'UNIQUE', message: 'Already exists' }],
    });
  });

  it('deleting a role a user still holds (P2003, RESTRICT) maps to 409 REFERENCE_CONFLICT', async () => {
    const user = await createStaffUser(prisma, { role: 'operator' });
    const error = await rejection(prisma.role.delete({ where: { id: user.roleId } }));
    expect(toApiError(error)).toEqual({
      statusCode: 409,
      code: 'REFERENCE_CONFLICT',
      message: 'Still referenced',
    });
  });
});
