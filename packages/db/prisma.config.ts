import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// DATABASE_URL: required by migrate/introspection commands, optional for validate/generate.
const url = process.env['DATABASE_URL'];

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  ...(url ? { datasource: { url } } : {}),
});
