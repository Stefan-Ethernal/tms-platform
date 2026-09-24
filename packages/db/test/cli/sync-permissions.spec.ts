import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PERMISSION_CODES } from '@tms/contracts';
import { resetTestDatabase, testDatabaseUrl } from '../../src/testing';

jest.setTimeout(120_000);

const CLI = resolve(__dirname, '../../dist/cli/sync-permissions.js');
// A cwd without a `.env`, so the CLI's guarded load cannot pick up a developer's local file.
const cwd = mkdtempSync(join(tmpdir(), 'tms-sync-cli-'));

function run(url: string | undefined) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env['DATABASE_URL'];
  if (url) env['DATABASE_URL'] = url;
  return spawnSync(process.execPath, [CLI], { cwd, env, encoding: 'utf8' });
}
const lastJsonLine = (stdout: string): Record<string, unknown> =>
  JSON.parse(stdout.trim().split('\n').at(-1)!) as Record<string, unknown>;

describe('tms-sync-permissions CLI', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('syncs on the first run and reports an empty second run', () => {
    const first = run(testDatabaseUrl());
    expect(first.stderr).toBe('');
    expect(first.status).toBe(0);
    const report = lastJsonLine(first.stdout);
    expect(report['event']).toBe('permissions.synced');
    expect([...(report['inserted'] as string[])].sort()).toEqual([...PERMISSION_CODES].sort());

    const second = run(testDatabaseUrl());
    expect(second.status).toBe(0);
    expect(lastJsonLine(second.stdout)).toEqual({
      event: 'permissions.synced',
      inserted: [],
      regrouped: [],
      reactivated: [],
      renamed: [],
      lockedRoleGrants: [],
      deprecated: [],
      deleted: [],
    });
  });

  it('exits 2 and names DATABASE_URL when it is missing', () => {
    const result = run(undefined);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('DATABASE_URL is not set');
    expect(result.stdout).toBe('');
  });

  it('exits 1 on a wrong password without echoing it', () => {
    const url = new URL(testDatabaseUrl());
    url.password = 'not-the-password-7f3a';
    const result = run(url.toString());
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^permission sync failed: \w+: /);
    expect(result.stderr).not.toContain('not-the-password-7f3a');
    expect(result.stdout).toBe('');
  });
});
