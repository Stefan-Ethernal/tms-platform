import { Injectable, Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient, type CreatePrismaClientOptions } from '../src';
import { PrismaModule, PrismaService } from '../src/nest';
import {
  resetTestDatabase,
  startFaultProxy,
  testDatabaseUrl,
  withAdminClient,
} from '../src/testing';

@Injectable()
class NeedsPrisma {
  constructor(readonly prisma: PrismaService) {}
}

@Module({ providers: [NeedsPrisma] })
class ConsumerModule {}

async function start(options: CreatePrismaClientOptions): Promise<TestingModule> {
  const moduleRef = await Test.createTestingModule({
    imports: [PrismaModule.forRoot(options), ConsumerModule],
  }).compile();
  await moduleRef.init();
  return moduleRef;
}

async function backendsOnTestDatabase(): Promise<number> {
  const database = new URL(testDatabaseUrl()).pathname.slice(1);
  return withAdminClient(async (client) => {
    const result = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [database],
    );
    return Number(result.rows[0]?.count ?? '0');
  });
}

async function eventually(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return check();
}

describe('@tms/db/nest', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('provides one global PrismaService built on the generated client', async () => {
    const moduleRef = await start({ url: testDatabaseUrl() });
    const prisma = moduleRef.get(PrismaService);
    expect(Object.getPrototypeOf(PrismaService.prototype)).toBe(PrismaClient.prototype);
    // Prisma 7's constructor returns a proxy, so `instanceof` is false by design; the constructor survives.
    expect(prisma.constructor).toBe(PrismaService);
    expect(moduleRef.get(NeedsPrisma).prisma).toBe(prisma);
    await expect(prisma.$queryRaw`SELECT 1 AS one`).resolves.toEqual([{ one: 1 }]);
    await moduleRef.close();
  });

  it('connects lazily: starting the module opens no connection', async () => {
    const hole = await startFaultProxy();
    const moduleRef = await start({ url: `postgresql://tms:tms@127.0.0.1:${hole.port}/tms` });
    expect(hole.accepted).toBe(0);
    await moduleRef.close();
    await hole.close();
  });

  it('bounds a black-holed connect with connectTimeoutMs (the pool layer)', async () => {
    const hole = await startFaultProxy();
    const moduleRef = await start({
      url: `postgresql://tms:tms@127.0.0.1:${hole.port}/tms`,
      connectTimeoutMs: 300,
    });
    const started = performance.now();
    await expect(moduleRef.get(PrismaService).$queryRaw`SELECT 1`).rejects.toThrow(
      /connection timeout/i,
    );
    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(2000);
    expect(hole.accepted).toBeGreaterThanOrEqual(1);
    await hole.close();
    await moduleRef.close();
  });

  it('disconnects on module destroy: no backend stays on the database', async () => {
    const moduleRef = await start({ url: testDatabaseUrl() });
    const prisma = moduleRef.get(PrismaService);
    await prisma.$queryRaw`SELECT 1`;
    expect(await backendsOnTestDatabase()).toBeGreaterThanOrEqual(1);
    const disconnect = jest.spyOn(prisma, '$disconnect');
    await moduleRef.close();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(await eventually(async () => (await backendsOnTestDatabase()) === 0, 5000)).toBe(true);
  });
});
