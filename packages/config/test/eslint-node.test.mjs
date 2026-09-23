import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { nodeConfig } from '../eslint/node.mjs';

async function lint(source, { allowedDomainSubpaths } = {}) {
  const eslint = new ESLint({
    cwd: import.meta.dirname,
    overrideConfigFile: true,
    overrideConfig: [
      ...nodeConfig({ tsconfigRootDir: import.meta.dirname, allowedDomainSubpaths }),
      // Type-aware rules need a TS project; the rule under test is specifier based.
      tseslint.configs.disableTypeChecked,
    ],
  });
  const [result] = await eslint.lintText(source, { filePath: 'src/example.ts' });
  return result.messages.map((m) => m.ruleId);
}

describe('nodeConfig allowedDomainSubpaths', () => {
  const restricted = { allowedDomainSubpaths: ['checkin', 'shared'] };

  it('rejects @tms/domain/admin when only checkin and shared are allowed', async () => {
    expect(await lint(`import { x } from '@tms/domain/admin';\nexport { x };\n`, restricted)).toContain(
      'no-restricted-imports',
    );
  });

  it('rejects the root @tms/domain export', async () => {
    expect(await lint(`import { x } from '@tms/domain';\nexport { x };\n`, restricted)).toContain(
      'no-restricted-imports',
    );
  });

  it('allows @tms/domain/checkin and @tms/domain/shared', async () => {
    const ids = await lint(
      `import { a } from '@tms/domain/checkin';\nimport { b } from '@tms/domain/shared';\nexport { a, b };\n`,
      restricted,
    );
    expect(ids).not.toContain('no-restricted-imports');
  });

  it('does not restrict @tms/domain when no subpaths are given', async () => {
    expect(await lint(`import { x } from '@tms/domain/admin';\nexport { x };\n`)).not.toContain(
      'no-restricted-imports',
    );
  });
});
