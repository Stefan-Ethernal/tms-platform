import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// DATABASE_URL: required by migrate/introspection commands, optional for validate/generate.
const url = process.env['DATABASE_URL'];

export default defineConfig({
  schema: 'prisma/schema.prisma',
  // `prisma db seed` runs the built seed CLI; predev and the migrate image call the same file.
  migrations: { path: 'prisma/migrations', seed: 'node dist/cli/seed.js' },
  ...(url ? { datasource: { url } } : {}),
});
