import { createPgAdapter } from './adapter';
import { PrismaClient } from './generated/prisma/client';

// PrismaClient (class and type), the Prisma namespace, $Enums, every enum and every model type.
export * from './generated/prisma/client';

export interface CreatePrismaClientOptions {
  /** postgresql:// URL: `DATABASE_URL` in the apps and the migrate image, `testDatabaseUrl()` in tests. */
  url: string;
  /** Bound on acquiring a connection so a black-holed database fails fast instead of hanging (health checks). */
  connectTimeoutMs?: number;
}

/**
 * The generated client over the pg driver adapter, for callers outside Nest (the CLIs, the migrate
 * image, tests). `PrismaService` (`@tms/db/nest`) builds the same client through the same
 * `createPgAdapter` helper for Nest applications; both are the only two places that construct one.
 */
export function createPrismaClient({
  url,
  connectTimeoutMs,
}: CreatePrismaClientOptions): PrismaClient {
  return new PrismaClient({ adapter: createPgAdapter(url, connectTimeoutMs) });
}

export * from './sync';
export * from './seed';
