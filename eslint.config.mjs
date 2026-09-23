import { globalIgnores } from 'eslint/config';
import { nodeConfig } from './packages/config/eslint/node.mjs';

export default [
  globalIgnores(['apps/**', 'packages/**', 'e2e/**', 'tools/**']),
  ...nodeConfig({ tsconfigRootDir: import.meta.dirname }),
];
