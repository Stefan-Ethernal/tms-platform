import { PrismaPg } from '@prisma/adapter-pg';

/**
 * The one place that builds the pg driver adapter, so `createPrismaClient` and `PrismaService`
 * (`@tms/db/nest`) — which must pass an already-built adapter into its own `super()` call and so
 * cannot call `createPrismaClient` itself — stay in sync instead of constructing it twice.
 */
export function createPgAdapter(url: string, connectTimeoutMs: number): PrismaPg {
  return new PrismaPg({ connectionString: url, connectionTimeoutMillis: connectTimeoutMs });
}
