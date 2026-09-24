import { createPrismaClient, type PrismaClient } from '../src';
import { makeStaffUser, resetTestDatabase, testDatabaseUrl } from '../src/testing';

describe('phase 2 auth fields', () => {
  let prisma: PrismaClient;

  beforeEach(async () => {
    await resetTestDatabase();
    prisma = createPrismaClient({ url: testDatabaseUrl() });
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  it('defaults lockoutLevel to 0', async () => {
    const user = await makeStaffUser(prisma, { status: 'INVITED' });
    expect(user.lockoutLevel).toBe(0);
  });

  it('indexes action tokens by user and type instead of by user alone', async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'ActionToken'
      ORDER BY indexname`;

    expect(rows.map((row) => row.indexname)).toEqual([
      'ActionToken_pkey',
      'ActionToken_tokenHash_key',
      'ActionToken_userId_type_idx',
    ]);
  });
});
