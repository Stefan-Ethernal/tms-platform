import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  POSTGRES_TEST_IMAGE,
  resetTestDatabase,
  testDatabaseUrl,
  withAdminClient,
} from '../src/testing';
import { startPostgres } from '../src/testing/global-setup';
import {
  currentWorkerId,
  otherWorkerUrls,
  queryRows,
  tableExists,
  workerDatabases,
} from './support/worker-databases';

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'prisma', 'migrations');
const COMPOSE_FILE = path.resolve(__dirname, '..', '..', '..', 'infra', 'docker-compose.yml');
const TURBO_FILE = path.resolve(__dirname, '..', '..', '..', 'turbo.json');

interface TurboConfig {
  globalPassThroughEnv?: string[];
  tasks: Record<string, { passThroughEnv?: string[] }>;
}
const PROBE_TABLE = 'harness_probe_one';
const RESET_TABLE = 'harness_reset_probe';

function migrationFolderCount(): number {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    .length;
}

describe('@tms/db/testing harness', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterEach(async () => {
    await queryRows(testDatabaseUrl(), `DROP TABLE IF EXISTS ${PROBE_TABLE}, ${RESET_TABLE}`);
  });

  it('connects each Jest worker to its own clone', async () => {
    const [row] = await queryRows<{ db: string }>(
      testDatabaseUrl(),
      'SELECT current_database() AS db',
    );
    expect(row?.db).toBe(`tms_w${currentWorkerId()}`);
  });

  it('clones at least two worker databases from one template', async () => {
    const names = await workerDatabases();
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(names).toEqual(names.map((_, index) => `tms_w${index + 1}`));
    const templates = await withAdminClient(async (admin) => {
      const result = await admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_database WHERE datname = 'tms_template'`,
      );
      return result.rows[0]?.n;
    });
    expect(templates).toBe(1);
  });

  it('inherits _prisma_migrations from the migrated template, one row per migration folder', async () => {
    const [row] = await queryRows<{ n: number }>(
      testDatabaseUrl(),
      'SELECT count(*)::int AS n FROM _prisma_migrations',
    );
    expect(row?.n).toBe(migrationFolderCount());
  });

  it('keeps a table created in this worker database invisible to every other clone', async () => {
    const own = testDatabaseUrl();
    await queryRows(own, `CREATE TABLE ${PROBE_TABLE} (id integer PRIMARY KEY)`);
    await queryRows(own, `INSERT INTO ${PROBE_TABLE} (id) VALUES (1)`);
    expect(await tableExists(own, PROBE_TABLE)).toBe(true);
    const others = await otherWorkerUrls();
    expect(others.length).toBeGreaterThanOrEqual(1);
    for (const url of others) {
      expect(await tableExists(url, PROBE_TABLE)).toBe(false);
    }
  });

  it('resetTestDatabase empties tables, restarts identities and keeps _prisma_migrations', async () => {
    const url = testDatabaseUrl();
    await queryRows(
      url,
      `CREATE TABLE ${RESET_TABLE} (id serial PRIMARY KEY, label text NOT NULL)`,
    );
    await queryRows(url, `INSERT INTO ${RESET_TABLE} (label) VALUES ('a'), ('b')`);

    await resetTestDatabase();

    const [count] = await queryRows<{ n: number }>(
      url,
      `SELECT count(*)::int AS n FROM ${RESET_TABLE}`,
    );
    expect(count?.n).toBe(0);
    const [inserted] = await queryRows<{ id: number }>(
      url,
      `INSERT INTO ${RESET_TABLE} (label) VALUES ('c') RETURNING id`,
    );
    expect(inserted?.id).toBe(1);
    const [migrations] = await queryRows<{ n: number }>(
      url,
      'SELECT count(*)::int AS n FROM _prisma_migrations',
    );
    expect(migrations?.n).toBe(migrationFolderCount());
  });

  it('resetTestDatabase is a no-op on a database without tables', async () => {
    const name = `tms_reset_empty_w${currentWorkerId()}`;
    await withAdminClient((admin) => admin.query(`CREATE DATABASE ${name}`));
    try {
      const url = new URL(testDatabaseUrl());
      url.pathname = `/${name}`;
      await expect(resetTestDatabase(url.toString())).resolves.toBeUndefined();
    } finally {
      await withAdminClient((admin) => admin.query(`DROP DATABASE ${name}`));
    }
  });

  it('gets the Docker variables through turbo and never DATABASE_URL (Review Focus 6)', () => {
    const turbo = JSON.parse(readFileSync(TURBO_FILE, 'utf8')) as TurboConfig;
    // Testcontainers finds the daemon through these; turbo's strict env mode drops anything unlisted.
    expect(turbo.globalPassThroughEnv).toEqual(['DOCKER_*', 'XDG_RUNTIME_DIR', 'TESTCONTAINERS_*']);
    expect(turbo.tasks['test']?.passThroughEnv).toBeUndefined();
    expect(turbo.tasks['@tms/db#test']?.passThroughEnv).toBeUndefined();
    const databaseTasks = Object.keys(turbo.tasks).filter(
      (name) => name.startsWith('db:') && name !== 'db:validate',
    );
    expect(databaseTasks.length).toBeGreaterThanOrEqual(4);
    for (const name of databaseTasks) {
      expect(turbo.tasks[name]?.passThroughEnv).toContain('DATABASE_URL');
    }
  });

  it('pins the same Postgres image as infra/docker-compose.yml', () => {
    const compose = readFileSync(COMPOSE_FILE, 'utf8');
    expect(/image: (postgres:\S+)/.exec(compose)?.[1]).toBe(POSTGRES_TEST_IMAGE);
  });

  it('names the missing Jest setup when the harness environment is absent', () => {
    const saved = process.env['TEST_DB_URL_TEMPLATE'];
    delete process.env['TEST_DB_URL_TEMPLATE'];
    try {
      expect(() => testDatabaseUrl()).toThrow(
        'TEST_DB_URL_TEMPLATE is not set: the Jest config must use createJestConfig({ rootDir, database: true }) from @tms/config/jest',
      );
    } finally {
      process.env['TEST_DB_URL_TEMPLATE'] = saved;
    }
  });
});

describe('startPostgres', () => {
  it('names Docker when no container runtime is reachable', async () => {
    const cause = new Error('Could not find a working container runtime strategy');
    const failure: unknown = await startPostgres({ start: () => Promise.reject(cause) }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      'Testcontainers could not reach Docker: Could not find a working container runtime strategy. Is the Docker daemon running?',
    );
    expect((failure as Error).cause).toBe(cause);
  });
});
