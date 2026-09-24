import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const PACKAGE_ROOT = resolve(__dirname, '..');
// Built by turbo's @tms/nest-bootstrap#build, which @tms/nest-bootstrap#test depends on (turbo.json).
const DIST = resolve(PACKAGE_ROOT, 'dist', 'index.js');
const MAIN = [
  "require('reflect-metadata');",
  `const { bootstrapApi, createEnvSchema } = require(${JSON.stringify(DIST)});`,
  "void bootstrapApi({ name: 'api-admin', envSchema: createEnvSchema({ defaultPort: 3001 }),",
  "  module: () => { throw new Error('the module factory ran'); } });",
].join('\n');

function runMain(env: Record<string, string>) {
  // cwd = the package, so `-e` resolves reflect-metadata from its node_modules.
  return spawnSync(process.execPath, ['-e', MAIN], {
    cwd: PACKAGE_ROOT,
    env: { PATH: process.env['PATH'] ?? '', ...env },
    encoding: 'utf8',
    timeout: 20_000,
  });
}

describe('bootstrapApi in a real Node process', () => {
  it.each<[string, string]>([
    ['abc', 'PORT: Invalid input: expected number, received NaN'],
    // 0 would make Node pick a random port; the schema refuses it before listen().
    ['0', 'PORT: Too small: expected number to be >=1'],
  ])('PORT=%s exits 1 with one stderr line, no stack trace and no module built', (port, detail) => {
    const result = runMain({ PORT: port });
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(`api-admin: Invalid environment: ${detail}\n`);
    expect(result.stdout).toBe('');
  });
});
