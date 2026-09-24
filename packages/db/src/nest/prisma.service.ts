import type { OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import type { CreatePrismaClientOptions } from '../index';

/**
 * The generated client as the applications' single Nest provider. Prisma connects lazily on the
 * first query, so an unreachable database never fails startup; the health endpoint reports it.
 */
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor({ url, connectTimeoutMs = 5000 }: CreatePrismaClientOptions) {
    super({
      adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: connectTimeoutMs }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
