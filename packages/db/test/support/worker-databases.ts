import { Client } from 'pg';
import { testDatabaseUrl, withAdminClient } from '../../src/testing';

/** Runs one statement against `url` on a short-lived connection. */
export async function queryRows<T extends object>(
  url: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    const result = await client.query<T>(sql, params);
    return result.rows;
  } finally {
    await client.end();
  }
}

/** Names of the per-worker clones the harness created, in worker order. */
export async function workerDatabases(): Promise<string[]> {
  const rows = await withAdminClient(async (admin) => {
    const result = await admin.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname ~ '^tms_w[0-9]+$'
        ORDER BY length(datname), datname`,
    );
    return result.rows;
  });
  return rows.map((row) => row.datname);
}

/** URLs of every worker clone except the current worker's own database. */
export async function otherWorkerUrls(): Promise<string[]> {
  const own = currentWorkerId();
  const names = await workerDatabases();
  return names
    .map((name) => name.slice('tms_w'.length))
    .filter((id) => id !== own)
    .map((id) => testDatabaseUrl(id));
}

export function currentWorkerId(): string {
  return process.env['JEST_WORKER_ID'] ?? '1';
}

export async function tableExists(url: string, table: string): Promise<boolean> {
  const [row] = await queryRows<{ reg: string | null }>(
    url,
    'SELECT to_regclass($1)::text AS reg',
    [`public.${table}`],
  );
  return (row?.reg ?? null) !== null;
}
