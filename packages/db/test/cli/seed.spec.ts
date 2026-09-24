import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createPrismaClient, type PrismaClient } from '../../src/index';
import { resetTestDatabase, testDatabaseUrl } from '../../src/testing';

jest.setTimeout(120_000);

const CLI = resolve(__dirname, '../../dist/cli/seed.js');
const cwd = mkdtempSync(join(tmpdir(), 'tms-seed-cli-'));

function run(extra: Record<string, string | undefined>) {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: testDatabaseUrl() };
  delete env['BOOTSTRAP_ADMIN_EMAIL'];
  delete env['BOOTSTRAP_ADMIN_USERNAME'];
  for (const [name, value] of Object.entries(extra)) {
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
  return spawnSync(process.execPath, [CLI], { cwd, env, encoding: 'utf8' });
}
const lastJsonLine = (stdout: string): Record<string, unknown> =>
  JSON.parse(stdout.trim().split('\n').at(-1)!) as Record<string, unknown>;

describe('tms-seed CLI', () => {
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

  it('exits 2 when no admin exists and BOOTSTRAP_ADMIN_EMAIL is missing, writing nothing', async () => {
    const result = run({});
    expect(result.status).toBe(2);
    expect(result.stderr).toBe(
      'seed failed: SeedConfigError: BOOTSTRAP_ADMIN_EMAIL is required while no admin exists\n',
    );
    expect(result.stdout).toBe('');
    expect(await client.role.count()).toBe(0);
  });

  it('exits 2 on an invalid BOOTSTRAP_ADMIN_EMAIL before touching the database', async () => {
    const result = run({ BOOTSTRAP_ADMIN_EMAIL: 'not-an-email' });
    expect(result.status).toBe(2);
    expect(result.stderr).toBe('BOOTSTRAP_ADMIN_EMAIL is not a valid email address\n');
    expect(await client.permission.count()).toBe(0);
  });

  it('seeds with a normalised email and username and prints seed.applied', async () => {
    const result = run({
      BOOTSTRAP_ADMIN_EMAIL: '  Admin@Example.com ',
      BOOTSTRAP_ADMIN_USERNAME: 'root',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(lastJsonLine(result.stdout)).toMatchObject({
      event: 'seed.applied',
      bootstrapAdmin: 'created',
      warnings: [],
    });
    expect(await client.user.findMany()).toMatchObject([
      { username: 'root', email: 'admin@example.com', status: 'INVITED' },
    ]);
  });
});
