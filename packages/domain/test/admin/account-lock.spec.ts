import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { seedDatabase } from '@tms/db';
import { PrismaModule, PrismaService } from '@tms/db/nest';
import { resetTestDatabase, testDatabaseUrl } from '@tms/db/testing';
import { AccountLockService, AdminAuthModule } from '../../src/admin';
import {
  type AppTransactionHost,
  InMemoryMailSender,
  MailModule,
  MailSender,
  SharedModule,
  TransactionHost,
} from '../../src/shared';
import { testAuthOptions } from './support/options';

describe('AccountLockService', () => {
  let locks: AccountLockService;
  let txHost: AppTransactionHost;
  let prisma: PrismaService;
  let user: { id: string };

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      imports: [
        PrismaModule.forRoot({ url: testDatabaseUrl() }),
        SharedModule.forRoot({ app: 'ADMIN' }),
        MailModule.forRoot({ smtpUrl: 'smtp://localhost:1025', from: 'TMS <no-reply@tms.local>' }),
        AdminAuthModule.forRoot(testAuthOptions),
      ],
    })
      .overrideProvider(MailSender)
      .useValue(new InMemoryMailSender())
      .compile();
    await ref.init();
    locks = ref.get(AccountLockService);
    txHost = ref.get<AppTransactionHost>(TransactionHost);
    prisma = ref.get(PrismaService);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    await seedDatabase(prisma, { bootstrapAdmin: { email: 'bootstrap@example.com' } });
    const role = await prisma.role.findFirstOrThrow({ where: { key: 'admin' } });
    const email = `${randomUUID()}@example.com`;
    user = await prisma.user.create({
      data: {
        kind: 'STAFF',
        username: email.split('@')[0]!,
        firstName: 'Test',
        lastName: 'User',
        email,
        status: 'ACTIVE',
        roleId: role.id,
        locale: 'en',
      },
    });
  });

  it('refuses to lock a row outside a transaction (a lock without a transaction is a no-op)', async () => {
    await expect(locks.lock(user.id)).rejects.toThrow('needs an active transaction');
  });

  it('takes FOR NO KEY UPDATE: rows referencing the user can be inserted while the lock is held', async () => {
    await txHost.withTransaction(async () => {
      await locks.lock(user.id);
      // another connection: the FK check takes FOR KEY SHARE on the user row, which FOR UPDATE would block
      const insert = prisma.recoveryCode.create({
        data: { userId: user.id, codeHash: 'a'.repeat(64) },
      });
      let timer: NodeJS.Timeout | undefined;
      const blocked = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('blocked by the row lock')), 2000);
      });
      try {
        await expect(Promise.race([insert, blocked])).resolves.toMatchObject({ userId: user.id });
      } finally {
        clearTimeout(timer);
      }
    });
  });
});
