import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createJestConfig } from '../jest/create-config.mjs';

const savedCi = process.env.CI;
beforeEach(() => {
  delete process.env.CI;
});
afterEach(() => {
  if (savedCi === undefined) delete process.env.CI;
  else process.env.CI = savedCi;
});

/** A consumer package linked to a built @tms/db the way pnpm links workspace:* dependencies. */
function createWorkspace() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tms-jest-preset-')));
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  };
  write(
    'packages/db/package.json',
    JSON.stringify({
      name: '@tms/db',
      type: 'commonjs',
      exports: {
        './testing/jest-global-setup': './dist/testing/global-setup.js',
        './testing/jest-global-teardown': './dist/testing/global-teardown.js',
      },
    }),
  );
  write('packages/db/dist/testing/global-setup.js', 'module.exports = async () => {};\n');
  write('packages/db/dist/testing/global-teardown.js', 'module.exports = async () => {};\n');
  write('apps/api/package.json', JSON.stringify({ name: '@tms/api', private: true }));
  write('apps/plain/package.json', JSON.stringify({ name: '@tms/plain', private: true }));
  fs.mkdirSync(path.join(root, 'apps/api/node_modules/@tms'), { recursive: true });
  fs.symlinkSync(
    '../../../../packages/db',
    path.join(root, 'apps/api/node_modules/@tms/db'),
    'dir',
  );
  return root;
}

let ws;
beforeAll(() => {
  ws = createWorkspace();
});
afterAll(() => {
  fs.rmSync(ws, { recursive: true, force: true });
});

describe('createJestConfig', () => {
  it('returns the Nest 12 template settings plus the workspace interop options', () => {
    expect(createJestConfig({ rootDir: '/repo/apps/api-admin' })).toEqual({
      rootDir: '/repo/apps/api-admin',
      moduleFileExtensions: ['js', 'json', 'ts'],
      testEnvironment: 'node',
      testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
      moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
      transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
      transformIgnorePatterns: ['/node_modules/', '/packages/[^/]+/dist/'],
      maxWorkers: '50%',
      collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/instrument.ts'],
      coverageDirectory: '<rootDir>/coverage',
    });
  });

  it('uses two workers when CI is set', () => {
    process.env.CI = 'true';
    expect(createJestConfig({ rootDir: '/repo/apps/api-admin' }).maxWorkers).toBe(2);
  });

  it.each([['false'], ['0']])('treats CI=%s as not CI', (value) => {
    process.env.CI = value;
    expect(createJestConfig({ rootDir: '/repo/apps/api-admin' }).maxWorkers).toBe('50%');
  });

  it('treats an unset CI as not CI', () => {
    delete process.env.CI;
    expect(createJestConfig({ rootDir: '/repo/apps/api-admin' }).maxWorkers).toBe('50%');
  });

  it('maps .js-suffixed relative specifiers to extensionless ones and nothing else', () => {
    const [[pattern, replacement]] = Object.entries(
      createJestConfig({ rootDir: '/r' }).moduleNameMapper,
    );
    const map = (specifier) => specifier.replace(new RegExp(pattern), replacement);
    expect(map('./permissions.js')).toBe('./permissions');
    expect(map('../audit/index.js')).toBe('../audit/index');
    expect(new RegExp(pattern).test('@tms/contracts')).toBe(false);
    expect(new RegExp(pattern).test('./data.json')).toBe(false);
  });

  it('never transforms node_modules or the dist/ of a workspace package', () => {
    const patterns = createJestConfig({ rootDir: '/r' }).transformIgnorePatterns.map(
      (p) => new RegExp(p),
    );
    const ignored = (file) => patterns.some((p) => p.test(file));
    expect(ignored('/repo/node_modules/.pnpm/zod@4.6.5/node_modules/zod/index.js')).toBe(true);
    expect(ignored('/repo/packages/contracts/dist/index.js')).toBe(true);
    expect(ignored('/repo/packages/db/src/testing/index.ts')).toBe(false);
    expect(ignored('/repo/apps/api-admin/src/app.ts')).toBe(false);
  });

  it('database: true in a consumer resolves the compiled harness through @tms/db exports', () => {
    const config = createJestConfig({ rootDir: path.join(ws, 'apps/api'), database: true });
    expect(config.globalSetup).toBe(path.join(ws, 'packages/db/dist/testing/global-setup.js'));
    expect(config.globalTeardown).toBe(
      path.join(ws, 'packages/db/dist/testing/global-teardown.js'),
    );
    expect(config.testTimeout).toBe(30_000);
  });

  it('database: true inside @tms/db uses the harness sources', () => {
    const config = createJestConfig({ rootDir: path.join(ws, 'packages/db'), database: true });
    expect(config.globalSetup).toBe('<rootDir>/src/testing/global-setup.ts');
    expect(config.globalTeardown).toBe('<rootDir>/src/testing/global-teardown.ts');
    expect(config.testTimeout).toBe(30_000);
  });

  it('database: true without a dependency on @tms/db names what is missing', () => {
    const manifest = path.join(ws, 'apps/plain/package.json');
    expect(() =>
      createJestConfig({ rootDir: path.join(ws, 'apps/plain'), database: true }),
    ).toThrow(
      `createJestConfig({ database: true }) needs "@tms/db": "workspace:*" among the dependencies of ${manifest} and a built @tms/db (turbo runs ^build first)`,
    );
  });
});
