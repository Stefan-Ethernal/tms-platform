import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { nodeConfig } from '../eslint/node.mjs';

const fixtures = path.join(import.meta.dirname, 'fixtures');
const originalCwd = process.cwd();

afterAll(() => {
  process.chdir(originalCwd);
});

// eslint-plugin-boundaries prints each deprecation warning once per process through console.warn,
// so the spy is installed before the first lint run of this file.
const warnings = [];
vi.spyOn(console, 'warn').mockImplementation((...args) => {
  warnings.push(args.join(' '));
});

/**
 * Lints `source` as the fixture file `relFile` (`<packages|apps>/<name>/src/<file>`) the way a real
 * `eslint .` run does: turbo runs each package's lint script inside that package, so the process
 * cwd is the package directory, not a directory that happens to contain every fixture. That is
 * what makes `boundaries/root-path` load-bearing (the plugin's default root is the process cwd).
 */
async function lint(relFile, source) {
  const packageDir = path.join(fixtures, path.dirname(path.dirname(relFile)));
  process.chdir(packageDir);
  const eslint = new ESLint({
    cwd: packageDir,
    overrideConfigFile: true,
    overrideConfig: [
      ...nodeConfig({ tsconfigRootDir: fixtures, boundariesRootPath: fixtures }),
      tseslint.configs.disableTypeChecked,
    ],
  });
  const [result] = await eslint.lintText(source, { filePath: path.join(fixtures, relFile) });
  return result.messages;
}

/** Messages that fail a real run: the given rule at severity 2 ("error"), not a warning. */
const errors = (messages, ruleId) =>
  messages.filter((m) => m.ruleId === ruleId && m.severity === 2);

/** One fixture package per element type of `boundaries/elements` in eslint/base.mjs. */
const elements = {
  contracts: 'packages/contracts',
  db: 'packages/db',
  'auth-core': 'packages/auth-core',
  logger: 'packages/logger',
  domain: 'packages/domain',
  ui: 'packages/ui',
  bootstrap: 'packages/nest-bootstrap',
  api: 'apps/api-admin',
  web: 'apps/web-admin',
};

/**
 * Spec section 3 (contracts <- db <- domain <- apps) with the phase 1 `bootstrap` element and apps
 * split into `api` and `web`: which element types each type may import.
 */
const allowed = {
  contracts: [],
  db: ['contracts'],
  'auth-core': ['contracts'],
  logger: ['contracts'],
  domain: ['contracts', 'db', 'auth-core', 'logger'],
  ui: ['contracts'],
  bootstrap: ['contracts', 'db', 'logger'],
  api: ['contracts', 'db', 'auth-core', 'logger', 'domain', 'bootstrap'],
  web: ['contracts', 'ui'],
};

/** The full 9x9 matrix; the diagonal is an import inside the same package, always allowed. */
const matrix = Object.keys(elements).flatMap((from) =>
  Object.keys(elements).map((to) => ({
    from,
    to,
    verdict: from === to || allowed[from].includes(to) ? 'allows' : 'forbids',
  })),
);

describe('dependency rule contracts <- db <- domain <- apps', () => {
  it('forbids db importing domain', async () => {
    const messages = await lint(
      'packages/db/src/x.ts',
      `import { domain } from '../../domain/src/index';\nexport { domain };\n`,
    );
    expect(errors(messages, 'boundaries/dependencies').map((m) => m.message)).toEqual([
      'db may not import domain (dependency rule contracts <- db <- domain <- apps)',
    ]);
  });

  it('forbids a web app importing db, naming the web element', async () => {
    const messages = await lint(
      'apps/web-admin/src/x.ts',
      `import { db } from '../../../packages/db/src/index';\nexport { db };\n`,
    );
    expect(errors(messages, 'boundaries/dependencies').map((m) => m.message)).toEqual([
      'web may not import db (dependency rule contracts <- db <- domain <- apps)',
    ]);
  });

  it.each(matrix)('$verdict $from importing $to', async ({ from, to, verdict }) => {
    const fromSrc = path.join(fixtures, elements[from], 'src');
    const target =
      from === to
        ? './index'
        : path.relative(fromSrc, path.join(fixtures, elements[to], 'src', 'index'));
    const messages = await lint(
      `${elements[from]}/src/matrix.ts`,
      `import * as target from '${target}';\nexport { target };\n`,
    );
    expect(errors(messages, 'boundaries/dependencies')).toHaveLength(verdict === 'forbids' ? 1 : 0);
  });

  it('configures the plugin without deprecation warnings', async () => {
    await lint(
      'packages/db/src/w.ts',
      `import { contracts } from '../../contracts/src/index';\nexport { contracts };\n`,
    );
    expect(warnings.filter((w) => w.includes('[boundaries]'))).toEqual([]);
  });
});
