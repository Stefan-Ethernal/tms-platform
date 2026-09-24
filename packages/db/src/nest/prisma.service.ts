import type { OnModuleDestroy } from '@nestjs/common';
import { createPgAdapter } from '../adapter';
import { PrismaClient } from '../generated/prisma/client';
import type { CreatePrismaClientOptions } from '../index';

/**
 * The generated client as the applications' single Nest provider. Prisma connects lazily on the
 * first query, so an unreachable database never fails startup; the health endpoint reports it.
 */
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor({ url, connectTimeoutMs }: CreatePrismaClientOptions) {
    // `extends PrismaClient` must pass a built adapter into `super()` directly, so this cannot
    // delegate to `createPrismaClient`; `createPgAdapter` keeps the adapter construction itself
    // shared with it instead.
    super({ adapter: createPgAdapter(url, connectTimeoutMs) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
