import globals from 'globals';
import { defineConfig } from 'eslint/config';
import { baseConfig } from './base.mjs';

/**
 * ESLint configuration for Node packages and NestJS apps.
 *
 * @param {{ tsconfigRootDir: string, allowedDomainSubpaths?: string[], boundariesRootPath?: string }} options
 *   `allowedDomainSubpaths` restricts imports of `@tms/domain` to the listed subpath
 *   exports (spec section 3: api-driver may import only checkin and shared).
 *   `boundariesRootPath` overrides the repository root for the boundaries plugin (tests only).
 */
export function nodeConfig({ tsconfigRootDir, allowedDomainSubpaths, boundariesRootPath }) {
  const config = [
    ...baseConfig({ tsconfigRootDir, boundariesRootPath }),
    { languageOptions: { globals: globals.node } },
  ];
  if (allowedDomainSubpaths) {
    const message = `This app may import only ${allowedDomainSubpaths
      .map((sub) => `@tms/domain/${sub}`)
      .join(' and ')} (spec section 3).`;
    config.push({
      rules: {
        'no-restricted-imports': [
          'error',
          {
            // `paths` bans the bare specifier by exact string match. `patterns` (glob-based, via
            // the `ignore` package) is used separately for the subpath wildcard: gitignore-style
            // matching cannot re-include a child once its parent directory is excluded, so the
            // bare '@tms/domain' must not appear inside the same glob group as the negated
            // subpaths, or it would also block '@tms/domain/checkin' etc. from being allowed.
            paths: [{ name: '@tms/domain', message }],
            patterns: [
              {
                group: [
                  '@tms/domain/**',
                  ...allowedDomainSubpaths.map((sub) => `!@tms/domain/${sub}`),
                ],
                message,
              },
            ],
          },
        ],
      },
    });
  }
  return defineConfig(config);
}
