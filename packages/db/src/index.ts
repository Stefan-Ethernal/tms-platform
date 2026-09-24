import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

// PrismaClient (class and type), the Prisma namespace, $Enums, every enum and every model type.
export * from './generated/prisma/client';

export interface CreatePrismaClientOptions {
  /** postgresql:// URL: `DATABASE_URL` in the apps and the migrate image, `testDatabaseUrl()` in tests. */
  url: string;
  /** Bound on acquiring a connection so a black-holed database fails fast instead of hanging (health checks). */
  connectTimeoutMs?: number;
}

/** The generated client over the pg driver adapter — the only way this package hands out a PrismaClient. */
export function createPrismaClient({
  url,
  connectTimeoutMs = 5000,
}: CreatePrismaClientOptions): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: connectTimeoutMs }),
  });
}

export * from './sync';
