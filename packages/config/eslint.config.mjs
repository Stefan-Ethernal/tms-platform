import { globalIgnores } from 'eslint/config';
import { nodeConfig } from './eslint/node.mjs';

export default [
  // The boundaries-fixture .ts files exist only so eslint-plugin-boundaries can resolve relative
  // imports in test/eslint-boundaries.test.mjs; they are fed to ESLint in-memory via
  // `overrideConfigFile: true` there and are not part of this package's own TS project, so the
  // type-aware project service cannot (and does not need to) parse them here.
  globalIgnores(['test/fixtures/**']),
  ...nodeConfig({ tsconfigRootDir: import.meta.dirname }),
];
