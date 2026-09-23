import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig } from 'eslint/config';
import { baseConfig } from './base.mjs';

/** @param {{ tsconfigRootDir: string }} options */
export function reactConfig({ tsconfigRootDir }) {
  return defineConfig([
    ...baseConfig({ tsconfigRootDir }),
    {
      files: ['**/*.{ts,tsx}'],
      languageOptions: { globals: globals.browser },
      extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    },
  ]);
}
