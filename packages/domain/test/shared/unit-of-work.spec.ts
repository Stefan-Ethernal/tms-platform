import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createPrismaClient } from '@tms/db';
import { PrismaModule, PrismaService } from '@tms/db/nest';
import { resetTestDatabase, testDatabaseUrl } from '@tms/db/testing';
import {
  AfterCommitError,
  type AppTransactionHost,
  SharedModule,
  TransactionHost,
  UnitOfWork,
} from '../../src/shared';

describe('UnitOfWork', () => {
  let uow: UnitOfWork;
  let prisma: PrismaService;
  let txHost: AppTransactionHost;
  const outside = createPrismaClient({ url: testDatabaseUrl() });

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      imports: [
        PrismaModule.forRoot({ url: testDatabaseUrl() }),
        SharedModule.forRoot({ app: 'ADMIN' }),
      ],
    }).compile();
    await ref.init();
    uow = ref.get(UnitOfWork);
    prisma = ref.get(PrismaService);
    txHost = ref.get<AppTransactionHost>(TransactionHost);
  });
  afterAll(() => outside.$disconnect());
  beforeEach(() => resetTestDatabase());

  const createCarrier = (name: string) =>
    txHost.tx.carrier.create({ data: { name, isActive: true } });

  it('runs effects after commit, when other connections can see the data', async () => {
    const name = `c-${randomUUID()}`;
    let seen: number | undefined;
    await uow.run(
      async () => {
        await createCarrier(name);
        uow.afterCommit(async () => {
          seen = await outside.carrier.count({ where: { name } });
        });
      },
      { awaitEffects: true },
    );
    expect(seen).toBe(1);
  });

  it('never runs effects of a rolled-back unit', async () => {
    const effect = jest.fn(() => Promise.resolve(undefined));
    await expect(
      uow.run(() => {
        uow.afterCommit(effect);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    await new Promise((r) => setImmediate(r));
    expect(effect).not.toHaveBeenCalled();
  });

  it('joins an outer unit: inner effects run once, after the outer commit', async () => {
    const order: string[] = [];
    await uow.run(
      async () => {
        await uow.run(async () => {
          await Promise.resolve();
          uow.afterCommit(async () => {
            await Promise.resolve();
            order.push('inner effect');
          });
          order.push('inner body');
        });
        order.push('outer body');
      },
      { awaitEffects: true },
    );
    expect(order).toEqual(['inner body', 'outer body', 'inner effect']);
  });

  it('refuses awaitEffects on a unit that joins an outer one, and rolls the outer unit back', async () => {
    const name = `c-${randomUUID()}`;
    await expect(
      uow.run(async () => {
        await createCarrier(name);
        await uow.run(() => Promise.resolve(undefined), { awaitEffects: true });
      }),
    ).rejects.toThrow('awaitEffects');
    expect(await prisma.carrier.count({ where: { name } })).toBe(0);
  });

  it('runs an effect immediately outside any transaction', async () => {
    const effect = jest.fn(() => Promise.resolve(undefined));
    uow.afterCommit(effect);
    await new Promise((r) => setImmediate(r));
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('refuses afterCommit inside a transaction that no unit owns', async () => {
    await expect(
      txHost.withTransaction(async () => {
        await Promise.resolve();
        uow.afterCommit(() => Promise.resolve(undefined));
      }),
    ).rejects.toThrow('UnitOfWork.run');
  });

  it('with awaitEffects, a failing effect rejects but the data stays committed', async () => {
    const name = `c-${randomUUID()}`;
    await expect(
      uow.run(
        async () => {
          await createCarrier(name);
          uow.afterCommit(async () => {
            await Promise.resolve();
            throw new Error('SMTP down');
          });
        },
        { awaitEffects: true },
      ),
    ).rejects.toBeInstanceOf(AfterCommitError);
    expect(await prisma.carrier.count({ where: { name } })).toBe(1);
  });

  it('in the background, a failing effect is logged by name only', async () => {
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await uow.run(async () => {
      await Promise.resolve();
      uow.afterCommit(async () => {
        await Promise.resolve();
        throw new Error('token=SECRET-VALUE');
      });
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(spy).toHaveBeenCalled();
    expect(JSON.stringify(spy.mock.calls)).not.toContain('SECRET-VALUE');
    spy.mockRestore();
  });
});
