# @tms/db

Prisma schema, migrations and database access for the TMS platform (CommonJS). Run the database
scripts through turbo, which passes `DATABASE_URL` through, e.g.
`pnpm turbo run db:migrate:deploy --filter=@tms/db` (likewise `db:validate`, `db:migrate:status`,
`db:drift` and `db:migrate:dev -- --name <change>`).

`@tms/db/testing` is the Testcontainers harness for Jest.
`createJestConfig({ rootDir, database: true })` from `@tms/config/jest` wires its globalSetup and
globalTeardown: one Postgres container per run, `tms_template` migrated once, one clone per Jest
worker. Tests use `testDatabaseUrl()`, `resetTestDatabase()` (in `beforeEach`) and
`withAdminClient(fn)`; they never read `DATABASE_URL`. Docker must be running.

The Prisma client is generated into `src/generated/prisma` (gitignored) by `pnpm turbo run generate --filter=@tms/db`;
`lint`, `typecheck`, `test` and `build` depend on that task, so a clean checkout needs no manual step.
Applications obtain a client only through `createPrismaClient({ url })` from `@tms/db`.
Row builders for tests (`makeRole`, `makeStaffUser`, …) come from `@tms/db/testing`; only tests import that subpath.

The Prisma CLI (`prisma`) is an **optional** dependency. `pnpm install` installs it (development,
CI, the `migrate` image built with `pnpm deploy --prod`), while the API images deploy with
`--no-optional` and ship only `@prisma/client`, the driver adapter and `pg`. Nothing under `src/`
may import `prisma` at runtime; only `prisma.config.ts` and the `dev-setup` CLI (local `predev`) use it.
