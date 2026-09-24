import { Client } from 'pg';
import { HARNESS_ENV, WORKER_PLACEHOLDER } from './constants';

export { POSTGRES_TEST_IMAGE } from './constants';
export * from './fixtures';

const CONNECT_TIMEOUT_MS = 5_000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set: the Jest config must use createJestConfig({ rootDir, database: true }) from @tms/config/jest`,
    );
  }
  return value;
}

/** URL of the database owned by the current Jest worker, or by `workerId`. */
export function testDatabaseUrl(workerId: string = process.env['JEST_WORKER_ID'] ?? '1'): string {
  return requireEnv(HARNESS_ENV.urlTemplate).replace(WORKER_PLACEHOLDER, workerId);
}

async function withClient<T>(url: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: CONNECT_TIMEOUT_MS });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Runs `fn` against the container's maintenance database (CREATE/DROP DATABASE and the like). */
export function withAdminClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  return withClient(requireEnv(HARNESS_ENV.adminUrl), fn);
}

/** Empties every public table except `_prisma_migrations` and restarts their sequences. */
export async function resetTestDatabase(url: string = testDatabaseUrl()): Promise<void> {
  await withClient(url, async (client) => {
    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    if (rows.length === 0) return;
    const tables = rows.map((row) => `"public"."${row.tablename.replaceAll('"', '""')}"`);
    await client.query(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
  });
}
