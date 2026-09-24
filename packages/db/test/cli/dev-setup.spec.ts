import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DRIFT_HINT } from '../../src/cli/support';
import { createPrismaClient, type PrismaClient } from '../../src/index';
import { resetTestDatabase, testDatabaseUrl } from '../../src/testing';

jest.setTimeout(180_000);

const CLI = resolve(__dirname, '../../dist/cli/dev-setup.js');
// A cwd without `.env` or `prisma.config.ts`: the CLI must find its own package files.
const cwd = mkdtempSync(join(tmpdir(), 'tms-dev-setup-'));

function run(extra: Record<string, string | undefined>) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [name, value] of Object.entries(extra)) {
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
  return spawnSync(process.execPath, [CLI], { cwd, env, encoding: 'utf8' });
}
const events = (stdout: string): Record<string, unknown>[] =>
  stdout
    .split('\n')
    .filter((line) => line.startsWith('{"event":'))
    .map((line) => JSON.parse(line) as Record<string, unknown>);

describe('dev-setup CLI (the predev pipeline)', () => {
  let client: PrismaClient;

  beforeAll(() => {
    client = createPrismaClient({ url: testDatabaseUrl() });
  });
  afterAll(async () => {
    await client.$disconnect();
  });
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('deploys, checks drift, syncs and seeds, printing both events', async () => {
    const result = run({
      DATABASE_URL: testDatabaseUrl(),
      BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No pending migrations to apply.');
    const [synced, seeded] = events(result.stdout);
    expect(synced?.['event']).toBe('permissions.synced');
    expect(seeded).toMatchObject({ event: 'seed.applied', bootstrapAdmin: 'created' });
    expect([...(seeded?.['rolesCreated'] as string[])].sort()).toEqual([
      'admin',
      'driver',
      'operator',
    ]);
    expect(await client.user.count()).toBe(1);
  });

  it('exits 2 with the migration hint when the database drifted from the schema', async () => {
    await client.$executeRawUnsafe('ALTER TABLE "Product" ADD COLUMN drift_probe integer');
    try {
      const result = run({
        DATABASE_URL: testDatabaseUrl(),
        BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
      });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(DRIFT_HINT);
      expect(events(result.stdout)).toEqual([]);
      expect(await client.user.count()).toBe(0);
    } finally {
      await client.$executeRawUnsafe('ALTER TABLE "Product" DROP COLUMN drift_probe');
    }
  });

  it('exits 2 naming DATABASE_URL when it is not set', () => {
    const result = run({ DATABASE_URL: undefined });
    expect(result.status).toBe(2);
    expect(result.stderr).toBe('DATABASE_URL is not set\n');
    expect(result.stdout).toBe('');
  });

  it('exits 1 on a wrong DATABASE_URL password without leaking it, even under prisma debug logging', () => {
    // `DEBUG=prisma:*` makes the Prisma CLI child process dump its config (URL and all) to its
    // own stderr; dev-setup.ts must scrub that captured output, not just its own error messages.
    const url = new URL(testDatabaseUrl());
    url.password = 'not-the-password-7f3a';
    const result = run({
      DATABASE_URL: url.toString(),
      BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
      DEBUG: 'prisma:*',
    });
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('not-the-password-7f3a');
    expect(result.stderr).not.toContain('not-the-password-7f3a');
  });
});
