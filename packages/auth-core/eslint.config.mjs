import { nodeConfig } from '@tms/config/eslint/node';

export default [
  ...nodeConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ['**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@nestjs/*', '@prisma/*', 'prisma', '@tms/*'],
              message:
                'auth-core stays Nest-free, Prisma-free and imports no workspace package (spec section 3)',
            },
          ],
        },
      ],
    },
  },
];
