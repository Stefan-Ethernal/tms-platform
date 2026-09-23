import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { nodeConfig } from '../eslint/node.mjs';

const fixtures = path.join(import.meta.dirname, 'fixtures');

// eslint-plugin-boundaries prints each deprecation warning once per process through console.warn,
// so the spy is installed before the first lint run of this file.
const warnings = [];
vi.spyOn(console, 'warn').mockImplementation((...args) => {
  warnings.push(args.join(' '));
});

async function lint(relFile, source) {
  const eslint = new ESLint({
    cwd: fixtures,
    overrideConfigFile: true,
    overrideConfig: [
      ...nodeConfig({ tsconfigRootDir: fixtures, boundariesRootPath: fixtures }),
      tseslint.configs.disableTypeChecked,
    ],
  });
  const [result] = await eslint.lintText(source, { filePath: path.join(fixtures, relFile) });
  return result.messages;
}

const ruleIds = (messages) => messages.map((m) => m.ruleId);

describe('dependency rule contracts <- db <- domain <- apps', () => {
  it('forbids db importing domain', async () => {
    const messages = await lint(
      'packages/db/src/x.ts',
      `import { domain } from '../../domain/src/index';\nexport { domain };\n`,
    );
    expect(ruleIds(messages)).toContain('boundaries/dependencies');
    expect(messages.map((m) => m.message)).toContain(
      'db may not import domain (dependency rule contracts <- db <- domain <- apps)',
    );
  });

  it('allows domain importing db and contracts', async () => {
    const messages = await lint(
      'packages/domain/src/y.ts',
      `import { db } from '../../db/src/index';\nimport { contracts } from '../../contracts/src/index';\nexport { db, contracts };\n`,
    );
    expect(ruleIds(messages)).not.toContain('boundaries/dependencies');
  });

  it('forbids contracts importing anything internal', async () => {
    const messages = await lint(
      'packages/contracts/src/z.ts',
      `import { db } from '../../db/src/index';\nexport { db };\n`,
    );
    expect(ruleIds(messages)).toContain('boundaries/dependencies');
  });

  it('configures the plugin without deprecation warnings', async () => {
    await lint(
      'packages/db/src/w.ts',
      `import { contracts } from '../../contracts/src/index';\nexport { contracts };\n`,
    );
    expect(warnings.filter((w) => w.includes('[boundaries]'))).toEqual([]);
  });
});
