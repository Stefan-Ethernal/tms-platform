import { PrismaPg } from '@prisma/adapter-pg';

/** Bound on acquiring a connection so a black-holed database fails fast instead of hanging. */
export const DEFAULT_CONNECT_TIMEOUT_MS = 5000;

/**
 * The one place that builds the pg driver adapter, so `createPrismaClient` and `PrismaService`
 * (`@tms/db/nest`) — which must pass an already-built adapter into its own `super()` call and so
 * cannot call `createPrismaClient` itself — stay in sync instead of constructing it twice, default
 * included.
 */
export function createPgAdapter(
  url: string,
  connectTimeoutMs: number = DEFAULT_CONNECT_TIMEOUT_MS,
): PrismaPg {
  return new PrismaPg({ connectionString: url, connectionTimeoutMillis: connectTimeoutMs });
}
