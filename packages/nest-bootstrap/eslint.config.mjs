import { nodeConfig } from '@tms/config/eslint/node';

export default [
  ...nodeConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    // Apps import this subpath as the very first module (instrument.ts), before Nest is loaded.
    files: ['src/sentry/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@nestjs/*', '@sentry/nestjs/setup'],
              message: 'src/sentry must stay Nest-free: instrument.ts loads it before Nest.',
            },
          ],
        },
      ],
    },
  },
];
