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
