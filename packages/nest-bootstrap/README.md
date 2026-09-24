# @tms/nest-bootstrap

Process-level setup both NestJS APIs share, so each app stays at `main.ts` plus its `AppModule`
(ADR-0008):

- `createEnvSchema({ defaultPort })`, `loadEnv(schema, source)` — the zod-validated environment,
  parsed before Nest starts (`NODE_ENV`, `PORT`, `HOST`, `LOG_*`); `listenHost(env)` — 127.0.0.1 in
  development, 0.0.0.0 otherwise, unless `HOST` is set.
- `CoreModule.forRoot({ app, env })` — the logger from `@tms/logger`; the database connection and
  health check, and Sentry, join here once they exist.
- `configureApp(app)` — pino as Nest's logger, `/api` prefix, shutdown hooks; e2e tests call it too.
- `bootstrapApi({ name, envSchema, module })` — the whole `main.ts`.
