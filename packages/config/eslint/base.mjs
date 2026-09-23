import path from 'node:path';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';

/** Repository root, derived from this file's real location (packages/config/eslint). */
export const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');

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
 * Dependency rule from the spec (section 3): contracts <- db <- domain <- apps.
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
      // eslint-plugin-boundaries resolves relative import specifiers through
      // eslint-import-resolver-node, whose default extensions are .js/.json/.node; without .ts
      // here it cannot resolve extensionless relative imports and silently reports no dependency.
      'import/resolver': { node: { extensions: ['.js', '.json', '.ts', '.tsx'] } },
      'boundaries/root-path': rootPath,
      'boundaries/elements': [
        { type: 'contracts', pattern: 'packages/contracts' },
        { type: 'db', pattern: 'packages/db' },
        { type: 'auth-core', pattern: 'packages/auth-core' },
        { type: 'logger', pattern: 'packages/logger' },
        { type: 'domain', pattern: 'packages/domain' },
        { type: 'ui', pattern: 'packages/ui' },
        { type: 'app', pattern: 'apps/*', capture: ['app'] },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          message: '${file.type} may not import ${dependency.type} (dependency rule contracts <- db <- domain <- apps)',
          rules: [
            { from: 'db', allow: ['contracts'] },
            { from: 'auth-core', allow: ['contracts'] },
            { from: 'logger', allow: ['contracts'] },
            { from: 'domain', allow: ['contracts', 'db', 'auth-core', 'logger'] },
            { from: 'ui', allow: ['contracts'] },
            { from: 'app', allow: ['contracts', 'db', 'auth-core', 'logger', 'domain', 'ui'] },
          ],
        },
      ],
    },
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
        '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      },
    },
    { files: ['**/*.{js,mjs,cjs}'], extends: [tseslint.configs.disableTypeChecked] },
    boundariesConfig(boundariesRootPath),
    prettier,
  ]);
}
