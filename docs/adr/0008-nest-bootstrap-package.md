# ADR-0008: Shared Nest bootstrap package (`@tms/nest-bootstrap`)

- Status: accepted
- Date: 2026-09-23
- Spec reference: sections 3, 5, 6 and 11; D5, D14

## Context

Both APIs need the same process-level setup: a validated environment before Nest starts, the `/api`
prefix, shutdown hooks and nestjs-pino as Nest's logger with rolling files (D14); within phase 1
also `/api/health` (D5) and Sentry (section 11). Phase 0 kept this inside each app (`src/app.ts`,
`src/config/env.ts`), duplicated line for line, and the phase 0 final review asked where the shared
bootstrap should live before phase 1 adds three more pieces to it. Section 6 has no such package:
`logger` is the pino configuration only, and `domain/shared` is the service layer that `api-driver`
imports next to `domain/checkin`.

## Decision

A CommonJS workspace package `@tms/nest-bootstrap` (`packages/nest-bootstrap`) owns everything
process-level that both APIs share: `createEnvSchema` and `loadEnv` (zod, parsed before Nest starts;
no `@nestjs/config`), `configureApp`, `bootstrapApi` (the whole `main.ts`) and
`CoreModule.forRoot({ app, env })` (the logger now; the Prisma client and `HealthModule`, and the
Sentry module and filter plus a Nest-free `@tms/nest-bootstrap/sentry` subpath, join later).
Each app is `main.ts` plus an `AppModule.forRoot(env)` importing `CoreModule` and its feature
modules. ESLint boundaries gain the element `bootstrap`: it may import `contracts`, `db` and
`logger`; the API apps (element `api`) may import it; no package and no web app may. It never imports `domain`, so `api-driver`'s
restriction to `@tms/domain/checkin` and `@tms/domain/shared` keeps its meaning. `@nestjs/*`,
`reflect-metadata` and `rxjs` are peer dependencies, so each process holds one copy of Nest (the
hygiene single-copy check).

## Alternatives considered

- Keep the setup in each app (phase 0): every variable, health rule and Sentry option written twice,
  drifting apart, and tested twice through the apps' e2e specs.
- Put it into `@tms/logger` or `@tms/domain/shared`: the logger would depend on `db` (health) and
  Sentry; `domain` would own ports, prefixes and health, which are not business logic. Both would
  work technically, but the dependency rule would stop describing what each package is for.
- `@nestjs/config` (`ConfigModule`): validates after Nest has started and hands values out only
  through DI, while `main.ts` needs `PORT` and the log settings before the container exists.
- One Nest application with two entry points: contradicts ADR-0001 (two deployables, module-level
  isolation of the kiosk API).

## Consequences

- Both APIs boot identically; a new shared variable is one entry of `baseEnvSchema` in one file.
- One more package in the build graph (`contracts`, `logger` → `nest-bootstrap` → apps) and one more
  boundaries element, enforced for `@tms/*` specifiers by the typescript resolver.
- Tests build apps with `Test.createTestingModule({ imports: [AppModule.forRoot(env)] })` plus
  `configureApp`, the production code path except `listen`.
- A change to `CoreModule` changes both APIs at once; its tests live in the package, the apps keep
  only their own contract (default port, JSON 404, `/api` prefix, request id).
