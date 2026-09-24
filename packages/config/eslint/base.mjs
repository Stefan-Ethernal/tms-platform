import { createRequire } from 'node:module';
import path from 'node:path';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';

/** Repository root, derived from this file's real location (packages/config/eslint). */
export const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');

// eslint-module-utils loads resolvers by require() from the linted file's location, then from its
// own pnpm virtual-store path; neither can see packages/config/node_modules, so the resolver is
// passed by absolute path.
const tsResolver = createRequire(import.meta.url).resolve('eslint-import-resolver-typescript');

export const ignores = globalIgnores([
  '**/dist/**',
  '**/coverage/**',
  '**/node_modules/**',
  '**/generated/**',
  '**/.turbo/**',
  '**/playwright-report/**',
  '**/test-results/**',
  '**/public/mockServiceWorker.js',
]);

/**
 * Dependency rule from the spec (section 3): contracts <- db <- domain <- apps, plus
 * contracts, db, logger <- bootstrap <- api for the shared Nest bootstrap (phase 1 plan). Apps are
 * two element types: `api` (NestJS, apps/api-*) and `web` (React SPAs, apps/web-*).
 * eslint-plugin-boundaries v7: element patterns are folder patterns (no file part), and
 * `capture` names one entry per wildcard. Paths are matched relative to `rootPath`, so the same
 * configuration works when eslint runs inside any workspace package.
 *
 * @param {string} rootPath repository root (or a fixtures root in tests)
 */
export function boundariesConfig(rootPath) {
  return {
    plugins: { boundaries },
    settings: {
      // eslint-import-resolver-typescript (unrs-resolver) reads package.json `exports` and
      // realpaths pnpm's node_modules symlinks, so an `@tms/*` specifier resolves to the imported
      // package's own files and counts as a local dependency. It replaces the node resolver
      // instead of joining it: ESLint deep-merges settings, the node resolver would be tried
      // first, and its un-realpathed node_modules path makes the plugin treat the import as
      // external, i.e. unchecked.
      'import/resolver': { [tsResolver]: {} },
      'boundaries/root-path': rootPath,
      'boundaries/elements': [
        { type: 'contracts', pattern: 'packages/contracts' },
        { type: 'db', pattern: 'packages/db' },
        { type: 'auth-core', pattern: 'packages/auth-core' },
        { type: 'logger', pattern: 'packages/logger' },
        { type: 'domain', pattern: 'packages/domain' },
        { type: 'ui', pattern: 'packages/ui' },
        { type: 'bootstrap', pattern: 'packages/nest-bootstrap' },
        { type: 'api', pattern: 'apps/api-*', capture: ['name'] },
        { type: 'web', pattern: 'apps/web-*', capture: ['name'] },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          message:
            '{{from.type}} may not import {{to.type}} (dependency rule contracts <- db <- domain <- apps)',
          policies: [
            policy('db', ['contracts']),
            policy('auth-core', ['contracts']),
            policy('logger', ['contracts']),
            policy('domain', ['contracts', 'db', 'auth-core', 'logger']),
            policy('ui', ['contracts']),
            policy('bootstrap', ['contracts', 'db', 'logger']),
            policy('api', ['contracts', 'db', 'auth-core', 'logger', 'domain', 'bootstrap']),
            policy('web', ['contracts', 'ui']),
          ],
        },
      ],
    },
  };
}

/**
 * One `boundaries/dependencies` policy in the v7 entity-selector form: files of element type
 * `from` may import files of each element type in `allowed`.
 *
 * @param {string} from
 * @param {string[]} allowed
 */
function policy(from, allowed) {
  return {
    from: { element: { type: from } },
    allow: allowed.map((type) => ({ to: { element: { type } } })),
  };
}

/**
 * @param {{ tsconfigRootDir: string, boundariesRootPath?: string }} options
 */
export function baseConfig({ tsconfigRootDir, boundariesRootPath = repoRoot }) {
  return defineConfig([
    ignores,
    js.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { fixStyle: 'inline-type-imports' },
        ],
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      },
    },
    { files: ['**/*.{js,mjs,cjs}'], extends: [tseslint.configs.disableTypeChecked] },
    boundariesConfig(boundariesRootPath),
    prettier,
  ]);
}
