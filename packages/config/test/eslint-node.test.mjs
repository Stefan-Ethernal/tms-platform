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
  // Only severity 2 fails a real run (no lint script passes --max-warnings 0).
  return result.messages.filter((m) => m.ruleId === 'no-restricted-imports' && m.severity === 2);
}

describe('nodeConfig allowedDomainSubpaths', () => {
  const restricted = { allowedDomainSubpaths: ['checkin', 'shared'] };

  it('rejects @tms/domain/admin when only checkin and shared are allowed', async () => {
    expect(
      await lint(`import { x } from '@tms/domain/admin';\nexport { x };\n`, restricted),
    ).toHaveLength(1);
  });

  it('rejects the root @tms/domain export', async () => {
    expect(
      await lint(`import { x } from '@tms/domain';\nexport { x };\n`, restricted),
    ).toHaveLength(1);
  });

  it('allows @tms/domain/checkin and @tms/domain/shared', async () => {
    const errors = await lint(
      `import { a } from '@tms/domain/checkin';\nimport { b } from '@tms/domain/shared';\nexport { a, b };\n`,
      restricted,
    );
    expect(errors).toEqual([]);
  });

  it('does not restrict @tms/domain when no subpaths are given', async () => {
    expect(await lint(`import { x } from '@tms/domain/admin';\nexport { x };\n`)).toEqual([]);
  });
});
