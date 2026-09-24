import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/** Package that ships the Testcontainers harness (`@tms/db/testing`). */
export const HARNESS_PACKAGE = '@tms/db';

/**
 * Whether `CI` marks a CI run. Unset, `''`, `'0'` and `'false'` (case-insensitive) are not CI;
 * everything else (including `'1'` and `'true'`) is.
 */
function isCi() {
  const value = (process.env['CI'] ?? '').toLowerCase();
  return value !== '' && value !== '0' && value !== 'false';
}

/**
 * Jest configuration for NestJS apps and CommonJS libraries (the Nest 12 template plus the
 * interop settings the workspace needs). Run with
 * `NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' jest`:
 * `@nestjs/*` and `@tms/contracts` ship ESM, which jest-runtime 30 loads through `require(esm)`.
 *
 * @param {{ rootDir: string, database?: boolean }} options
 *   `database: true` adds the Testcontainers harness (one Postgres per run, one database per
 *   worker); the package needs `"@tms/db": "workspace:*"` among its (dev)dependencies.
 * @returns {import('jest').Config}
 */
export function createJestConfig({ rootDir, database = false }) {
  const config = {
    rootDir,
    moduleFileExtensions: ['js', 'json', 'ts'],
    testEnvironment: 'node',
    testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
    // Jest 30 resolves through unrs-resolver, which has no `.js` -> `.ts` fallback; CommonJS
    // packages write extensionless relative imports, this maps any `.js` suffix that slips in.
    moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
    transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
    // Workspace packages are consumed from their compiled dist/; transforming it again only costs
    // time (spike: 6.2 s instead of 1.4 s).
    transformIgnorePatterns: ['/node_modules/', '/packages/[^/]+/dist/'],
    maxWorkers: isCi() ? 2 : '50%',
    collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/instrument.ts'],
    coverageDirectory: '<rootDir>/coverage',
  };
  return database ? { ...config, ...databaseHarness(rootDir), testTimeout: 30_000 } : config;
}

/** @param {string} rootDir */
function databaseHarness(rootDir) {
  const manifestPath = path.join(rootDir, 'package.json');
  const { name } = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (name === HARNESS_PACKAGE) {
    // The harness package tests its own sources: its dist/ does not exist before `build`.
    return {
      globalSetup: '<rootDir>/src/testing/global-setup.ts',
      globalTeardown: '<rootDir>/src/testing/global-teardown.ts',
    };
  }
  // Resolve from the consuming package (its dependency on @tms/db), not from packages/config.
  const requireFromPackage = createRequire(manifestPath);
  try {
    return {
      globalSetup: requireFromPackage.resolve(`${HARNESS_PACKAGE}/testing/jest-global-setup`),
      globalTeardown: requireFromPackage.resolve(`${HARNESS_PACKAGE}/testing/jest-global-teardown`),
    };
  } catch (error) {
    throw new Error(
      `createJestConfig({ database: true }) needs "${HARNESS_PACKAGE}": "workspace:*" among the ` +
        `dependencies of ${manifestPath} and a built ${HARNESS_PACKAGE} (turbo runs ^build first)`,
      { cause: error },
    );
  }
}
