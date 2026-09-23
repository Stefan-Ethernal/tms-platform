import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { nodeConfig } from '../eslint/node.mjs';

const fixtures = path.join(import.meta.dirname, 'fixtures');

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
  return result.messages.map((m) => m.ruleId);
}

describe('dependency rule contracts <- db <- domain <- apps', () => {
  it('forbids db importing domain', async () => {
    const ids = await lint(
      'packages/db/src/x.ts',
      `import { domain } from '../../domain/src/index';\nexport { domain };\n`,
    );
    expect(ids).toContain('boundaries/element-types');
  });

  it('allows domain importing db and contracts', async () => {
    const ids = await lint(
      'packages/domain/src/y.ts',
      `import { db } from '../../db/src/index';\nimport { contracts } from '../../contracts/src/index';\nexport { db, contracts };\n`,
    );
    expect(ids).not.toContain('boundaries/element-types');
  });

  it('forbids contracts importing anything internal', async () => {
    const ids = await lint(
      'packages/contracts/src/z.ts',
      `import { db } from '../../db/src/index';\nexport { db };\n`,
    );
    expect(ids).toContain('boundaries/element-types');
  });
});
