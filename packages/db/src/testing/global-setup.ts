import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import {
  HARNESS_ENV,
  POSTGRES_TEST_IMAGE,
  TEMPLATE_DB,
  WORKER_DB_PREFIX,
  WORKER_PLACEHOLDER,
} from './constants';

/** Anything with testcontainers' `start()`; tests inject a failing one. */
export interface PostgresStarter {
  start(): Promise<StartedPostgreSqlContainer>;
}

/** globalSetup and globalTeardown run in Jest's parent process but as separate module instances. */
export const harnessGlobals = globalThis as typeof globalThis & {
  __TMS_PG_CONTAINER__?: StartedPostgreSqlContainer;
};

// src/testing and dist/testing are both two levels below the package root, so the compiled
// harness finds prisma.config.ts, the migrations and the package's own prisma binary too.
const PKG_ROOT = path.resolve(__dirname, '..', '..');
const PRISMA_BIN = path.join(PKG_ROOT, 'node_modules', '.bin', 'prisma');
// pg waits forever for a server that accepts TCP but never answers; bound every connect.
const CONNECT_TIMEOUT_MS = 5_000;

function withDatabase(baseUrl: string, database: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

function log(message: string, since: number): void {
  console.log(`[db-harness] ${message} in ${(performance.now() - since).toFixed(0)} ms`);
}

/**
 * Starts the Postgres container. testcontainers reports a missing daemon as "Could not find a
 * working container runtime strategy"; the rethrown error says Docker instead.
 */
export async function startPostgres(
  starter: PostgresStarter = new PostgreSqlContainer(POSTGRES_TEST_IMAGE)
    .withUsername('tms')
    .withPassword('tms')
    .withDatabase('postgres'),
): Promise<StartedPostgreSqlContainer> {
  try {
    return await starter.start();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Testcontainers could not reach Docker: ${message}. Is the Docker daemon running?`,
      { cause: error },
    );
  }
}

/**
 * Jest globalSetup: one container per run, `tms_template` migrated once with the package's
 * migrations, then one clone per Jest worker (at least two, so isolation is always testable).
 * Jest passes its GlobalConfig; only `maxWorkers` is read, so the type stays local.
 */
export default async function globalSetup(globalConfig: { maxWorkers: number }): Promise<void> {
  const startedAt = performance.now();
  const container = await startPostgres();
  harnessGlobals.__TMS_PG_CONTAINER__ = container;
  const adminUrl = container.getConnectionUri();
  log(`container ${POSTGRES_TEST_IMAGE} up`, startedAt);

  const admin = new Client({
    connectionString: adminUrl,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${TEMPLATE_DB}`);
    const migrateStartedAt = performance.now();
    execFileSync(PRISMA_BIN, ['migrate', 'deploy'], {
      cwd: PKG_ROOT,
      env: { ...process.env, DATABASE_URL: withDatabase(adminUrl, TEMPLATE_DB) },
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    log(`template ${TEMPLATE_DB} migrated`, migrateStartedAt);

    // CREATE DATABASE ... TEMPLATE fails while any session is still connected to the template.
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [TEMPLATE_DB],
    );
    const cloneStartedAt = performance.now();
    const workers = Math.max(2, globalConfig.maxWorkers);
    for (let n = 1; n <= workers; n += 1) {
      await admin.query(`CREATE DATABASE ${WORKER_DB_PREFIX}${n} TEMPLATE ${TEMPLATE_DB}`);
    }
    log(`${workers} worker databases cloned`, cloneStartedAt);

    // Set before Jest spawns its workers, so every worker process inherits them.
    process.env[HARNESS_ENV.adminUrl] = adminUrl;
    process.env[HARNESS_ENV.urlTemplate] = withDatabase(
      adminUrl,
      `${WORKER_DB_PREFIX}${WORKER_PLACEHOLDER}`,
    );
    process.env[HARNESS_ENV.workerCount] = String(workers);
  } finally {
    await admin.end();
  }
  log('global setup done', startedAt);
}
