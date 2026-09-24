# Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the foundation every later phase builds on: the `contracts` package (enums, permission catalogue, seeded roles, audit actions, scrub list), the complete Prisma data model with migrations, an idempotent seed with the INVITED bootstrap admin, the permission-catalogue sync, a Testcontainers test harness, the `logger` package (redaction, request id, rolling files), the shared Nest bootstrap (`nest-bootstrap`: typed env, `/api/health`, Sentry disabled without a DSN), `domain/shared` (transactions, `AuditService`, `Clock`, `MailSender` port), and a slim `migrate` image that migrates, syncs and seeds — delivered as a stack of small PRs, each green on CI by itself.

**Architecture:** Two CommonJS NestJS apps keep loading ESM-only Nest 12 through Node's `require(esm)`. New Nest-aware libraries (`@tms/db`, `@tms/logger`, `@tms/nest-bootstrap`, `@tms/domain`) are **CommonJS** so dual-build dependencies (`nestjs-cls`, `@nestjs-cls/transactional`, `@sentry/nestjs`) load exactly once per process; only `@tms/contracts` is ESM because the Vite SPAs import it. The Prisma 7 client is generated into `packages/db/src/generated/prisma` (CJS) and used through the `@prisma/adapter-pg` driver adapter. Every database test runs against a Testcontainers Postgres: one template database migrated once, one clone per Jest worker. The permission sync and the seed are pure functions with CLIs in `@tms/db`; the `migrate` one-shot and `predev` run them, never a Nest process (D12). The dependency rule gains a `bootstrap` element (`contracts, db, logger ← bootstrap ← api apps`) and splits the single `app` element into `api` (`apps/api-*`) and `web` (`apps/web-*`, which may import only `contracts` and `ui`); it is now enforced for `@tms/*` specifiers through `eslint-import-resolver-typescript`.

**Tech Stack:** Node 26 (`.nvmrc`, root `engines` `>=26.0.0` since `main` 0d5f4ac; ≥ 24.13 is what `Module.registerHooks` for Sentry 11 and Jest's `require(esm)` need), pnpm 12.5.1, Turborepo 2.11, TypeScript ~7.0.2 in the default catalog (`@tms/contracts`, `e2e`) and ~6.0.3 through `catalog:nest-ts6` for every package that runs ts-jest, the Nest CLI or the compiler API (TS 7.0's `require('typescript')` is only `lib/version.cjs`; typescript-eslint gets TS 6 through `.pnpmfile.cjs`), PostgreSQL 18 (compose and the Testcontainers harness; CI `db-drift` bumped in Task 04), `@types/node` 26, NestJS 12.1, Jest 30.5 + ts-jest 29.4 + supertest 7.3, Vitest 5 (contracts only), Prisma 7.10 (`prisma`, `@prisma/client`, `@prisma/adapter-pg` all pinned 7.10.0; `latest` is an 8 rc), pg 8.23, zod 4.6, nestjs-pino 5.2 + pino 10.3 + pino-http 11 + pino-roll 4, nestjs-cls 7 + @nestjs-cls/transactional 4 + @nestjs-cls/transactional-adapter-prisma 2, @nestjs/terminus 12.1, @sentry/nestjs pinned 11.0.0 (the first release with Nest 12 peers; published 2026-09-23, so pnpm records seven `@sentry/*@11.0.0` lines in `minimumReleaseAgeExclude`; its API replaced `sendDefaultPii` with `dataCollection`), testcontainers + @testcontainers/postgresql 12.1, fast-check 4.10, eslint-import-resolver-typescript 4.4, ESLint 10 + typescript-eslint 8.70 + eslint-plugin-boundaries 7.2, Docker (rootful, `docker run` only in this plan's checks; compose only as project `tms-p1`).

**Spikes (2026-09-23, scratch projects outside the repo, all confirmed):** (S1) CommonJS Nest libraries + ESM `contracts` load once each from the CJS apps under Node 24 and Jest 30.5 (`require(esm)` is native in jest-runtime); `nestjs-cls`, `@nestjs-cls/*` and `zod` are dual builds whose class identities differ between module graphs (`TransactionHost`, `ClsService` — hence CJS for everything that touches them; zod 4 `instanceof` still works through its trait check), `@nestjs/common` is one instance; the Prisma 7 `prisma-client` generator with `moduleFormat = "cjs"` emits no `import.meta` or top-level `await` and compiles under tsc; `pnpm deploy --legacy --prod --no-optional` drops the Prisma CLI from an app tree (128 MB vs 357 MB), `deploy --legacy --prod` of `@tms/db` keeps it (the `migrate` image stays about the size of phase 0, ≈ 760 MB, because the seed ships `@prisma/client`; Task 09 budgets `/app` instead); shared tsconfig presets may set `rootDir`/`outDir` only through TypeScript's `${configDir}` substitution (a plain relative value resolves against the preset file → TS6059 and stray emit; `main` already uses `${configDir}`); `verbatimModuleSyntax` breaks CJS output; `prisma migrate dev` without `--name` hangs on the prompt when there is no TTY. (S2) `eslint-import-resolver-node` never reports `@tms/*` imports (unresolved `exports`, un-realpathed symlinks → "external"); `eslint-import-resolver-typescript` keyed by absolute path and replacing the `import/resolver` setting reports all six specifier cases with the existing messages. (S3) The Testcontainers harness runs in ~5 s (container 2.2 s, `migrate deploy` 1 s, clones 80 ms); pnpm 12 needs `allowBuilds` entries for `ssh2`, `cpu-features`, `protobufjs`; a bogus `DOCKER_HOST` falls back to the socket (only a missing socket fails, in ~3 s, without naming Docker); warm Jest runs collapse both spec files into one worker; `pg` without `connectionTimeoutMillis` hangs indefinitely on a black hole. (S4) nestjs-pino 5 accepts `pinoHttp: [options, stream]`; pino resolves a transport target relative to the caller file; `app.close()` does not flush pino-roll, `transport.end()` + `close` does; pino-roll size rotation is chunk-granular; Sentry 11 boots silently with an empty DSN, `SentryGlobalFilter` keeps the 404 body, `beforeSend` sees `event.request.headers`, Jest needs `enableRuntimeChannelInjection: false`; terminus `HealthCheckService` cannot produce the D5 body — `HealthIndicatorService` can. Reports: `.superpowers/` is gitignored, so the spike reports stay outside the repository; their conclusions are inlined in the tasks as `Spike note` lines.

**Toolchain drift after the spikes:** the spikes ran on Node 24.21 and TypeScript 6.0.3; `main` moved to Node 26, TypeScript 7 (`nest-ts6` for compiler-API users) and Postgres 18 (0d5f4ac). The first task that relies on a spike fact re-runs it on Node 26 and records any difference in its journal row: 02 (presets, resolver), 04 (harness on Postgres 18), 07 (`process.loadEnvFile`), 10 (pino worker transports), 11 (`require(esm)` without warnings), 13 (Sentry `Module.registerHooks`, `enableRuntimeChannelInjection`), 14 (CLS / transactional).

**Spec:** `docs/superpowers/specs/2026-09-23-rbac-checkin-design.md`, section 16 phase 1, plus sections 3 (quality principles), 4 (D5, D7, D9, D12, D14), 6 (structure), 7 (data model), 9 (catalogue and sync), 11 (observability), 13 (testing), 17 (end-to-end verification). Inputs from the phase 0 final review (`docs/efficiency/critical-path.md`, "Inputs for later phase plans"): shared Nest bootstrap location; `node-library` tsconfig preset; migrate image `deploy --prod` / ownership / `@prisma/dev` footprint; a boundaries test using `@tms/*` specifiers; `predev` switching from `migrate deploy` to the D12 flow.

## Global Constraints

- Public repository: **client documents live only in `docs/client/` (gitignored) and the client name never appears in repository text** ("the client"; ADR 0007, convention only). Seed data is generic and derived from nothing in `docs/client/`.
- "Code quality: SOLID, clean module boundaries, extensible, testable; quality over speed."
- "Dependency rule: `contracts ← db ← domain ← apps`. `auth-core` is Nest-free and Prisma-free ... Enforced with `eslint-plugin-boundaries`. Additional rule: `apps/api-driver` may import only `@tms/domain/checkin` and `@tms/domain/shared`." This plan adds the element `bootstrap` (`packages/nest-bootstrap`), which may import `contracts`, `db` and `logger`; the API apps may import it. The element `app` splits into `api` (`apps/api-*`: `contracts, db, auth-core, logger, domain, bootstrap`) and `web` (`apps/web-*`: `contracts, ui`).
- "Enums and statuses are defined once in `contracts` (zod) and mirrored in `schema.prisma`; a unit test asserts set equality."
- "Testability: time, randomness, mail, cipher and Sentry sit behind ports with in-memory test implementations."
- "Fail-closed security: a route without `@RequirePermissions` or `@Public` cannot exist (guard + test)." The guard arrives in phase 3a; this plan reserves the metadata key `PUBLIC_ROUTE_KEY` in `contracts` so `bootstrap` (health) and `domain` (guard) never need to import each other.
- D5: "`/health` is `@Public`, no device key, returns only `ok`/`degraded` (no database details)." Served at `/api/health` because both APIs sit under the global prefix `api` and Caddy forwards only `/api` (D11).
- D7: "One migration per PR; a PR carrying a migration is rebased on `main` and its migration regenerated before merge; such PRs merge serially."
- D9: "Soft delete of users: none. DEACTIVATED is terminal; no hard delete (audit integrity)." Foreign keys towards `User` are RESTRICT.
- D12: "No manual step in either flow. Compose: one-shot `migrate` service (`prisma migrate deploy` + permission sync); apps `depends_on: service_completed_successfully`. Local: `pnpm dev` has a `predev` script ... Migrations never run inside a Nest process." `predev` in this plan runs `migrate deploy` + drift check + sync + seed instead of `migrate dev` (deviation 6).
- D14: "File logs in containers: enabled by default (requirement); `LOG_DIR` is a volume; `LOG_FILE_ENABLED=false` for environments that collect stdout."
- Section 9: "`PermissionSyncService` (run by the `migrate` service, `predev` and the seed, never by the app): upserts catalogue codes (does not overwrite admin-edited name/description), `renamedFrom` migrates `RolePermission` rows before the old code becomes deprecated, a deprecated code is deleted only when no role references it. Idempotent (`sync(sync(c)) == sync(c)`), logs its result."
- Section 11: "Redaction: password, pin, cardSerial, token, authorization, cookie, totp, recoveryCode." "Sentry ... DSN from env, disabled when empty; release = git SHA; `sendDefaultPii=false`; `beforeSend` scrub list shared from `contracts`; no user context on the kiosk." "Audit: `AuditService.record()` inside the caller's transaction."
- Section 13: "API E2E (Jest + supertest + **Testcontainers Postgres everywhere**, one database per Jest worker from a template): **primary backend verification.**" Docker is therefore required for `pnpm verify` and the pre-push hook from Task 04 on.
- Every change to `main` goes through a PR (ruleset "main: pull requests only", squash merges). Conventional commits with a **header of at most 100 characters**. One boundary per PR; the PR title is the squash commit.
- Versions are pinned through the pnpm catalog; **never `latest`** in package manifests or Dockerfiles. Every new library declares `@nestjs/*`, `reflect-metadata` and `rxjs` as `peerDependencies` (catalog versions as `devDependencies`), so each process holds exactly one copy of Nest. Every package that runs ts-jest, the Nest CLI or the TypeScript compiler API (`packages/config`, `db`, `logger`, `nest-bootstrap`, `domain`, both APIs) declares `"typescript": "catalog:nest-ts6"`, because TypeScript 7.0 ships no JS API until 7.1 (`main`'s CLAUDE.md); `@tms/contracts` (tsc + Vitest only) and `e2e` keep the default `catalog:` (TypeScript 7).
- Package `exports` always carry `types` and `default` conditions (never `import`-only); no top-level `await` in any library; library code never imports `dotenv/config` (CLI entry points only).
- Repository text, code and documentation in English. "`.env.example` per application; all secrets only in env."

## Review Focus

Inputs the spec implies but that need explicit tests (each pinned to the owning task):

1. **Redaction coverage** (Tasks 03, 10, 13): nested and array values (`{user:{password}}`, `[{pin}]`), header case variants and `Set-Cookie[]`, `?token=` inside `req.url`, `err.config.headers.authorization`, `Bearer …`/URL credentials inside message strings, child logger bindings, Sentry breadcrumbs and `request.data`. Tests assert that the raw secret string is absent from the output, not only that a `[REDACTED]` marker exists; false positives (`shipping`, `mapping`, `keyId`) stay untouched.
2. **Sync edge cases** (Task 07): a rename whose target grant already exists, chained renames, a referenced deprecated code (kept) and an unreferenced one (deleted) in the same run, admin-edited name/description preserved, a re-added deprecated code re-activated, the locked Admin role losing deprecated codes, a second run doing zero writes (including `syncedAt`), two concurrent runs, an invalid catalogue producing zero writes.
3. **Seed re-runs** (Task 08): after an admin renames or edits the Operator role, after the bootstrap admin is ACTIVE or BLOCKED, with a changed `BOOTSTRAP_ADMIN_EMAIL`, with no email on an empty database, and two concurrent seeds (predev and compose).
4. **Audit and the caller's transaction** (Task 14): a rollback leaves no audit row; a metadata validation failure rolls back the caller's state change (fail-closed); outside a transaction the row autocommits; unknown metadata keys are rejected.
5. **Health under failure** (Task 12): database down at boot (no crash loop), down after boot, black-holed (bounded latency); the body is exactly `{ status, service }` with no details, stack or connection string; `Cache-Control: no-store`; polls produce no info-level log; the app recovers when the database returns.
6. **Harness isolation** (Task 04): two workers get distinct databases, the template is migrated once, Docker environment variables pass through turbo, and without Docker the run fails fast with a message naming Docker instead of hanging.
7. **Container runtime** (Tasks 09, 11, 12): library `dist/` present in the deployed tree (`files`), non-root process with a read-only root filesystem, the `logs` volume writable by `node`, retention across restarts without one app deleting the other's files, the Prisma CLI absent from the API images, `LOG_FILE_ENABLED=false` really disables file logging.
8. **Request id** (Tasks 10, 14): a hostile `X-Request-Id` (CRLF, 200 characters) is replaced; the response header, the log `reqId` and the CLS request id agree under 50 concurrent requests.

## Execution notes (apply to every task)

- **One task = one PR** on branch `phase-1/NN-<slug>` from `main`, opened with the `pr` skill after `pnpm verify`; the PR title is the task's commit header. The stack merges in order (squash). The phase 0 stack (PRs #2–#11) landed on `main` on 2026-09-24 (`cc47fec`); every phase 1 branch starts from that `main` or later.
- **Journal as you go**: every task's Commit step also appends its row (date, task, approach, start, end, rework, notes) to `docs/efficiency/critical-path.md` and includes that file in the commit. Do not batch rows at the end.
- **Scoped runs**: `pnpm turbo run <task> --filter=<package>`, one task per command (`pnpm --filter a b c` passes `b c` as arguments to `a`). Whole-repo: `pnpm verify`.
- **Databases in verification steps**: unit and API tests use the Testcontainers harness (Task 04) and need Docker. Manual checks use a throwaway container, never the compose project `tms`: `docker network create tms-p1-net && docker run -d --name tms-p1-pg --network tms-p1-net -p 55432:5432 -e POSTGRES_USER=tms -e POSTGRES_PASSWORD=tms -e POSTGRES_DB=tms postgres:18-alpine` (clean up with `docker rm -f tms-p1-pg && docker network rm tms-p1-net`). Compose, where a task needs it, runs as project `tms-p1` with alternate ports: `POSTGRES_PORT=55432 MAILPIT_UI_PORT=58025 MAILPIT_SMTP_PORT=51025 CADDY_ADMIN_PORT=58080 CADDY_KIOSK_PORT=58081 pnpm compose -p tms-p1 ...` and `COMPOSE_PROJECT_NAME=tms-p1` plus the same variables for `infra/smoke.sh`.
- **Background servers**: start them with `timeout <seconds> <command> &` (never bare `pnpm ... &` + `kill %1`).
- **Prettier**: run `pnpm exec prettier --write` on every created file and `pnpm format:check` before committing (Prettier skips gitignored paths such as `src/generated/`).
- **Commit headers**: at most 100 characters; the commit-msg hook rejects longer ones. Fix-round commits are separate conventional commits on the same branch.
- **Fallbacks**: when a step names a fallback, the acceptance criterion stays the same and the fallback used is recorded in the journal row and the PR "Risks and notes".
- **PR body** (`.github/pull_request_template.md`, `pr` skill): what and why (2–4 sentences naming the spec section), one Mermaid diagram of the type named in the task, affected boundaries (packages, public interfaces, migration yes/no), a **verification plan** (what will be run: `pnpm verify`, the task's scenarios, CI jobs) and the **verification results** table `scenario | layer | outcome` with the real output of the task's verification steps, risks and notes (deviations, fallbacks used, follow-ups).

---

## Task overview

| # | Task | Branch | Deliverable | Verified by |
|---|---|---|---|---|
| 01 | Plan | `phase-1/01-plan` | this document + critic table + journal rows | prettier, hygiene |
| 02 | Config presets, Jest interop, `generate` task, specifier-aware boundaries | `phase-1/02-config` | `node-library.json`, `nest-library.json`, Jest preset options, typescript resolver, `bootstrap` element and the `api`/`web` split, turbo `generate`, hygiene copy check | `@tms/config` tests (specifier cases by message text), app tests unchanged, `pnpm verify` without `[boundaries]` warnings |
| 03 | `@tms/contracts` | `phase-1/03-contracts` | enums, permission catalogue, seeded roles, audit actions, scrub list, `PUBLIC_ROUTE_KEY` | Vitest: catalogue invariants, roles, audit metadata, `isSensitiveKey`, fast-check scrub property |
| 04 | Testcontainers harness | `phase-1/04-db-testing` | `@tms/db/testing`, Jest preset `database: true`, turbo pass-through, CI timeout, README prerequisite | two-worker isolation test, no-Docker fails fast, CI `verify` green |
| 05 | Schema: identity, access, audit | `phase-1/05-schema-identity` | generated CJS client, `createPrismaClient`, models + migration 1, ERD part 1 | enum parity, FK behaviour, uniqueness, indexes; drift |
| 06 | Schema: drivers, master data, operations | `phase-1/06-schema-operations` | models + migration 2, ERD complete | enum parity, `activeOrderId`/`(day, sequenceNumber)` constraints; drift |
| 07 | Permission sync | `phase-1/07-permission-sync` | `planPermissionSync`, `syncPermissions`, CLI, ADR 0004 | planner tables, fast-check idempotence, DB edge cases, CLI twice |
| 08 | Seed + `predev` | `phase-1/08-seed-predev` | `seedDatabase`, CLI, `migrations.seed`, root `predev` | seed idempotence matrix, `predev < /dev/null` |
| 09 | Migrate image | `phase-1/09-migrate-image` | production-only image running deploy + seed (sync inside), read-only root filesystem, smoke counts, `/app` size budget (`MIGRATE_APP_MAX_BYTES`) | `docker build`/`run` twice, `du -sb /app`, `pnpm compose -p tms-p1` smoke, CI `e2e` |
| 10 | `@tms/logger` | `phase-1/10-logger` | `createLoggerModule`, redaction, request id, pino-roll files | redaction matrix, request-id cases, file behaviour |
| 11 | `@tms/nest-bootstrap` | `phase-1/11-nest-bootstrap` | env schema (incl. `HOST` via `listenHost`), `configureApp`, `bootstrapApi`, `CoreModule`; apps reduced; `api.Dockerfile` builds dependencies; ADR 0008 | env matrix, process-level `PORT` test, app e2e unchanged, both images boot read-only with a log file |
| 12 | Health | `phase-1/12-health` | `@tms/db/nest` `PrismaModule`, `HealthModule` (`{ status, service }`), compose healthchecks + `restart: unless-stopped`, smoke/e2e checks, migrate-ordering proof | ok/degraded/black-hole/recovery tests, compose `tms-p1` full smoke + Playwright |
| 13 | Sentry | `phase-1/13-sentry` | `@tms/nest-bootstrap/sentry`, `instrument.ts`, `SentryModule` + filter | options/scrub tests, capturing transport, empty DSN |
| 14 | `@tms/domain/shared` | `phase-1/14-domain-shared` | `SharedModule`, `AuditService`, `Clock`, `MailSender`, ADR 0006 | transaction/rollback/autocommit matrix, request context over HTTP |

Dependencies: 03 needs 02; 04 → 05 → 06 → 07 → 08 → 09 is a chain; 10 needs 03; 11 needs 10 and 09 (smoke.sh, compose layout, optional `prisma`); 12 needs 11, 05 and 04; 13 needs 12 (`DATABASE_URL` in the schema); 14 needs 12 and 10. If Task 07 is rejected, 08 and 09 go with it, and Tasks 11–12 must drop their Task 09 references (smoke check 2, compose line numbers, the `--no-optional` rationale) before rebasing onto Task 06.

## Shared interfaces (names every task must use exactly)

| Name | Defined in | Signature / shape |
|---|---|---|
| `DB_MIRRORED_ENUMS` | `@tms/contracts` (Task 03) | `Record<PrismaEnumName, z.ZodEnum>` — only enums that exist in `schema.prisma` |
| `PERMISSIONS`, `PERMISSION_CODES`, `PermissionCode`, `PermissionCodeSchema`, `PermissionDefinition`, `PERMISSION_GROUPS`, `PermissionGroup`, `validateCatalogue`, `CatalogueProblem`, `permissionCodesForAudience` | `@tms/contracts` (03) | `PermissionDefinition = { code: `${group}:${action}`, group, audience: 'STAFF' \| 'DRIVER', defaultName, defaultDescription, renamedFrom?: readonly string[] }`; `validateCatalogue(c): CatalogueProblem[]`; `permissionCodesForAudience(audience, catalogue = PERMISSIONS): PermissionCode[]` |
| `SEEDED_ROLES`, `SeededRole`, `SeededRoleKey`, `ADMIN_ROLE_KEY`, `ALL_FOR_AUDIENCE`, `resolveRolePermissions` | `@tms/contracts` (03) | `{ key: 'admin' \| 'operator' \| 'driver'; name; description; appliesTo; isSystem; permissionsLocked; permissions: typeof ALL_FOR_AUDIENCE \| readonly PermissionCode[] }[]`; `resolveRolePermissions(role, catalogue = PERMISSIONS): PermissionCode[]` |
| `AUDIT_ACTIONS`, `AUDIT_ACTION_NAMES`, `AuditAction`, `AuditActionSchema`, `AuditMetadata<A>`, `parseAuditMetadata`, `AuditMetadataError`, `AuditTargetTypeSchema`, `AuditTargetType` | `@tms/contracts` (03) | 50 actions named `<area>.<entity>.<event>`, per-action `z.strictObject` metadata; `system.permissions.synced` = `{ inserted, reactivated, deprecated, deleted, renamed }` counters, `system.seed.applied` = `{ created, unchanged }` |
| `isSensitiveKey`, `scrubDeep`, `scrubString`, `scrubUrl`, `REDACTED` | `@tms/contracts/security` (03) | pure, isomorphic |
| `PUBLIC_ROUTE_KEY` | `@tms/contracts` (03) | `'tms:public-route'` |
| `POSTGRES_TEST_IMAGE`, `testDatabaseUrl(workerId?)`, `resetTestDatabase(url?)`, `withAdminClient(fn)`, `startFaultProxy(options?)`, `FaultProxy`, `FaultMode` | `@tms/db/testing` (04; fault proxy 12; row builders 05/06, listed below) | harness API; `startFaultProxy({ upstream?, mode? })` → `{ port, accepted, setMode(mode), close() }`, `FaultMode = 'forward' \| 'refuse' \| 'blackhole'` |
| `startPostgres(starter?)`, `PostgresStarter`, `harnessGlobals`; `HARNESS_ENV` | `@tms/db/testing/jest-global-setup` (04; `HARNESS_ENV` in `src/testing/constants.ts`) | Jest globalSetup/teardown; `HARNESS_ENV` = `TEST_DB_ADMIN_URL`, `TEST_DB_URL_TEMPLATE` (`__N__` placeholder), `TEST_DB_WORKER_COUNT`; at least two clones are always created |
| `createJestConfig({ rootDir, database = false })`, `HARNESS_PACKAGE` | `@tms/config/jest` (02) | `database: true` wires the harness globalSetup/teardown and a 30 s timeout; `maxWorkers` is 2 on CI |
| turbo tasks `generate`, `db:validate`, `db:migrate:dev`, `db:migrate:deploy`, `db:migrate:status`, `db:drift` (02); `@tms/db#test` inputs (04); `db:setup` (08) | `turbo.json` | database scripts run as `pnpm turbo run <task> --filter=@tms/db [-- <args>]`; `db:sync`/`db:seed` have no turbo task (run inside `packages/db` or with `node dist/cli/…`) |
| `createPrismaClient({ url, connectTimeoutMs? })`, `CreatePrismaClientOptions` | `@tms/db` (05) | returns the generated `PrismaClient` over `PrismaPg`; `connectTimeoutMs` default 5000 |
| `planPermissionSync`, `isEmptyPlan`, `syncPermissions`, `isEmptyReport`, `summarizeSyncReport`, `SyncReport`, `SyncOptions`, `LockedRole`, `SyncPlan`, `SyncState`, `CatalogueInvalidError`, `LOCK_KEY` | `@tms/db` (07) | `syncPermissions(client, catalogue = PERMISSIONS, opts?: { lockedRoles?, now? }): Promise<SyncReport>`; `summarizeSyncReport` = the five `system.permissions.synced` counters; `LOCK_KEY = 7301`; CLI `tms-sync-permissions` |
| `seedDatabase`, `SeedReport`, `SeedOptions`, `summarizeSeedReport`, `SeedConfigError`, `SEED_LOCK_KEY`, `SEED_PRODUCTS`, `SEED_LOADING_POINTS`, `SEEDED_ENTITY_COUNT` | `@tms/db` (08) | `seedDatabase(client, { bootstrapAdmin: { email, username? }, now? }): Promise<SeedReport>`; `summarizeSeedReport` = `{ created, unchanged }`; `SEED_LOCK_KEY = 7302`; CLIs `tms-seed`, `dist/cli/dev-setup.js` |
| `createLoggerModule`, `LoggerOptions`, `LOG_LEVELS`, `LogLevel`, `resolveRequestId`, `REQUEST_ID_HEADER`, `REQUEST_ID_PATTERN`, `LOG_DESTINATION`, `createLogDestination`, `closeLogDestination`, `buildPinoOptions`, `buildPinoHttpOptions`, `buildFileTransportOptions`, `FileTransportOptions`, `Logger` | `@tms/logger` (10) | `createLoggerModule({ app, level, file: { enabled, dir, retentionDays } }): DynamicModule`; `LOG_DESTINATION` is the injection token tests override with a `MemoryLogStream`; `resolveRequestId(req, res?)` is memoized on `req.id`; the logger owns `LOG_LEVELS` |
| `MemoryLogStream`, `LogRecord`, `WaitForOptions` | `@tms/logger/testing` (10) | in-memory destination: `lines`, `records()`, `text()`, `mark()`, `since(mark)`, `waitFor(predicate, { from?, timeoutMs? })` (default 2000 ms); one stream per test file |
| `syncPermissionsInTx` | `@tms/db` (07) | `syncPermissionsInTx(tx, catalogue, opts)` — the transactional core shared by `syncPermissions` and the seed |
| `makeRole`, `makeStaffUser`, `makeDriverUser`, `makePermission`, `uniqueSuffix` (05); `TEST_DAY`, `makeCarrier`, `makeVehicle`, `makeProduct`, `makeLoadingPoint`, `makeDriverProfile`, `makeIdentityCard`, `makeLoadingOrder` (06) | `@tms/db/testing` (source `packages/db/src/testing/fixtures.ts`) | builders that create rows, e.g. `makeRole(prisma, overrides?)`; type-only imports, so the subpath still loads nothing but `pg` at runtime; used by Tasks 05–07 and 14 and by later packages' tests (consumers import `@tms/db/testing` from tests only, with `@tms/db` as a devDependency where it is not already a dependency) |
| `expectKnownRequestError(operation, { code, constraint })` (05); `queryRows`, `workerDatabases`, `otherWorkerUrls`, `currentWorkerId`, `tableExists` (04); `applyPlanToState` (07) | `packages/db/test/support/{prisma-errors,worker-databases,sync-model}.ts` | test helpers; Prisma 7 adapter errors carry the constraint at `meta.driverAdapterError.cause.constraint.index` |
| `createEnvSchema`, `baseEnvSchema`, `BaseEnv`, `loadEnv`, `listenHost`, `configureApp`, `bootstrapApi`, `BootstrapOptions<E>`, `CoreModule`, `ApiName`; re-exports `LOG_LEVELS`, `LogLevel` | `@tms/nest-bootstrap` (11) | `bootstrapApi({ name, envSchema, module, source?, stderr? })` resolves `undefined` and sets exit code 1 on an invalid environment, else listens on `(PORT, listenHost(env))`; later variables are entries of the `baseEnvSchema` literal, later modules entries of `CoreModule.forRoot({ app, env })`'s `imports`; apps export `envSchema`, `Env`, `AppModule.forRoot(env)` |
| `PinoLogger`, `Logger`, `InjectPinoLogger` | `@tms/logger` (10) re-exports of nestjs-pino | one pino-http instance per process: one logger configuration per Jest spec file |
| `HealthModule`, `HealthModuleOptions`, `HealthBody` | `@tms/nest-bootstrap` (12) | `HealthModule.forRoot({ service, dbTimeoutMs })`; `GET /api/health` → 200 `{ status: 'ok', service }` / 503 `{ status: 'degraded', service }`, `service: ApiName` |
| `buildSentryOptions`, `scrubSentryEvent`, `initSentry`, `SentryApp`, `SentryEnv`, `SentryOptionsInput` | `@tms/nest-bootstrap/sentry` (13) | Nest-free (lint-enforced) |
| `SharedModule`, `SharedModuleOptions`, `AuditService`, `AuditRecordInput`, `AUDIT_APP`, `Clock`, `SystemClock`, `FixedClock`, `MailSender`, `MailMessage`, `InMemoryMailSender`, `RequestContext`, `REQUEST_CONTEXT_KEY`, `USER_AGENT_MAX_LENGTH`, `AppTransactionHost`; re-exports `Transactional`, `Propagation`, `TransactionHost`, `ClsService` | `@tms/domain/shared` (14) | `SharedModule.forRoot({ app: 'ADMIN' \| 'DRIVER' })`; `AuditService.record<A>({ action, outcome, actorUserId?, target?, metadata? }): Promise<void>`; parameters typed `AppTransactionHost` need `@Inject(TransactionHost)` |
| Env variables | 08, 10, 11, 12, 13 | `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_USERNAME`, `HOST`, `LOG_LEVEL`, `LOG_FILE_ENABLED`, `LOG_DIR`, `LOG_RETENTION_DAYS`, `DATABASE_URL`, `HEALTH_DB_TIMEOUT_MS`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` (phase 0: `NODE_ENV`, `PORT`); build argument `GIT_SHA` (13); CI `MIGRATE_APP_MAX_BYTES` (09) |
| further `@tms/contracts` names: `PrismaEnumName`, `<Name>Schema` + type per enum, `EmailSchema`, `Email`, `AUTH_AUDIT_ACTIONS`, `ADMIN_AUDIT_ACTIONS`, `OPS_AUDIT_ACTIONS`, `CHECKIN_AUDIT_ACTIONS`, `SYSTEM_AUDIT_ACTIONS`, `SENSITIVE_KEY_TOKENS`, `CIRCULAR`, `MAX_DEPTH_REACHED`, `ScrubOptions` | `@tms/contracts` (03) | `scrubString`/`scrubUrl` keep bracketed markers (`[REDACTED]`, `[Filtered]`) whole |
| ESLint element types `bootstrap`, `api`, `web` | `packages/config/eslint/base.mjs` (02) | `bootstrap → contracts, db, logger`; `api` (`apps/api-*`) → `contracts, db, auth-core, logger, domain, bootstrap`; `web` (`apps/web-*`) → `contracts, ui` |
| `SINGLE_COPY_PACKAGES`, `findDuplicateCopies(storeEntries, packages?)`, `runHygiene({ trackedFiles, claudeMd, pnpmStoreEntries? })` | `tools/scripts/check-hygiene.mjs` (02) | one `node_modules/.pnpm` directory each for `@nestjs/common`, `@nestjs/core`, `nestjs-cls`, `@nestjs-cls/transactional`, `@prisma/client` |
| `PrismaModule`, `PrismaService` | `@tms/db/nest` (12) | `PrismaModule.forRoot({ url, connectTimeoutMs? })` (global), `PrismaService extends PrismaClient` (a proxy: never `instanceof`); `@nestjs/common`, `reflect-metadata`, `rxjs` optional peers |
| `registerSmokeSuite({ name, title, service })` | `e2e/tests/support/smoke.ts` (12) | Playwright smoke per origin, asserts the health `service` |

---

### Task 01: The plan

**Branch:** `phase-1/01-plan`
**PR title:** `docs: add the phase 1 foundation plan`

**Files:**
- Create: `docs/superpowers/plans/2026-09-23-phase-1-foundation.md` (this document, including the critic table)
- Modify: `docs/efficiency/critical-path.md` (rows for the spikes, the plan, the critic pass and its incorporation)

**Interfaces:**
- Consumes: the spec, the phase 0 final review inputs, the spike results recorded in the Tech Stack paragraph and in the tasks' `Spike note` lines.
- Produces: the task list, the shared-interface table and the PR stack that Tasks 02–14 implement; every later task cites this file by path.

- [ ] **Step 1: Confirm the base and the inputs**

Run: `git fetch -q origin && git log --oneline -1 origin/main && git show origin/main:docs/efficiency/critical-path.md | grep -c "Inputs for later phase plans"`
Expected: `origin/main` is at or after `cc47fec` (the phase 0 docs PR #10 squash commit, merged 2026-09-24) and the count is `1`; the five phase 1 inputs listed there (shared Nest bootstrap location, `node-library` preset, migrate image `deploy --prod` / `--chown` / `@prisma/dev`, boundaries test with `@tms/*` specifiers, `predev` → D12 flow) are the ones this plan's "Spec" paragraph names. The plan branch was fast-forwarded onto that `main` before the plan was committed, so no rebase is pending.

- [ ] **Step 2: Rebase before opening the PR if `main` moved**

Run: `git rebase origin/main`
Expected: clean, or a single append-only conflict in `docs/efficiency/critical-path.md` resolved by keeping both sets of rows in chronological order, then `git rebase --continue`.

- [ ] **Step 3: Verify the document**

Run: `pnpm install --frozen-lockfile && pnpm exec prettier --check docs/superpowers/plans/2026-09-23-phase-1-foundation.md docs/efficiency/critical-path.md && node tools/scripts/check-hygiene.mjs && grep -nE 'T[B]D|T[O]DO|implement [l]ater|fill [i]n|add [a]ppropriate|similar [t]o Task|tests [f]or the above' docs/superpowers/plans/2026-09-23-phase-1-foundation.md; echo "placeholders-exit=$?"`
Expected: prettier `All matched files use Prettier code style!` (both paths are in `.prettierignore`, so this only proves the command runs; the plan is checked by eye and by the critic), hygiene `hygiene: ok (<n> tracked files)` (phase 0's script; the single-copy check arrives with Task 02), and `placeholders-exit=1` (no matches; the bracketed letters keep the pattern from matching this very line).

- [ ] **Step 4: Commit**

Run: `tools/scripts/gitleaks.sh dir docs/superpowers/plans/2026-09-23-phase-1-foundation.md --redact --no-banner`
Expected: `no leaks found` (the two test-fixture passwords carry `gitleaks:allow`; the pre-commit hook and the CI `hygiene` job scan this file too).

Append the journal rows of the plan session (spikes, writing, critic pass, incorporation of the critic findings) to `docs/efficiency/critical-path.md`, then:

```bash
git add docs/superpowers/plans/2026-09-23-phase-1-foundation.md docs/efficiency/critical-path.md
git commit -m "docs: add the phase 1 foundation plan"
```
Expected: this commit passes all hooks (header 37 characters). Fix-round commits from the review go on the same branch as `docs: ...` commits with headers ≤ 100 characters and are squashed on merge. Then open the PR with the `pr` skill (Execution notes); CI `verify`, `hygiene` and `db-drift` green (docs-only change; `e2e` runs unchanged).

**PR body notes:**
- What and why: spec section 16 phase 1 plus the five final-review inputs and the architect-review journal inputs (W1, W5, D10-3, A-4, A-6, I7-1, M6-6); diagram: Mermaid `gitGraph` (main → 14 `phase-1/*` branches); boundaries: docs only; migration no.
- Verification plan: Step 3 (Prettier, hygiene, placeholder scan); CI `verify`, `hygiene`, `db-drift`.
- Verification results (`scenario | layer | outcome`): `prettier --check | docs | pass (ignored paths)`, `check-hygiene | docs | pass`, `placeholder scan | docs | 0 matches`.
- Risks and notes: the stack merges in order (01 → 14) after the phase 0 stack; predev wording deviation (6); Sentry 11 pinned at 11.0.0 with seven release-age exclusions; Node 26 and TypeScript 7 (with the `nest-ts6` catalog) from `main` 0d5f4ac.

---

### Task 02: Config presets, Jest interop, `generate` task and specifier-aware boundaries

**Branch:** `phase-1/02-config`
**PR title:** `build(config): add library presets, Jest ESM interop, generate task and specifier-aware boundaries`

Spec: section 3 (dependency rule, enforced by `eslint-plugin-boundaries`), section 6 (`config/` holds the shared presets), section 13 (CI: eslint with boundaries); phase 0 final-review inputs "`node-library` tsconfig preset" and "a boundaries test using `@tms/*` specifiers"; journal inputs W1 (boundaries never fires for `@tms/*` specifiers), W5 (split the single `app` element type into `api` and `web`) and D10-3 (`test.outputs: []`); plan deviation 2 (`bootstrap` element). Every later task compiles, lints and tests through what this PR sets up; it changes no product code.

Spike notes (re-run on the real toolchain in a scratch replica of the tree): TypeScript 6.0.3 defaults `types` to `[]`, so `library.json` reports `TS2591` on `process`, `node-library.json` is clean, `nest-library.json` compiles a decorated class in a `"type": "commonjs"` scope, and `library.json` on that file gives `TS1287` + `TS2591`; `${configDir}` in a preset resolves to the directory of the extending tsconfig (a plain relative `rootDir`/`outDir` would resolve against `packages/config/tsconfig/` and fail with TS6059), which is why phase 0's `library.json` already uses it. turbo 2.11.3 passes `CI`, `DOCKER_*` and `XDG_RUNTIME_DIR` by default but drops `TESTCONTAINERS_*` unless listed, drops `DATABASE_URL` for `test` and passes it to the `db:*` tasks through `passThroughEnv`; arguments after `--` reach only the entry task (not its `generate` dependency); a package without a `generate` script skips that dependency silently; `$TURBO_ROOT$/infra/docker-compose.yml` as a task input changes the task hash. Prisma 7.10.0 on the empty schema: `db:drift` exits 0 (`No difference detected.`) and `migrate dev --name probe --create-only` writes `-- This is an empty migration.`. Both API suites and their lint stay green with the new Jest preset and the typescript resolver.

**Files:**
- Create: `packages/config/tsconfig/node-library.json`, `packages/config/tsconfig/nest-library.json`, `packages/config/test/fixtures/packages/nest-bootstrap/src/index.ts`, `packages/config/test/fixtures/apps/web-admin/src/index.ts`
- Modify: `packages/config/jest/create-config.mjs` (whole file), `packages/config/eslint/base.mjs:1-68` (resolver, `bootstrap` element, `api`/`web` split, policies), `packages/config/package.json:17-30` (dependencies), `packages/db/tsconfig.json`, `e2e/tsconfig.json`, `turbo.json` (whole file), `pnpm-workspace.yaml:21` (catalog; line 18 before `main` 0d5f4ac), `pnpm-lock.yaml`, `tools/scripts/check-hygiene.mjs` (whole file), `.github/workflows/ci.yml:31` (verify job step), `README.md:11`, `CLAUDE.md:50-51`, `docs/architecture.md:41-46`, `docs/efficiency/critical-path.md`
- Test: `packages/config/test/tsconfig-presets.test.mjs` (phase 0 file extended, 2 → 10 cases), `packages/config/test/eslint-boundaries.test.mjs:46-68` and after `:86` (element maps 7×7 → 9×9, one message case), `packages/config/test/jest-preset.test.mjs`, `packages/config/test/eslint-boundaries-packages.test.mjs` (new); `tools/scripts/check-hygiene.test.mjs`, `tools/scripts/check-hygiene-cli.test.mjs` (extended); `packages/config/test/eslint-node.test.mjs` (unchanged, must stay green)
- Unchanged on purpose: `packages/config/tsconfig/library.json` (phase 0 already sets `outDir: "${configDir}/dist"` and `rootDir: "${configDir}/src"`), `apps/api-*/package.json` (phase 0 already lists `"files": ["dist"]`, which `pnpm deploy` copies in Tasks 09 and 11), `.npmrc` (deleted in phase 0; `engineStrict: true` lives in `pnpm-workspace.yaml`)

**Interfaces:**
- Consumes: the phase 0 presets (`base.json`, `library.json` with `${configDir}` paths, `nest.json` without `incremental`), `nodeConfig`/`baseConfig`/`boundariesConfig` (`packages/config/eslint`), `createJestConfig({ rootDir })`, `runHygiene({ trackedFiles, claudeMd })`, the phase 0 tests `tsconfig-presets.test.mjs` (`parseExtending`) and `eslint-boundaries.test.mjs` (element matrix over `test/fixtures/{packages,apps}`), catalog entries `typescript`, `@types/node`, `vitest`, `eslint-plugin-boundaries`.
- Produces:
  - `@tms/config/tsconfig/node-library.json` (ESM for Node: `library.json` + `types: ["node"]`) and `@tms/config/tsconfig/nest-library.json` (CommonJS Nest libraries: `base.json` + `nodenext`, decorators, declarations, `types: ["node"]`, no `verbatimModuleSyntax`). Like phase 0's `library.json`, both set `outDir: "${configDir}/dist"` and `rootDir: "${configDir}/src"` (`node-library.json` by inheritance): TypeScript substitutes the directory of the extending tsconfig, so the paths land inside each package. A package `tsconfig.json` that also includes `test/` overrides `rootDir: "."` with `noEmit: true`; its `tsconfig.build.json` may restate `rootDir: "./src"`/`outDir: "./dist"` or rely on the preset. `packages/config/package.json` `exports["./tsconfig/*"]` already covers both files (no change).
  - `createJestConfig({ rootDir: string, database?: boolean }): import('jest').Config` — adds `moduleNameMapper { '^(\\.{1,2}/.*)\\.js$': '$1' }`, `transform` for `^.+\.ts$` only, `transformIgnorePatterns ['/node_modules/', '/packages/[^/]+/dist/']`, `maxWorkers: CI ? 2 : '50%'`, `!src/instrument.ts` in coverage; `database: true` → harness `globalSetup`/`globalTeardown` + `testTimeout: 30_000` (used from Task 04 on); `HARNESS_PACKAGE`.
  - ESLint: `import/resolver` = `eslint-import-resolver-typescript` by absolute path (replacing the node resolver); element `bootstrap` (`packages/nest-bootstrap`); the phase 0 element `app` (`apps/*`) splits into `api` (`apps/api-*`) and `web` (`apps/web-*`); policies `bootstrap → contracts, db, logger`, `api → contracts, db, auth-core, logger, domain, bootstrap`, `web → contracts, ui`. Message template unchanged: `<from> may not import <to> (dependency rule contracts <- db <- domain <- apps)`.
  - turbo: task `generate` (inputs `prisma/schema.prisma`, `prisma.config.ts`, `package.json`; outputs `src/generated/**`), `build`/`typecheck`/`lint`/`test`/`dev` depend on `["^build", "generate"]`, `test.outputs: []`, `globalPassThroughEnv: ["DOCKER_*", "XDG_RUNTIME_DIR", "TESTCONTAINERS_*"]`, uncached `db:validate`, `db:migrate:dev` (depends on `generate`), `db:migrate:deploy`, `db:migrate:status`, `db:drift` with `passThroughEnv: ["DATABASE_URL"]`. A package without a `generate` script (all of them until Task 05) skips that dependency.
  - Root `engines.node` unchanged: `main` already requires `>=26.0.0` (`.nvmrc` `26`, `engineStrict: true`).
  - Hygiene: `SINGLE_COPY_PACKAGES`, `findDuplicateCopies`, `runHygiene({ trackedFiles, claudeMd, pnpmStoreEntries = null })`; `main()` reads `node_modules/.pnpm` when present and prints `hygiene: ok (N tracked files, single copies ok)` or `…, single-copy check skipped)`.

- [ ] **Step 1: Add the resolver and the Node types to `@tms/config`**

`pnpm-workspace.yaml`: insert after line 21 (`  eslint-plugin-boundaries: ^7.2.0`):

```yaml
  eslint-import-resolver-typescript: ^4.4.5
```

`packages/config/package.json`: replace lines 17–30 (`dependencies` and `devDependencies`) with:

```json
  "dependencies": {
    "@eslint/js": "catalog:",
    "eslint-config-prettier": "catalog:",
    "eslint-import-resolver-typescript": "catalog:",
    "eslint-plugin-boundaries": "catalog:",
    "eslint-plugin-react-hooks": "catalog:",
    "eslint-plugin-react-refresh": "catalog:",
    "globals": "catalog:",
    "typescript-eslint": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "eslint": "catalog:",
    "typescript": "catalog:nest-ts6",
    "vitest": "catalog:"
  },
```

`@types/node` is a devDependency because the preset fixture tests below compile with `types: ["node"]` from inside `packages/config` (pnpm hoists no `@types` to the root). `typescript` stays `catalog:nest-ts6` as on `main` 0d5f4ac: the preset tests call the compiler API (`ts.readConfigFile`, `ts.createProgram`), which TypeScript 7.0 does not ship until 7.1.

Run: `pnpm install`
Expected: exit 0; the lockfile gains `eslint-import-resolver-typescript@4.4.5` and those of its dependencies not locked yet (`eslint-import-context`, `get-tsconfig`, `is-bun-module`, `stable-hash-x`); `unrs-resolver@1.12.2` is reused (already locked through `jest-resolve` and already `true` in `allowBuilds`), so no `ERR_PNPM_IGNORED_BUILDS` and no `allowBuilds` stub appears. Commit any `minimumReleaseAgeExclude` lines pnpm adds.

- [ ] **Step 2: Write the failing config tests**

`packages/config/test/tsconfig-presets.test.mjs` exists since phase 0 (43 lines: `presets`, `scratch`, `afterAll`, `parseExtending(preset)` and two cases, `library.json resolves outDir and rootDir inside the extending package` and `nest.json leaves incrementality to turbo, so typecheck writes no tsbuildinfo into dist`). Both cases stay verbatim; `parseExtending` gains the optional `source`, `type` (writes a `package.json`, which decides the module format under `nodenext`) and `compilerOptions`; a `typecheck` helper runs the checks `tsc --noEmit -p` runs, in-process through `ts.createProgram`; eight cases follow. The throwaway packages live in the OS temp directory, outside any `node_modules` chain, so `typeRoots` points at this package's own `@types` (hence the `@types/node` devDependency of Step 1). Full file after this step:

```js
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import ts from 'typescript';

const presets = path.join(import.meta.dirname, '..', 'tsconfig');
const scratch = mkdtempSync(path.join(tmpdir(), 'tms-config-tsconfig-'));
// The throwaway packages live outside the repository, so they borrow this package's @types/node
// (a real package finds its own through node_modules).
const typeRoots = [path.join(import.meta.dirname, '..', 'node_modules', '@types')];

const USES_PROCESS = `export const nodeEnv: string | undefined = process.env['NODE_ENV'];\n`;
const DECORATED = `function Injectable(): ClassDecorator {
  return () => undefined;
}

export class Clock {
  now(): Date {
    return new Date(0);
  }
}

@Injectable()
export class Greeter {
  constructor(private readonly clock: Clock) {}

  greet(): string {
    return \`pid \${process.pid} at \${this.clock.now().toISOString()}\`;
  }
}
`;

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * Parses a throwaway package tsconfig that extends one preset, the way `tsc -p` does.
 *
 * @param {string} preset file name under packages/config/tsconfig
 * @param {{ source?: string, type?: 'module' | 'commonjs', compilerOptions?: object }} [options]
 *   `type` writes a package.json, which decides the module format under `nodenext`.
 */
function parseExtending(preset, { source = 'export const x = 1;\n', type, compilerOptions } = {}) {
  const pkg = mkdtempSync(path.join(scratch, 'pkg-'));
  mkdirSync(path.join(pkg, 'src'));
  writeFileSync(path.join(pkg, 'src', 'index.ts'), source);
  if (type) writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ type }));
  const configPath = path.join(pkg, 'tsconfig.json');
  writeFileSync(
    configPath,
    JSON.stringify({ extends: path.join(presets, preset), compilerOptions, include: ['src'] }),
  );
  const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
  return { pkg, parsed: ts.parseJsonConfigFileContent(config, ts.sys, pkg, undefined, configPath) };
}

/**
 * Type-checks a throwaway package like `tsc --noEmit -p` would.
 *
 * @returns {string[]} the distinct TS error codes, sorted
 */
function typecheck(preset, { source, type }) {
  const { parsed } = parseExtending(preset, {
    source,
    type,
    compilerOptions: { noEmit: true, typeRoots },
  });
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  return [...new Set(diagnostics.map((d) => `TS${d.code}`))].sort();
}

describe('tsconfig presets', () => {
  it('library.json resolves outDir and rootDir inside the extending package', () => {
    const { pkg, parsed } = parseExtending('library.json');
    expect(parsed.errors).toEqual([]);
    expect(parsed.options.outDir).toBe(path.join(pkg, 'dist'));
    expect(parsed.options.rootDir).toBe(path.join(pkg, 'src'));
  });

  it('nest.json leaves incrementality to turbo, so typecheck writes no tsbuildinfo into dist', () => {
    const { parsed } = parseExtending('nest.json');
    expect(parsed.options.incremental).toBeUndefined();
    expect(parsed.options.composite).toBeUndefined();
  });

  it.each(['node-library.json', 'nest-library.json'])(
    '%s resolves outDir and rootDir inside the extending package (${configDir})',
    (preset) => {
      const { pkg, parsed } = parseExtending(preset);
      expect(parsed.errors).toEqual([]);
      expect(parsed.options.outDir).toBe(path.join(pkg, 'dist'));
      expect(parsed.options.rootDir).toBe(path.join(pkg, 'src'));
    },
  );

  it('node-library.json is library.json plus the Node types', () => {
    const { parsed } = parseExtending('node-library.json');
    expect(parsed.options.types).toEqual(['node']);
    expect(parsed.options.verbatimModuleSyntax).toBe(true);
    expect(parsed.options.declaration).toBe(true);
  });

  it('nest-library.json has decorators, declarations and Node types but no verbatimModuleSyntax', () => {
    const { parsed } = parseExtending('nest-library.json');
    expect(parsed.options).toMatchObject({
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      declaration: true,
      declarationMap: true,
      types: ['node'],
    });
    expect(parsed.options.verbatimModuleSyntax).toBeUndefined();
  });

  it('library.json has no Node types: process is unknown (TS2591)', () => {
    expect(typecheck('library.json', { source: USES_PROCESS, type: 'module' })).toEqual(['TS2591']);
  });

  it('node-library.json type-checks the same file cleanly', () => {
    expect(typecheck('node-library.json', { source: USES_PROCESS, type: 'module' })).toEqual([]);
  });

  it('nest-library.json type-checks a decorated class in a CommonJS package', () => {
    expect(typecheck('nest-library.json', { source: DECORATED, type: 'commonjs' })).toEqual([]);
  });

  it('library.json rejects that CommonJS file (verbatimModuleSyntax), so nest-library.json must not extend it', () => {
    expect(typecheck('library.json', { source: DECORATED, type: 'commonjs' })).toEqual([
      'TS1287',
      'TS2591',
    ]);
  });
});
```

`packages/config/test/eslint-boundaries.test.mjs` (phase 0: `lint()` runs ESLint from inside the fixture package, `errors()` keeps severity-2 messages, the `elements`/`allowed` maps drive a 7×7 `it.each` matrix). Replace lines 46–68 (the two maps and the matrix comment) with:

```js
/** One fixture package per element type of `boundaries/elements` in eslint/base.mjs. */
const elements = {
  contracts: 'packages/contracts',
  db: 'packages/db',
  'auth-core': 'packages/auth-core',
  logger: 'packages/logger',
  domain: 'packages/domain',
  ui: 'packages/ui',
  bootstrap: 'packages/nest-bootstrap',
  api: 'apps/api-admin',
  web: 'apps/web-admin',
};

/**
 * Spec section 3 (contracts <- db <- domain <- apps) with the phase 1 `bootstrap` element and apps
 * split into `api` and `web`: which element types each type may import.
 */
const allowed = {
  contracts: [],
  db: ['contracts'],
  'auth-core': ['contracts'],
  logger: ['contracts'],
  domain: ['contracts', 'db', 'auth-core', 'logger'],
  ui: ['contracts'],
  bootstrap: ['contracts', 'db', 'logger'],
  api: ['contracts', 'db', 'auth-core', 'logger', 'domain', 'bootstrap'],
  web: ['contracts', 'ui'],
};

/** The full 9x9 matrix; the diagonal is an import inside the same package, always allowed. */
```

and insert after line 86 of the phase 0 file (the `});` closing `it('forbids db importing domain', …)`), so a failing `web` case also shows the rendered message:

```js

  it('forbids a web app importing db, naming the web element', async () => {
    const messages = await lint(
      'apps/web-admin/src/x.ts',
      `import { db } from '../../../packages/db/src/index';\nexport { db };\n`,
    );
    expect(errors(messages, 'boundaries/dependencies').map((m) => m.message)).toEqual([
      'web may not import db (dependency rule contracts <- db <- domain <- apps)',
    ]);
  });
```

Two fixtures join the phase 0 ones (the matrix imports each element's `src/index`):

`packages/config/test/fixtures/packages/nest-bootstrap/src/index.ts`:

```ts
export const bootstrap = 1;
```

`packages/config/test/fixtures/apps/web-admin/src/index.ts`:

```ts
export const web = 1;
```

`packages/config/test/jest-preset.test.mjs` (no database: a temporary pnpm-style workspace stands in for a built `@tms/db`):

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createJestConfig } from '../jest/create-config.mjs';

const savedCi = process.env.CI;
beforeEach(() => {
  delete process.env.CI;
});
afterEach(() => {
  if (savedCi === undefined) delete process.env.CI;
  else process.env.CI = savedCi;
});

/** A consumer package linked to a built @tms/db the way pnpm links workspace:* dependencies. */
function createWorkspace() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tms-jest-preset-')));
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  };
  write(
    'packages/db/package.json',
    JSON.stringify({
      name: '@tms/db',
      type: 'commonjs',
      exports: {
        './testing/jest-global-setup': './dist/testing/global-setup.js',
        './testing/jest-global-teardown': './dist/testing/global-teardown.js',
      },
    }),
  );
  write('packages/db/dist/testing/global-setup.js', 'module.exports = async () => {};\n');
  write('packages/db/dist/testing/global-teardown.js', 'module.exports = async () => {};\n');
  write('apps/api/package.json', JSON.stringify({ name: '@tms/api', private: true }));
  write('apps/plain/package.json', JSON.stringify({ name: '@tms/plain', private: true }));
  fs.mkdirSync(path.join(root, 'apps/api/node_modules/@tms'), { recursive: true });
  fs.symlinkSync(
    '../../../../packages/db',
    path.join(root, 'apps/api/node_modules/@tms/db'),
    'dir',
  );
  return root;
}

let ws;
beforeAll(() => {
  ws = createWorkspace();
});
afterAll(() => {
  fs.rmSync(ws, { recursive: true, force: true });
});

describe('createJestConfig', () => {
  it('returns the Nest 12 template settings plus the workspace interop options', () => {
    expect(createJestConfig({ rootDir: '/repo/apps/api-admin' })).toEqual({
      rootDir: '/repo/apps/api-admin',
      moduleFileExtensions: ['js', 'json', 'ts'],
      testEnvironment: 'node',
      testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
      moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
      transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
      transformIgnorePatterns: ['/node_modules/', '/packages/[^/]+/dist/'],
      maxWorkers: '50%',
      collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/instrument.ts'],
      coverageDirectory: '<rootDir>/coverage',
    });
  });

  it('uses two workers when CI is set', () => {
    process.env.CI = 'true';
    expect(createJestConfig({ rootDir: '/repo/apps/api-admin' }).maxWorkers).toBe(2);
  });

  it('maps .js-suffixed relative specifiers to extensionless ones and nothing else', () => {
    const [[pattern, replacement]] = Object.entries(
      createJestConfig({ rootDir: '/r' }).moduleNameMapper,
    );
    const map = (specifier) => specifier.replace(new RegExp(pattern), replacement);
    expect(map('./permissions.js')).toBe('./permissions');
    expect(map('../audit/index.js')).toBe('../audit/index');
    expect(new RegExp(pattern).test('@tms/contracts')).toBe(false);
    expect(new RegExp(pattern).test('./data.json')).toBe(false);
  });

  it('never transforms node_modules or the dist/ of a workspace package', () => {
    const patterns = createJestConfig({ rootDir: '/r' }).transformIgnorePatterns.map(
      (p) => new RegExp(p),
    );
    const ignored = (file) => patterns.some((p) => p.test(file));
    expect(ignored('/repo/node_modules/.pnpm/zod@4.6.5/node_modules/zod/index.js')).toBe(true);
    expect(ignored('/repo/packages/contracts/dist/index.js')).toBe(true);
    expect(ignored('/repo/packages/db/src/testing/index.ts')).toBe(false);
    expect(ignored('/repo/apps/api-admin/src/app.ts')).toBe(false);
  });

  it('database: true in a consumer resolves the compiled harness through @tms/db exports', () => {
    const config = createJestConfig({ rootDir: path.join(ws, 'apps/api'), database: true });
    expect(config.globalSetup).toBe(path.join(ws, 'packages/db/dist/testing/global-setup.js'));
    expect(config.globalTeardown).toBe(
      path.join(ws, 'packages/db/dist/testing/global-teardown.js'),
    );
    expect(config.testTimeout).toBe(30_000);
  });

  it('database: true inside @tms/db uses the harness sources', () => {
    const config = createJestConfig({ rootDir: path.join(ws, 'packages/db'), database: true });
    expect(config.globalSetup).toBe('<rootDir>/src/testing/global-setup.ts');
    expect(config.globalTeardown).toBe('<rootDir>/src/testing/global-teardown.ts');
    expect(config.testTimeout).toBe(30_000);
  });

  it('database: true without a dependency on @tms/db names what is missing', () => {
    const manifest = path.join(ws, 'apps/plain/package.json');
    expect(() =>
      createJestConfig({ rootDir: path.join(ws, 'apps/plain'), database: true }),
    ).toThrow(
      `createJestConfig({ database: true }) needs "@tms/db": "workspace:*" among the dependencies of ${manifest} and a built @tms/db (turbo runs ^build first)`,
    );
  });
});
```

`packages/config/test/eslint-boundaries-packages.test.mjs` (spike S2's test plus case (g) for the `web` element; it lints in-memory sources against a temporary pnpm-style workspace with exports-only manifests, `dist/*.d.ts` stubs and relative `node_modules` symlinks; `fs.realpathSync` on the temp root matters because unrs-resolver returns real paths and `boundaries/root-path` must match them — `/tmp` is a symlink on macOS):

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { nodeConfig } from '../eslint/node.mjs';

const warnings = [];
vi.spyOn(console, 'warn').mockImplementation((...args) => {
  warnings.push(args.join(' '));
});

/** pnpm-style workspace: exports-only packages, dist stubs, node_modules symlinks. */
function createWorkspace() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tms-boundaries-')));
  const entry = (p) => ({ types: `./dist/${p}index.d.ts`, default: `./dist/${p}index.js` });
  const pkg = (dir, name, exports) => {
    fs.mkdirSync(path.join(root, dir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, dir, 'dist', 'shared'), { recursive: true });
    fs.writeFileSync(
      path.join(root, dir, 'package.json'),
      JSON.stringify({ name, type: 'module', exports }),
    );
    for (const f of ['index', 'shared/index']) {
      fs.writeFileSync(
        path.join(root, dir, 'dist', `${f}.d.ts`),
        'export declare const x: number;\n',
      );
      fs.writeFileSync(path.join(root, dir, 'dist', `${f}.js`), 'export const x = 1;\n');
    }
  };
  pkg('packages/contracts', '@tms/contracts', { '.': entry('') });
  pkg('packages/db', '@tms/db', { '.': entry('') });
  pkg('packages/domain', '@tms/domain', { '.': entry(''), './shared': entry('shared/') });
  pkg('packages/nest-bootstrap', '@tms/nest-bootstrap', { '.': entry('') });
  for (const app of ['api-admin', 'web-admin']) {
    fs.mkdirSync(path.join(root, 'apps', app, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'apps', app, 'package.json'),
      JSON.stringify({ name: `@tms/${app}`, private: true }),
    );
  }
  const link = (from, dep, target) => {
    const linkPath = path.join(root, from, 'node_modules', dep);
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.symlinkSync(path.relative(path.dirname(linkPath), path.join(root, target)), linkPath, 'dir');
  };
  link('packages/contracts', '@tms/db', 'packages/db');
  link('packages/db', '@tms/domain', 'packages/domain');
  link('packages/db', '@tms/contracts', 'packages/contracts');
  link('packages/domain', '@tms/db', 'packages/db');
  link('packages/nest-bootstrap', '@tms/domain', 'packages/domain');
  link('apps/api-admin', '@tms/nest-bootstrap', 'packages/nest-bootstrap');
  link('apps/web-admin', '@tms/nest-bootstrap', 'packages/nest-bootstrap');
  fs.mkdirSync(path.join(root, 'packages/contracts/node_modules/zod'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'packages/contracts/node_modules/zod/package.json'),
    JSON.stringify({ name: 'zod', main: 'index.js' }),
  );
  fs.writeFileSync(
    path.join(root, 'packages/contracts/node_modules/zod/index.js'),
    'module.exports = {};\n',
  );
  return root;
}

let ws;
beforeAll(() => {
  ws = createWorkspace();
});
afterAll(() => {
  fs.rmSync(ws, { recursive: true, force: true });
});

async function lint(relFile, source) {
  const eslint = new ESLint({
    cwd: ws,
    overrideConfigFile: true,
    overrideConfig: [
      ...nodeConfig({ tsconfigRootDir: ws, boundariesRootPath: ws }),
      tseslint.configs.disableTypeChecked,
    ],
  });
  const [result] = await eslint.lintText(source, { filePath: path.join(ws, relFile) });
  return result.messages;
}
const boundaryMessages = (messages) =>
  messages.filter((m) => m.ruleId === 'boundaries/dependencies').map((m) => m.message);
const RULE = '(dependency rule contracts <- db <- domain <- apps)';

describe('dependency rule over @tms/* package specifiers (pnpm symlinks, exports-only package.json)', () => {
  it('(a) forbids contracts importing @tms/db', async () => {
    const messages = await lint(
      'packages/contracts/src/x.ts',
      `import { x } from '@tms/db';\nexport { x };\n`,
    );
    expect(boundaryMessages(messages)).toEqual([`contracts may not import db ${RULE}`]);
  });
  it('(b) forbids db importing the @tms/domain/shared subpath export', async () => {
    const messages = await lint(
      'packages/db/src/x.ts',
      `import { x } from '@tms/domain/shared';\nexport { x };\n`,
    );
    expect(boundaryMessages(messages)).toEqual([`db may not import domain ${RULE}`]);
  });
  it('(c) allows domain importing @tms/db', async () => {
    const messages = await lint(
      'packages/domain/src/x.ts',
      `import { x } from '@tms/db';\nexport { x };\n`,
    );
    expect(boundaryMessages(messages)).toEqual([]);
  });
  it('(d) ignores external packages such as zod', async () => {
    const messages = await lint(
      'packages/contracts/src/y.ts',
      `import { z } from 'zod';\nexport { z };\n`,
    );
    expect(boundaryMessages(messages)).toEqual([]);
  });
  it('(e) forbids nest-bootstrap importing @tms/domain', async () => {
    const messages = await lint(
      'packages/nest-bootstrap/src/x.ts',
      `import { x } from '@tms/domain';\nexport { x };\n`,
    );
    expect(boundaryMessages(messages)).toEqual([`bootstrap may not import domain ${RULE}`]);
  });
  it('(f) allows an api app importing @tms/nest-bootstrap', async () => {
    const messages = await lint(
      'apps/api-admin/src/x.ts',
      `import { b } from '@tms/nest-bootstrap';\nexport { b };\n`,
    );
    expect(boundaryMessages(messages)).toEqual([]);
  });
  it('(g) forbids a web app importing @tms/nest-bootstrap', async () => {
    const messages = await lint(
      'apps/web-admin/src/x.ts',
      `import { b } from '@tms/nest-bootstrap';\nexport { b };\n`,
    );
    expect(boundaryMessages(messages)).toEqual([`web may not import bootstrap ${RULE}`]);
  });
  it('configures the plugin without deprecation warnings', () => {
    expect(warnings.filter((w) => w.includes('[boundaries]'))).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the config tests to verify they fail**

Run: `pnpm turbo run test --filter=@tms/config --force`
Expected: FAIL, `Test Files  4 failed | 1 passed (5)`, `Tests  35 failed | 78 passed (113)`:
- `tsconfig-presets.test.mjs` 6 failed | 4 passed: the four `node-library.json`/`nest-library.json` option cases find `error TS5083: Cannot read file '…/tsconfig/node-library.json'` (or `nest-library.json`) in `parsed.errors`, and the two clean-compile cases get `[ 'TS2591', 'TS5083' ]` instead of `[]`; the two phase 0 cases and the two `library.json` compile cases (`['TS2591']`, `['TS1287', 'TS2591']`) already pass;
- `jest-preset.test.mjs` 7 failed (the old preset has no mapper, no `maxWorkers`, no `database`);
- `eslint-boundaries.test.mjs` 18 failed | 66 passed: the eleven matrix cases that expect an error to or from `bootstrap` (the phase 0 config has no such element, and files outside every element are not checked), `forbids api importing ui` and the five `forbids web importing db/auth-core/logger/domain/bootstrap` cases (both apps are still the one element `app`), and the new `web may not import db` message case;
- `eslint-boundaries-packages.test.mjs` 4 failed | 4 passed: (a), (b), (e) and (g) get `[]` — the node resolver never resolves an `@tms/*` specifier to a local file, so nothing is reported; (c), (d), (f) and the warning check pass;
- `eslint-node.test.mjs` 4 passed.

- [ ] **Step 4: Write the presets**

`packages/config/tsconfig/library.json` stays as phase 0 left it (`outDir: "${configDir}/dist"`, `rootDir: "${configDir}/src"`); `node-library.json` inherits both.

`packages/config/tsconfig/node-library.json`:

```json
{
  // ESM library for Node (library.json + Node types); browser-safe packages use library.json.
  "extends": "./library.json",
  "compilerOptions": { "types": ["node"] }
}
```

`packages/config/tsconfig/nest-library.json`:

```json
{
  // CommonJS on purpose: nestjs-cls, @nestjs-cls/* and zod ship dual builds, so an ESM library
  // next to the CommonJS apps would load a second copy (a second TransactionHost class).
  // Not based on library.json: verbatimModuleSyntax rejects CommonJS output (TS1287, TS1295).
  // ${configDir} is the directory of the extending tsconfig, so dist/ and src/ are the package's.
  "extends": "./base.json",
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strictPropertyInitialization": false,
    "declaration": true,
    "declarationMap": true,
    "types": ["node"],
    "outDir": "${configDir}/dist",
    "rootDir": "${configDir}/src"
  }
}
```

(`base.json` already has `isolatedModules: true`, which S3 measured as halving ts-jest time under `nodenext`.)

`packages/db/tsconfig.json` (the local `types` duplicated what `node-library.json` now provides; Task 04 moves `@tms/db` to CommonJS and `nest-library.json`):

```json
{
  "extends": "@tms/config/tsconfig/node-library.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true },
  "include": ["prisma.config.ts"]
}
```

`e2e/tsconfig.json` (same duplication):

```json
{
  "extends": "@tms/config/tsconfig/node-library.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true },
  "include": ["playwright.config.ts", "tests"]
}
```

- [ ] **Step 5: Write the Jest preset**

`packages/config/jest/create-config.mjs`:

```js
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/** Package that ships the Testcontainers harness (`@tms/db/testing`). */
export const HARNESS_PACKAGE = '@tms/db';

/**
 * Jest configuration for NestJS apps and CommonJS libraries (the Nest 12 template plus the
 * interop settings the workspace needs). Run with
 * `NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' jest`:
 * `@nestjs/*` and `@tms/contracts` ship ESM, which jest-runtime 30 loads through `require(esm)`.
 *
 * @param {{ rootDir: string, database?: boolean }} options
 *   `database: true` adds the Testcontainers harness (one Postgres per run, one database per
 *   worker); the package needs `"@tms/db": "workspace:*"` among its (dev)dependencies.
 * @returns {import('jest').Config}
 */
export function createJestConfig({ rootDir, database = false }) {
  const config = {
    rootDir,
    moduleFileExtensions: ['js', 'json', 'ts'],
    testEnvironment: 'node',
    testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
    // Jest 30 resolves through unrs-resolver, which has no `.js` -> `.ts` fallback; CommonJS
    // packages write extensionless relative imports, this maps any `.js` suffix that slips in.
    moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
    transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
    // Workspace packages are consumed from their compiled dist/; transforming it again only costs
    // time (spike: 6.2 s instead of 1.4 s).
    transformIgnorePatterns: ['/node_modules/', '/packages/[^/]+/dist/'],
    maxWorkers: process.env['CI'] ? 2 : '50%',
    collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/instrument.ts'],
    coverageDirectory: '<rootDir>/coverage',
  };
  return database ? { ...config, ...databaseHarness(rootDir), testTimeout: 30_000 } : config;
}

/** @param {string} rootDir */
function databaseHarness(rootDir) {
  const manifestPath = path.join(rootDir, 'package.json');
  const { name } = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (name === HARNESS_PACKAGE) {
    // The harness package tests its own sources: its dist/ does not exist before `build`.
    return {
      globalSetup: '<rootDir>/src/testing/global-setup.ts',
      globalTeardown: '<rootDir>/src/testing/global-teardown.ts',
    };
  }
  // Resolve from the consuming package (its dependency on @tms/db), not from packages/config.
  const requireFromPackage = createRequire(manifestPath);
  try {
    return {
      globalSetup: requireFromPackage.resolve(`${HARNESS_PACKAGE}/testing/jest-global-setup`),
      globalTeardown: requireFromPackage.resolve(`${HARNESS_PACKAGE}/testing/jest-global-teardown`),
    };
  } catch (error) {
    throw new Error(
      `createJestConfig({ database: true }) needs "${HARNESS_PACKAGE}": "workspace:*" among the ` +
        `dependencies of ${manifestPath} and a built ${HARNESS_PACKAGE} (turbo runs ^build first)`,
      { cause: error },
    );
  }
}
```

The transform no longer matches `.js`: compiled workspace `dist/` files (CommonJS libraries and the ESM `contracts`) load untransformed, which jest-runtime 30.5 handles natively (S1). `maxWorkers: 2` under `CI` keeps the GitHub runner (4 vCPU) from starting one Testcontainers clone per core; turbo passes `CI` to tasks by default (verified), and a command-line `--maxWorkers` still wins.

- [ ] **Step 6: Switch the boundaries resolver and add the `bootstrap` element**

`packages/config/eslint/base.mjs`: replace lines 1–68 (imports through the end of `boundariesConfig`) with the block below; `policy()` and `baseConfig()` (lines 69–108) stay as they are.

```js
import { createRequire } from 'node:module';
import path from 'node:path';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';

/** Repository root, derived from this file's real location (packages/config/eslint). */
export const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');

// eslint-module-utils loads resolvers by require() from the linted file's location, then from its
// own pnpm virtual-store path; neither can see packages/config/node_modules, so the resolver is
// passed by absolute path.
const tsResolver = createRequire(import.meta.url).resolve('eslint-import-resolver-typescript');

export const ignores = globalIgnores([
  '**/dist/**',
  '**/coverage/**',
  '**/node_modules/**',
  '**/generated/**',
  '**/.turbo/**',
  '**/playwright-report/**',
  '**/test-results/**',
  '**/public/mockServiceWorker.js',
]);

/**
 * Dependency rule from the spec (section 3): contracts <- db <- domain <- apps, plus
 * contracts, db, logger <- bootstrap <- api for the shared Nest bootstrap (phase 1 plan). Apps are
 * two element types: `api` (NestJS, apps/api-*) and `web` (React SPAs, apps/web-*).
 * eslint-plugin-boundaries v7: element patterns are folder patterns (no file part), and
 * `capture` names one entry per wildcard. Paths are matched relative to `rootPath`, so the same
 * configuration works when eslint runs inside any workspace package.
 *
 * @param {string} rootPath repository root (or a fixtures root in tests)
 */
export function boundariesConfig(rootPath) {
  return {
    plugins: { boundaries },
    settings: {
      // eslint-import-resolver-typescript (unrs-resolver) reads package.json `exports` and
      // realpaths pnpm's node_modules symlinks, so an `@tms/*` specifier resolves to the imported
      // package's own files and counts as a local dependency. It replaces the node resolver
      // instead of joining it: ESLint deep-merges settings, the node resolver would be tried
      // first, and its un-realpathed node_modules path makes the plugin treat the import as
      // external, i.e. unchecked.
      'import/resolver': { [tsResolver]: {} },
      'boundaries/root-path': rootPath,
      'boundaries/elements': [
        { type: 'contracts', pattern: 'packages/contracts' },
        { type: 'db', pattern: 'packages/db' },
        { type: 'auth-core', pattern: 'packages/auth-core' },
        { type: 'logger', pattern: 'packages/logger' },
        { type: 'domain', pattern: 'packages/domain' },
        { type: 'ui', pattern: 'packages/ui' },
        { type: 'bootstrap', pattern: 'packages/nest-bootstrap' },
        { type: 'api', pattern: 'apps/api-*', capture: ['name'] },
        { type: 'web', pattern: 'apps/web-*', capture: ['name'] },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          message:
            '{{from.type}} may not import {{to.type}} (dependency rule contracts <- db <- domain <- apps)',
          policies: [
            policy('db', ['contracts']),
            policy('auth-core', ['contracts']),
            policy('logger', ['contracts']),
            policy('domain', ['contracts', 'db', 'auth-core', 'logger']),
            policy('ui', ['contracts']),
            policy('bootstrap', ['contracts', 'db', 'logger']),
            policy('api', ['contracts', 'db', 'auth-core', 'logger', 'domain', 'bootstrap']),
            policy('web', ['contracts', 'ui']),
          ],
        },
      ],
    },
  };
}
```

`web` may no longer import `db`, `auth-core`, `logger` or `domain` (phase 0 allowed it through the shared `app` type), and `api` no longer imports `ui` (journal W5). No `project`, no `alwaysTryTypes` (S2: irrelevant without `paths`; `project` globs print a "Multiple projects found" warning) and never `symlinks: false` (that returns the `node_modules` path and silently disables the rule again). The default extensions of the typescript resolver cover `.ts`/`.tsx`, which the removed node-resolver setting listed explicitly.

- [ ] **Step 7: Run the config tests to verify they pass, then lint**

Run: `pnpm turbo run test --filter=@tms/config --force`
Expected: PASS, `Test Files  5 passed (5)`, `Tests  113 passed (113)` (`tsconfig-presets` 10, `jest-preset` 7, `eslint-boundaries` 84 = 81 matrix cases + 3, `eslint-boundaries-packages` 8, `eslint-node` 4).

Run: `pnpm turbo run lint --filter=@tms/config`
Expected: exit 0.

- [ ] **Step 8: Hygiene — one copy per process (test first)**

`tools/scripts/check-hygiene.test.mjs` (phase 0, 114 lines) — three changes, everything else unchanged; line numbers refer to the file before this step.

Replace lines 2–7 (the import) with:

```js
import { describe, expect, it } from 'vitest';
import {
  CLAUDE_MD_MAX_LINES,
  claudeMdLineCount,
  findDuplicateCopies,
  findForbiddenDocuments,
  runHygiene,
} from './check-hygiene.mjs';
```

Insert after line 68 (the `});` closing `describe('findForbiddenDocuments', …)`), before the blank line and `describe('claudeMdLineCount', …)`:

```js

describe('findDuplicateCopies', () => {
  it('accepts one store directory per watched package and packages not installed yet', () => {
    const entries = [
      '@nestjs+common@12.1.0_reflect-metadata@0.2.2_rxjs@7.8.2',
      '@nestjs+core@12.1.0_@nestjs+common@12.1.0_reflect-metadata@0.2.2_rxjs@7.8.2',
      'lock.yaml',
      'node_modules',
    ];
    expect(findDuplicateCopies(entries)).toEqual([]);
  });

  it('reports a package that pnpm installed with two peer sets', () => {
    const entries = ['@nestjs+core@12.1.0_rxjs@7.8.2_a', '@nestjs+core@12.1.0_rxjs@7.8.2_b'];
    expect(findDuplicateCopies(entries)).toEqual([
      {
        name: '@nestjs/core',
        copies: ['@nestjs+core@12.1.0_rxjs@7.8.2_a', '@nestjs+core@12.1.0_rxjs@7.8.2_b'],
      },
    ]);
  });

  it('does not count packages that only share a name prefix', () => {
    const entries = [
      '@nestjs-cls+transactional@4.0.0_x',
      '@nestjs-cls+transactional-adapter-prisma@2.0.0_x',
      '@prisma+client@7.10.0_y',
      '@prisma+client-runtime-utils@7.10.0',
      'nestjs-cls@7.0.0_z',
    ];
    expect(findDuplicateCopies(entries)).toEqual([]);
  });
});
```

Insert after line 113 (the `});` closing the test "reports a tracked file under docs/client/ with a distinct message"), inside `describe('runHygiene', …)`:

```js

  it('reports duplicate copies found in node_modules/.pnpm', () => {
    const problems = runHygiene({
      trackedFiles: [],
      claudeMd: '',
      pnpmStoreEntries: ['@prisma+client@7.10.0_a', '@prisma+client@7.10.0_b'],
    });
    expect(problems).toEqual([
      '@prisma/client is installed 2 times (@prisma+client@7.10.0_a, @prisma+client@7.10.0_b); align versions and peers so one copy remains',
    ]);
  });

  it('skips the single-copy check without node_modules/.pnpm', () => {
    expect(runHygiene({ trackedFiles: [], claudeMd: '', pnpmStoreEntries: null })).toEqual([]);
  });
```

`tools/scripts/check-hygiene-cli.test.mjs` (phase 0: copies the script into a throwaway git repository and runs it with `node`, as husky and CI do): insert after line 42 (the `});` closing the phase 0 case), inside `describe('check-hygiene CLI', …)`:

```js

  it('exits 1 on two store directories of a single-copy package and 0 with one', () => {
    const store = path.join(repo, 'node_modules', '.pnpm');
    mkdirSync(path.join(store, '@prisma+client@7.10.0_a'), { recursive: true });
    mkdirSync(path.join(store, '@prisma+client@7.10.0_b'), { recursive: true });

    const failing = spawnSync('node', [script], { cwd: repo, encoding: 'utf8' });
    expect(failing.status).toBe(1);
    expect(failing.stderr).toContain(
      'hygiene: @prisma/client is installed 2 times (@prisma+client@7.10.0_a, @prisma+client@7.10.0_b)',
    );

    rmSync(path.join(store, '@prisma+client@7.10.0_b'), { recursive: true });

    const passing = spawnSync('node', [script], { cwd: repo, encoding: 'utf8' });
    expect(passing.status).toBe(0);
    expect(passing.stdout).toBe('hygiene: ok (0 tracked files, single copies ok)\n');
  });
```

Run: `pnpm turbo run test --filter=@tms/scripts --force`
Expected: FAIL, `Test Files  2 failed (2)`, `Tests  5 failed | 13 passed (18)` — three `TypeError: findDuplicateCopies is not a function`, `expected [] to deeply equal [ Array(1) ]` for the `runHygiene` duplicate case (the old `runHygiene` ignores `pnpmStoreEntries`) and `expected +0 to be 1` for the CLI case (the old `main()` never reads `node_modules/.pnpm`); vitest fails, so `gitleaks.test.sh` does not run.

`tools/scripts/check-hygiene.mjs` (full file; the phase 0 `docs/client/` rules are unchanged):

```js
#!/usr/bin/env node
/**
 * Repository hygiene (spec sections 13 and 14; public repository):
 *  - no client-type documents tracked outside docs/client/: PDF, Word, PowerPoint, Excel,
 *    OpenDocument, Visio, AutoCAD drawings and saved mail (FORBIDDEN_DOCUMENT_RE),
 *  - CLAUDE.md stays short,
 *  - packages whose classes must exist once per process are installed once
 *    (SINGLE_COPY_PACKAGES; skipped without node_modules/.pnpm, e.g. in the CI hygiene job).
 * The client's name is kept out of the repository by convention, not by this script
 * (ADR 0007). Exit 1 with one line per problem.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORBIDDEN_DOCUMENT_RE =
  /\.(pdf|doc|docx|ppt|pptx|xls|xlsx|odt|ods|odp|vsd|vsdx|dwg|msg|eml)$/i;
export const CLIENT_DOCS_DIR = 'docs/client/';
export const CLAUDE_MD_MAX_LINES = 150;
/**
 * Nest's DI tokens and nestjs-cls' TransactionHost/ClsService are compared by class identity; a
 * second copy (another version or another peer-dependency set, i.e. another directory in
 * node_modules/.pnpm) splits them silently. Packages not installed yet are fine.
 */
export const SINGLE_COPY_PACKAGES = [
  '@nestjs/common',
  '@nestjs/core',
  'nestjs-cls',
  '@nestjs-cls/transactional',
  '@prisma/client',
];

/** @param {string[]} trackedFiles */
export function findForbiddenDocuments(trackedFiles) {
  return trackedFiles.filter(
    (f) =>
      (FORBIDDEN_DOCUMENT_RE.test(f) && !f.startsWith(CLIENT_DOCS_DIR)) ||
      (f.startsWith(CLIENT_DOCS_DIR) && f !== `${CLIENT_DOCS_DIR}README.md`),
  );
}

/** @param {string} text */
export function claudeMdLineCount(text) {
  return text === '' ? 0 : text.replace(/\n$/, '').split('\n').length;
}

/**
 * @param {string[]} storeEntries directory names in node_modules/.pnpm
 * @param {string[]} packages
 * @returns {{ name: string, copies: string[] }[]}
 */
export function findDuplicateCopies(storeEntries, packages = SINGLE_COPY_PACKAGES) {
  return packages.flatMap((name) => {
    // pnpm names a store directory `<name with / as +>@<version>[_<peer set>]`.
    const prefix = `${name.replace('/', '+')}@`;
    const copies = storeEntries.filter((entry) => entry.startsWith(prefix)).sort();
    return copies.length > 1 ? [{ name, copies }] : [];
  });
}

/**
 * @param {{ trackedFiles: string[], claudeMd: string | null, pnpmStoreEntries?: string[] | null }} input
 *   `pnpmStoreEntries` is null when node_modules/.pnpm does not exist (check skipped).
 */
export function runHygiene({ trackedFiles, claudeMd, pnpmStoreEntries = null }) {
  const problems = findForbiddenDocuments(trackedFiles).map((f) =>
    f.startsWith(CLIENT_DOCS_DIR)
      ? `tracked file under docs/client/ (must stay untracked): ${f}`
      : `client-type document outside docs/client/: ${f}`,
  );
  if (claudeMd !== null) {
    const lines = claudeMdLineCount(claudeMd);
    if (lines > CLAUDE_MD_MAX_LINES) {
      problems.push(
        `CLAUDE.md has ${lines} lines (max ${CLAUDE_MD_MAX_LINES}); move detail into docs/`,
      );
    }
  }
  if (pnpmStoreEntries !== null) {
    for (const { name, copies } of findDuplicateCopies(pnpmStoreEntries)) {
      problems.push(
        `${name} is installed ${copies.length} times (${copies.join(', ')}); align versions and peers so one copy remains`,
      );
    }
  }
  return problems;
}

function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const trackedFiles = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  const claudeMdPath = path.join(repoRoot, 'CLAUDE.md');
  const claudeMd = existsSync(claudeMdPath) ? readFileSync(claudeMdPath, 'utf8') : null;
  const storeDir = path.join(repoRoot, 'node_modules', '.pnpm');
  const pnpmStoreEntries = existsSync(storeDir) ? readdirSync(storeDir) : null;

  const problems = runHygiene({ trackedFiles, claudeMd, pnpmStoreEntries });
  for (const p of problems) console.error(`hygiene: ${p}`);
  if (problems.length > 0) process.exit(1);
  const singleCopy = pnpmStoreEntries === null ? 'single-copy check skipped' : 'single copies ok';
  console.log(`hygiene: ok (${trackedFiles.length} tracked files, ${singleCopy})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
```

`.github/workflows/ci.yml`: the `hygiene` job has no `pnpm install`, so the new check would always be skipped there; insert after line 31 (`      - run: pnpm install --frozen-lockfile` in the `verify` job):

```yaml
      - name: One copy of Nest, nestjs-cls and the Prisma client
        run: node tools/scripts/check-hygiene.mjs
```

Run: `pnpm turbo run test --filter=@tms/scripts --force && pnpm turbo run lint --filter=@tms/scripts && node tools/scripts/check-hygiene.mjs`
Expected: `Tests  18 passed (18)` and the four `gitleaks.test.sh` `ok` lines; lint exit 0; `hygiene: ok (<N> tracked files, single copies ok)` (today's store has one `@nestjs+common@12.1.0_…` and one `@nestjs+core@12.1.0_…` directory).

- [ ] **Step 9: Turbo tasks and engines**

`turbo.json` (full file):

```json
{
  "$schema": "https://turborepo.dev/schema.json",
  "ui": "stream",
  "globalDependencies": [".nvmrc", "pnpm-workspace.yaml", "packages/config/**"],
  "globalPassThroughEnv": ["DOCKER_*", "XDG_RUNTIME_DIR", "TESTCONTAINERS_*"],
  "tasks": {
    "generate": {
      "inputs": ["prisma/schema.prisma", "prisma.config.ts", "package.json"],
      "outputs": ["src/generated/**"]
    },
    "build": {
      "dependsOn": ["^build", "generate"],
      "outputs": ["dist/**"],
      "inputs": ["$TURBO_DEFAULT$", "!**/*.md"]
    },
    "typecheck": { "dependsOn": ["^build", "generate"] },
    "lint": { "dependsOn": ["^build", "generate"] },
    "test": { "dependsOn": ["^build", "generate"], "outputs": [] },
    "dev": { "cache": false, "persistent": true, "dependsOn": ["^build", "generate"] },
    "db:validate": { "cache": false },
    "db:migrate:dev": {
      "cache": false,
      "dependsOn": ["generate"],
      "passThroughEnv": ["DATABASE_URL"]
    },
    "db:migrate:deploy": { "cache": false, "passThroughEnv": ["DATABASE_URL"] },
    "db:migrate:status": { "cache": false, "passThroughEnv": ["DATABASE_URL"] },
    "db:drift": { "cache": false, "passThroughEnv": ["DATABASE_URL"] }
  }
}
```

Why each piece: `generate` is the Prisma client generation Task 05 adds to `@tms/db` (Prisma 7's `migrate dev` no longer generates); packages without a `generate` script skip it, so today nothing changes. `test.outputs: []` removes turbo's "no output files found for task …#test" warning (no test run writes `coverage/`). `DOCKER_*` and `XDG_RUNTIME_DIR` are in turbo's default pass-through list already (verified) and are listed so the Testcontainers dependency is explicit; `TESTCONTAINERS_*` is not a default and would be dropped in strict mode. `DATABASE_URL` reaches only the `db:*` tasks — never `test`. Arguments after `--` go to the named task only, e.g. `pnpm turbo run db:migrate:dev --filter=@tms/db -- --name <change>` (this is the allowlisted form; `pnpm --filter` is not).

`package.json` (root): no change. `main` (0d5f4ac) already requires `"node": ">=26.0.0"` with `.nvmrc` `26`, which is above the ≥ 24.13 that `Module.registerHooks` (Sentry 11, Task 13) and Jest's `require(esm)` (≥ 24.9) need; `engineStrict: true` in `pnpm-workspace.yaml` makes `pnpm install` refuse older Node.

Run: `pnpm install && pnpm exec prettier --write turbo.json package.json packages/config packages/db/tsconfig.json e2e/tsconfig.json tools/scripts .github/workflows/ci.yml`
Expected: `Already up to date` (or `Done`), exit 0; Prettier leaves the files as shown.

- [ ] **Step 10: Scoped verification**

Run: `pnpm turbo run test --filter=@tms/api-admin --force && pnpm turbo run test --filter=@tms/api-driver --force`
Expected: each `Test Suites: 2 passed, 2 total` and `Tests: 14 passed, 14 total` (phase 0: 10 `env.spec.ts` cases + 4 `app.e2e-spec.ts` cases; the `.ts`-only transform and the mapper change nothing for the apps).

Run: `mkdir -p .cache && pnpm turbo run lint --filter=@tms/api-admin --force > .cache/lint-api-admin.log 2>&1; echo lint=$?; grep -c '\[boundaries\]' .cache/lint-api-admin.log`
Expected: `lint=0` and `0`. Same for `--filter=@tms/api-driver`.

Run: `pnpm turbo run typecheck --filter=@tms/db && pnpm turbo run typecheck --filter=@tms/e2e`
Expected: exit 0 for both (`node-library.json` supplies the Node types they used to list themselves).

Database tasks through turbo (throwaway container from the Execution notes):

```bash
docker rm -f tms-p1-pg 2>/dev/null; docker network inspect tms-p1-net >/dev/null 2>&1 || docker network create tms-p1-net
docker run -d --name tms-p1-pg --network tms-p1-net -p 55432:5432 -e POSTGRES_USER=tms -e POSTGRES_PASSWORD=tms -e POSTGRES_DB=tms postgres:18-alpine
sleep 3
```

Run: `DATABASE_URL=postgresql://tms:tms@localhost:55432/tms pnpm turbo run db:drift --filter=@tms/db; echo drift=$?`
Expected: `prisma migrate status` (the first half of phase 0's `db:drift`) finds no migration and exits 0, then `@tms/db:db:drift: No difference detected.` and `drift=0` (empty schema, empty database).

Run: `pnpm turbo run db:validate --filter=@tms/db`
Expected: `The schema at prisma/schema.prisma is valid`, exit 0.

Run (arguments pass through to the entry task; `--create-only` keeps the scratch database untouched):
```bash
docker exec tms-p1-pg createdb -U tms tms_probe
DATABASE_URL=postgresql://tms:tms@localhost:55432/tms_probe pnpm turbo run db:migrate:dev --filter=@tms/db -- --name probe --create-only
ls packages/db/prisma/migrations && cat packages/db/prisma/migrations/*_probe/migration.sql
```
Expected: `@tms/db:db:migrate:dev: $ prisma migrate dev --name probe --create-only`, then `Prisma Migrate created the following migration without applying it <timestamp>_probe`; the listing shows `<timestamp>_probe` and `migration_lock.toml`; the SQL file is `-- This is an empty migration.`

Run: `rm -rf packages/db/prisma/migrations/*_probe && docker exec tms-p1-pg dropdb -U tms tms_probe && git status --short packages/db && docker rm -f tms-p1-pg && docker network rm tms-p1-net`
Expected: `git status` prints nothing for `packages/db`; the container and network are gone.

- [ ] **Step 11: Documentation**

`README.md`: replace line 11 with

```md
- Node 26 (`.nvmrc`; `engines` enforces it), pnpm 12.5.1 (`corepack enable` picks it from `packageManager`)
```

`CLAUDE.md`: replace lines 50–51 (keeps the line count, so Task 03's "after line 53" still holds; 40–41 before `main` 0d5f4ac grew the Stack section by ten lines):

```md
- Dependency rule `contracts <- db <- domain <- apps`, `contracts, db, logger <- bootstrap <- api`,
  web apps only `contracts`/`ui` (eslint boundaries); `api-driver` only `@tms/domain/{checkin,shared}`.
```

`docs/architecture.md`: replace lines 41–46 (the paragraph under `## Dependency rule`; it grows from six to twelve lines, later tasks anchor on `## Environments`):

```md
`contracts <- db <- domain <- apps`, plus `contracts, db, logger <- bootstrap <- api` (`bootstrap`
is `packages/nest-bootstrap`, the shared Nest bootstrap). Apps are two element types: `api`
(`apps/api-*`) may import `contracts`, `db`, `auth-core`, `logger`, `domain` and `bootstrap`; `web`
(`apps/web-*`) only `contracts` and `ui`. Enforced by `eslint-plugin-boundaries`
(`packages/config/eslint/base.mjs`) for relative imports and `@tms/*` package specifiers alike:
`eslint-import-resolver-typescript` follows each package's `exports` and pnpm's symlinks to the
real file, so a forbidden import is reported however it is written
(`packages/config/test/eslint-boundaries-packages.test.mjs`). `api-driver` may import only
`@tms/domain/checkin` and `@tms/domain/shared` (`no-restricted-imports` in its eslint config).
`auth-core` is Nest-free and Prisma-free by convention; boundaries stops it importing `db`/`domain`,
and direct `@nestjs/*`/`@prisma/*` imports get their own `no-restricted-imports` rule when the
package lands (phase 2) — boundaries does not check npm-package specifiers.
```

Run: `pnpm exec prettier --write README.md CLAUDE.md docs/architecture.md && pnpm format:check && wc -l CLAUDE.md`
Expected: `All matched files use Prettier code style!`; `72 CLAUDE.md`.

- [ ] **Step 12: Whole-repository verification**

Run: `mkdir -p .cache && pnpm verify > .cache/verify-02.log 2>&1; echo verify=$?; grep -c 'no output files found' .cache/verify-02.log; grep -c '\[boundaries\]' .cache/verify-02.log; tail -4 .cache/verify-02.log`
Expected: `verify=0`, `0`, `0`; the tail shows `hygiene: ok (<N> tracked files, single copies ok)` and gitleaks `no leaks found`.

- [ ] **Step 13: Commit**

Append to `docs/efficiency/critical-path.md`:
`| 2026-MM-DD | Task 02: Config presets, Jest interop, generate task and specifier-aware boundaries | subagent | HH:MM | HH:MM | <rework or none> | n/a | <RED 35 failed/78 passed → GREEN 113; hygiene 5 failed → 18 passed; apps 14 + 14 unchanged; db:drift exit 0 and --name/--create-only pass-through shown; resolver added without allowBuilds prompt> |`

```bash
git add packages/config packages/db/tsconfig.json e2e/tsconfig.json turbo.json package.json pnpm-workspace.yaml pnpm-lock.yaml tools/scripts .github/workflows/ci.yml README.md CLAUDE.md docs/architecture.md docs/efficiency/critical-path.md
git commit -m "build(config): add library presets, Jest ESM interop, generate task and specifier-aware boundaries"
```
Expected: this commit passes all hooks (header 98 characters).

**PR body notes:**
- Diagram: Mermaid `flowchart LR` of the dependency rule with the new elements — `contracts --> db --> domain --> api`, `contracts --> auth-core --> domain`, `contracts --> logger --> domain`, `contracts & db & logger --> bootstrap --> api`, `contracts --> ui --> web`, `contracts --> web` (arrow = "may be imported by"); a note that `@tms/*` specifiers are now checked like relative imports and that `app` is split into `api` and `web`.
- Boundaries: `@tms/config` public API (`node-library.json`, `nest-library.json` with `${configDir}` paths like `library.json`, `createJestConfig({ rootDir, database })`, ESLint resolver, `bootstrap` element, `api`/`web` element types), turbo task graph (`generate`, `db:*`, pass-through env), hygiene check + one CI `verify` step. No product code. Migration: no.
- Verification plan: `pnpm verify`; `@tms/config` and `@tms/scripts` tests RED before and GREEN after the implementation; both API suites and their lint (no `[boundaries]` line); `db:drift`, `db:validate` and `db:migrate:dev -- --name probe --create-only` through turbo against `tms-p1-pg`; CI `verify`, `hygiene`, `db-drift`.
- Verification results (`scenario | layer | outcome`): `tsconfig presets: ${configDir} paths, option shapes, TS2591 / TS1287 / clean compiles | static (TypeScript API) | RED 6 failed → 10 passed`; `Jest preset shape, mapper, ignore patterns, database option | unit (Vitest) | 7 passed`; `boundaries 9×9 matrix with bootstrap/api/web + 2 message cases | lint (Vitest + ESLint) | RED 18 failed → 84 passed`; `boundaries over @tms/* specifiers (7 cases + warnings) | lint | RED 4 failed with the node resolver → 8 passed`; `eslint-node | lint | 4 passed`; `single-copy hygiene (unit + CLI) | unit | RED 5 failed → 18 passed`; `api-admin / api-driver suites | e2e (Jest) | 14 + 14 passed`; `db:drift / db:validate / db:migrate:dev -- --name probe --create-only via turbo | db (tms-p1-pg) | exit 0, empty probe migration removed`; `pnpm verify | repo | exit 0, 0 "no output files", 0 [boundaries]`.
- Risks and notes: every `@tms/*` import is now actually checked, so later PRs may surface violations the node resolver hid; web apps lose phase 0's implicit permission to import `db`, `auth-core`, `logger` and `domain` (none does); the harness preset resolves `@tms/db/testing/*` from the consumer, so `database: true` requires a dependency on `@tms/db` and a prior `^build` (turbo does that); the single-copy check flags more than one store directory and ignores packages not yet installed (deviation from "exactly one": `nestjs-cls`, `@nestjs-cls/transactional` and `@prisma/client` arrive in Tasks 05 and 14); `db:migrate:status` joins the three requested turbo `db:*` tasks.

---

---

### Task 03: `@tms/contracts` — enums, permission catalogue, seeded roles, audit actions and scrub list

**Branch:** `phase-1/03-contracts`
**PR title:** `feat(contracts): add enums, permission catalogue, seeded roles, audit actions and scrub list`

Spec: section 3 (enums defined once in `contracts`), 7 (every enum), 8–10 (audit action union), 9 (catalogue, seeded roles), 11 (redaction list and the Sentry scrub list shared from `contracts`), 12 (`EmailSchema` for forms). Depends on Task 02 only for the ESLint resolver; the package compiles with the existing `library.json` preset. Everything here is pure TypeScript with `zod` as the only runtime dependency: no Node types, no `process`, no `Buffer`, because the Vite SPAs (phase 6) import this package.

**Files:**
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/tsconfig.build.json`, `packages/contracts/eslint.config.mjs`, `packages/contracts/vitest.config.mjs`, `packages/contracts/README.md`, `packages/contracts/src/index.ts`, `packages/contracts/src/enums.ts`, `packages/contracts/src/permissions.ts`, `packages/contracts/src/roles.ts`, `packages/contracts/src/common.ts`, `packages/contracts/src/routing.ts`, `packages/contracts/src/audit/index.ts`, `packages/contracts/src/audit/auth.ts`, `packages/contracts/src/audit/admin.ts`, `packages/contracts/src/audit/ops.ts`, `packages/contracts/src/audit/checkin.ts`, `packages/contracts/src/audit/system.ts`, `packages/contracts/src/security/index.ts`, `packages/contracts/src/security/scrub.ts`
- Modify: `pnpm-workspace.yaml:33` (catalog entry `fast-check` after `vitest`; line 32 on `main`, 33 once Task 02's resolver line is in), `pnpm-lock.yaml` (regenerated), `CLAUDE.md:53` (one bullet under Rules), `docs/architecture.md:54` (new section before `## Environments`, after Task 02's twelve-line "Dependency rule" paragraph), `docs/efficiency/critical-path.md` (journal row)
- Test: `packages/contracts/test/enums.test.ts`, `packages/contracts/test/permissions.test.ts`, `packages/contracts/test/roles.test.ts`, `packages/contracts/test/audit.test.ts`, `packages/contracts/test/scrub.test.ts`

**Interfaces:**
- Consumes: `@tms/config/tsconfig/library.json` (ESM `nodenext`, declarations, `verbatimModuleSyntax`), `nodeConfig` from `@tms/config/eslint/node`, catalog `zod ^4.6.5`, `vitest ^5.0.1`, `typescript ~7.0.2` (default catalog: TypeScript 7's native `tsc` builds this ESM package; verified with 7.0.2), `eslint ^10.11.0`; new catalog entry `fast-check ^4.10.2`.
- Produces (package `@tms/contracts`, exports `.`, `./security`, `./audit`, each `{ types, default }`):
  - `DB_MIRRORED_ENUMS: Record<PrismaEnumName, z.ZodEnum>` with the 14 Prisma enum names `UserKind, UserStatus, DriverType, IdentityCardStatus, SessionScope, ActionTokenType, VehicleKind, LoadingPointKind, TransportKind, LoadingOrderStatus, QueueEntryStatus, CheckInVia, AuditApp, AuditOutcome`; per enum `XSchema` (`z.enum`) and type `X`.
  - `PERMISSION_GROUPS` (13), `PermissionDefinition = { readonly code: \`${PermissionGroup}:${string}\`; readonly group: PermissionGroup; readonly audience: UserKind; readonly defaultName: string; readonly defaultDescription: string; readonly renamedFrom?: readonly string[] }`, `PERMISSIONS` (33 entries, `as const satisfies readonly PermissionDefinition[]`), `PermissionCode` (union of the 33 codes), `PERMISSION_CODES`, `PermissionCodeSchema`, `permissionCodesForAudience(audience: UserKind, catalogue = PERMISSIONS): PermissionCode[]`, `validateCatalogue(catalogue: readonly PermissionDefinition[]): CatalogueProblem[]`, `CatalogueProblem = { readonly code: string; readonly problem: string }`.
  - `SEEDED_ROLES` (`as const satisfies readonly SeededRole[]`), `SeededRole = { key: 'admin' | 'operator' | 'driver'; name; description; appliesTo: UserKind; isSystem: boolean; permissionsLocked: boolean; permissions: 'ALL_FOR_AUDIENCE' | readonly PermissionCode[] }`, `ADMIN_ROLE_KEY = 'admin'`, `ALL_FOR_AUDIENCE`, `resolveRolePermissions(role: SeededRole, catalogue = PERMISSIONS): PermissionCode[]`.
  - `AUDIT_ACTIONS` (50 actions → `z.strictObject` metadata schema, aggregated from the per-area files `auth`, `admin`, `ops` (`admin.order.*`, owned by the ops lane from phase 4), `checkin`, `system`), `AuditAction`, `AUDIT_ACTION_NAMES`, `AuditActionSchema`, `AuditMetadata<A>`, `parseAuditMetadata<A extends AuditAction>(action: A, value: unknown): AuditMetadata<A>` (throws `AuditMetadataError { action: string; issues: readonly z.core.$ZodIssue[] }`), `AuditTargetTypeSchema` (13 target types).
  - `@tms/contracts/security`: `REDACTED = '[REDACTED]'`, `CIRCULAR`, `MAX_DEPTH_REACHED`, `SENSITIVE_KEY_TOKENS`, `isSensitiveKey(key: string): boolean`, `scrubString(text: string): string`, `scrubUrl(url: string): string`, `scrubDeep<T>(value: T, options?: { maxDepth?: number }): T`.
  - `EmailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email())` (zod 4 deprecates `z.string().email()`; the pipe form is used), `PUBLIC_ROUTE_KEY = 'tms:public-route'`.
  - `src/index.ts` re-exports everything, including the `security` and `audit` internals; the two subpaths are narrow-import conveniences, not the only way in.

Design rules fixed by this task: enum values are `UPPER_SNAKE`; permission codes are `group:kebab-action`, `checkin:*` is the only `DRIVER` audience; audit actions are `<area>.<entity>.<event>` with areas `auth | admin | checkin | system` and kebab-case segments; every metadata schema is a strict object whose keys pass `!isSensitiveKey(key)` (a test walks all schemas); `isSensitiveKey` matches whole words of a key split at camelCase boundaries and separators, plus adjacent word pairs (`card`+`serial`, `x-device-key`), so `tokenHash` and `tokenCount` match while `shipping`, `mapping`, `keyId`, `footprint` do not — over-redaction of a harmless key (`pinFailedCount`) is accepted, a leaked secret is not.

Contract facts later tasks rely on: `system.permissions.synced` metadata has five counters `{ inserted, reactivated, deprecated, deleted, renamed }` (`reactivated` covers the Review Focus case "re-added deprecated code re-activated"), and Task 07's `SyncReport` maps onto exactly these keys; `system.seed.applied` metadata is `{ created, unchanged }`, which Task 08's `SeedReport` maps onto; login audit uses two actions, `auth.login.success` and `auth.login.failure`, with `method: PASSWORD | TOTP | RECOVERY_CODE` (+ `reason` on failure), not one action per method; token ids are never audit metadata (`isSensitiveKey('actionTokenId')` is true by design), token flows use the target type `ActionToken` instead; `scrubString` keeps bracketed markers whole, so Sentry's `[Filtered]` after a sensitive key becomes `[REDACTED]` (Task 13 relies on it).

Phase 3 additions made here because both back-end lanes share these files after phase 3a: `drivers:reset-pin` and `cards:block` are split out of `drivers:manage` and `cards:manage`, so a custom role can hold only the PIN reset or only the card block (Admin gets them through `ALL_FOR_AUDIENCE`; the seeded Operator stays at the section 9 list); `admin.driver.pin-reset` has empty metadata (the PIN never goes into metadata), `admin.permission.deleted` carries `{ code }`, and every CSV export writes `admin.list.exported` with `{ list, rowCount, filterFields }` — field names only, never filter values (spec section 12). The requested names `admin.driver.pin_reset` and `list.exported` are spelled to the naming rule above (kebab-case segments, three segments, area `admin`).

- [ ] **Step 1: Add `fast-check` to the catalog and create the package skeleton**

`pnpm-workspace.yaml`: insert after the line `  vitest: ^5.0.1` (line 33 after Task 02):

```yaml
  fast-check: ^4.10.2
```

`packages/contracts/package.json`:

```json
{
  "name": "@tms/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Enums, permission catalogue, seeded roles, audit actions and scrub rules shared by every TMS package",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./security": { "types": "./dist/security/index.d.ts", "default": "./dist/security/index.js" },
    "./audit": { "types": "./dist/audit/index.d.ts", "default": "./dist/audit/index.js" }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "catalog:"
  },
  "devDependencies": {
    "@tms/config": "workspace:*",
    "eslint": "catalog:",
    "fast-check": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

`packages/contracts/tsconfig.json` (`"types": []` is the guard that keeps Node globals out: `process`, `Buffer` and `structuredClone` fail to compile; vitest's typings compile without `@types/node`):

```json
{
  "extends": "@tms/config/tsconfig/library.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true, "types": [] },
  "include": ["src", "test"]
}
```

`packages/contracts/tsconfig.build.json` (`library.json` already sets `outDir: "${configDir}/dist"` and `rootDir: "${configDir}/src"`, which resolve to the same two directories; the build config restates them so it reads on its own and undoes the `rootDir: "."` of `tsconfig.json`):

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "rootDir": "./src", "outDir": "./dist", "noEmit": false },
  "include": ["src"],
  "exclude": ["**/*.spec.ts", "**/*.test.ts"]
}
```

`packages/contracts/eslint.config.mjs`:

```js
import { nodeConfig } from '@tms/config/eslint/node';

export default nodeConfig({ tsconfigRootDir: import.meta.dirname });
```

`packages/contracts/vitest.config.mjs` (`.mjs`, not `.mts`: the type-aware ESLint project service would otherwise demand the config file in a tsconfig):

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
```

`packages/contracts/README.md`:

```md
# @tms/contracts

Definitions shared by every package and both SPAs: zod enums mirrored in `schema.prisma`
(`DB_MIRRORED_ENUMS`), the permission catalogue (`PERMISSIONS`, `validateCatalogue`), the seeded
roles (`SEEDED_ROLES`), the audit action union with per-action strict metadata schemas
(`AUDIT_ACTIONS`, `parseAuditMetadata`), the redaction rules (`@tms/contracts/security`:
`isSensitiveKey`, `scrubDeep`, `scrubString`, `scrubUrl`) and `EmailSchema`.

ESM, no Node types: the package must stay importable from the browser. Relative imports carry the
`.js` extension. Tests: `pnpm turbo run test --filter=@tms/contracts` (Vitest + fast-check).
```

Run: `pnpm install`
Expected: exit 0, `pnpm-lock.yaml` gains `fast-check@4.10.2` and the `packages/contracts` importer; if pnpm appends a `minimumReleaseAgeExclude` entry for `fast-check@4.10.2`, keep it (commit it in Step 10).

- [ ] **Step 2: Write the failing tests**

`packages/contracts/test/enums.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DB_MIRRORED_ENUMS, UserKindSchema } from '../src/enums.js';

const PRISMA_ENUM_NAMES = [
  'UserKind',
  'UserStatus',
  'DriverType',
  'IdentityCardStatus',
  'SessionScope',
  'ActionTokenType',
  'VehicleKind',
  'LoadingPointKind',
  'TransportKind',
  'LoadingOrderStatus',
  'QueueEntryStatus',
  'CheckInVia',
  'AuditApp',
  'AuditOutcome',
];

describe('DB_MIRRORED_ENUMS', () => {
  it('is keyed by exactly the 14 Prisma enum names', () => {
    expect(Object.keys(DB_MIRRORED_ENUMS).sort()).toEqual([...PRISMA_ENUM_NAMES].sort());
  });

  it.each(Object.entries(DB_MIRRORED_ENUMS))(
    '%s has at least two unique UPPER_SNAKE values',
    (_name, schema) => {
      expect(schema.options.length).toBeGreaterThanOrEqual(2);
      expect(new Set(schema.options).size).toBe(schema.options.length);
      for (const value of schema.options) expect(value).toMatch(/^[A-Z][A-Z0-9_]*$/);
    },
  );

  it('parses a member and rejects a non-member with an invalid_value issue', () => {
    expect(UserKindSchema.parse('STAFF')).toBe('STAFF');
    const result = UserKindSchema.safeParse('staff');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.code).toBe('invalid_value');
  });
});
```

`packages/contracts/test/permissions.test.ts` (broken catalogues are built with a cast because the type forbids most of the mistakes the runtime check must still catch for JS callers and future edits):

```ts
import { describe, expect, it } from 'vitest';
import {
  PERMISSION_GROUPS,
  PERMISSIONS,
  PermissionCodeSchema,
  permissionCodesForAudience,
  validateCatalogue,
  type PermissionDefinition,
} from '../src/permissions.js';

const entry = (over: Partial<Record<keyof PermissionDefinition, unknown>>): PermissionDefinition =>
  ({
    code: 'users:read',
    group: 'users',
    audience: 'STAFF',
    defaultName: 'View users',
    defaultDescription: 'List users.',
    ...over,
  }) as PermissionDefinition;

describe('PERMISSIONS', () => {
  it('is a valid catalogue of 33 codes covering the 13 groups', () => {
    expect(validateCatalogue(PERMISSIONS)).toEqual([]);
    expect(PERMISSIONS).toHaveLength(33);
    expect(new Set(PERMISSIONS.map((p) => p.group))).toEqual(new Set(PERMISSION_GROUPS));
  });

  it('contains every code named in spec section 9', () => {
    const codes = PERMISSIONS.map((p) => p.code);
    for (const code of [
      'users:read',
      'users:create',
      'users:update',
      'users:block',
      'users:unlock',
      'users:invite',
      'users:reset-mfa',
      'roles:read',
      'roles:manage',
      'permissions:read',
      'permissions:update',
      'orders:read',
      'orders:manage',
      'queue:read',
      'queue:assign-point',
      'queue:call',
      'queue:complete',
      'queue:remove',
      'queue:manual-checkin',
      'audit:read',
      'checkin:perform',
    ]) {
      expect(codes).toContain(code);
    }
  });

  it('gives checkin:perform to DRIVER and everything else to STAFF', () => {
    expect(permissionCodesForAudience('DRIVER')).toEqual(['checkin:perform']);
    expect(permissionCodesForAudience('STAFF')).toHaveLength(32);
  });

  it('splits the PIN reset and the card block out of drivers:manage and cards:manage', () => {
    const byCode = new Map<string, PermissionDefinition>(PERMISSIONS.map((p) => [p.code, p]));
    expect(byCode.get('drivers:reset-pin')).toMatchObject({
      audience: 'STAFF',
      defaultName: 'Reset driver PIN',
    });
    expect(byCode.get('cards:block')).toMatchObject({
      audience: 'STAFF',
      defaultName: 'Block identity cards',
    });
    expect(byCode.get('drivers:manage')?.defaultDescription).toBe('Create and edit drivers.');
    expect(byCode.get('cards:manage')?.defaultDescription).toBe(
      'Issue and replace identity cards.',
    );
  });

  it('PermissionCodeSchema accepts live codes only', () => {
    expect(PermissionCodeSchema.parse('queue:call')).toBe('queue:call');
    expect(PermissionCodeSchema.safeParse('queue:fly').success).toBe(false);
  });
});

describe('validateCatalogue', () => {
  it('reports a duplicate code once, on the second occurrence', () => {
    expect(validateCatalogue([entry({}), entry({})])).toEqual([
      { code: 'users:read', problem: 'duplicate code' },
    ]);
  });

  it.each(['users:Read', 'users:read_all', 'users', 'users:read:all', 'Users:read', 'users:-read'])(
    'rejects the malformed code %s',
    (code) => {
      expect(validateCatalogue([entry({ code })])).toContainEqual({
        code,
        problem: 'code must be <group>:<kebab-case-action>',
      });
    },
  );

  it('rejects a group that does not match the code prefix', () => {
    expect(validateCatalogue([entry({ group: 'roles' })])).toEqual([
      { code: 'users:read', problem: 'group "roles" does not match the code prefix' },
    ]);
  });

  it('rejects an unknown group', () => {
    const problems = validateCatalogue([entry({ code: 'reports:read', group: 'reports' })]);
    expect(problems).toContainEqual({ code: 'reports:read', problem: 'unknown group "reports"' });
  });

  it('requires DRIVER audience for checkin:* and STAFF elsewhere', () => {
    expect(validateCatalogue([entry({ code: 'checkin:perform', group: 'checkin' })])).toEqual([
      { code: 'checkin:perform', problem: 'audience must be DRIVER' },
    ]);
    expect(validateCatalogue([entry({ audience: 'DRIVER' })])).toEqual([
      { code: 'users:read', problem: 'audience must be STAFF' },
    ]);
  });

  it('rejects empty names and descriptions', () => {
    expect(validateCatalogue([entry({ defaultName: ' ', defaultDescription: '' })])).toEqual([
      { code: 'users:read', problem: 'defaultName is empty' },
      { code: 'users:read', problem: 'defaultDescription is empty' },
    ]);
  });

  it('rejects renamedFrom entries that are live or claimed twice', () => {
    const catalogue = [
      entry({ code: 'users:read', renamedFrom: ['users:list', 'users:view'] }),
      entry({ code: 'users:list', group: 'users' }),
      entry({ code: 'roles:read', group: 'roles', renamedFrom: ['users:view'] }),
    ];
    expect(validateCatalogue(catalogue)).toEqual([
      { code: 'roles:read', problem: 'renamedFrom "users:view" is also claimed by users:read' },
      { code: 'users:read', problem: 'renamedFrom "users:list" is still a live code' },
    ]);
  });

  it('accepts a rename whose old code is gone', () => {
    expect(validateCatalogue([entry({ renamedFrom: ['users:list'] })])).toEqual([]);
  });
});
```

`packages/contracts/test/roles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PERMISSIONS, permissionCodesForAudience } from '../src/permissions.js';
import {
  ADMIN_ROLE_KEY,
  ALL_FOR_AUDIENCE,
  resolveRolePermissions,
  SEEDED_ROLES,
} from '../src/roles.js';

const byKey = Object.fromEntries(SEEDED_ROLES.map((r) => [r.key, r]));

describe('SEEDED_ROLES', () => {
  it('defines admin, operator and driver with the section 9 flags', () => {
    expect(
      SEEDED_ROLES.map((r) => [r.key, r.name, r.appliesTo, r.isSystem, r.permissionsLocked]),
    ).toEqual([
      ['admin', 'Admin', 'STAFF', true, true],
      ['operator', 'Operator', 'STAFF', false, false],
      ['driver', 'Driver', 'DRIVER', true, true],
    ]);
    expect(ADMIN_ROLE_KEY).toBe('admin');
    expect(byKey['admin']?.permissions).toBe(ALL_FOR_AUDIENCE);
  });

  it('references only live codes whose audience matches the role', () => {
    const liveByCode = new Map(PERMISSIONS.map((p) => [p.code, p]));
    for (const role of SEEDED_ROLES) {
      for (const code of resolveRolePermissions(role)) {
        expect(liveByCode.get(code)?.audience, `${role.key} -> ${code}`).toBe(role.appliesTo);
      }
    }
  });

  it('expands Admin to every STAFF permission and Driver to checkin:perform', () => {
    expect(resolveRolePermissions(byKey['admin']!)).toEqual(permissionCodesForAudience('STAFF'));
    expect(resolveRolePermissions(byKey['admin']!)).toEqual(
      expect.arrayContaining(['drivers:reset-pin', 'cards:block']),
    );
    expect(resolveRolePermissions(byKey['driver']!)).toEqual(['checkin:perform']);
  });

  it('gives Operator exactly the section 9 list: orders:*, queue:*, read-only master data, audit', () => {
    const expected = PERMISSIONS.filter(
      (p) =>
        p.group === 'orders' ||
        p.group === 'queue' ||
        ([
          'drivers',
          'cards',
          'vehicles',
          'carriers',
          'products',
          'loading-points',
          'audit',
        ].includes(p.group) &&
          p.code.endsWith(':read')),
    ).map((p) => p.code);
    expect([...resolveRolePermissions(byKey['operator']!)].sort()).toEqual([...expected].sort());
    expect(expected).toHaveLength(15);
  });

  it('does not grant Operator any users, roles or permissions administration', () => {
    const codes = resolveRolePermissions(byKey['operator']!);
    expect(codes.filter((c) => /^(users|roles|permissions):/.test(c))).toEqual([]);
    expect(codes).not.toContain('drivers:reset-pin');
    expect(codes).not.toContain('cards:block');
  });
});
```

`packages/contracts/test/audit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  ADMIN_AUDIT_ACTIONS,
  AUDIT_ACTION_NAMES,
  AUDIT_ACTIONS,
  AuditActionSchema,
  AuditMetadataError,
  AuditTargetTypeSchema,
  OPS_AUDIT_ACTIONS,
  parseAuditMetadata,
} from '../src/audit/index.js';
import { isSensitiveKey } from '../src/security/scrub.js';

/** Every property key reachable in a schema tree, including nested objects, arrays, optionals and unions. */
function collectKeys(schema: z.ZodType, into: string[] = []): string[] {
  const def = schema.def as {
    type: string;
    shape?: Record<string, z.ZodType>;
    element?: z.ZodType;
    innerType?: z.ZodType;
    options?: z.ZodType[];
  };
  if (def.shape) {
    for (const [key, child] of Object.entries(def.shape)) {
      into.push(key);
      collectKeys(child, into);
    }
  }
  if (def.element) collectKeys(def.element, into);
  if (def.innerType) collectKeys(def.innerType, into);
  if (def.options) for (const option of def.options) collectKeys(option, into);
  return into;
}

describe('AUDIT_ACTIONS', () => {
  it('names every action <area>.<entity>.<event> in kebab-case with a known area', () => {
    expect(AUDIT_ACTION_NAMES.length).toBeGreaterThanOrEqual(45);
    for (const action of AUDIT_ACTION_NAMES) {
      expect(action).toMatch(/^(auth|admin|checkin|system)\.[a-z]+(-[a-z]+)*\.[a-z]+(-[a-z]+)*$/);
    }
    expect(AuditActionSchema.parse('auth.login.failure')).toBe('auth.login.failure');
    expect(AuditActionSchema.safeParse('auth.login.Failure').success).toBe(false);
  });

  it('covers the events named in spec sections 8 to 10', () => {
    for (const action of [
      'auth.invite.issued',
      'auth.invite.accepted',
      'auth.invite.resent',
      'auth.password.set',
      'auth.totp.enrolled',
      'auth.totp.verified',
      'auth.login.success',
      'auth.login.failure',
      'auth.lockout.applied',
      'auth.session.revoked',
      'auth.mfa.reset',
      'auth.password-reset.requested',
      'auth.password-reset.completed',
      'admin.user.created',
      'admin.user.updated',
      'admin.user.blocked',
      'admin.user.unblocked',
      'admin.user.deactivated',
      'admin.user.unlocked',
      'admin.user.role-changed',
      'admin.role.created',
      'admin.role.updated',
      'admin.role.deleted',
      'admin.permission.updated',
      'admin.driver.created',
      'admin.driver.updated',
      'admin.driver.pin-reset',
      'admin.card.issued',
      'admin.card.blocked',
      'admin.carrier.created',
      'admin.carrier.updated',
      'admin.vehicle.created',
      'admin.vehicle.updated',
      'admin.order.created',
      'admin.order.updated',
      'admin.order.cancelled',
      'checkin.identify.success',
      'checkin.identify.failure',
      'checkin.pin.locked',
      'checkin.order.confirmed',
      'checkin.queue.checked-in',
      'checkin.queue.manual-checkin',
      'checkin.queue.point-assigned',
      'checkin.queue.called',
      'checkin.queue.completed',
      'checkin.queue.removed',
      'system.permissions.synced',
      'system.seed.applied',
    ]) {
      expect(AUDIT_ACTIONS, action).toHaveProperty(action);
    }
  });

  it('uses a strict object for every action and no sensitive key anywhere in any schema', () => {
    for (const [action, schema] of Object.entries(AUDIT_ACTIONS)) {
      expect(schema.def.type, action).toBe('object');
      expect(schema.safeParse({ unexpected: 1 }).success, action).toBe(false);
      for (const key of collectKeys(schema)) {
        expect(isSensitiveKey(key), `${action}.${key}`).toBe(false);
      }
    }
  });

  it('lists the 13 audit target types', () => {
    expect(AuditTargetTypeSchema.options).toHaveLength(13);
    expect(AuditTargetTypeSchema.parse('QueueEntry')).toBe('QueueEntry');
  });

  it('keeps the loading-order actions in OPS_AUDIT_ACTIONS, apart from the admin file', () => {
    expect(Object.keys(OPS_AUDIT_ACTIONS)).toEqual([
      'admin.order.created',
      'admin.order.updated',
      'admin.order.cancelled',
    ]);
    expect(Object.keys(ADMIN_AUDIT_ACTIONS).filter((a) => a.startsWith('admin.order.'))).toEqual(
      [],
    );
    expect(AUDIT_ACTION_NAMES).toHaveLength(50);
  });

  it('carries the phase 3 metadata: no PIN, a permission code, export field names only', () => {
    expect(parseAuditMetadata('admin.driver.pin-reset', {})).toEqual({});
    expect(() => parseAuditMetadata('admin.driver.pin-reset', { pin: '1234' })).toThrow(
      /Unrecognized key/,
    );
    expect(parseAuditMetadata('admin.permission.deleted', { code: 'queue:fly' })).toEqual({
      code: 'queue:fly',
    });
    expect(() => parseAuditMetadata('admin.permission.deleted', {})).toThrow(
      'Invalid audit metadata for admin.permission.deleted: code: Invalid input: expected string, received undefined',
    );
    const exported = { list: 'drivers', rowCount: 12, filterFields: ['status', 'carrierId'] };
    expect(parseAuditMetadata('admin.list.exported', exported)).toEqual(exported);
    expect(() =>
      parseAuditMetadata('admin.list.exported', { ...exported, filters: { status: 'ACTIVE' } }),
    ).toThrow(/Unrecognized key: "filters"/);
    expect(() =>
      parseAuditMetadata('admin.list.exported', { ...exported, filterFields: ['status=ACTIVE'] }),
    ).toThrow(/filterFields\.0: Invalid string/);
  });
});

describe('parseAuditMetadata', () => {
  it('accepts undefined and {} for an empty schema and returns {}', () => {
    expect(parseAuditMetadata('admin.user.created', undefined)).toEqual({});
    expect(parseAuditMetadata('admin.user.created', {})).toEqual({});
  });

  it('returns the typed metadata of a populated schema', () => {
    const parsed = parseAuditMetadata('auth.login.failure', {
      method: 'TOTP',
      reason: 'CODE_REPLAYED',
    });
    expect(parsed).toEqual({ method: 'TOTP', reason: 'CODE_REPLAYED' });
    const synced = parseAuditMetadata('system.permissions.synced', {
      inserted: 3,
      reactivated: 0,
      deprecated: 1,
      deleted: 0,
      renamed: 2,
    });
    expect(synced.renamed).toBe(2);
  });

  it('rejects unknown keys with an unrecognized_keys issue naming the key', () => {
    let caught: unknown;
    try {
      parseAuditMetadata('admin.user.created', { password: 'x' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AuditMetadataError);
    const error = caught as AuditMetadataError;
    expect(error.name).toBe('AuditMetadataError');
    expect(error.action).toBe('admin.user.created');
    expect(error.issues.map((i) => i.code)).toEqual(['unrecognized_keys']);
    expect(error.message).toBe(
      'Invalid audit metadata for admin.user.created: <root>: Unrecognized key: "password"',
    );
    expect(error.message).not.toContain(': x');
  });

  it('rejects a wrong enum value and a missing required key', () => {
    expect(() =>
      parseAuditMetadata('auth.login.failure', { method: 'PASSWORD', reason: 'OOPS' }),
    ).toThrow(/reason: Invalid option/);
    expect(() => parseAuditMetadata('checkin.queue.removed', {})).toThrow(
      'Invalid audit metadata for checkin.queue.removed: reason: Invalid input: expected string, received undefined',
    );
    expect(() => parseAuditMetadata('checkin.queue.removed', { reason: 'x'.repeat(201) })).toThrow(
      /reason: Too big/,
    );
  });

  it('rejects an action that is not in the catalogue', () => {
    expect(() => parseAuditMetadata('auth.login.oops' as never, {})).toThrow(
      'Invalid audit metadata for auth.login.oops: <root>: unknown audit action',
    );
  });
});
```

`packages/contracts/test/scrub.test.ts` (the property plants a secret under a random sensitive key at a random path of a random tree; leaf strings come from an alphabet without `=`, `:`, `/` or quotes so the "unchanged" half of the property holds):

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CIRCULAR,
  isSensitiveKey,
  MAX_DEPTH_REACHED,
  REDACTED,
  scrubDeep,
  scrubString,
  scrubUrl,
} from '../src/security/scrub.js';

describe('isSensitiveKey', () => {
  it.each([
    'password',
    'Password',
    'PASSWORD',
    'passwd',
    'user_password',
    'passwordConfirmation',
    'pin',
    'PIN',
    'newPin',
    'pin_hash',
    'pinHash',
    'PINCode',
    'cardSerial',
    'card_serial',
    'card-serial',
    'CardSerial',
    'token',
    'tokenHash',
    'tokenCount',
    'accessToken',
    'refresh_token',
    'actionTokenId',
    'jwt',
    'authorization',
    'Authorization',
    'x-authorization',
    'cookie',
    'Cookie',
    'set-cookie',
    'Set-Cookie',
    'Set-Cookie[]',
    'cookies',
    'totp',
    'totpSecretEnc',
    'otp',
    'otpCode',
    'recoveryCode',
    'recovery_code',
    'recoveryCodes',
    'secret',
    'SECRETS_ENC_KEY',
    'clientSecret',
    'apiKey',
    'x-api-key',
    'X-Device-Key',
    'deviceKey',
    'sessionId',
    'session_id',
  ])('matches %s', (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each([
    'shipping',
    'shippingAddress',
    'mapping',
    'keyId',
    'footprint',
    'hotplug',
    'spinner',
    'pinned',
    'email',
    'username',
    'userId',
    'roleId',
    'kioskId',
    'sessionCount',
    'reason',
    'loadingPointId',
    'sequenceNumber',
    'failedAttempts',
    'lockedUntil',
    'name',
    'id',
    '',
    'x',
    'tokenizer',
    'protoplasm',
    'opinion',
  ])('does not match %s', (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });
});

describe('scrubString', () => {
  it.each([
    ['Authorization: Bearer eyJhbGciOi.abc_def-ghi', 'Authorization: Bearer [REDACTED]'],
    ['basic dXNlcjpwYXNz', 'basic [REDACTED]'],
    ['postgresql://tms:s3cret@db:5432/tms', 'postgresql://[REDACTED]@db:5432/tms'],
    ['https://user:@host/', 'https://[REDACTED]@host/'],
    ['GET /api/accept?token=abc123&lang=en', 'GET /api/accept?token=[REDACTED]&lang=en'],
    ['GET /x?pin=1234', 'GET /x?pin=[REDACTED]'],
    ['GET /x?shipping=fast&mapping=1', 'GET /x?shipping=fast&mapping=1'],
    ['login failed password=hunter2 user=ana', 'login failed password=[REDACTED] user=ana'],
    [
      'body {"password":"hunter2","email":"a@b.c"}',
      'body {"password":"[REDACTED]","email":"a@b.c"}',
    ],
    ['{"pin": 1234, "kioskId": "k1"}', '{"pin":"[REDACTED]", "kioskId": "k1"}'],
    ['{"totp":"12 34\\"56"}', '{"totp":"[REDACTED]"}'],
    ['token=[Filtered]', 'token=[REDACTED]'],
    ['GET /x?token=[Filtered]&lang=en', 'GET /x?token=[REDACTED]&lang=en'],
    ['nothing to see here', 'nothing to see here'],
    ['', ''],
  ])('%s -> %s', (input, expected) => {
    expect(scrubString(input)).toBe(expected);
  });

  it('is idempotent', () => {
    const once = scrubString('Bearer x token=y https://u:p@h/?pin=1 {"secret":"z"}');
    expect(scrubString(once)).toBe(once);
    expect(once).not.toMatch(/x|=y|u:p|pin=1|"z"/);
  });
});

describe('scrubUrl', () => {
  it('redacts credentials and sensitive query parameters, keeps the rest', () => {
    expect(scrubUrl('https://ana:pw@example.com/a?b=1&token=t&cardSerial=42#frag')).toBe(
      'https://[REDACTED]@example.com/a?b=1&token=[REDACTED]&cardSerial=[REDACTED]#frag',
    );
    expect(scrubUrl('/api/health')).toBe('/api/health');
  });
});

describe('scrubDeep', () => {
  it('redacts nested and array values under sensitive keys and keeps the others', () => {
    const input = {
      user: { name: 'Ana', password: 'hunter2', pin: 1234 },
      cards: [{ cardSerial: 'ABC', label: 'main' }],
      headers: { Authorization: 'Bearer x', 'Set-Cookie': ['sid=1'], 'x-request-id': 'r1' },
      shipping: { pin: 'still redacted', address: 'Street 1' },
      count: 3,
      when: new Date(0),
      bytes: new Uint8Array([1, 2, 3]),
    };
    const out = scrubDeep(input);
    expect(out).toEqual({
      user: { name: 'Ana', password: REDACTED, pin: REDACTED },
      cards: [{ cardSerial: REDACTED, label: 'main' }],
      headers: { Authorization: REDACTED, 'Set-Cookie': REDACTED, 'x-request-id': 'r1' },
      shipping: { pin: REDACTED, address: 'Street 1' },
      count: 3,
      when: new Date(0),
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(out).not.toBe(input);
    expect(out.user).not.toBe(input.user);
    expect(JSON.stringify(out)).not.toMatch(/hunter2|1234|ABC|Bearer x|sid=1/);
  });

  it('scrubs string leaves under non-sensitive keys (URLs, messages)', () => {
    expect(scrubDeep({ url: '/accept?token=abc', msg: 'Bearer zzz' })).toEqual({
      url: `/accept?token=${REDACTED}`,
      msg: `Bearer ${REDACTED}`,
    });
  });

  it('cuts cycles and caps depth', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a['self'] = a;
    expect(scrubDeep(a)).toEqual({ name: 'a', self: CIRCULAR });
    const shared = { ok: true };
    expect(scrubDeep({ x: shared, y: shared })).toEqual({ x: { ok: true }, y: { ok: true } });
    expect(scrubDeep({ a: { b: { c: 1 } } }, { maxDepth: 2 })).toEqual({
      a: { b: MAX_DEPTH_REACHED },
    });
  });

  it('turns an Error into a plain object with scrubbed message, stack, cause and own props', () => {
    const cause = new Error('db: postgresql://tms:pw@db/tms');
    const error = new Error('request failed token=abc', { cause }) as Error & { config: unknown };
    error.config = { headers: { authorization: 'Bearer x' }, url: '/y?pin=1' };
    const out = scrubDeep(error) as unknown as Record<string, unknown>;
    expect(out['name']).toBe('Error');
    expect(out['message']).toBe(`request failed token=${REDACTED}`);
    expect(out['stack']).toMatch(/^Error: request failed token=\[REDACTED\]/);
    expect(out['cause']).toMatchObject({
      name: 'Error',
      message: `db: postgresql://${REDACTED}@db/tms`,
    });
    expect(out['config']).toEqual({
      headers: { authorization: REDACTED },
      url: `/y?pin=${REDACTED}`,
    });
    expect(JSON.stringify(out)).not.toMatch(/abc|:pw@|Bearer x|pin=1/);
  });

  it('returns primitives, Map and Set untouched', () => {
    expect(scrubDeep(5)).toBe(5);
    expect(scrubDeep(null)).toBeNull();
    const map = new Map([['k', 'v']]);
    expect(scrubDeep(map)).toBe(map);
  });

  const SENSITIVE_KEYS = [
    'password',
    'pin',
    'cardSerial',
    'token',
    'authorization',
    'cookie',
    'totp',
    'recoveryCode',
  ];
  const SAFE_KEYS = ['name', 'email', 'shipping', 'mapping', 'keyId', 'count', 'items', 'user'];
  const safeString = fc.string({
    unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 '),
    maxLength: 12,
  });
  const leaf = fc.oneof(safeString, fc.integer(), fc.boolean(), fc.constant(null));
  const tree = fc.letrec<{ node: unknown }>((tie) => ({
    node: fc.oneof(
      { depthSize: 'small', withCrossShrink: true },
      leaf,
      fc.array(tie('node'), { maxLength: 4 }),
      fc.dictionary(fc.constantFrom(...SAFE_KEYS), tie('node'), { maxKeys: 4 }),
    ),
  })).node;
  const secret = fc.string({
    unit: fc.constantFrom(...'ABCDEFGHJKLMNPQRSTUVWXYZ'),
    minLength: 8,
    maxLength: 16,
  });

  it('property: a secret planted under a sensitive key at any depth never survives, other leaves are unchanged', () => {
    fc.assert(
      fc.property(
        tree,
        fc.array(fc.oneof(fc.constantFrom(...SAFE_KEYS), fc.nat({ max: 3 })), { maxLength: 6 }),
        fc.constantFrom(...SENSITIVE_KEYS),
        secret,
        (base, path, sensitiveKey, planted) => {
          const root: unknown = JSON.parse(JSON.stringify(base));
          let cursor: unknown = root;
          let parent: unknown = undefined;
          let parentKey: string | number = '';
          for (const step of path) {
            if (typeof cursor !== 'object' || cursor === null) break;
            const key = Array.isArray(cursor)
              ? typeof step === 'number'
                ? step % Math.max(cursor.length, 1)
                : 0
              : String(step);
            parent = cursor;
            parentKey = key;
            cursor = (cursor as Record<string | number, unknown>)[key];
          }
          const host: Record<string, unknown> = { [sensitiveKey]: planted };
          let subject: unknown;
          if (parent === undefined) subject = host;
          else {
            (parent as Record<string | number, unknown>)[parentKey] = host;
            subject = root;
          }
          const scrubbed = scrubDeep(subject);
          const text = JSON.stringify(scrubbed);
          expect(text).not.toContain(planted);
          expect(JSON.stringify(scrubDeep(base))).toBe(JSON.stringify(base));
        },
      ),
      { numRuns: 300 },
    );
  });
});
```

Run: `pnpm turbo run test --filter=@tms/contracts`
Expected: RED, exit 1. Five suites fail to load, one line each of the form `Error: Cannot find module '../src/enums.js' imported from .../packages/contracts/test/enums.test.ts` (also `../src/permissions.js` twice, `../src/audit/index.js`, `../src/security/scrub.js`), then `Test Files  5 failed (5)` and `Tests  no tests`.

- [ ] **Step 3: Write the enums, `EmailSchema` and `PUBLIC_ROUTE_KEY`**

`packages/contracts/src/enums.ts`:

```ts
import { z } from 'zod';

// Every enum mirrored in schema.prisma is defined here once (spec section 3); Task 05 asserts
// set equality between DB_MIRRORED_ENUMS and the generated Prisma $Enums.

export const UserKindSchema = z.enum(['STAFF', 'DRIVER']);
export type UserKind = z.infer<typeof UserKindSchema>;

export const UserStatusSchema = z.enum(['INVITED', 'ACTIVE', 'BLOCKED', 'DEACTIVATED']);
export type UserStatus = z.infer<typeof UserStatusSchema>;

export const DriverTypeSchema = z.enum(['TRUCK', 'RAIL']);
export type DriverType = z.infer<typeof DriverTypeSchema>;

export const IdentityCardStatusSchema = z.enum(['ACTIVE', 'BLOCKED']);
export type IdentityCardStatus = z.infer<typeof IdentityCardStatusSchema>;

export const SessionScopeSchema = z.enum(['PRE_MFA', 'ENROLLMENT', 'FULL']);
export type SessionScope = z.infer<typeof SessionScopeSchema>;

export const ActionTokenTypeSchema = z.enum(['INVITE', 'PASSWORD_RESET', 'MFA_RESET']);
export type ActionTokenType = z.infer<typeof ActionTokenTypeSchema>;

export const VehicleKindSchema = z.enum(['TRUCK', 'RAIL_WAGON']);
export type VehicleKind = z.infer<typeof VehicleKindSchema>;

export const LoadingPointKindSchema = z.enum(['TRUCK_ISLAND', 'RAIL_TRACK']);
export type LoadingPointKind = z.infer<typeof LoadingPointKindSchema>;

export const TransportKindSchema = z.enum(['TRUCK', 'RAIL']);
export type TransportKind = z.infer<typeof TransportKindSchema>;

export const LoadingOrderStatusSchema = z.enum([
  'CREATED',
  'QUEUED',
  'CALLED',
  'LOADED',
  'CANCELLED',
]);
export type LoadingOrderStatus = z.infer<typeof LoadingOrderStatusSchema>;

export const QueueEntryStatusSchema = z.enum(['WAITING', 'CALLED', 'DONE', 'REMOVED']);
export type QueueEntryStatus = z.infer<typeof QueueEntryStatusSchema>;

export const CheckInViaSchema = z.enum(['KIOSK', 'MANUAL']);
export type CheckInVia = z.infer<typeof CheckInViaSchema>;

export const AuditAppSchema = z.enum(['ADMIN', 'DRIVER', 'SYSTEM']);
export type AuditApp = z.infer<typeof AuditAppSchema>;

export const AuditOutcomeSchema = z.enum(['SUCCESS', 'FAILURE']);
export type AuditOutcome = z.infer<typeof AuditOutcomeSchema>;

/** Keyed by the Prisma enum name; the key set must equal the enums declared in schema.prisma. */
export const DB_MIRRORED_ENUMS = {
  UserKind: UserKindSchema,
  UserStatus: UserStatusSchema,
  DriverType: DriverTypeSchema,
  IdentityCardStatus: IdentityCardStatusSchema,
  SessionScope: SessionScopeSchema,
  ActionTokenType: ActionTokenTypeSchema,
  VehicleKind: VehicleKindSchema,
  LoadingPointKind: LoadingPointKindSchema,
  TransportKind: TransportKindSchema,
  LoadingOrderStatus: LoadingOrderStatusSchema,
  QueueEntryStatus: QueueEntryStatusSchema,
  CheckInVia: CheckInViaSchema,
  AuditApp: AuditAppSchema,
  AuditOutcome: AuditOutcomeSchema,
} as const satisfies Record<string, z.ZodEnum>;

export type PrismaEnumName = keyof typeof DB_MIRRORED_ENUMS;
```

`packages/contracts/src/common.ts`:

```ts
import { z } from 'zod';

/**
 * Login and invite emails: trimmed and lower-cased before validation so `Ana@Example.com ` and
 * `ana@example.com` are the same account. zod 4 deprecates `z.string().email()`; the format
 * check is `z.email()` behind a pipe.
 */
export const EmailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
export type Email = z.infer<typeof EmailSchema>;
```

`packages/contracts/src/routing.ts`:

```ts
/**
 * Nest metadata key of `@Public()` (phase 3a). Reserved here so `nest-bootstrap` (health route)
 * and `domain` (guard) share it without importing each other.
 */
export const PUBLIC_ROUTE_KEY = 'tms:public-route' as const;
```

- [ ] **Step 4: Write the permission catalogue and the seeded roles**

`packages/contracts/src/permissions.ts` (the `staff()` helper derives `group` from the code so the two can never disagree in the catalogue itself; `validateCatalogue` still checks it for catalogues built elsewhere):

```ts
import { z } from 'zod';
import type { UserKind } from './enums.js';

export const PERMISSION_GROUPS = [
  'users',
  'roles',
  'permissions',
  'drivers',
  'cards',
  'vehicles',
  'carriers',
  'products',
  'loading-points',
  'orders',
  'queue',
  'audit',
  'checkin',
] as const;
export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

export interface PermissionDefinition {
  readonly code: `${PermissionGroup}:${string}`;
  readonly group: PermissionGroup;
  /** Which user kind a role granting this permission applies to (Admin = all STAFF codes). */
  readonly audience: UserKind;
  readonly defaultName: string;
  readonly defaultDescription: string;
  /** Codes this permission replaces; the sync migrates RolePermission rows from them. */
  readonly renamedFrom?: readonly string[];
}

const staff = <C extends `${PermissionGroup}:${string}`>(
  code: C,
  defaultName: string,
  defaultDescription: string,
) => ({ code, group: groupOf(code), audience: 'STAFF' as const, defaultName, defaultDescription });

function groupOf<C extends `${PermissionGroup}:${string}`>(code: C): GroupOf<C> {
  return code.slice(0, code.indexOf(':')) as GroupOf<C>;
}
type GroupOf<C extends string> = C extends `${infer G}:${string}` ? G : never;

/** The permission catalogue (spec section 9). Codes are `group:action`, actions in kebab-case. */
export const PERMISSIONS = [
  staff('users:read', 'View users', 'List staff and driver users and open their details.'),
  staff('users:create', 'Create users', 'Create staff and driver users.'),
  staff('users:update', 'Edit users', 'Change user profile data.'),
  staff('users:block', 'Block users', 'Block, unblock and deactivate users.'),
  staff('users:unlock', 'Unlock users', 'Clear a login lockout before it expires.'),
  staff('users:invite', 'Invite users', 'Send and resend invitation and password reset emails.'),
  staff('users:reset-mfa', 'Reset two-factor', 'Reset a user’s two-factor authentication.'),
  staff('roles:read', 'View roles', 'List roles and their permissions.'),
  staff('roles:manage', 'Manage roles', 'Create, edit and delete roles and their permissions.'),
  staff('permissions:read', 'View permissions', 'List the permission catalogue.'),
  staff('permissions:update', 'Edit permissions', 'Edit permission names and descriptions.'),
  staff('drivers:read', 'View drivers', 'List drivers and open their profiles.'),
  staff('drivers:manage', 'Manage drivers', 'Create and edit drivers.'),
  staff('drivers:reset-pin', 'Reset driver PIN', 'Set a new kiosk PIN for a driver.'),
  staff('cards:read', 'View cards', 'List identity cards.'),
  staff('cards:manage', 'Manage cards', 'Issue and replace identity cards.'),
  staff(
    'cards:block',
    'Block identity cards',
    'Block an identity card so it no longer opens the kiosk.',
  ),
  staff('vehicles:read', 'View vehicles', 'List vehicles.'),
  staff('vehicles:manage', 'Manage vehicles', 'Create, edit and block vehicles.'),
  staff('carriers:read', 'View carriers', 'List carriers.'),
  staff('carriers:manage', 'Manage carriers', 'Create and edit carriers.'),
  staff('products:read', 'View products', 'List products.'),
  staff('loading-points:read', 'View loading points', 'List loading islands and rail tracks.'),
  staff('orders:read', 'View orders', 'List loading orders.'),
  staff('orders:manage', 'Manage orders', 'Create, edit and cancel loading orders.'),
  staff('queue:read', 'View queue', 'See the loading queue.'),
  staff(
    'queue:assign-point',
    'Assign loading point',
    'Assign or change the loading point of a queue entry.',
  ),
  staff('queue:call', 'Call to loading', 'Call the next driver to a loading point.'),
  staff('queue:complete', 'Complete loading', 'Mark a called entry as loaded.'),
  staff('queue:remove', 'Remove from queue', 'Remove an entry from the queue with a reason.'),
  staff('queue:manual-checkin', 'Manual check-in', 'Check a driver in on their behalf.'),
  staff('audit:read', 'View audit log', 'Read the audit log.'),
  {
    code: 'checkin:perform',
    group: 'checkin',
    audience: 'DRIVER',
    defaultName: 'Check in at the kiosk',
    defaultDescription: 'Identify with card and PIN and confirm a loading order at the kiosk.',
  },
] as const satisfies readonly PermissionDefinition[];

export type PermissionCode = (typeof PERMISSIONS)[number]['code'];

export const PERMISSION_CODES: readonly PermissionCode[] = PERMISSIONS.map((p) => p.code);

export const PermissionCodeSchema = z.enum(PERMISSION_CODES);

/** Live codes granted to roles of `audience` (what `'ALL_FOR_AUDIENCE'` expands to). */
export function permissionCodesForAudience(
  audience: UserKind,
  catalogue: readonly PermissionDefinition[] = PERMISSIONS,
): PermissionCode[] {
  return catalogue.filter((p) => p.audience === audience).map((p) => p.code as PermissionCode);
}

export interface CatalogueProblem {
  readonly code: string;
  readonly problem: string;
}

const CODE_PATTERN = /^([a-z]+(?:-[a-z]+)*):([a-z]+(?:-[a-z]+)*)$/;
const GROUPS: ReadonlySet<string> = new Set(PERMISSION_GROUPS);

/**
 * Structural invariants of a catalogue; an empty result means valid. The permission sync
 * (Task 07) refuses to write anything when this returns problems.
 */
export function validateCatalogue(catalogue: readonly PermissionDefinition[]): CatalogueProblem[] {
  const problems: CatalogueProblem[] = [];
  const liveCodes = new Set<string>();
  const renamedSeen = new Map<string, string>();

  for (const entry of catalogue) {
    const { code } = entry;
    if (liveCodes.has(code)) problems.push({ code, problem: 'duplicate code' });
    liveCodes.add(code);

    const match = CODE_PATTERN.exec(code);
    if (!match) {
      problems.push({ code, problem: 'code must be <group>:<kebab-case-action>' });
    } else if (match[1] !== entry.group) {
      problems.push({ code, problem: `group "${entry.group}" does not match the code prefix` });
    }
    if (!GROUPS.has(entry.group)) {
      problems.push({ code, problem: `unknown group "${String(entry.group)}"` });
    }

    const expectedAudience: UserKind = entry.group === 'checkin' ? 'DRIVER' : 'STAFF';
    if (entry.audience !== expectedAudience) {
      problems.push({ code, problem: `audience must be ${expectedAudience}` });
    }

    if (entry.defaultName.trim() === '') problems.push({ code, problem: 'defaultName is empty' });
    if (entry.defaultDescription.trim() === '') {
      problems.push({ code, problem: 'defaultDescription is empty' });
    }

    for (const old of entry.renamedFrom ?? []) {
      const owner = renamedSeen.get(old);
      if (owner !== undefined) {
        problems.push({ code, problem: `renamedFrom "${old}" is also claimed by ${owner}` });
      }
      renamedSeen.set(old, code);
    }
  }

  for (const [old, owner] of renamedSeen) {
    if (liveCodes.has(old)) {
      problems.push({ code: owner, problem: `renamedFrom "${old}" is still a live code` });
    }
  }

  return problems;
}
```

`packages/contracts/src/roles.ts`:

```ts
import type { UserKind } from './enums.js';
import {
  PERMISSIONS,
  permissionCodesForAudience,
  type PermissionCode,
  type PermissionDefinition,
} from './permissions.js';

export const ADMIN_ROLE_KEY = 'admin' as const;
export const ALL_FOR_AUDIENCE = 'ALL_FOR_AUDIENCE' as const;

export type SeededRoleKey = 'admin' | 'operator' | 'driver';

export interface SeededRole {
  /** Stable identity across renames (`Role.key`, spec deviation 3). */
  readonly key: SeededRoleKey;
  readonly name: string;
  readonly description: string;
  readonly appliesTo: UserKind;
  readonly isSystem: boolean;
  /** The sync keeps a locked role equal to its definition; unlocked roles are admin-editable. */
  readonly permissionsLocked: boolean;
  readonly permissions: typeof ALL_FOR_AUDIENCE | readonly PermissionCode[];
}

/** Roles created by the seed (spec section 9). Operator is editable and therefore not a system role. */
export const SEEDED_ROLES = [
  {
    key: 'admin',
    name: 'Admin',
    description: 'Full access to every back-office function.',
    appliesTo: 'STAFF',
    isSystem: true,
    permissionsLocked: true,
    permissions: ALL_FOR_AUDIENCE,
  },
  {
    key: 'operator',
    name: 'Operator',
    description: 'Runs the loading queue and reads master data.',
    appliesTo: 'STAFF',
    isSystem: false,
    permissionsLocked: false,
    permissions: [
      'orders:read',
      'orders:manage',
      'queue:read',
      'queue:assign-point',
      'queue:call',
      'queue:complete',
      'queue:remove',
      'queue:manual-checkin',
      'drivers:read',
      'cards:read',
      'vehicles:read',
      'carriers:read',
      'products:read',
      'loading-points:read',
      'audit:read',
    ],
  },
  {
    key: 'driver',
    name: 'Driver',
    description: 'Checks in at the kiosk with card and PIN.',
    appliesTo: 'DRIVER',
    isSystem: true,
    permissionsLocked: true,
    permissions: ['checkin:perform'],
  },
] as const satisfies readonly SeededRole[];

/** Expands `'ALL_FOR_AUDIENCE'` against `catalogue`; explicit lists are returned as given. */
export function resolveRolePermissions(
  role: SeededRole,
  catalogue: readonly PermissionDefinition[] = PERMISSIONS,
): PermissionCode[] {
  return role.permissions === ALL_FOR_AUDIENCE
    ? permissionCodesForAudience(role.appliesTo, catalogue)
    : [...role.permissions];
}
```

- [ ] **Step 5: Write the audit actions**

`packages/contracts/src/audit/auth.ts`:

```ts
import { z } from 'zod';

const empty = z.strictObject({});
const count = z.number().int().nonnegative();

export const LoginMethodSchema = z.enum(['PASSWORD', 'TOTP', 'RECOVERY_CODE']);
export type LoginMethod = z.infer<typeof LoginMethodSchema>;

export const LoginFailureReasonSchema = z.enum([
  'INVALID_CREDENTIALS',
  'INVALID_CODE',
  'CODE_REPLAYED',
  'ACCOUNT_LOCKED',
  'ACCOUNT_NOT_ACTIVE',
  'TOO_MANY_MFA_ATTEMPTS',
]);
export type LoginFailureReason = z.infer<typeof LoginFailureReasonSchema>;

export const SessionRevocationReasonSchema = z.enum([
  'LOGOUT',
  'BLOCKED',
  'DEACTIVATED',
  'PASSWORD_CHANGED',
  'ROLE_CHANGED',
  'MFA_RESET',
  'EXPIRED',
]);
export type SessionRevocationReason = z.infer<typeof SessionRevocationReasonSchema>;

/**
 * Spec section 8, staff authentication. The target is the User; token flows target the
 * ActionToken row instead of carrying its id in metadata (`token` is a sensitive key).
 */
export const AUTH_AUDIT_ACTIONS = {
  'auth.invite.issued': empty,
  'auth.invite.accepted': empty,
  'auth.invite.resent': empty,
  'auth.password.set': empty,
  'auth.totp.enrolled': empty,
  'auth.totp.verified': empty,
  'auth.login.success': z.strictObject({ method: LoginMethodSchema }),
  'auth.login.failure': z.strictObject({
    method: LoginMethodSchema,
    reason: LoginFailureReasonSchema,
  }),
  'auth.lockout.applied': z.strictObject({
    failedAttempts: z.number().int().min(1),
    lockedUntil: z.iso.datetime(),
  }),
  'auth.session.revoked': z.strictObject({
    reason: SessionRevocationReasonSchema,
    sessionCount: count,
  }),
  'auth.mfa.reset': empty,
  'auth.password-reset.requested': empty,
  'auth.password-reset.completed': empty,
} as const;
```

`packages/contracts/src/audit/admin.ts`:

```ts
import { z } from 'zod';

const empty = z.strictObject({});
const id = z.string().min(1).max(64);
const code = z.string().min(1).max(80);
const count = z.number().int().nonnegative();
/** A list's entity key (`drivers`, `loading-orders`) and a filter field name; never a value. */
const listKey = z.string().regex(/^[a-z]+(-[a-z]+)*$/).max(40);
const fieldName = z.string().regex(/^[a-z][A-Za-z0-9]*$/).max(64);

export const UserProfileFieldSchema = z.enum([
  'username',
  'firstName',
  'lastName',
  'dateOfBirth',
  'phone',
  'email',
  'locale',
]);
export type UserProfileField = z.infer<typeof UserProfileFieldSchema>;

/** Spec sections 7 to 9 and 12, back-office administration; loading orders live in `ops.ts`. */
export const ADMIN_AUDIT_ACTIONS = {
  'admin.user.created': empty,
  'admin.user.updated': z.strictObject({ changedFields: z.array(UserProfileFieldSchema).max(16) }),
  'admin.user.blocked': empty,
  'admin.user.unblocked': empty,
  'admin.user.deactivated': empty,
  'admin.user.unlocked': empty,
  'admin.user.role-changed': z.strictObject({ fromRoleId: id, toRoleId: id }),
  'admin.role.created': empty,
  'admin.role.updated': z.strictObject({
    permissionsAdded: z.array(code).max(200).optional(),
    permissionsRemoved: z.array(code).max(200).optional(),
  }),
  'admin.role.deleted': empty,
  'admin.permission.updated': empty,
  'admin.permission.deleted': z.strictObject({ code }),
  'admin.driver.created': empty,
  'admin.driver.updated': empty,
  // The PIN never goes into metadata.
  'admin.driver.pin-reset': empty,
  'admin.card.issued': empty,
  'admin.card.blocked': empty,
  'admin.carrier.created': empty,
  'admin.carrier.updated': empty,
  'admin.vehicle.created': empty,
  'admin.vehicle.updated': empty,
  // Every CSV export (spec section 12): the filtered field names, never the filter values.
  'admin.list.exported': z.strictObject({
    list: listKey,
    rowCount: count,
    filterFields: z.array(fieldName).max(32),
  }),
} as const;
```

`packages/contracts/src/audit/ops.ts` (its own file because orders administration belongs to `@tms/domain/ops`, owned by the back-end ops lane from phase 4; the area stays `admin`):

```ts
import { z } from 'zod';

const empty = z.strictObject({});

/** Spec section 7, loading orders administered from the back office. */
export const OPS_AUDIT_ACTIONS = {
  'admin.order.created': empty,
  'admin.order.updated': empty,
  'admin.order.cancelled': empty,
} as const;
```

`packages/contracts/src/audit/checkin.ts`:

```ts
import { z } from 'zod';

const empty = z.strictObject({});
const id = z.string().min(1).max(64);
const kioskId = z.string().min(1).max(64);
const sequenceNumber = z.number().int().min(1);

export const IdentifyFailureReasonSchema = z.enum([
  'UNKNOWN_CARD',
  'CARD_BLOCKED',
  'DRIVER_NOT_ACTIVE',
  'NO_PERMISSION',
  'ADR_EXPIRED',
  'PIN_INCORRECT',
  'PIN_LOCKED',
]);
export type IdentifyFailureReason = z.infer<typeof IdentifyFailureReasonSchema>;

/**
 * Spec sections 8 (driver) and 10. The card serial is never metadata: an identify failure targets
 * the IdentityCard by id when the card is known and has no target otherwise.
 */
export const CHECKIN_AUDIT_ACTIONS = {
  'checkin.identify.success': z.strictObject({ kioskId }),
  'checkin.identify.failure': z.strictObject({ kioskId, reason: IdentifyFailureReasonSchema }),
  'checkin.pin.locked': z.strictObject({
    failedAttempts: z.number().int().min(1),
    lockedUntil: z.iso.datetime(),
  }),
  'checkin.order.confirmed': z.strictObject({ kioskId }),
  'checkin.queue.checked-in': z.strictObject({ sequenceNumber, kioskId }),
  'checkin.queue.manual-checkin': z.strictObject({ sequenceNumber }),
  'checkin.queue.point-assigned': z.strictObject({ loadingPointId: id }),
  'checkin.queue.called': empty,
  'checkin.queue.completed': empty,
  'checkin.queue.removed': z.strictObject({ reason: z.string().min(1).max(200) }),
} as const;
```

`packages/contracts/src/audit/system.ts`:

```ts
import { z } from 'zod';

const count = z.number().int().nonnegative();

/** Written by the permission sync and the seed (app SYSTEM, no actor). */
export const SYSTEM_AUDIT_ACTIONS = {
  'system.permissions.synced': z.strictObject({
    inserted: count,
    reactivated: count,
    deprecated: count,
    deleted: count,
    renamed: count,
  }),
  'system.seed.applied': z.strictObject({ created: count, unchanged: count }),
} as const;
```

`packages/contracts/src/audit/index.ts`:

```ts
import { z } from 'zod';
import { ADMIN_AUDIT_ACTIONS } from './admin.js';
import { AUTH_AUDIT_ACTIONS } from './auth.js';
import { CHECKIN_AUDIT_ACTIONS } from './checkin.js';
import { OPS_AUDIT_ACTIONS } from './ops.js';
import { SYSTEM_AUDIT_ACTIONS } from './system.js';

export * from './admin.js';
export * from './auth.js';
export * from './checkin.js';
export * from './ops.js';
export * from './system.js';

/** `<area>.<entity>.<event>`, kebab-case segments; every value is a fail-closed strict object. */
export const AUDIT_ACTIONS = {
  ...AUTH_AUDIT_ACTIONS,
  ...ADMIN_AUDIT_ACTIONS,
  ...OPS_AUDIT_ACTIONS,
  ...CHECKIN_AUDIT_ACTIONS,
  ...SYSTEM_AUDIT_ACTIONS,
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export const AUDIT_ACTION_NAMES = Object.keys(AUDIT_ACTIONS) as readonly AuditAction[];

export const AuditActionSchema = z.enum(AUDIT_ACTION_NAMES);

export type AuditMetadata<A extends AuditAction> = z.output<(typeof AUDIT_ACTIONS)[A]>;

export const AuditTargetTypeSchema = z.enum([
  'User',
  'Role',
  'Permission',
  'DriverProfile',
  'IdentityCard',
  'Carrier',
  'Vehicle',
  'Product',
  'LoadingPoint',
  'LoadingOrder',
  'QueueEntry',
  'Session',
  'ActionToken',
]);
export type AuditTargetType = z.infer<typeof AuditTargetTypeSchema>;

export class AuditMetadataError extends Error {
  override readonly name = 'AuditMetadataError';

  constructor(
    readonly action: string,
    readonly issues: readonly z.core.$ZodIssue[],
  ) {
    super(
      `Invalid audit metadata for ${action}: ${issues
        .map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`)
        .join('; ')}`,
    );
  }
}

/**
 * Validates `value` against the action's strict schema. `undefined` means "no metadata" and is
 * accepted only where the schema is empty. Throws `AuditMetadataError` on any issue, including an
 * action that is not in `AUDIT_ACTIONS` (the caller's transaction then rolls back).
 */
export function parseAuditMetadata<A extends AuditAction>(
  action: A,
  value: unknown,
): AuditMetadata<A> {
  const schema = (AUDIT_ACTIONS as Record<string, z.ZodType | undefined>)[action];
  if (schema === undefined) {
    throw new AuditMetadataError(action, [
      {
        code: 'invalid_value',
        values: [...AUDIT_ACTION_NAMES],
        path: [],
        message: 'unknown audit action',
        input: action,
      },
    ]);
  }
  const result = schema.safeParse(value ?? {});
  if (!result.success) throw new AuditMetadataError(action, result.error.issues);
  return result.data as AuditMetadata<A>;
}
```

- [ ] **Step 6: Write the scrub module and the package index**

`packages/contracts/src/security/scrub.ts`:

```ts
// Pure and isomorphic: no Node imports. Used by the logger (pino redact + serializers), the
// Sentry beforeSend hook and the audit metadata test.

export const REDACTED = '[REDACTED]' as const;
export const CIRCULAR = '[Circular]' as const;
export const MAX_DEPTH_REACHED = '[MaxDepth]' as const;

/**
 * Words that mark a key as sensitive (spec section 11 plus the token, device and session
 * material of sections 8 and 9). Compared against whole words of the key, never substrings.
 */
export const SENSITIVE_KEY_TOKENS = [
  'password',
  'passwords',
  'passwd',
  'passphrase',
  'pin',
  'pins',
  'cardserial',
  'token',
  'tokens',
  'jwt',
  'authorization',
  'cookie',
  'cookies',
  'setcookie',
  'totp',
  'otp',
  'recoverycode',
  'recoverycodes',
  'secret',
  'secrets',
  'apikey',
  'devicekey',
  'sessionid',
] as const;

const TOKENS: ReadonlySet<string> = new Set(SENSITIVE_KEY_TOKENS);

/** `cardSerial` -> ['card', 'serial']; `Set-Cookie[]` -> ['set', 'cookie']; `PINCode` -> ['pin', 'code']. */
function wordsOf(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

/**
 * True when the key, split into words at camelCase boundaries and separators, contains a
 * sensitive word or an adjacent pair forming one (`card`+`serial`, `x-device-key`,
 * `recovery_code`). `tokenHash` and `tokenCount` match (the word `token`); `shipping`, `mapping`,
 * `keyId` and `footprint` do not because `pin`/`otp` are not whole words there.
 */
export function isSensitiveKey(key: string): boolean {
  const words = wordsOf(key);
  if (words.length === 0) return false;
  if (words.join('') === 'setcookie') return true;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? '';
    if (TOKENS.has(word)) return true;
    const next = words[i + 1];
    if (next !== undefined && TOKENS.has(word + next)) return true;
  }
  return false;
}

const AUTH_SCHEME = /\b(bearer|basic|digest)\s+(\[REDACTED\]|[^\s,;"')}\]]+)/gi;
const URL_CREDENTIALS = /(\/\/)([^\s/@:?#]+):([^\s/@?#]*)@/g;
// The value alternative `\[[A-Za-z]+\]` keeps bracketed markers whole: a second pass leaves
// `token=[REDACTED]` alone and Sentry's `token=[Filtered]` becomes `token=[REDACTED]`, not `…]]`.
const KEY_VALUE =
  /(^|[\s?&;,("'{[])([A-Za-z_][A-Za-z0-9_.\-[\]]{0,63})\s*=\s*(\[[A-Za-z]+\]|[^\s&;,)"'}\]#]+)/g;
const JSON_PAIR = /"([^"\\]{1,64})"\s*:\s*("(?:[^"\\]|\\.)*"|[^,}\]\s]+)/g;

/**
 * Redacts credentials embedded in free text: `Bearer x`, `//user:pass@`, `key=value` pairs and
 * JSON `"key":"value"` pairs whose key is sensitive. Idempotent.
 */
export function scrubString(text: string): string {
  return scrubJsonPairs(scrubUrl(text.replace(AUTH_SCHEME, `$1 ${REDACTED}`)));
}

/** Redacts `user:password@` and sensitive query parameters of a URL (or any text holding one). */
export function scrubUrl(url: string): string {
  return scrubKeyValuePairs(url.replace(URL_CREDENTIALS, `$1${REDACTED}@`));
}

function scrubKeyValuePairs(text: string): string {
  return text.replace(KEY_VALUE, (match: string, lead: string, key: string) =>
    isSensitiveKey(key) ? `${lead}${key}=${REDACTED}` : match,
  );
}

function scrubJsonPairs(text: string): string {
  return text.replace(JSON_PAIR, (match: string, key: string) =>
    isSensitiveKey(key) ? `"${key}":"${REDACTED}"` : match,
  );
}

export interface ScrubOptions {
  /** Nesting depth after which subtrees are replaced by `[MaxDepth]`; default 32. */
  readonly maxDepth?: number;
}

/**
 * Deep copy of `value` with every value under a sensitive key replaced by `[REDACTED]`, every
 * string leaf passed through `scrubString`, cycles cut with `[Circular]` and depth capped.
 * Arrays and objects (own enumerable keys) are walked; `Error` becomes a plain object with
 * name, scrubbed message and stack, walked `cause` and own properties; Date, ArrayBuffer views,
 * Map and Set are returned as they are.
 */
export function scrubDeep<T>(value: T, options: ScrubOptions = {}): T {
  return walk(value, options.maxDepth ?? 32, new WeakSet<object>()) as T;
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;
  if (
    value instanceof Date ||
    ArrayBuffer.isView(value) ||
    value instanceof Map ||
    value instanceof Set
  ) {
    return value;
  }
  if (seen.has(value)) return CIRCULAR;
  if (depth <= 0) return MAX_DEPTH_REACHED;
  seen.add(value);

  let result: unknown;
  if (Array.isArray(value)) {
    result = value.map((item) => walk(item, depth - 1, seen));
  } else {
    const out: Record<string, unknown> = {};
    if (value instanceof Error) {
      out['name'] = value.name;
      out['message'] = scrubString(value.message);
      if (typeof value.stack === 'string') out['stack'] = scrubString(value.stack);
      if (value.cause !== undefined) out['cause'] = walk(value.cause, depth - 1, seen);
    }
    for (const [key, item] of Object.entries(value)) {
      out[key] = isSensitiveKey(key) ? REDACTED : walk(item, depth - 1, seen);
    }
    result = out;
  }

  seen.delete(value);
  return result;
}
```

`packages/contracts/src/security/index.ts`:

```ts
export * from './scrub.js';
```

`packages/contracts/src/index.ts`:

```ts
// The subpaths `@tms/contracts/security` and `@tms/contracts/audit` are conveniences for
// consumers that want a narrow import; everything is also reachable from the root.
export * from './audit/index.js';
export * from './common.js';
export * from './enums.js';
export * from './permissions.js';
export * from './roles.js';
export * from './routing.js';
export * from './security/index.js';
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm exec prettier --write packages/contracts && pnpm turbo run test --filter=@tms/contracts`
Expected: GREEN, exit 0: `Test Files  5 passed (5)`, `Tests  147 passed (147)` — `enums.test.ts` 16, `permissions.test.ts` 18, `roles.test.ts` 5, `audit.test.ts` 11, `scrub.test.ts` 97 (the fast-check property runs 300 cases). If the property fails, vitest prints the shrunk counterexample (`base`, `path`, `sensitiveKey`, `planted`) — the redaction has a hole, fix `isSensitiveKey`/`walk`, never the generator.

- [ ] **Step 8: Lint, typecheck, build and prove `require(esm)` through the exports map**

Run: `pnpm turbo run lint --filter=@tms/contracts`
Expected: exit 0, no `[boundaries]` warning (the package imports only `zod` and its own files).

Run: `pnpm turbo run typecheck --filter=@tms/contracts`
Expected: exit 0. Negative check of the no-Node guard: `printf 'export const x = process.env;\n' > packages/contracts/src/tmp.ts && pnpm turbo run typecheck --filter=@tms/contracts; rm packages/contracts/src/tmp.ts`
Expected: `error TS2591: Cannot find name 'process'` and a non-zero exit (then the file is removed).

Run: `pnpm turbo run build --filter=@tms/contracts && ls packages/contracts/dist packages/contracts/dist/security packages/contracts/dist/audit`
Expected: exit 0; `dist/index.js`, `dist/index.d.ts`, `dist/security/index.js`, `dist/security/index.d.ts`, `dist/audit/index.js`, `dist/audit/index.d.ts` present (plus the other modules and `.map` files).

Run (a CommonJS context loading the ESM dist by package name; Node resolves the self-reference through `exports`, which is exactly what the CJS Nest apps and libraries will do):

```bash
cd packages/contracts && node -e "const m = require('@tms/contracts'); const s = require('@tms/contracts/security'); const a = require('@tms/contracts/audit'); console.log('root keys', Object.keys(m).length, '| security keys', Object.keys(s).length, '| audit keys', Object.keys(a).length, '| PERMISSIONS', m.PERMISSIONS.length, '| AUDIT_ACTIONS', Object.keys(m.AUDIT_ACTIONS).length, '|', m.isSensitiveKey('cardSerial'), m.PUBLIC_ROUTE_KEY, m.EmailSchema.parse('  Ana@Example.COM '))" && node -e "try { require('@tms/contracts/enums') } catch (e) { console.log('deep path:', e.code) }" && (grep -rn 'process\.\|Buffer\|require(' dist --include='*.js' || echo 'no node globals in dist'); cd ../..
```

Expected: `root keys 51 | security keys 8 | audit keys 16 | PERMISSIONS 33 | AUDIT_ACTIONS 50 | true tms:public-route ana@example.com`, then `deep path: ERR_PACKAGE_PATH_NOT_EXPORTED`, then `no node globals in dist`. No `ERR_REQUIRE_ESM`, no `ERR_PACKAGE_PATH_NOT_EXPORTED` on the three exported paths.

- [ ] **Step 9: Document the module-format rule**

`CLAUDE.md`: insert after line 53 (the bullet ending `enums and DTO schemas live in \`contracts\`.`):

```md
- Libraries consumed by the SPAs (`contracts`, later `ui`) are ESM; Nest-aware libraries are
  CommonJS (`nest-library.json`); package `exports` carry `types` + `default`.
```

`docs/architecture.md`: insert before line 54 (`## Environments`; Task 02 grew the "Dependency rule" paragraph to lines 41–52), after that paragraph and its blank line:

```md
## Packages and module format

Nest-aware libraries (`db`, `logger`, `nest-bootstrap`, `domain`) compile to CommonJS
(`@tms/config/tsconfig/nest-library.json`) like the two apps, so dual-build dependencies such as
`nestjs-cls` and `@sentry/nestjs` load exactly once per process. `contracts` (and later `ui`) is
ESM (`library.json`, `.js` extensions on relative imports) because the Vite SPAs import it; the
CommonJS apps and libraries load it through Node's `require(esm)` (Node 22.12+, no top-level
`await` allowed in the package). Every package `exports` entry carries `types` + `default`, never
`import` only, so both module systems and TypeScript's `nodenext` resolution land on the same file;
subpaths (`./security`, `./audit`) are the only deep imports the exports map allows.

```

Run: `pnpm exec prettier --write CLAUDE.md docs/architecture.md packages/contracts/README.md && pnpm format:check && wc -l CLAUDE.md`
Expected: `All matched files use Prettier code style!`; `74 CLAUDE.md` (limit 150).

- [ ] **Step 10: Whole-repo verification, journal and commit**

Run: `pnpm verify`
Expected: exit 0; turbo reports `lint`, `typecheck`, `test`, `build` for `@tms/contracts` among the tasks (no cache hit on the first run), `pnpm format:check` clean, hygiene `ok`, gitleaks `no leaks found`.

Append to `docs/efficiency/critical-path.md` (fill the times; describe any snippet that needed a fix in the Rework column):

```md
| 2026-MM-DD | Task 03: `@tms/contracts` — enums, permission catalogue, seeded roles, audit actions and scrub list | subagent | HH:MM | HH:MM | <rework or none> | n/a | 147 Vitest tests (5 files) incl. a 300-run fast-check redaction property; `require('@tms/contracts')` from CJS resolves through `exports`; `types: []` keeps Node globals out. |
```

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml packages/contracts CLAUDE.md docs/architecture.md docs/efficiency/critical-path.md
git commit -m "feat(contracts): add enums, permission catalogue, seeded roles, audit actions and scrub list"
```

Expected: this commit passes all hooks (header 92 characters).

**PR body notes:**
- Diagram: `flowchart LR` — `PERMISSIONS` → `validateCatalogue` → permission sync (Task 07) → `Permission`/`RolePermission` tables; `SEEDED_ROLES` + `resolveRolePermissions` → seed (Task 08); `PermissionCode` → `@RequirePermissions` + `PermissionsGuard` (phase 3a) and `usePermissions` (phase 6); `AUDIT_ACTIONS` + `parseAuditMetadata` → `AuditService` (Task 14); `isSensitiveKey`/`scrubDeep` → `@tms/logger` redaction (Task 10) and Sentry `beforeSend` (Task 13); `DB_MIRRORED_ENUMS` → `$Enums` parity test (Task 05); `EmailSchema` → forms (phase 6).
- Affected boundaries: new package `@tms/contracts` (element `contracts`, imports nothing from the workspace); public interfaces listed under Interfaces above; catalog gains `fast-check ^4.10.2`; migration: no.
- Verification plan: `pnpm verify`; `@tms/contracts` tests RED (modules missing) then GREEN; lint, typecheck (plus the negative `process` check), build; the CommonJS `require` of the three exported paths and the blocked deep path; CI `verify`.
- Verification results (`scenario | layer | outcome`): catalogue invariants incl. broken catalogues and the `drivers:reset-pin`/`cards:block` split (18 tests) | unit, Vitest | pass; seeded roles vs catalogue and section 9 list (5) | unit | pass; audit action naming, strict metadata, no sensitive key in any schema, `OPS_AUDIT_ACTIONS` split, phase 3 metadata (`pin-reset`, `permission.deleted`, `list.exported`), `parseAuditMetadata` rejections (11) | unit | pass; `isSensitiveKey` positives/negatives, `scrubString`/`scrubUrl` table incl. `token=[Filtered]`, `scrubDeep` (Error, cycles, depth) + fast-check property 300 runs (97) | unit + property | pass; enums 14 names, ≥ 2 unique values each (16) | unit | pass; lint / typecheck / build | static | exit 0; `require('@tms/contracts')` and both subpaths from a CJS context, deep path blocked | node | 51 / 8 / 16 keys, `ERR_PACKAGE_PATH_NOT_EXPORTED` for `./enums`; `pnpm verify` | repo | exit 0.
- Risks and notes: the word-based `isSensitiveKey` over-redacts harmless keys that contain a sensitive word (`pinFailedCount`, `totpEnabledAt`, `actionTokenId`) — accepted, a leaked secret is worse; metadata schemas therefore never use such keys (test-enforced) and token flows use target type `ActionToken`. `system.permissions.synced` has five counters (`reactivated` added) and `system.seed.applied` has `{ created, unchanged }`: Tasks 07 and 08 map their reports onto these keys. `scrubDeep` returns `Map`/`Set` uninspected (JSON-serialised as `{}` by pino/Sentry anyway). `tsconfig.build.json` restates the `rootDir`/`outDir` that `library.json` sets through `${configDir}`. Phase 3 requests P1-1/P1-2 are folded in: two split-out codes (`drivers:reset-pin`, `cards:block`), `admin.permission.deleted`, `admin.list.exported` (requested as `list.exported`, renamed to fit `<area>.<entity>.<event>`), and `admin.order.*` in `audit/ops.ts`; `admin.driver.pin-reset` already existed (requested as `pin_reset`).

---

### Task 04: Testcontainers harness (`@tms/db/testing`)

**Branch:** `phase-1/04-db-testing`
**PR title:** `test(db): add the Testcontainers Postgres harness with one database per Jest worker`

Spec: section 13 ("API E2E (Jest + supertest + **Testcontainers Postgres everywhere**, one database per Jest worker from a template)"), Review Focus 6 (two workers get distinct databases, the template is migrated once, Docker variables pass through turbo, no Docker fails fast naming Docker); plan deviation 15 (harness inside `@tms/db`). `@tms/db` becomes a buildable CommonJS package; the harness is its first code. Spike S3 is the source of the harness.

Spike notes (re-run with Jest 30.5.2, ts-jest 29.4.12 and testcontainers 12.1.0 in a scratch replica): typecheck, ESLint, build, a `--maxWorkers=2` run (the 11 spike cases green, ~5 s), a `--runInBand` run (still two clones), a consumer package using the compiled harness through `createJestConfig({ database: true })`, `TESTCONTAINERS_RYUK_DISABLED=true` (no Ryuk container afterwards) and a real "no Docker" run under `unshare -Urm` with a tmpfs over `/run` (`Testcontainers could not reach Docker: Could not find a working container runtime strategy. Is the Docker daemon running?` after 0.85 s) all behaved as written below. Departures from S3's code: the harness clones `max(2, maxWorkers)` databases (not `max(1, …)`), so the isolation test always has a neighbour even in band (40 ms per extra clone); S3's teardown diagnostics (committed transactions per clone) are dropped; the `globalThis` container slot is a typed accessor instead of `declare global { var … }` (`no-var` is on for TS files). `pg` and `@types/pg` enter the catalog (group `# data`) and the `@tms/db` devDependencies here, so Task 05 moves `pg` to `dependencies` instead of adding it; this task also creates `packages/db/README.md`, which Task 05 appends to.

**Files:**
- Create: `packages/db/tsconfig.build.json`, `packages/db/jest.config.mjs`, `packages/db/README.md`, `packages/db/src/index.ts`, `packages/db/src/testing/constants.ts`, `packages/db/src/testing/global-setup.ts`, `packages/db/src/testing/global-teardown.ts`, `packages/db/src/testing/index.ts`, `packages/db/test/support/worker-databases.ts`
- Modify: `packages/db/package.json` (whole file), `packages/db/tsconfig.json` (whole file), `pnpm-workspace.yaml` (catalog groups `# testing` and `# data`, `allowBuilds`), `pnpm-lock.yaml`, `turbo.json` (task `@tms/db#test`), `.github/workflows/ci.yml` (`verify` timeout, `db-drift` validate step), `README.md:12`, `CLAUDE.md:49` (one Rules bullet), `docs/architecture.md` (`## Testing strategy`, end of file), `docs/efficiency/critical-path.md`
- Test: `packages/db/test/harness.spec.ts`, `packages/db/test/harness-second-worker.spec.ts`

**Interfaces:**
- Consumes: `createJestConfig({ rootDir, database: true })` from `@tms/config/jest` including its `maxWorkers: process.env.CI ? 2 : '50%'` line (both Task 02 — the preset points `@tms/db` itself at `<rootDir>/src/testing/global-{setup,teardown}.ts` and every other package at the compiled `@tms/db/testing/jest-global-{setup,teardown}`); `@tms/config/tsconfig/nest-library.json` and turbo `globalPassThroughEnv` (Task 02); `prisma.config.ts` and `prisma/migrations/` (phase 0, unchanged).
- Produces:
  - `@tms/db/testing` (`dist/testing/index.*`): `POSTGRES_TEST_IMAGE = 'postgres:18-alpine'`; `testDatabaseUrl(workerId: string = process.env.JEST_WORKER_ID ?? '1'): string`; `resetTestDatabase(url: string = testDatabaseUrl()): Promise<void>` (TRUNCATE every public table except `_prisma_migrations`, `RESTART IDENTITY CASCADE`; no-op without tables); `withAdminClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T>` (maintenance database `postgres`). Every connection sets `connectionTimeoutMillis: 5000`.
  - `@tms/db/testing/jest-global-setup`: default `globalSetup(globalConfig: { maxWorkers: number }): Promise<void>`; named `startPostgres(starter?: PostgresStarter): Promise<StartedPostgreSqlContainer>` (rethrows `Error('Testcontainers could not reach Docker: <message>. Is the Docker daemon running?', { cause })`), `PostgresStarter`, `harnessGlobals`. `@tms/db/testing/jest-global-teardown`: default `globalTeardown(): Promise<void>`.
  - Run-time contract: databases `tms_template` (migrated once per Jest run with `node_modules/.bin/prisma migrate deploy`, `cwd` = package root) and `tms_w1` … `tms_wN`, N = `max(2, maxWorkers)`; env `TEST_DB_ADMIN_URL`, `TEST_DB_URL_TEMPLATE` (`…/tms_w__N__`), `TEST_DB_WORKER_COUNT`, set in the Jest parent before workers spawn.
  - `@tms/db` manifest: `"type": "commonjs"`, `main`/`types`, exports `.`, `./testing`, `./testing/jest-global-setup`, `./testing/jest-global-teardown` (each `{ types, default }`), `files: ["dist", "prisma", "prisma.config.ts"]`, scripts `build`, `test` (Jest; `prisma validate` moves to the `db:validate` script, run by the CI `db-drift` job and Task 05's verification), `src/index.ts` with the transient `DB_PACKAGE` export (Task 05 replaces the file).
  - Test helpers `packages/db/test/support/worker-databases.ts`: `queryRows<T>(url, sql, params?)`, `workerDatabases()`, `otherWorkerUrls()`, `currentWorkerId()`, `tableExists(url, table)`.

- [ ] **Step 1: Catalog, build approvals and the package skeleton**

`pnpm-workspace.yaml`, catalog: replace the two lines `  # data` / `  prisma: ^7.10.0` (right after `  '@playwright/test': ^1.63.0`, the end of the `# react` group) with a new `# testing` group and the extended `# data` group:

```yaml
  # testing (Testcontainers pinned exactly: the harness was verified against 12.1.0)
  testcontainers: 12.1.0
  '@testcontainers/postgresql': 12.1.0
  # data
  prisma: ^7.10.0
  pg: ^8.23.0
  '@types/pg': ^8.23.1
```

(Task 05 replaces the `# data` lines with the exact Prisma trio plus these same two `pg` lines; the `# testing` group stays.)

`pnpm-workspace.yaml`, `allowBuilds`: append three entries to the existing block (edit it in place — a second `allowBuilds:` key is a YAML `duplicate mapping key`):

```yaml
  # testcontainers' optional native helpers; the harness works with them unbuilt (spike S3)
  ssh2: false
  cpu-features: false
  protobufjs: false
```

`prisma`, `@prisma/engines`, `msw`, `@parcel/watcher` and `unrs-resolver` are already listed (phase 0 dropped `esbuild`). pnpm 12 exits 1 with `ERR_PNPM_IGNORED_BUILDS` until every package with a build script has an entry.

`packages/db/package.json` (full file; the five `db:*` scripts are phase 0's, `db:drift` included — `prisma migrate status` first, so a missing `DATABASE_URL` fails instead of passing; `prisma` and `dotenv` stay runtime dependencies until Tasks 05/09 rework them):

```json
{
  "name": "@tms/db",
  "version": "0.0.0",
  "private": true,
  "type": "commonjs",
  "description": "Prisma schema, migrations and database access for the TMS platform",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./testing": {
      "types": "./dist/testing/index.d.ts",
      "default": "./dist/testing/index.js"
    },
    "./testing/jest-global-setup": {
      "types": "./dist/testing/global-setup.d.ts",
      "default": "./dist/testing/global-setup.js"
    },
    "./testing/jest-global-teardown": {
      "types": "./dist/testing/global-teardown.d.ts",
      "default": "./dist/testing/global-teardown.js"
    }
  },
  "files": [
    "dist",
    "prisma",
    "prisma.config.ts"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "db:validate": "prisma validate",
    "db:migrate:dev": "prisma migrate dev",
    "db:migrate:deploy": "prisma migrate deploy",
    "db:migrate:status": "prisma migrate status",
    "db:drift": "prisma migrate status && prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' jest"
  },
  "dependencies": {
    "dotenv": "catalog:",
    "prisma": "catalog:"
  },
  "devDependencies": {
    "@testcontainers/postgresql": "catalog:",
    "@tms/config": "workspace:*",
    "@types/jest": "catalog:",
    "@types/node": "catalog:",
    "@types/pg": "catalog:",
    "eslint": "catalog:",
    "jest": "catalog:",
    "pg": "catalog:",
    "testcontainers": "catalog:",
    "ts-jest": "catalog:",
    "typescript": "catalog:nest-ts6"
  }
}
```

The harness packages are devDependencies (deviation 15): `pnpm deploy --prod` never ships them, and a consumer's `globalSetup` loads them from `packages/db/node_modules` through the realpath of `@tms/db` (S3), so apps list only `@tms/db`.

`packages/db/tsconfig.json` (full file; `prisma.config.ts` compiles as CommonJS now, which works because `nest-library.json` has no `verbatimModuleSyntax`):

```json
{
  "extends": "@tms/config/tsconfig/nest-library.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true, "types": ["node", "jest"] },
  "include": ["src", "test", "prisma.config.ts"]
}
```

`packages/db/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "rootDir": "./src", "outDir": "./dist", "noEmit": false, "types": ["node"] },
  "include": ["src"],
  "exclude": ["**/*.spec.ts", "**/*.test.ts"]
}
```

`packages/db/jest.config.mjs`:

```js
import { createJestConfig } from '@tms/config/jest';

export default createJestConfig({ rootDir: import.meta.dirname, database: true });
```

`packages/db/src/index.ts` (the `.` export must resolve to a file; Task 05 replaces this file with `createPrismaClient` and the generated client):

```ts
/** Package entry point; the Prisma client factory joins it once the schema has models. */
export const DB_PACKAGE = '@tms/db' as const;
```

`packages/db/README.md`:

```md
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
```

Run: `pnpm install`
Expected: exit 0, no `ERR_PNPM_IGNORED_BUILDS`; `devDependencies` of `@tms/db` gain `@testcontainers/postgresql 12.1.0`, `@types/jest 30.0.0`, `@types/pg 8.23.1`, `jest 30.5.2`, `pg 8.23.0`, `testcontainers 12.1.0`, `ts-jest 29.4.12`; a `[WARN] … deprecated subdependencies found: glob@10.5.0` line is expected (via testcontainers). If pnpm names another ignored build, it has written `<name>: set this to true or false` into `allowBuilds`: set it to `false` in place, rerun, and record it in the journal. Commit any `minimumReleaseAgeExclude` lines pnpm adds.

- [ ] **Step 2: Write the failing harness tests**

`packages/db/test/support/worker-databases.ts`:

```ts
import { Client } from 'pg';
import { testDatabaseUrl, withAdminClient } from '../../src/testing';

/** Runs one statement against `url` on a short-lived connection. */
export async function queryRows<T extends object>(
  url: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    const result = await client.query<T>(sql, params);
    return result.rows;
  } finally {
    await client.end();
  }
}

/** Names of the per-worker clones the harness created, in worker order. */
export async function workerDatabases(): Promise<string[]> {
  const rows = await withAdminClient(async (admin) => {
    const result = await admin.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname ~ '^tms_w[0-9]+$'
        ORDER BY length(datname), datname`,
    );
    return result.rows;
  });
  return rows.map((row) => row.datname);
}

/** URLs of every worker clone except the current worker's own database. */
export async function otherWorkerUrls(): Promise<string[]> {
  const own = currentWorkerId();
  const names = await workerDatabases();
  return names
    .map((name) => name.slice('tms_w'.length))
    .filter((id) => id !== own)
    .map((id) => testDatabaseUrl(id));
}

export function currentWorkerId(): string {
  return process.env['JEST_WORKER_ID'] ?? '1';
}

export async function tableExists(url: string, table: string): Promise<boolean> {
  const [row] = await queryRows<{ reg: string | null }>(
    url,
    'SELECT to_regclass($1)::text AS reg',
    [`public.${table}`],
  );
  return (row?.reg ?? null) !== null;
}
```

`packages/db/test/harness.spec.ts` (every assertion holds with zero migrations today and with Task 05's migrations later: the `_prisma_migrations` checks count the migration folders instead of hard-coding a number — `migrate deploy` creates the table even with no migration):

```ts
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  POSTGRES_TEST_IMAGE,
  resetTestDatabase,
  testDatabaseUrl,
  withAdminClient,
} from '../src/testing';
import { startPostgres } from '../src/testing/global-setup';
import {
  currentWorkerId,
  otherWorkerUrls,
  queryRows,
  tableExists,
  workerDatabases,
} from './support/worker-databases';

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'prisma', 'migrations');
const COMPOSE_FILE = path.resolve(__dirname, '..', '..', '..', 'infra', 'docker-compose.yml');
const TURBO_FILE = path.resolve(__dirname, '..', '..', '..', 'turbo.json');

interface TurboConfig {
  globalPassThroughEnv?: string[];
  tasks: Record<string, { passThroughEnv?: string[] }>;
}
const PROBE_TABLE = 'harness_probe_one';
const RESET_TABLE = 'harness_reset_probe';

function migrationFolderCount(): number {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    .length;
}

describe('@tms/db/testing harness', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterEach(async () => {
    await queryRows(testDatabaseUrl(), `DROP TABLE IF EXISTS ${PROBE_TABLE}, ${RESET_TABLE}`);
  });

  it('connects each Jest worker to its own clone', async () => {
    const [row] = await queryRows<{ db: string }>(
      testDatabaseUrl(),
      'SELECT current_database() AS db',
    );
    expect(row?.db).toBe(`tms_w${currentWorkerId()}`);
  });

  it('clones at least two worker databases from one template', async () => {
    const names = await workerDatabases();
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(names).toEqual(names.map((_, index) => `tms_w${index + 1}`));
    const templates = await withAdminClient(async (admin) => {
      const result = await admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_database WHERE datname = 'tms_template'`,
      );
      return result.rows[0]?.n;
    });
    expect(templates).toBe(1);
  });

  it('inherits _prisma_migrations from the migrated template, one row per migration folder', async () => {
    const [row] = await queryRows<{ n: number }>(
      testDatabaseUrl(),
      'SELECT count(*)::int AS n FROM _prisma_migrations',
    );
    expect(row?.n).toBe(migrationFolderCount());
  });

  it('keeps a table created in this worker database invisible to every other clone', async () => {
    const own = testDatabaseUrl();
    await queryRows(own, `CREATE TABLE ${PROBE_TABLE} (id integer PRIMARY KEY)`);
    await queryRows(own, `INSERT INTO ${PROBE_TABLE} (id) VALUES (1)`);
    expect(await tableExists(own, PROBE_TABLE)).toBe(true);
    const others = await otherWorkerUrls();
    expect(others.length).toBeGreaterThanOrEqual(1);
    for (const url of others) {
      expect(await tableExists(url, PROBE_TABLE)).toBe(false);
    }
  });

  it('resetTestDatabase empties tables, restarts identities and keeps _prisma_migrations', async () => {
    const url = testDatabaseUrl();
    await queryRows(
      url,
      `CREATE TABLE ${RESET_TABLE} (id serial PRIMARY KEY, label text NOT NULL)`,
    );
    await queryRows(url, `INSERT INTO ${RESET_TABLE} (label) VALUES ('a'), ('b')`);

    await resetTestDatabase();

    const [count] = await queryRows<{ n: number }>(
      url,
      `SELECT count(*)::int AS n FROM ${RESET_TABLE}`,
    );
    expect(count?.n).toBe(0);
    const [inserted] = await queryRows<{ id: number }>(
      url,
      `INSERT INTO ${RESET_TABLE} (label) VALUES ('c') RETURNING id`,
    );
    expect(inserted?.id).toBe(1);
    const [migrations] = await queryRows<{ n: number }>(
      url,
      'SELECT count(*)::int AS n FROM _prisma_migrations',
    );
    expect(migrations?.n).toBe(migrationFolderCount());
  });

  it('resetTestDatabase is a no-op on a database without tables', async () => {
    const name = `tms_reset_empty_w${currentWorkerId()}`;
    await withAdminClient((admin) => admin.query(`CREATE DATABASE ${name}`));
    try {
      const url = new URL(testDatabaseUrl());
      url.pathname = `/${name}`;
      await expect(resetTestDatabase(url.toString())).resolves.toBeUndefined();
    } finally {
      await withAdminClient((admin) => admin.query(`DROP DATABASE ${name}`));
    }
  });

  it('gets the Docker variables through turbo and never DATABASE_URL (Review Focus 6)', () => {
    const turbo = JSON.parse(readFileSync(TURBO_FILE, 'utf8')) as TurboConfig;
    // Testcontainers finds the daemon through these; turbo's strict env mode drops anything unlisted.
    expect(turbo.globalPassThroughEnv).toEqual(['DOCKER_*', 'XDG_RUNTIME_DIR', 'TESTCONTAINERS_*']);
    expect(turbo.tasks['test']?.passThroughEnv).toBeUndefined();
    expect(turbo.tasks['@tms/db#test']?.passThroughEnv).toBeUndefined();
    const databaseTasks = Object.keys(turbo.tasks).filter(
      (name) => name.startsWith('db:') && name !== 'db:validate',
    );
    expect(databaseTasks.length).toBeGreaterThanOrEqual(4);
    for (const name of databaseTasks) {
      expect(turbo.tasks[name]?.passThroughEnv).toContain('DATABASE_URL');
    }
  });

  it('pins the same Postgres image as infra/docker-compose.yml', () => {
    const compose = readFileSync(COMPOSE_FILE, 'utf8');
    expect(/image: (postgres:\S+)/.exec(compose)?.[1]).toBe(POSTGRES_TEST_IMAGE);
  });

  it('names the missing Jest setup when the harness environment is absent', () => {
    const saved = process.env['TEST_DB_URL_TEMPLATE'];
    delete process.env['TEST_DB_URL_TEMPLATE'];
    try {
      expect(() => testDatabaseUrl()).toThrow(
        'TEST_DB_URL_TEMPLATE is not set: the Jest config must use createJestConfig({ rootDir, database: true }) from @tms/config/jest',
      );
    } finally {
      process.env['TEST_DB_URL_TEMPLATE'] = saved;
    }
  });
});

describe('startPostgres', () => {
  it('names Docker when no container runtime is reachable', async () => {
    const cause = new Error('Could not find a working container runtime strategy');
    const failure: unknown = await startPostgres({ start: () => Promise.reject(cause) }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      'Testcontainers could not reach Docker: Could not find a working container runtime strategy. Is the Docker daemon running?',
    );
    expect((failure as Error).cause).toBe(cause);
  });
});
```

`packages/db/test/harness-second-worker.spec.ts`:

```ts
import { resetTestDatabase, testDatabaseUrl } from '../src/testing';
import {
  currentWorkerId,
  otherWorkerUrls,
  queryRows,
  tableExists,
} from './support/worker-databases';

// A second spec file so that `--maxWorkers=2` can place the two files on different workers.
// Jest may still run both in one worker (in-band heuristic on warm runs), so nothing here
// assumes which worker this file lands on.
const PROBE_TABLE = 'harness_probe_two';

describe('@tms/db/testing harness (second file)', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterEach(async () => {
    await queryRows(testDatabaseUrl(), `DROP TABLE IF EXISTS ${PROBE_TABLE}`);
  });

  it('connects each Jest worker to its own clone', async () => {
    const [row] = await queryRows<{ db: string }>(
      testDatabaseUrl(),
      'SELECT current_database() AS db',
    );
    expect(row?.db).toBe(`tms_w${currentWorkerId()}`);
  });

  it('keeps a table created in this worker database invisible to every other clone', async () => {
    const own = testDatabaseUrl();
    await queryRows(own, `CREATE TABLE ${PROBE_TABLE} (id integer PRIMARY KEY)`);
    expect(await tableExists(own, PROBE_TABLE)).toBe(true);
    const others = await otherWorkerUrls();
    expect(others.length).toBeGreaterThanOrEqual(1);
    for (const url of others) {
      expect(await tableExists(url, PROBE_TABLE)).toBe(false);
    }
  });
});
```

The isolation check connects to the *other* clones explicitly instead of relying on file-to-worker placement: warm Jest runs put both files into worker 1 even with `--maxWorkers=2` (S3), and the check must hold either way. Scratch tables use distinct names per file and are dropped in `afterEach`, so the two files never interfere whether they share a worker database or not.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm turbo run test --filter=@tms/db --force`
Expected: FAIL before any test runs —
```
● Validation Error:

  Module <rootDir>/src/testing/global-setup.ts in the globalSetup option was not found.
         <rootDir> is: …/packages/db
```
and turbo reports `@tms/db#test` exited (1). (The preset already points `@tms/db` at its own sources.)

- [ ] **Step 4: Write the harness**

`packages/db/src/testing/constants.ts`:

```ts
/** Same image as the compose `postgres` service (a test keeps the two equal). */
export const POSTGRES_TEST_IMAGE = 'postgres:18-alpine';

export const TEMPLATE_DB = 'tms_template';
export const WORKER_DB_PREFIX = 'tms_w';
/** Stands for the Jest worker id; `{n}` would not survive URL encoding (`URL` escapes braces). */
export const WORKER_PLACEHOLDER = '__N__';

/** Environment set by globalSetup and inherited by every Jest worker. */
export const HARNESS_ENV = {
  adminUrl: 'TEST_DB_ADMIN_URL',
  urlTemplate: 'TEST_DB_URL_TEMPLATE',
  workerCount: 'TEST_DB_WORKER_COUNT',
} as const;
```

`packages/db/src/testing/global-setup.ts`:

```ts
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import {
  HARNESS_ENV,
  POSTGRES_TEST_IMAGE,
  TEMPLATE_DB,
  WORKER_DB_PREFIX,
  WORKER_PLACEHOLDER,
} from './constants';

/** Anything with testcontainers' `start()`; tests inject a failing one. */
export interface PostgresStarter {
  start(): Promise<StartedPostgreSqlContainer>;
}

/** globalSetup and globalTeardown run in Jest's parent process but as separate module instances. */
export const harnessGlobals = globalThis as typeof globalThis & {
  __TMS_PG_CONTAINER__?: StartedPostgreSqlContainer;
};

// src/testing and dist/testing are both two levels below the package root, so the compiled
// harness finds prisma.config.ts, the migrations and the package's own prisma binary too.
const PKG_ROOT = path.resolve(__dirname, '..', '..');
const PRISMA_BIN = path.join(PKG_ROOT, 'node_modules', '.bin', 'prisma');
// pg waits forever for a server that accepts TCP but never answers; bound every connect.
const CONNECT_TIMEOUT_MS = 5_000;

function withDatabase(baseUrl: string, database: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

function log(message: string, since: number): void {
  console.log(`[db-harness] ${message} in ${(performance.now() - since).toFixed(0)} ms`);
}

/**
 * Starts the Postgres container. testcontainers reports a missing daemon as "Could not find a
 * working container runtime strategy"; the rethrown error says Docker instead.
 */
export async function startPostgres(
  starter: PostgresStarter = new PostgreSqlContainer(POSTGRES_TEST_IMAGE)
    .withUsername('tms')
    .withPassword('tms')
    .withDatabase('postgres'),
): Promise<StartedPostgreSqlContainer> {
  try {
    return await starter.start();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Testcontainers could not reach Docker: ${message}. Is the Docker daemon running?`,
      { cause: error },
    );
  }
}

/**
 * Jest globalSetup: one container per run, `tms_template` migrated once with the package's
 * migrations, then one clone per Jest worker (at least two, so isolation is always testable).
 * Jest passes its GlobalConfig; only `maxWorkers` is read, so the type stays local.
 */
export default async function globalSetup(globalConfig: { maxWorkers: number }): Promise<void> {
  const startedAt = performance.now();
  const container = await startPostgres();
  harnessGlobals.__TMS_PG_CONTAINER__ = container;
  const adminUrl = container.getConnectionUri();
  log(`container ${POSTGRES_TEST_IMAGE} up`, startedAt);

  const admin = new Client({
    connectionString: adminUrl,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${TEMPLATE_DB}`);
    const migrateStartedAt = performance.now();
    execFileSync(PRISMA_BIN, ['migrate', 'deploy'], {
      cwd: PKG_ROOT,
      env: { ...process.env, DATABASE_URL: withDatabase(adminUrl, TEMPLATE_DB) },
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    log(`template ${TEMPLATE_DB} migrated`, migrateStartedAt);

    // CREATE DATABASE ... TEMPLATE fails while any session is still connected to the template.
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [TEMPLATE_DB],
    );
    const cloneStartedAt = performance.now();
    const workers = Math.max(2, globalConfig.maxWorkers);
    for (let n = 1; n <= workers; n += 1) {
      await admin.query(`CREATE DATABASE ${WORKER_DB_PREFIX}${n} TEMPLATE ${TEMPLATE_DB}`);
    }
    log(`${workers} worker databases cloned`, cloneStartedAt);

    // Set before Jest spawns its workers, so every worker process inherits them.
    process.env[HARNESS_ENV.adminUrl] = adminUrl;
    process.env[HARNESS_ENV.urlTemplate] = withDatabase(
      adminUrl,
      `${WORKER_DB_PREFIX}${WORKER_PLACEHOLDER}`,
    );
    process.env[HARNESS_ENV.workerCount] = String(workers);
  } finally {
    await admin.end();
  }
  log('global setup done', startedAt);
}
```

`DATABASE_URL` is set only in the environment of the spawned `prisma` process; `prisma.config.ts` still imports `dotenv/config`, which never overrides a variable that is already set, so a local `packages/db/.env` cannot redirect the migration. A failing `migrate deploy` throws with Prisma's stderr in the message and Jest aborts the run; the container is then reaped by Ryuk.

`packages/db/src/testing/global-teardown.ts`:

```ts
import { harnessGlobals } from './global-setup';

/** Jest globalTeardown: stops the container; Ryuk removes it if this never runs. */
export default async function globalTeardown(): Promise<void> {
  const container = harnessGlobals.__TMS_PG_CONTAINER__;
  if (!container) return;
  const startedAt = performance.now();
  await container.stop();
  harnessGlobals.__TMS_PG_CONTAINER__ = undefined;
  console.log(`[db-harness] container stopped in ${(performance.now() - startedAt).toFixed(0)} ms`);
}
```

`packages/db/src/testing/index.ts` (the test-facing API; it imports `pg` only, never testcontainers):

```ts
import { Client } from 'pg';
import { HARNESS_ENV, WORKER_PLACEHOLDER } from './constants';

export { POSTGRES_TEST_IMAGE } from './constants';

const CONNECT_TIMEOUT_MS = 5_000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set: the Jest config must use createJestConfig({ rootDir, database: true }) from @tms/config/jest`,
    );
  }
  return value;
}

/** URL of the database owned by the current Jest worker, or by `workerId`. */
export function testDatabaseUrl(workerId: string = process.env['JEST_WORKER_ID'] ?? '1'): string {
  return requireEnv(HARNESS_ENV.urlTemplate).replace(WORKER_PLACEHOLDER, workerId);
}

async function withClient<T>(url: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: CONNECT_TIMEOUT_MS });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Runs `fn` against the container's maintenance database (CREATE/DROP DATABASE and the like). */
export function withAdminClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  return withClient(requireEnv(HARNESS_ENV.adminUrl), fn);
}

/** Empties every public table except `_prisma_migrations` and restarts their sequences. */
export async function resetTestDatabase(url: string = testDatabaseUrl()): Promise<void> {
  await withClient(url, async (client) => {
    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    if (rows.length === 0) return;
    const tables = rows.map((row) => `"public"."${row.tablename.replaceAll('"', '""')}"`);
    await client.query(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `mkdir -p .cache && pnpm turbo run test --filter=@tms/db --force -- --maxWorkers=2 > .cache/t04-green.log 2>&1; echo test=$?; grep -E '\[db-harness\]|Test Suites:|Tests:' .cache/t04-green.log; grep -c 'template tms_template migrated' .cache/t04-green.log`
Expected (timings from the spike; the first run also pulls `postgres:18-alpine` and `testcontainers/ryuk:0.14.0`):
```
test=0
@tms/db:test: [db-harness] container postgres:18-alpine up in ~2200 ms
@tms/db:test: [db-harness] template tms_template migrated in ~1000 ms
@tms/db:test: [db-harness] 2 worker databases cloned in ~80 ms
@tms/db:test: [db-harness] global setup done in ~3300 ms
@tms/db:test: Test Suites: 2 passed, 2 total
@tms/db:test: Tests:       12 passed, 12 total
@tms/db:test: [db-harness] container stopped in ~250 ms
1
```
The final `1` is the "template migrated once" check (Review Focus 6). Turbo forwards `--maxWorkers=2` to the `test` script of `@tms/db` only. Jest 30 prints no `PASS <file>` lines when stdout is not a TTY; the summary lines are the evidence.

Run: `pnpm turbo run test --filter=@tms/db --force -- --runInBand 2>&1 | grep -E 'cloned|Tests:'`
Expected: `2 worker databases cloned` and `Tests: 12 passed, 12 total` — the isolation tests keep a neighbour clone even in band.

- [ ] **Step 6: Lint, typecheck, build and the published entry points**

Run: `pnpm turbo run lint --filter=@tms/db && pnpm turbo run typecheck --filter=@tms/db && pnpm turbo run build --filter=@tms/db && find packages/db/dist -name '*.js' | sort`
Expected: exit 0; five files — `packages/db/dist/index.js`, `packages/db/dist/testing/constants.js`, `…/global-setup.js`, `…/global-teardown.js`, `…/index.js` (each with `.d.ts` and maps next to it).

Run (the package resolves itself through its `exports`, exactly as consumers will):
```bash
(cd packages/db && node -e "for (const s of ['@tms/db', '@tms/db/testing', '@tms/db/testing/jest-global-setup', '@tms/db/testing/jest-global-teardown']) console.log(s, '->', require.resolve(s).replace(process.cwd(), '.')); console.log(Object.keys(require('@tms/db/testing')).sort().join(' '))")
```
Expected:
```
@tms/db -> ./dist/index.js
@tms/db/testing -> ./dist/testing/index.js
@tms/db/testing/jest-global-setup -> ./dist/testing/global-setup.js
@tms/db/testing/jest-global-teardown -> ./dist/testing/global-teardown.js
POSTGRES_TEST_IMAGE resetTestDatabase testDatabaseUrl withAdminClient
```

Run: `pnpm turbo run db:validate --filter=@tms/db`
Expected: `The schema at prisma/schema.prisma is valid` (the check the old `test` script did; `prisma.config.ts` still loads with the package now CommonJS).

- [ ] **Step 7: Docker behaviour — pass-through, no daemon, clean-up**

Run (`TESTCONTAINERS_*` reaches the harness only through Task 02's `globalPassThroughEnv`; with Ryuk disabled no reaper container exists after the run):
```bash
sleep 12
TESTCONTAINERS_RYUK_DISABLED=true pnpm turbo run test --filter=@tms/db --force > .cache/t04-noryuk.log 2>&1; echo test=$?
docker ps -a --filter label=org.testcontainers=true --format '{{.Image}}' | sort | uniq -c
pnpm turbo run test --filter=@tms/db --force > .cache/t04-ryuk.log 2>&1; echo test=$?
docker ps -a --filter label=org.testcontainers=true --format '{{.Image}}' | sort | uniq -c
```
Expected: `test=0`, then no output (no labelled container at all), then `test=0`, then `1 testcontainers/ryuk:0.14.0` (Ryuk lingers for its 10 s grace period; the Postgres container is already gone).

Run (no Docker daemon reachable: `/run` is hidden in a private mount namespace, so `/var/run/docker.sock` and a rootless `$XDG_RUNTIME_DIR/docker.sock` disappear; Jest is called directly because turbo is not needed for this check):
```bash
(cd packages/db && time unshare -Urm sh -c 'mount -t tmpfs tmpfs /run && NODE_OPTIONS="--experimental-vm-modules --no-warnings=ExperimentalWarning" timeout 60 node_modules/.bin/jest'; echo exit=$?)
```
Expected within a few seconds (spike: 0.85 s for Jest, 2.89 s including pnpm): `Error: Jest: Got error running globalSetup - …/packages/db/src/testing/global-setup.ts, reason: Testcontainers could not reach Docker: Could not find a working container runtime strategy. Is the Docker daemon running?`, no test runs, non-zero `exit=`. Fallback: if `unshare` fails with `Operation not permitted` (unprivileged user namespaces disabled), record "not run: unshare unavailable" in the journal and the PR; the `startPostgres` unit test in `harness.spec.ts` still pins the message. A bogus `DOCKER_HOST` is **not** a substitute: testcontainers falls back to the default socket and the run passes (S3).

Run: `sleep 12; docker ps -a --filter label=org.testcontainers=true -q | wc -l; docker ps -a --format '{{.Names}}' | grep -c '^tms-p1-' || true`
Expected: `0` and `0` — nothing left behind.

- [ ] **Step 8: CI and the turbo cache key**

`turbo.json`: add after the `"test"` entry (the harness test reads `infra/docker-compose.yml`, which lies outside the package's default inputs; without this a compose image bump could hit a stale cache):

```json
    "@tms/db#test": {
      "dependsOn": ["^build", "generate", "build"],
      "outputs": [],
      "inputs": ["$TURBO_DEFAULT$", "$TURBO_ROOT$/infra/docker-compose.yml"]
    },
```

`.github/workflows/ci.yml`, job `verify`: change `timeout-minutes: 20` to

```yaml
    timeout-minutes: 25
```

(the runner has Docker; the harness adds ≈ 3.5 s per Jest project plus two image pulls, and Jest runs with two workers there because the preset sees `CI`.)

`.github/workflows/ci.yml`, job `db-drift`: change the service `image: postgres:16-alpine` to `image: postgres:18-alpine` (compose moved to 18 in `main` 0d5f4ac, the harness follows, and the comment above the service asks to keep them in sync), and insert before the step `- name: Apply migrations`:

```yaml
      - name: Schema is valid
        run: pnpm --filter @tms/db db:validate
```

(`prisma validate` left the `test` script; the job already installs `@tms/db...` and has `DATABASE_URL`. CI may use `pnpm --filter`; the allowlist restriction applies to Claude sessions.)

Run: `pnpm exec prettier --write turbo.json .github/workflows/ci.yml packages/db && pnpm turbo run test --filter=@tms/db --dry=json | grep -c 'infra/docker-compose.yml'`
Expected: Prettier leaves the files as shown; the count is at least `1` (the compose file is part of the task's inputs).

- [ ] **Step 9: Documentation**

`README.md`: replace line 12 (`- Docker with Compose v2 (used for …)`) with

```md
- Docker with Compose v2 and the daemon running (`docker info` succeeds): Postgres, Mailpit,
  migrations and the production-like stack, and the Testcontainers Postgres that database tests
  start in `pnpm verify`, the pre-push hook and CI `verify` (without it they stop with
  "Testcontainers could not reach Docker")
```

`CLAUDE.md`: insert after line 49 (the TDD bullet ending `real output in the PR.`; Task 03's insertion after line 53 does not move it):

```md
- Database tests use `@tms/db/testing` (Testcontainers; Docker required); never point tests at
  the dev database.
```

`docs/architecture.md`: append to the section `## Testing strategy` (after its last line, the end of the file):

```md

Database tests (phase 1): a Jest project that uses `createJestConfig({ rootDir, database: true })`
(`@tms/config/jest`) runs the Testcontainers harness from `@tms/db/testing`
(`packages/db/src/testing`). Its `globalSetup` starts one `postgres:18-alpine` container per run
(the compose image, kept equal by a test), creates `tms_template`, applies the migrations once with
the package's own `prisma migrate deploy`, and clones `tms_w1` … `tms_wN` from it with
`CREATE DATABASE … TEMPLATE` (N = max(2, Jest workers); two workers in CI). A test gets its
database from `testDatabaseUrl()` (derived from `JEST_WORKER_ID` at run time, because Jest may run
several files in one worker) and calls `resetTestDatabase()` in `beforeEach` (`TRUNCATE … RESTART
IDENTITY CASCADE`, `_prisma_migrations` kept). `globalTeardown` stops the container; Ryuk removes
whatever a killed run leaves behind. Tests never read `DATABASE_URL`, so they cannot reach the
development database. The fixed cost is about 3.5 s per Jest project (container 2.2 s, migrations
1 s, 40 ms per clone). Docker is therefore required for `pnpm verify`, the pre-push hook and CI.
```

Run: `pnpm exec prettier --write README.md CLAUDE.md docs/architecture.md packages/db/README.md && pnpm format:check && wc -l CLAUDE.md`
Expected: `All matched files use Prettier code style!`; `76 CLAUDE.md` (72 + Task 03's two lines + these two; limit 150).

- [ ] **Step 10: Whole-repository verification**

Run: `pnpm verify > .cache/verify-04.log 2>&1; echo verify=$?; grep -E '@tms/db:test: Tests:|hygiene: ok' .cache/verify-04.log; grep -c 'no output files found' .cache/verify-04.log`
Expected: `verify=0`; `@tms/db:test: Tests:       12 passed, 12 total`; `hygiene: ok (<N> tracked files, single copies ok)`; `0`. `@tms/config` stays at 113 tests (its Jest-preset test uses a temporary workspace, not the real harness).

Run: `sleep 12; docker ps -a --filter label=org.testcontainers=true -q | wc -l`
Expected: `0`.

- [ ] **Step 11: Commit**

Append to `docs/efficiency/critical-path.md`:
`| 2026-MM-DD | Task 04: Testcontainers harness (@tms/db/testing) | subagent | HH:MM | HH:MM | <rework or none> | n/a | <RED globalSetup not found → GREEN 12 passed with --maxWorkers=2, template migrated once, 2 clones in band; setup ~3.3 s; no-Docker run via unshare: message + seconds, or "not run"; Ryuk-disabled pass-through shown; allowBuilds ssh2/cpu-features/protobufjs=false; CI verify duration after push> |`

```bash
git add packages/db pnpm-workspace.yaml pnpm-lock.yaml turbo.json .github/workflows/ci.yml README.md CLAUDE.md docs/architecture.md docs/efficiency/critical-path.md
git commit -m "test(db): add the Testcontainers Postgres harness with one database per Jest worker"
```
Expected: this commit passes all hooks (header 83 characters); `git show --stat HEAD` lists no `dist/` file. After the push, CI `verify` is green well inside 25 minutes and its `@tms/db:test` log shows the four `[db-harness]` lines and `Tests: 12 passed, 12 total`; `db-drift` shows the new "Schema is valid" step green.

**PR body notes:**
- Diagram: Mermaid `sequenceDiagram` — participants Jest (parent), globalSetup, Docker/Testcontainers, Postgres, prisma CLI, Jest worker n, globalTeardown, Ryuk: `startPostgres()` → container up (or "could not reach Docker"); `CREATE DATABASE tms_template`; `prisma migrate deploy` with `DATABASE_URL=…/tms_template`; `CREATE DATABASE tms_w1…tms_wN TEMPLATE tms_template`; env `TEST_DB_*` set; workers spawn; worker n: `testDatabaseUrl()` → `tms_wn`, `resetTestDatabase()` per test; `globalTeardown` → `container.stop()`; Ryuk reaps after a crash.
- Boundaries: `@tms/db` becomes `"type": "commonjs"` with `exports` `.`, `./testing`, `./testing/jest-global-setup`, `./testing/jest-global-teardown` and `files`; new public API `POSTGRES_TEST_IMAGE`, `testDatabaseUrl(workerId?)`, `resetTestDatabase(url?)`, `withAdminClient(fn)`; `test` script is Jest (validate moved to `db:validate`); catalog `testcontainers`/`@testcontainers/postgresql` 12.1.0, `pg`, `@types/pg`; `allowBuilds` +3 (all `false`); CI `verify` timeout 25, `db-drift` validate step; README prerequisite. Migration: no.
- Verification plan: `pnpm verify`; `@tms/db` tests RED (globalSetup missing) then GREEN with `--maxWorkers=2` and `--runInBand`; the Ryuk-disabled pass-through run; the no-Docker run under `unshare`; leftover-container check; exports self-resolution; CI `verify` and `db-drift`.
- Verification results (`scenario | layer | outcome`): `harness.spec.ts: own clone, ≥ 2 clones from one template, _prisma_migrations inherited, cross-clone isolation, reset semantics, empty-db no-op, compose image pin, turbo passes the Docker variables and never `DATABASE_URL` to tests, missing-env message, startPostgres names Docker (injected failure) | db (Testcontainers) + unit | 10 passed`; `harness-second-worker.spec.ts: own clone, isolation | db | 2 passed`; `template migrated once | db | 1 log line`; `--runInBand | db | 2 clones, 12 passed`; `TESTCONTAINERS_RYUK_DISABLED through turbo | env | no ryuk container`; `no Docker (unshare, hidden /run) | env | failed in <s> s naming Docker` (or "not run: unshare unavailable"); `leftover containers after 12 s | env | 0`; `exports self-resolution + dist | static | 4 paths, 4 names`; `pnpm verify | repo | green`; `CI verify | CI | green, <duration>`.
- Risks and notes: Docker is now a hard local prerequisite for `pnpm verify` and the pre-push hook (README, CLAUDE.md); ≈ 3.5 s fixed cost per Jest project that sets `database: true` (apps join in Task 12); Jest may run both files in one worker — tests never assume placement; the harness clones at least two databases even in band; it runs the Prisma CLI through the package's `node_modules/.bin` shim (works from `src` and `dist`); `pg` and `@types/pg` enter the catalog here, Task 05 moves `pg` to `dependencies`; departures from spike S3 are listed in this task's Spike notes.

---

### Task 05: Schema — identity, access and audit

**Branch:** `phase-1/05-schema-identity`
**PR title:** `feat(db): add the identity, access and audit schema with its first migration`

**Files:**
- Create: `packages/db/src/index.ts` (replaces the Task 04 entry file), `packages/db/prisma/migrations/<timestamp>_identity_access_audit/migration.sql` (generated by `prisma migrate dev`, never hand-written), `packages/db/src/testing/fixtures.ts`, `packages/db/test/support/prisma-errors.ts` (both in Step 1)
- Modify: `packages/db/prisma/schema.prisma` (generator block + all enums and models), `packages/db/package.json` (scripts `generate`/`build`, dependencies; `pg` moves from `devDependencies` to `dependencies`), `packages/db/src/testing/index.ts` (one re-export line, Step 1), `pnpm-workspace.yaml` (catalog group `# data`: Prisma trio pinned exactly, Task 04's `pg`/`@types/pg` lines kept), `pnpm-lock.yaml`, `packages/db/README.md` (4 lines appended to Task 04's file), `docs/architecture.md:75` (section "Data model — phase 1"; line 58 on `main`, moved by Tasks 02 and 03), `docs/efficiency/critical-path.md`
- Test: `packages/db/test/enums-parity.spec.ts`, `packages/db/test/schema-identity.spec.ts`

**Interfaces:**
- Consumes: `DB_MIRRORED_ENUMS` from `@tms/contracts` (Task 03); `testDatabaseUrl()`, `resetTestDatabase()` from `@tms/db/testing` (Task 04, imported as `../src/testing` inside the package); turbo task `generate` and preset `@tms/config/tsconfig/nest-library.json` (Task 02); Jest preset option `database: true` (Task 04's `jest.config.mjs`, unchanged).
- Produces: `createPrismaClient(options: CreatePrismaClientOptions): PrismaClient` and `export * from './generated/prisma/client'` (`PrismaClient` class and type, `Prisma` namespace, `$Enums`, every enum const/type such as `UserKind`, every model type such as `User`, `Role`, `AuditLog`); migration 1 (6 enum types, 8 tables); `@tms/db/testing` gains the row builders `uniqueSuffix`, `makeRole`, `makeStaffUser`, `makeDriverUser`, `makePermission` (phase 3 request P1-5: tests of other packages build rows without reaching into `packages/db/test`); test helpers listed above. `src/generated/` stays gitignored (`**/generated/` in `.gitignore`); a clean checkout works because `lint`, `typecheck`, `test` and `build` depend on the turbo `generate` task.

Decisions stated once: table names keep Prisma's defaults (PascalCase tables, camelCase columns, no `@@map`) — the schema is the only place names live and every raw query in this repository quotes identifiers. Every FK towards `User` is `onDelete: Restrict` (D9), including `Session.userId`: sessions are revoked by deleting session rows, users are never deleted, so RESTRICT costs nothing and cannot hide a stray user delete. Only `RolePermission.roleId` cascades (deleting a role removes its grants); `RolePermission.permissionCode` is RESTRICT (section 7). Bookkeeping timestamps (`createdAt`, `updatedAt`, `AuditLog.at`) default in the database; business timestamps (`expiresAt`, `lastSeenAt`, `syncedAt`) have no default and are set by the owning service through the `Clock` port.

Spike notes (Prisma 7.10.0 in a scratch project): the `prisma-client` generator with `moduleFormat = "cjs"` emits only `.ts` files (no `.wasm`, no `.js`), so `tsc -p tsconfig.build.json` alone produces a complete `dist/generated/prisma`; generated files start with `// @ts-nocheck` and `/* eslint-disable */`, and the shared ESLint base already ignores `**/generated/**`. `importFileExtension = ""` (accepted by 7.10.0) makes the generated imports extensionless, the house rule for CommonJS libraries; typecheck, the `tsc` build, Node from `dist/` and a ts-jest suite were green with it (with the default `"js"`, Jest would depend on Task 02's `.js` mapper). Prisma 7 `migrate dev` does not run `generate` (deviation 6); the `build` script and the turbo `generate` task cover it. `@prisma/client` 7.10.0 has no install script, so `allowBuilds` needs no entry; `@prisma/adapter-pg` depends on `pg` itself. Prisma 7 driver-adapter errors have no `meta.target`: the violated constraint is at `meta.driverAdapterError.cause.constraint.index` (hence `expectKnownRequestError`). From Task 04 this task relies on: `packages/db/src/index.ts` as the `.` entry (replaced here), the harness at `src/testing/index.ts` (imported as `../src/testing` inside the package), `tsconfig.json` with `types: ["node", "jest"]` and `include: ["src", "test", "prisma.config.ts"]`, a synchronous `testDatabaseUrl()`; from Task 02: CommonJS Jest suites load the ESM `@tms/contracts` dist through `require(esm)` (`test` depends on `^build`).

- [ ] **Step 1: Write the failing tests and their support files**

`packages/db/src/testing/fixtures.ts` (published through `@tms/db/testing`, so app and domain tests can build rows without reaching into `packages/db/test`; the Prisma imports are type-only and the client is passed in, so the subpath still loads nothing but `pg` at runtime and nothing that `pnpm deploy --prod` drops; Task 06 appends the operations helpers in its Step 2; Tasks 07 and 14 reuse it):

```ts
import type { $Enums, Permission, PrismaClient, Role, User } from '../index';

let counter = 0;

/** Zero-padded counter: names created inside one test never collide (the database is reset per test). */
export function uniqueSuffix(): string {
  counter += 1;
  return String(counter).padStart(4, '0');
}

export interface RoleOverrides {
  key?: string | null;
  name?: string;
  description?: string;
  isSystem?: boolean;
  appliesTo?: $Enums.UserKind;
}

export function makeRole(prisma: PrismaClient, overrides: RoleOverrides = {}): Promise<Role> {
  const suffix = uniqueSuffix();
  return prisma.role.create({
    data: {
      key: overrides.key ?? null,
      name: overrides.name ?? `Role ${suffix}`,
      description: overrides.description ?? `Test role ${suffix}`,
      isSystem: overrides.isSystem ?? false,
      appliesTo: overrides.appliesTo ?? 'STAFF',
    },
  });
}

export interface UserOverrides {
  roleId?: string;
  username?: string;
  /** `null` stores no email; `undefined` generates a unique one for staff. */
  email?: string | null;
  status?: $Enums.UserStatus;
  createdById?: string;
}

/** STAFF user with a unique email (D1: staff log in with email) and a fresh STAFF role unless given. */
export async function makeStaffUser(prisma: PrismaClient, overrides: UserOverrides = {}): Promise<User> {
  const suffix = uniqueSuffix();
  const roleId = overrides.roleId ?? (await makeRole(prisma, { appliesTo: 'STAFF' })).id;
  return prisma.user.create({
    data: {
      kind: 'STAFF',
      username: overrides.username ?? `staff-${suffix}`,
      firstName: 'Test',
      lastName: `Staff ${suffix}`,
      email: overrides.email === undefined ? `staff-${suffix}@example.test` : overrides.email,
      roleId,
      ...(overrides.status ? { status: overrides.status } : {}),
      ...(overrides.createdById ? { createdById: overrides.createdById } : {}),
    },
  });
}

/** DRIVER user without an email unless given (section 7: email optional for drivers). */
export async function makeDriverUser(prisma: PrismaClient, overrides: UserOverrides = {}): Promise<User> {
  const suffix = uniqueSuffix();
  const roleId = overrides.roleId ?? (await makeRole(prisma, { appliesTo: 'DRIVER' })).id;
  return prisma.user.create({
    data: {
      kind: 'DRIVER',
      username: overrides.username ?? `driver-${suffix}`,
      firstName: 'Test',
      lastName: `Driver ${suffix}`,
      email: overrides.email ?? null,
      roleId,
      ...(overrides.status ? { status: overrides.status } : {}),
      ...(overrides.createdById ? { createdById: overrides.createdById } : {}),
    },
  });
}

export interface PermissionOverrides {
  code?: string;
  group?: string;
  name?: string;
  description?: string;
  isDeprecated?: boolean;
  syncedAt?: Date;
}

export function makePermission(
  prisma: PrismaClient,
  overrides: PermissionOverrides = {},
): Promise<Permission> {
  const suffix = uniqueSuffix();
  const group = overrides.group ?? 'test';
  return prisma.permission.create({
    data: {
      code: overrides.code ?? `${group}:action-${suffix}`,
      group,
      name: overrides.name ?? `Test permission ${suffix}`,
      description: overrides.description ?? `Test permission ${suffix}`,
      isDeprecated: overrides.isDeprecated ?? false,
      syncedAt: overrides.syncedAt ?? new Date(),
    },
  });
}
```

Append to `packages/db/src/testing/index.ts` (Task 04's file):

```ts
export * from './fixtures';
```

`packages/db/test/support/prisma-errors.ts` (shared by every later database test):

```ts
import { Prisma } from '../../src';

export interface ExpectedKnownRequestError {
  /** P2002 = unique constraint violated, P2003 = foreign key constraint violated. */
  code: 'P2002' | 'P2003';
  /** Constraint name as Postgres reports it, e.g. `User_email_key`, `RolePermission_permissionCode_fkey`. */
  constraint: string;
}

/**
 * Awaits a Prisma operation that must be rejected and asserts its code and the violated constraint.
 * Prisma 7 driver-adapter errors carry the constraint at `meta.driverAdapterError.cause.constraint.index`;
 * the classic `meta.target` field no longer exists.
 */
export async function expectKnownRequestError(
  operation: Promise<unknown>,
  expected: ExpectedKnownRequestError,
): Promise<Prisma.PrismaClientKnownRequestError> {
  let caught: unknown;
  try {
    await operation;
  } catch (error) {
    caught = error;
  }
  if (caught === undefined) {
    throw new Error(`expected ${expected.code} on ${expected.constraint}, but the operation succeeded`);
  }
  expect(caught).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  const known = caught as Prisma.PrismaClientKnownRequestError;
  expect(known.code).toBe(expected.code);
  expect(known.meta).toMatchObject({
    driverAdapterError: { cause: { constraint: { index: expected.constraint } } },
  });
  return known;
}
```

`packages/db/test/enums-parity.spec.ts`:

```ts
import { DB_MIRRORED_ENUMS } from '@tms/contracts';
import { $Enums } from '../src';

/** Contract enums whose Prisma counterpart arrives with Task 06 (drivers, master data, operations). */
const NOT_YET_IN_SCHEMA: readonly string[] = [
  'CheckInVia',
  'DriverType',
  'IdentityCardStatus',
  'LoadingOrderStatus',
  'LoadingPointKind',
  'QueueEntryStatus',
  'TransportKind',
  'VehicleKind',
];

const mirrored: Record<string, { options: readonly (string | number)[] }> = { ...DB_MIRRORED_ENUMS };
const generated: Record<string, Record<string, string>> = { ...$Enums };

const expectedNames = Object.keys(mirrored)
  .filter((name) => !NOT_YET_IN_SCHEMA.includes(name))
  .sort();

describe('enum parity between @tms/contracts and schema.prisma', () => {
  it('generates exactly the mirrored enums that exist in the schema so far', () => {
    expect(expectedNames).toHaveLength(6);
    expect(Object.keys(generated).sort()).toEqual(expectedNames);
  });

  it.each(expectedNames)('%s has the same members in both places', (name) => {
    const schema = mirrored[name];
    if (schema === undefined) {
      throw new Error(`${name} is not in DB_MIRRORED_ENUMS`);
    }
    expect(Object.values(generated[name] ?? {}).sort()).toEqual([...schema.options].sort());
  });
});
```

`packages/db/test/schema-identity.spec.ts`:

```ts
import { createPrismaClient, type PrismaClient } from '../src';
import {
  makeDriverUser,
  makePermission,
  makeRole,
  makeStaffUser,
  resetTestDatabase,
  testDatabaseUrl,
} from '../src/testing';
import { expectKnownRequestError } from './support/prisma-errors';

describe('identity, access and audit schema', () => {
  let prisma: PrismaClient;

  beforeEach(async () => {
    await resetTestDatabase();
    prisma = createPrismaClient({ url: testDatabaseUrl() });
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  it('rejects deleting a Permission that a RolePermission references (RESTRICT, P2003)', async () => {
    const role = await makeRole(prisma);
    const permission = await makePermission(prisma, { code: 'users:read', group: 'users' });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionCode: permission.code } });

    await expectKnownRequestError(prisma.permission.delete({ where: { code: permission.code } }), {
      code: 'P2003',
      constraint: 'RolePermission_permissionCode_fkey',
    });
    expect(await prisma.permission.count()).toBe(1);
  });

  it('cascades RolePermission rows when their Role is deleted', async () => {
    const role = await makeRole(prisma);
    const first = await makePermission(prisma);
    const second = await makePermission(prisma);
    await prisma.rolePermission.createMany({
      data: [
        { roleId: role.id, permissionCode: first.code },
        { roleId: role.id, permissionCode: second.code },
      ],
    });

    await prisma.role.delete({ where: { id: role.id } });

    expect(await prisma.rolePermission.count()).toBe(0);
    expect(await prisma.permission.count()).toBe(2);
  });

  it('rejects a second user with the same email (P2002 on User_email_key)', async () => {
    const role = await makeRole(prisma);
    await makeStaffUser(prisma, { roleId: role.id, email: 'same@example.test' });

    const error = await expectKnownRequestError(
      makeStaffUser(prisma, { roleId: role.id, email: 'same@example.test' }),
      { code: 'P2002', constraint: 'User_email_key' },
    );
    expect(error.meta).toMatchObject({ modelName: 'User' });
    expect(await prisma.user.count()).toBe(1);
  });

  it('lets several DRIVER users exist without an email (nullable unique)', async () => {
    const role = await makeRole(prisma, { appliesTo: 'DRIVER' });
    await makeDriverUser(prisma, { roleId: role.id });
    await makeDriverUser(prisma, { roleId: role.id });

    expect(await prisma.user.count({ where: { email: null } })).toBe(2);
  });

  it('links a user to its creator through createdById (self-relation) and defaults status to INVITED', async () => {
    const admin = await makeStaffUser(prisma);
    const invited = await makeStaffUser(prisma, { roleId: admin.roleId, createdById: admin.id });

    const loaded = await prisma.user.findUniqueOrThrow({
      where: { id: invited.id },
      include: { createdBy: true },
    });
    expect(loaded.createdBy?.id).toBe(admin.id);
    expect(loaded.status).toBe('INVITED');
    expect(admin.createdById).toBeNull();

    const creator = await prisma.user.findUniqueOrThrow({
      where: { id: admin.id },
      include: { createdUsers: true },
    });
    expect(creator.createdUsers.map((user) => user.id)).toEqual([invited.id]);
  });

  it('keeps a user that an AuditLog row names as actor (D9: RESTRICT towards User, P2003)', async () => {
    const actor = await makeStaffUser(prisma);
    await prisma.auditLog.create({
      data: { app: 'ADMIN', actorUserId: actor.id, action: 'test.action', outcome: 'SUCCESS', metadata: {} },
    });

    await expectKnownRequestError(prisma.user.delete({ where: { id: actor.id } }), {
      code: 'P2003',
      constraint: 'AuditLog_actorUserId_fkey',
    });
    expect(await prisma.user.count()).toBe(1);
  });

  it('indexes AuditLog on at, actorUserId, action and (targetType, targetId)', async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'AuditLog'
      ORDER BY indexname`;

    expect(rows.map((row) => row.indexname)).toEqual([
      'AuditLog_action_idx',
      'AuditLog_actorUserId_idx',
      'AuditLog_at_idx',
      'AuditLog_pkey',
      'AuditLog_targetType_targetId_idx',
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm turbo run test --filter=@tms/db`
Expected: FAIL — `test/enums-parity.spec.ts` and `test/schema-identity.spec.ts` fail at runtime (ts-jest transpiles without type-checking because `base.json` sets `isolatedModules: true`: `$Enums` is `undefined`, so the name-set case fails, and `createPrismaClient is not a function` in `beforeEach`; `pnpm turbo run typecheck --filter=@tms/db` shows the TS2305 errors); Task 04's harness suites still pass. (No `generate` script exists yet, so turbo skips that dependency for this package.)

- [ ] **Step 3: Write the schema**

`packages/db/prisma/schema.prisma` (full content; already in `prisma format` layout):

```prisma
generator client {
  provider            = "prisma-client"
  output              = "../src/generated/prisma"
  moduleFormat        = "cjs"
  importFileExtension = ""
}

datasource db {
  provider = "postgresql"
}

// Enums mirror DB_MIRRORED_ENUMS in @tms/contracts; test/enums-parity.spec.ts asserts set equality.

enum UserKind {
  STAFF
  DRIVER
}

enum UserStatus {
  INVITED
  ACTIVE
  BLOCKED
  DEACTIVATED
}

enum SessionScope {
  PRE_MFA
  ENROLLMENT
  FULL
}

enum ActionTokenType {
  INVITE
  PASSWORD_RESET
  MFA_RESET
}

enum AuditApp {
  ADMIN
  DRIVER
  SYSTEM
}

enum AuditOutcome {
  SUCCESS
  FAILURE
}

model User {
  id               String     @id @default(uuid(7)) @db.Uuid
  kind             UserKind
  username         String     @unique
  firstName        String
  lastName         String
  dateOfBirth      DateTime?  @db.Date
  phone            String?
  email            String?    @unique
  status           UserStatus @default(INVITED)
  passwordHash     String?
  totpSecretEnc    String?
  totpKeyId        String?
  totpEnabledAt    DateTime?  @db.Timestamptz(3)
  totpLastUsedStep Int?
  roleId           String     @db.Uuid
  role             Role       @relation(fields: [roleId], references: [id], onDelete: Restrict)
  locale           String     @default("en")
  lastLoginAt      DateTime?  @db.Timestamptz(3)
  failedLoginCount Int        @default(0)
  lockedUntil      DateTime?  @db.Timestamptz(3)
  createdById      String?    @db.Uuid
  createdBy        User?      @relation("UserCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)
  createdAt        DateTime   @default(now()) @db.Timestamptz(3)
  updatedAt        DateTime   @updatedAt @db.Timestamptz(3)

  createdUsers       User[]         @relation("UserCreatedBy")
  sessions           Session[]
  actionTokens       ActionToken[]  @relation("ActionTokenUser")
  issuedActionTokens ActionToken[]  @relation("ActionTokenCreatedBy")
  recoveryCodes      RecoveryCode[]
  auditEntries       AuditLog[]
}

model Role {
  id          String   @id @default(uuid(7)) @db.Uuid
  key         String?  @unique
  name        String   @unique
  description String
  isSystem    Boolean  @default(false)
  appliesTo   UserKind
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @db.Timestamptz(3)

  users       User[]
  permissions RolePermission[]
}

model Permission {
  code         String   @id
  group        String
  name         String
  description  String
  isDeprecated Boolean  @default(false)
  syncedAt     DateTime @db.Timestamptz(3)
  createdAt    DateTime @default(now()) @db.Timestamptz(3)
  updatedAt    DateTime @updatedAt @db.Timestamptz(3)

  roles RolePermission[]
}

model RolePermission {
  roleId         String     @db.Uuid
  permissionCode String
  role           Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission     Permission @relation(fields: [permissionCode], references: [code], onDelete: Restrict)

  @@id([roleId, permissionCode])
}

model Session {
  id                   String       @id @default(uuid(7)) @db.Uuid
  userId               String       @db.Uuid
  user                 User         @relation(fields: [userId], references: [id], onDelete: Restrict)
  tokenHash            String       @unique
  scope                SessionScope
  mfaVerifiedAt        DateTime?    @db.Timestamptz(3)
  totpPendingSecretEnc String?
  mfaAttempts          Int          @default(0)
  expiresAt            DateTime     @db.Timestamptz(3)
  lastSeenAt           DateTime     @db.Timestamptz(3)
  ip                   String?
  userAgent            String?
  createdAt            DateTime     @default(now()) @db.Timestamptz(3)

  @@index([userId])
}

model ActionToken {
  id          String          @id @default(uuid(7)) @db.Uuid
  userId      String          @db.Uuid
  user        User            @relation("ActionTokenUser", fields: [userId], references: [id], onDelete: Restrict)
  type        ActionTokenType
  tokenHash   String          @unique
  expiresAt   DateTime        @db.Timestamptz(3)
  usedAt      DateTime?       @db.Timestamptz(3)
  createdById String?         @db.Uuid
  createdBy   User?           @relation("ActionTokenCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)
  createdAt   DateTime        @default(now()) @db.Timestamptz(3)

  @@index([userId])
}

model RecoveryCode {
  id        String    @id @default(uuid(7)) @db.Uuid
  userId    String    @db.Uuid
  user      User      @relation(fields: [userId], references: [id], onDelete: Restrict)
  codeHash  String
  usedAt    DateTime? @db.Timestamptz(3)
  createdAt DateTime  @default(now()) @db.Timestamptz(3)

  @@index([userId])
}

model AuditLog {
  id          String       @id @default(uuid(7)) @db.Uuid
  at          DateTime     @default(now()) @db.Timestamptz(3)
  app         AuditApp
  actorUserId String?      @db.Uuid
  actor       User?        @relation(fields: [actorUserId], references: [id], onDelete: Restrict)
  action      String
  targetType  String?
  targetId    String?
  outcome     AuditOutcome
  ip          String?
  userAgent   String?
  metadata    Json

  @@index([at])
  @@index([actorUserId])
  @@index([action])
  @@index([targetType, targetId])
}
```

Run: `pnpm turbo run db:validate --filter=@tms/db && (cd packages/db && pnpm exec prisma format --check)`
Expected: `The schema at prisma/schema.prisma is valid` and `All files are formatted correctly!` (no database needed).

- [ ] **Step 4: Pin the Prisma trio in the catalog and extend the package manifest**

`pnpm-workspace.yaml`, replace the four `# data` catalog lines Task 04 left (`# data`, `prisma: ^7.10.0`, `pg`, `@types/pg`) with (exact pins: the CLI, the client and the adapter must be the same version; `latest` is an 8 rc):

```yaml
  # data (prisma, @prisma/client and @prisma/adapter-pg must share one exact version)
  prisma: 7.10.0
  '@prisma/client': 7.10.0
  '@prisma/adapter-pg': 7.10.0
  pg: ^8.23.0
  '@types/pg': ^8.23.1
```

(The `pg` and `@types/pg` lines are Task 04's, unchanged; Task 04's `# testing` group stays where it is.) `@prisma/client` 7.10.0 has no install script, so `allowBuilds` is unchanged.

`packages/db/package.json` — keep every field Task 04 set (`"type": "commonjs"`, `main`/`types`, the four `exports` entries, `files`, the five `db:*` scripts including phase 0's `db:drift` = `prisma migrate status && prisma migrate diff … --exit-code`, `lint`, `typecheck`, `test`, Task 04's devDependencies) and make these changes:

```jsonc
// scripts: add `generate`; `build` stays Task 04's `tsc -p tsconfig.build.json`: turbo runs `generate`
// first, and a second `prisma generate` inside `build` would rewrite src/generated while the parallel
// lint/typecheck/test read it; the Dockerfiles run `generate` explicitly before `build`.
"generate": "prisma generate",

// dependencies: add (alphabetical order)
"@prisma/adapter-pg": "catalog:",
"@prisma/client": "catalog:",
"@tms/contracts": "workspace:*",
"pg": "catalog:",

// devDependencies: remove "pg" (Task 04 added it there; it is a runtime dependency now);
// "@types/pg" stays where Task 04 put it
```

`@tms/contracts` is a runtime dependency on purpose: the parity test needs it now and Task 07's sync imports `PERMISSIONS` at runtime; the dependency rule allows `db → contracts`. `pg` moves to `dependencies`: it is the driver under `@prisma/adapter-pg` at runtime (the images deploy with `--prod`, which drops devDependencies), and one catalog version keeps the adapter and the harness on the same `pg`.

Append to `packages/db/README.md`:

```md
The Prisma client is generated into `src/generated/prisma` (gitignored) by `pnpm turbo run generate --filter=@tms/db`;
`lint`, `typecheck`, `test` and `build` depend on that task, so a clean checkout needs no manual step.
Applications obtain a client only through `createPrismaClient({ url })` from `@tms/db`.
Row builders for tests (`makeRole`, `makeStaffUser`, …) come from `@tms/db/testing`; only tests import that subpath.
```

Run: `pnpm install`
Expected: the lockfile gains `@prisma/client@7.10.0` and `@prisma/adapter-pg@7.10.0` and pins `prisma` to `7.10.0`; `pg` and `@types/pg` are already locked (Task 04), only the `pg` entry of the `@tms/db` importer moves from `devDependencies` to `dependencies`; no "Ignored build scripts" line names a Prisma package. Commit any `minimumReleaseAgeExclude` lines pnpm adds.

- [ ] **Step 5: Generate the client and write the package entry**

Run: `pnpm turbo run generate --filter=@tms/db && git status --short packages/db/src`
Expected: `✔ Generated Prisma Client (7.10.0) to ./src/generated/prisma`; `git status` prints nothing for `src/generated` (ignored).

Run: `find packages/db/src/generated -type f ! -name '*.ts' | wc -l`
Expected: `0` — the CJS client is pure TypeScript, so `tsc` emits everything `dist/` needs.

`packages/db/src/index.ts` (replaces Task 04's entry file):

```ts
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

// PrismaClient (class and type), the Prisma namespace, $Enums, every enum and every model type.
export * from './generated/prisma/client';

export interface CreatePrismaClientOptions {
  /** postgresql:// URL: `DATABASE_URL` in the apps and the migrate image, `testDatabaseUrl()` in tests. */
  url: string;
  /** Bound on acquiring a connection so a black-holed database fails fast instead of hanging (health, Task 12). */
  connectTimeoutMs?: number;
}

/** The generated client over the pg driver adapter — the only way this package hands out a PrismaClient. */
export function createPrismaClient({
  url,
  connectTimeoutMs = 5000,
}: CreatePrismaClientOptions): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: connectTimeoutMs }),
  });
}
```

Run: `pnpm turbo run typecheck --filter=@tms/db`
Expected: exit 0 (the generated files are `@ts-nocheck`; the test files now resolve every import).

- [ ] **Step 6: Create the migration against the throwaway database**

The container must be empty (first migration). Start or recreate it:

```bash
docker rm -f tms-p1-pg 2>/dev/null; docker network inspect tms-p1-net >/dev/null 2>&1 || docker network create tms-p1-net
docker run -d --name tms-p1-pg --network tms-p1-net -p 55432:5432 -e POSTGRES_USER=tms -e POSTGRES_PASSWORD=tms -e POSTGRES_DB=tms postgres:18-alpine
sleep 3
```

Run: `DATABASE_URL=postgresql://tms:tms@localhost:55432/tms pnpm turbo run db:migrate:dev --filter=@tms/db -- --name identity_access_audit`
Expected: turbo runs `generate` first, then `@tms/db:db:migrate:dev: $ prisma migrate dev --name identity_access_audit`, `Applying migration \`<timestamp>_identity_access_audit\`` … `Your database is now in sync with your schema.`; the new folder `packages/db/prisma/migrations/<timestamp>_identity_access_audit/migration.sql` exists. The SQL is generated, not edited.

Run (structure of the generated SQL):
```bash
M=$(ls -d packages/db/prisma/migrations/*_identity_access_audit)/migration.sql
grep -c 'CREATE TYPE' $M; grep -c 'CREATE TABLE' $M; grep -c 'CREATE UNIQUE INDEX' $M; grep -c 'CREATE INDEX' $M; grep -c 'ON DELETE RESTRICT' $M; grep -c 'ON DELETE CASCADE' $M
```
Expected: `6`, `8`, `6`, `7`, `8`, `1` (the single cascade is `RolePermission_roleId_fkey`); ids are `UUID NOT NULL` without a database default (v7 ids come from the client), `createdAt`/`at` default `CURRENT_TIMESTAMP`, `metadata` is `JSONB`.

Run: `DATABASE_URL=postgresql://tms:tms@localhost:55432/tms pnpm turbo run db:drift --filter=@tms/db; echo drift=$?`
Expected: `Database schema is up to date!` (the `migrate status` half), `No difference detected.` and `drift=0` (a non-zero exit would mean a pending migration or a schema the migrations do not rebuild — the CI `db-drift` job runs `db:migrate:deploy` + `db:drift` the same way).

Run: `DATABASE_URL=postgresql://tms:tms@localhost:55432/tms pnpm turbo run db:migrate:status --filter=@tms/db`
Expected: `Database schema is up to date!`

**Before merge (D7):** after `git rebase main`, delete this task's migration folder, recreate `tms-p1-pg` as above, run `DATABASE_URL=postgresql://tms:tms@localhost:55432/tms pnpm turbo run db:migrate:deploy --filter=@tms/db` and then the same `db:migrate:dev -- --name identity_access_audit` command, check `db:drift` exits 0 and commit the regenerated folder (`chore(db): regenerate the identity migration after rebase`). Migration PRs merge serially.

- [ ] **Step 7: Run the tests to verify they pass, then lint and build**

Run: `pnpm turbo run test --filter=@tms/db`
Expected: PASS — `enums-parity.spec.ts` 7 tests (1 name-set + 6 per enum), `schema-identity.spec.ts` 7 tests; Task 04's harness suites unchanged. The harness `globalSetup` applies the new migration to the template database, so no test creates tables.

Run: `pnpm turbo run lint --filter=@tms/db && pnpm turbo run build --filter=@tms/db && ls packages/db/dist/generated/prisma/client.js packages/db/dist/index.js`
Expected: exit 0; both files listed (`build` compiles the client that turbo's `generate` produced; `dist/generated/prisma/**/*.js` is what the apps and the migrate image load).

Run: `node -e "const { createPrismaClient, \$Enums } = require('./packages/db/dist/index.js'); console.log(Object.keys(\$Enums).length, typeof createPrismaClient)"`
Expected: `6 function` — the CommonJS entry loads without a database.

Run: `(cd packages/db && node -e "console.log(Object.keys(require('@tms/db/testing')).sort().join(' '))")`
Expected: `POSTGRES_TEST_IMAGE makeDriverUser makePermission makeRole makeStaffUser resetTestDatabase testDatabaseUrl uniqueSuffix withAdminClient` — the builders resolve through the package's `exports`, as other packages will load them.

- [ ] **Step 8: Document the data model**

In `docs/architecture.md`, replace the line `## Data model — phase 1 (ERD generated from \`schema.prisma\`)` (line 75 after Tasks 02 and 03) and the empty section with:

````md
## Data model — phase 1 (ERD mirrors `schema.prisma`)

Source of truth: `packages/db/prisma/schema.prisma`; every schema change ships with exactly one
migration under `packages/db/prisma/migrations/` (D7) and the CI `db-drift` job proves the
migrations rebuild the schema. Conventions: Prisma's default names (PascalCase tables, camelCase
columns, no `@@map`); primary keys are UUID v7 generated by the client (`@default(uuid(7))`, so ids
are time-ordered); every point in time is `TIMESTAMPTZ(3)`, every calendar day is `DATE`.
Bookkeeping timestamps (`createdAt`, `updatedAt`, `AuditLog.at`) default in the database; business
timestamps (`expiresAt`, `lastSeenAt`, `syncedAt`) are set by the owning service through the
`Clock` port. Foreign keys towards `User` are `ON DELETE RESTRICT` (D9: users are deactivated,
never deleted, so audit rows keep their actor); the only cascade is `Role → RolePermission`. Enums
are declared once in `@tms/contracts` (`DB_MIRRORED_ENUMS`) and mirrored in the schema;
`packages/db/test/enums-parity.spec.ts` asserts set equality per enum and that both name sets
coincide.

### Identity, access and audit

```mermaid
erDiagram
  Role ||--o{ User : "roleId"
  User o|--o{ User : "createdById"
  Role ||--o{ RolePermission : "roleId (cascade)"
  Permission ||--o{ RolePermission : "permissionCode (restrict)"
  User ||--o{ Session : "userId"
  User ||--o{ ActionToken : "userId"
  User o|--o{ ActionToken : "createdById"
  User ||--o{ RecoveryCode : "userId"
  User o|--o{ AuditLog : "actorUserId"

  User {
    uuid id PK
    UserKind kind
    text username UK
    text firstName
    text lastName
    date dateOfBirth "optional"
    text phone "optional"
    text email UK "optional"
    UserStatus status "default INVITED"
    text passwordHash "optional"
    text totpSecretEnc "optional"
    text totpKeyId "optional"
    timestamptz totpEnabledAt "optional"
    int totpLastUsedStep "optional"
    uuid roleId FK
    text locale "default en"
    timestamptz lastLoginAt "optional"
    int failedLoginCount "default 0"
    timestamptz lockedUntil "optional"
    uuid createdById FK "optional"
    timestamptz createdAt
    timestamptz updatedAt
  }
  Role {
    uuid id PK
    text key UK "optional, seeded roles only"
    text name UK
    text description
    bool isSystem "default false"
    UserKind appliesTo
    timestamptz createdAt
    timestamptz updatedAt
  }
  Permission {
    text code PK
    text group
    text name
    text description
    bool isDeprecated "default false"
    timestamptz syncedAt
    timestamptz createdAt
    timestamptz updatedAt
  }
  RolePermission {
    uuid roleId PK, FK
    text permissionCode PK, FK
  }
  Session {
    uuid id PK
    uuid userId FK
    text tokenHash UK
    SessionScope scope
    timestamptz mfaVerifiedAt "optional"
    text totpPendingSecretEnc "optional"
    int mfaAttempts "default 0"
    timestamptz expiresAt
    timestamptz lastSeenAt
    text ip "optional"
    text userAgent "optional"
    timestamptz createdAt
  }
  ActionToken {
    uuid id PK
    uuid userId FK
    ActionTokenType type
    text tokenHash UK
    timestamptz expiresAt
    timestamptz usedAt "optional"
    uuid createdById FK "optional"
    timestamptz createdAt
  }
  RecoveryCode {
    uuid id PK
    uuid userId FK
    text codeHash
    timestamptz usedAt "optional"
    timestamptz createdAt
  }
  AuditLog {
    uuid id PK
    timestamptz at "default now, indexed"
    AuditApp app
    uuid actorUserId FK "optional, indexed"
    text action "indexed"
    text targetType "optional, indexed with targetId"
    text targetId "optional"
    AuditOutcome outcome
    text ip "optional"
    text userAgent "optional"
    jsonb metadata
  }
```

Drivers, master data and operations (`DriverProfile`, `IdentityCard`, `Carrier`, `Vehicle`,
`Product`, `LoadingPoint`, `LoadingOrder`, `QueueEntry`, `QueueDayCounter`) follow in the next
schema PR.
````

Run (render check, as phase 0 did; the block is copied to a scratch file outside the repository):
```bash
awk '/^```mermaid$/{f=1;next} /^```$/{f=0} f' docs/architecture.md | awk '/^erDiagram/{n++} n==1' > /tmp/erd-identity.mmd
npx -y -p @mermaid-js/mermaid-cli@11.4.2 mmdc -i /tmp/erd-identity.mmd -o /tmp/erd-identity.svg -q; echo mmdc=$?; stat -c %s /tmp/erd-identity.svg
```
Expected: `mmdc=0` and an SVG of roughly 250 kB. If puppeteer finds no browser, prefix the `mmdc` command with `PUPPETEER_EXECUTABLE_PATH=$HOME/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome` (the Playwright Chromium; adjust the build number to `ls ~/.cache/ms-playwright`) if needed.

Run: `pnpm exec prettier --write packages/db/src/index.ts packages/db/src/testing packages/db/test packages/db/README.md docs/architecture.md pnpm-workspace.yaml packages/db/package.json && pnpm format:check`
Expected: exit 0 (Prettier skips `src/generated/` and `*.prisma`).

- [ ] **Step 9: Whole-repository verification**

Run: `pnpm verify`
Expected: every turbo task green including `@tms/db#generate`, `@tms/db#test` and `@tms/db#build`; `format:check` and hygiene exit 0; no `[boundaries]` warning.

Run: `git status --short | grep -c generated`
Expected: `0` — nothing generated is staged or untracked.

- [ ] **Step 10: Commit**

Append to `docs/efficiency/critical-path.md`:
`| 2026-09-23 | Task 05: Schema — identity, access and audit | subagent | HH:MM | HH:MM | <rework or none> | n/a | <migration timestamp, test counts 7 + 7, drift exit 0, importFileExtension="" and the Prisma 7 error shape (no meta.target) recorded> |`

```bash
git add packages/db pnpm-workspace.yaml pnpm-lock.yaml docs/architecture.md docs/efficiency/critical-path.md
git commit -m "feat(db): add the identity, access and audit schema with its first migration"
```
Expected: this commit passes all hooks (header 76 characters); `git show --stat HEAD` lists the migration folder and no `src/generated` file.

**PR body notes:**
- Diagram: Mermaid `erDiagram` — the "Identity, access and audit" block from `docs/architecture.md` (9 relations, 8 entities; RESTRICT/cascade named on the `RolePermission` edges).
- Boundaries: `@tms/db` public API gains `createPrismaClient`, `CreatePrismaClientOptions` and the generated types/enums; `@tms/db/testing` gains the row builders `uniqueSuffix`, `makeRole`, `makeStaffUser`, `makeDriverUser`, `makePermission` (type-only Prisma imports); new catalog entries `@prisma/client`, `@prisma/adapter-pg`, `pg`, `@types/pg`, `prisma` pinned exactly; `@tms/db → @tms/contracts` dependency (allowed by the rule). No app changes.
- Migration: **yes** — `<timestamp>_identity_access_audit`, additive (6 types, 8 tables, 13 indexes, 9 FKs), reversible by dropping those objects; regenerated after rebase (D7).
- Verification plan: `pnpm verify`; `@tms/db` tests RED (missing exports) then GREEN; `migrate dev`, `db:drift` and `db:migrate:status` through turbo against `tms-p1-pg`; lint, typecheck, build and the `dist` smoke; the ERD render; CI `verify` and `db-drift`.
- Verification results (`scenario | layer | outcome`): `enum parity (6 enums) | unit (Jest) | 7 passed`; `FK restrict/cascade, nullable unique, self-relation, AuditLog indexes | db (Testcontainers) | 7 passed`; `migrate dev + db:drift + migrate status on tms-p1-pg | db | exit 0, "No difference detected"`; `lint/typecheck/build + dist smoke | static | exit 0, "6 function"`; `@tms/db/testing exports through the exports map | node | 9 names incl. the 5 builders`; `pnpm verify | repo | green`; `mmdc render of the ERD | docs | exit 0`.
- Risks and notes: `importFileExtension = ""` (extensionless imports, the CommonJS house rule; the default `.js` would lean on Task 02's Jest mapper); Prisma 7 driver-adapter errors expose the constraint name, not `meta.target` — tests and the shared helper pin `meta.driverAdapterError.cause.constraint.index`; `Session.userId` is RESTRICT like every FK towards `User`; the ERD is hand-maintained next to the schema (drift check + parity test keep the schema honest, review keeps the diagram honest).

---

### Task 06: Schema — drivers, master data and operations

**Branch:** `phase-1/06-schema-operations`
**PR title:** `feat(db): add the driver, master data and operations schema with its migration`

**Files:**
- Create: `packages/db/prisma/migrations/<timestamp>_drivers_master_data_operations/migration.sql` (generated), `packages/db/test/schema-operations.spec.ts`
- Modify: `packages/db/prisma/schema.prisma` (5 back-relation lines in `User`, 8 enums and 9 models appended), `packages/db/test/enums-parity.spec.ts:5-14` (`NOT_YET_IN_SCHEMA` emptied, expected count 14), `packages/db/src/testing/fixtures.ts` (operations helpers appended; exported through `@tms/db/testing` by Task 05's re-export), `docs/architecture.md` (section "Data model — phase 1" replaced in full), `docs/efficiency/critical-path.md`
- Test: `packages/db/test/enums-parity.spec.ts`, `packages/db/test/schema-operations.spec.ts`

**Interfaces:**
- Consumes: everything Task 05 produced (`createPrismaClient`, `$Enums`, model types, `makeDriverUser`, `expectKnownRequestError`, `uniqueSuffix`), the harness (Task 04), `DB_MIRRORED_ENUMS` (Task 03).
- Produces: model types `Carrier`, `Vehicle`, `Product`, `LoadingPoint`, `DriverProfile`, `IdentityCard`, `LoadingOrder`, `QueueEntry`, `QueueDayCounter` and enums `DriverType`, `IdentityCardStatus`, `VehicleKind`, `LoadingPointKind`, `TransportKind`, `LoadingOrderStatus`, `QueueEntryStatus`, `CheckInVia` (all through `@tms/db`); migration 2 (8 enum types, 9 tables, 12 FKs all RESTRICT); fixtures `TEST_DAY`, `makeCarrier`, `makeVehicle`, `makeProduct`, `makeLoadingPoint`, `makeDriverProfile`, `makeIdentityCard`, `makeLoadingOrder`, all exported from `@tms/db/testing`. The queue position is never stored (section 10): phase 4 derives it with `ORDER BY checkedInAt, id` over active entries; `activeOrderId` (unique, nullable) equals `orderId` while WAITING/CALLED and is `null` afterwards, so a REMOVED order can check in again; `IdentityCard.activeUserId` (unique, nullable) follows the same pattern — it equals `userId` while the card is ACTIVE and is `null` once it is BLOCKED, so the database allows one ACTIVE card per driver and keeps blocked cards as history (phase 3 request P1-3); `(day, sequenceNumber)` is unique; `QueueDayCounter` is bumped with `UPDATE … RETURNING` inside the check-in transaction.

- [ ] **Step 1: Extend the parity test so it fails**

In `packages/db/test/enums-parity.spec.ts` replace the `NOT_YET_IN_SCHEMA` declaration and the count assertion:

```ts
/** Every mirrored enum now exists in the schema; the list stays so a later phase can stage a new enum. */
const NOT_YET_IN_SCHEMA: readonly string[] = [];
```

```ts
    expect(expectedNames).toHaveLength(14);
```

- [ ] **Step 2: Write the failing operations test and its fixtures**

Append to `packages/db/src/testing/fixtures.ts` (extend the first import line to `import type { $Enums, Carrier, DriverProfile, IdentityCard, LoadingOrder, LoadingPoint, Permission, PrismaClient, Product, Role, User, Vehicle } from '../index';`; still type-only, so `@tms/db/testing` keeps loading nothing but `pg`):

```ts
/** Calendar day used by queue tests; DATE columns round-trip as UTC midnight. */
export const TEST_DAY = new Date('2026-09-23T00:00:00.000Z');

export function makeCarrier(
  prisma: PrismaClient,
  overrides: { name?: string; isActive?: boolean } = {},
): Promise<Carrier> {
  const suffix = uniqueSuffix();
  return prisma.carrier.create({
    data: { name: overrides.name ?? `Carrier ${suffix}`, isActive: overrides.isActive ?? true },
  });
}

export function makeVehicle(
  prisma: PrismaClient,
  overrides: { carrierId: string; registration?: string; kind?: $Enums.VehicleKind; isBlocked?: boolean },
): Promise<Vehicle> {
  const suffix = uniqueSuffix();
  return prisma.vehicle.create({
    data: {
      registration: overrides.registration ?? `TS-${suffix}-AA`,
      carrierId: overrides.carrierId,
      kind: overrides.kind ?? 'TRUCK',
      isBlocked: overrides.isBlocked ?? false,
    },
  });
}

export function makeProduct(
  prisma: PrismaClient,
  overrides: { code?: string; name?: string; isActive?: boolean } = {},
): Promise<Product> {
  const suffix = uniqueSuffix();
  return prisma.product.create({
    data: {
      code: overrides.code ?? `P${suffix}`,
      name: overrides.name ?? `Product ${suffix}`,
      isActive: overrides.isActive ?? true,
    },
  });
}

export function makeLoadingPoint(
  prisma: PrismaClient,
  overrides: { code?: string; name?: string; kind?: $Enums.LoadingPointKind; isActive?: boolean } = {},
): Promise<LoadingPoint> {
  const suffix = uniqueSuffix();
  return prisma.loadingPoint.create({
    data: {
      code: overrides.code ?? `LP${suffix}`,
      name: overrides.name ?? `Loading point ${suffix}`,
      kind: overrides.kind ?? 'TRUCK_ISLAND',
      isActive: overrides.isActive ?? true,
    },
  });
}

export function makeDriverProfile(
  prisma: PrismaClient,
  overrides: { userId: string; carrierId: string; driverType?: $Enums.DriverType; pinHash?: string },
): Promise<DriverProfile> {
  return prisma.driverProfile.create({
    data: {
      userId: overrides.userId,
      carrierId: overrides.carrierId,
      driverType: overrides.driverType ?? 'TRUCK',
      pinHash: overrides.pinHash ?? 'not-a-real-hash',
      pinUpdatedAt: new Date(),
    },
  });
}

/** ACTIVE by default with `activeUserId = userId`; a BLOCKED card gets `activeUserId = null`. */
export function makeIdentityCard(
  prisma: PrismaClient,
  overrides: { userId: string; serial?: string; status?: $Enums.IdentityCardStatus },
): Promise<IdentityCard> {
  const suffix = uniqueSuffix();
  const status = overrides.status ?? 'ACTIVE';
  return prisma.identityCard.create({
    data: {
      serial: overrides.serial ?? `CARD-${suffix}`,
      userId: overrides.userId,
      activeUserId: status === 'ACTIVE' ? overrides.userId : null,
      status,
      issuedAt: new Date(),
    },
  });
}

export interface LoadingOrderOverrides {
  driverId: string;
  vehicleId: string;
  carrierId: string;
  productId: string;
  orderNumber?: string;
  transportKind?: $Enums.TransportKind;
  quantityLiters?: number;
  plannedDate?: Date;
  createdById?: string;
}

export function makeLoadingOrder(
  prisma: PrismaClient,
  overrides: LoadingOrderOverrides,
): Promise<LoadingOrder> {
  const suffix = uniqueSuffix();
  return prisma.loadingOrder.create({
    data: {
      orderNumber: overrides.orderNumber ?? `LO-${suffix}`,
      transportKind: overrides.transportKind ?? 'TRUCK',
      driverId: overrides.driverId,
      vehicleId: overrides.vehicleId,
      carrierId: overrides.carrierId,
      productId: overrides.productId,
      quantityLiters: overrides.quantityLiters ?? 20000,
      plannedDate: overrides.plannedDate ?? TEST_DAY,
      ...(overrides.createdById ? { createdById: overrides.createdById } : {}),
    },
  });
}
```

`packages/db/test/schema-operations.spec.ts`:

```ts
import { createPrismaClient, type PrismaClient } from '../src';
import {
  TEST_DAY,
  makeCarrier,
  makeDriverProfile,
  makeDriverUser,
  makeIdentityCard,
  makeLoadingOrder,
  makeProduct,
  makeVehicle,
  resetTestDatabase,
  testDatabaseUrl,
} from '../src/testing';
import { expectKnownRequestError } from './support/prisma-errors';

describe('drivers, master data and operations schema', () => {
  let prisma: PrismaClient;

  beforeEach(async () => {
    await resetTestDatabase();
    prisma = createPrismaClient({ url: testDatabaseUrl() });
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  /** One driver with profile, one vehicle and one product: enough to create orders. */
  async function orderGraph() {
    const carrier = await makeCarrier(prisma);
    const driver = await makeDriverUser(prisma);
    await makeDriverProfile(prisma, { userId: driver.id, carrierId: carrier.id });
    const vehicle = await makeVehicle(prisma, { carrierId: carrier.id });
    const product = await makeProduct(prisma);
    const order = () =>
      makeLoadingOrder(prisma, {
        driverId: driver.id,
        vehicleId: vehicle.id,
        carrierId: carrier.id,
        productId: product.id,
      });
    return { carrier, driver, vehicle, product, order };
  }

  function queueEntry(orderId: string, sequenceNumber: number, activeOrderId: string | null) {
    return prisma.queueEntry.create({
      data: {
        orderId,
        activeOrderId,
        day: TEST_DAY,
        sequenceNumber,
        checkedInAt: new Date(),
        checkedInVia: 'KIOSK',
      },
    });
  }

  it('lets finished entries of one order coexist with activeOrderId = null', async () => {
    const { order } = await orderGraph();
    const first = await order();
    await queueEntry(first.id, 1, null);
    await queueEntry(first.id, 2, null);

    expect(await prisma.queueEntry.count({ where: { orderId: first.id, activeOrderId: null } })).toBe(2);
  });

  it('allows one active entry per order (P2002 on QueueEntry_activeOrderId_key)', async () => {
    const { order } = await orderGraph();
    const first = await order();
    const created = await queueEntry(first.id, 1, first.id);
    expect(created.status).toBe('WAITING');

    await expectKnownRequestError(queueEntry(first.id, 2, first.id), {
      code: 'P2002',
      constraint: 'QueueEntry_activeOrderId_key',
    });
  });

  it('rejects a duplicate (day, sequenceNumber) (P2002 on QueueEntry_day_sequenceNumber_key)', async () => {
    const { order } = await orderGraph();
    const first = await order();
    const second = await order();
    await queueEntry(first.id, 1, first.id);

    await expectKnownRequestError(queueEntry(second.id, 1, second.id), {
      code: 'P2002',
      constraint: 'QueueEntry_day_sequenceNumber_key',
    });
  });

  it('rejects a duplicate Vehicle.registration (P2002 on Vehicle_registration_key)', async () => {
    const carrier = await makeCarrier(prisma);
    await makeVehicle(prisma, { carrierId: carrier.id, registration: 'AB-123-CD' });

    await expectKnownRequestError(
      makeVehicle(prisma, { carrierId: carrier.id, registration: 'AB-123-CD', kind: 'RAIL_WAGON' }),
      { code: 'P2002', constraint: 'Vehicle_registration_key' },
    );
  });

  it('rejects a duplicate IdentityCard.serial (P2002 on IdentityCard_serial_key)', async () => {
    // Two drivers, so only the serial collides, not activeUserId.
    const [first, second] = [await makeDriverUser(prisma), await makeDriverUser(prisma)];
    const created = await makeIdentityCard(prisma, { userId: first.id, serial: 'CARD-0001' });
    expect(created.status).toBe('ACTIVE');

    await expectKnownRequestError(
      makeIdentityCard(prisma, { userId: second.id, serial: 'CARD-0001' }),
      { code: 'P2002', constraint: 'IdentityCard_serial_key' },
    );
  });

  it('allows one ACTIVE card per driver (P2002 on IdentityCard_activeUserId_key)', async () => {
    const driver = await makeDriverUser(prisma);
    const active = await makeIdentityCard(prisma, { userId: driver.id });
    expect(active.activeUserId).toBe(driver.id);

    await expectKnownRequestError(makeIdentityCard(prisma, { userId: driver.id }), {
      code: 'P2002',
      constraint: 'IdentityCard_activeUserId_key',
    });
  });

  it('lets a BLOCKED card and a new ACTIVE card of one driver coexist (activeUserId = null)', async () => {
    const driver = await makeDriverUser(prisma);
    const old = await makeIdentityCard(prisma, { userId: driver.id });
    await prisma.identityCard.update({
      where: { id: old.id },
      data: { status: 'BLOCKED', activeUserId: null },
    });
    await makeIdentityCard(prisma, { userId: driver.id });

    expect(await prisma.identityCard.count({ where: { userId: driver.id } })).toBe(2);
    expect(await prisma.identityCard.findMany({ where: { activeUserId: driver.id } })).toMatchObject([
      { status: 'ACTIVE' },
    ]);
  });

  it('gives a driver at most one DriverProfile (P2002 on DriverProfile_pkey)', async () => {
    const carrier = await makeCarrier(prisma);
    const driver = await makeDriverUser(prisma);
    await makeDriverProfile(prisma, { userId: driver.id, carrierId: carrier.id });

    await expectKnownRequestError(
      makeDriverProfile(prisma, { userId: driver.id, carrierId: carrier.id, driverType: 'RAIL' }),
      { code: 'P2002', constraint: 'DriverProfile_pkey' },
    );
  });

  it('keeps a Product that an order references (RESTRICT, P2003 on LoadingOrder_productId_fkey)', async () => {
    const { product, order } = await orderGraph();
    const created = await order();
    expect(created.status).toBe('CREATED');
    expect(created.plannedDate).toEqual(TEST_DAY);

    await expectKnownRequestError(prisma.product.delete({ where: { id: product.id } }), {
      code: 'P2003',
      constraint: 'LoadingOrder_productId_fkey',
    });
    expect(await prisma.product.count()).toBe(1);
  });

  it('keeps a driver that an IdentityCard references (D9, P2003 on IdentityCard_userId_fkey)', async () => {
    const driver = await makeDriverUser(prisma);
    await makeIdentityCard(prisma, { userId: driver.id, serial: 'CARD-0002' });

    await expectKnownRequestError(prisma.user.delete({ where: { id: driver.id } }), {
      code: 'P2003',
      constraint: 'IdentityCard_userId_fkey',
    });
  });

  it('bumps QueueDayCounter with UPDATE ... RETURNING (1, then 2)', async () => {
    await prisma.queueDayCounter.create({ data: { day: TEST_DAY } });
    const bump = () => prisma.$queryRaw<{ sequenceNumber: number }[]>`
      UPDATE "QueueDayCounter" SET "next" = "next" + 1 WHERE "day" = ${TEST_DAY}::date
      RETURNING "next" - 1 AS "sequenceNumber"`;

    expect(await bump()).toEqual([{ sequenceNumber: 1 }]);
    expect(await bump()).toEqual([{ sequenceNumber: 2 }]);
    expect(await prisma.queueDayCounter.findUniqueOrThrow({ where: { day: TEST_DAY } })).toEqual({
      day: TEST_DAY,
      next: 3,
    });
  });
});
```

The concurrency property (fast-check: sequence numbers strictly increase without duplicates under concurrent check-in, section 13) belongs to phase 4 with the check-in service that owns the transaction; here only the row shape and the atomic single-statement bump are pinned.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm turbo run test --filter=@tms/db`
Expected: FAIL — `enums-parity.spec.ts`: `expect(received).toHaveLength(14)` received length 6; `schema-operations.spec.ts` fails at runtime, all 11 cases (`Cannot read properties of undefined (reading 'create')` on `prisma.carrier` or `prisma.identityCard`; ts-jest does not type-check under `isolatedModules: true`); `schema-identity.spec.ts` and the harness suites still pass (the fixtures' new imports are type-only); the type errors show in `pnpm turbo run typecheck --filter=@tms/db`.

- [ ] **Step 4: Extend the schema**

In `packages/db/prisma/schema.prisma`, inside `model User`, after the line `  auditEntries       AuditLog[]` add:

```prisma
  driverProfile      DriverProfile?
  identityCards      IdentityCard[]
  loadingOrders      LoadingOrder[] @relation("LoadingOrderDriver")
  createdOrders      LoadingOrder[] @relation("LoadingOrderCreatedBy")
  removedEntries     QueueEntry[]   @relation("QueueEntryRemovedBy")
```

Append to the end of the file (already in `prisma format` layout):

```prisma
enum DriverType {
  TRUCK
  RAIL
}

enum IdentityCardStatus {
  ACTIVE
  BLOCKED
}

enum VehicleKind {
  TRUCK
  RAIL_WAGON
}

enum LoadingPointKind {
  TRUCK_ISLAND
  RAIL_TRACK
}

enum TransportKind {
  TRUCK
  RAIL
}

enum LoadingOrderStatus {
  CREATED
  QUEUED
  CALLED
  LOADED
  CANCELLED
}

enum QueueEntryStatus {
  WAITING
  CALLED
  DONE
  REMOVED
}

enum CheckInVia {
  KIOSK
  MANUAL
}

model Carrier {
  id        String   @id @default(uuid(7)) @db.Uuid
  name      String   @unique
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  updatedAt DateTime @updatedAt @db.Timestamptz(3)

  vehicles       Vehicle[]
  driverProfiles DriverProfile[]
  loadingOrders  LoadingOrder[]
}

model Vehicle {
  id           String      @id @default(uuid(7)) @db.Uuid
  registration String      @unique
  carrierId    String      @db.Uuid
  carrier      Carrier     @relation(fields: [carrierId], references: [id], onDelete: Restrict)
  kind         VehicleKind
  isBlocked    Boolean     @default(false)
  createdAt    DateTime    @default(now()) @db.Timestamptz(3)
  updatedAt    DateTime    @updatedAt @db.Timestamptz(3)

  loadingOrders LoadingOrder[]
}

model Product {
  id        String   @id @default(uuid(7)) @db.Uuid
  code      String   @unique
  name      String
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  updatedAt DateTime @updatedAt @db.Timestamptz(3)

  loadingOrders LoadingOrder[]
}

model LoadingPoint {
  id        String           @id @default(uuid(7)) @db.Uuid
  code      String           @unique
  name      String
  kind      LoadingPointKind
  isActive  Boolean          @default(true)
  createdAt DateTime         @default(now()) @db.Timestamptz(3)
  updatedAt DateTime         @updatedAt @db.Timestamptz(3)

  queueEntries QueueEntry[]
}

model DriverProfile {
  userId         String     @id @db.Uuid
  user           User       @relation(fields: [userId], references: [id], onDelete: Restrict)
  driverType     DriverType
  carrierId      String     @db.Uuid
  carrier        Carrier    @relation(fields: [carrierId], references: [id], onDelete: Restrict)
  licenseNumber  String?
  adrExpiresAt   DateTime?  @db.Date
  pinHash        String
  pinFailedCount Int        @default(0)
  pinLockedUntil DateTime?  @db.Timestamptz(3)
  pinUpdatedAt   DateTime   @db.Timestamptz(3)
}

model IdentityCard {
  id           String             @id @default(uuid(7)) @db.Uuid
  serial       String             @unique
  userId       String             @db.Uuid
  user         User               @relation(fields: [userId], references: [id], onDelete: Restrict)
  activeUserId String?            @unique @db.Uuid
  status       IdentityCardStatus @default(ACTIVE)
  issuedAt     DateTime           @db.Timestamptz(3)
}

model LoadingOrder {
  id             String             @id @default(uuid(7)) @db.Uuid
  orderNumber    String             @unique
  transportKind  TransportKind
  driverId       String             @db.Uuid
  driver         User               @relation("LoadingOrderDriver", fields: [driverId], references: [id], onDelete: Restrict)
  vehicleId      String             @db.Uuid
  vehicle        Vehicle            @relation(fields: [vehicleId], references: [id], onDelete: Restrict)
  carrierId      String             @db.Uuid
  carrier        Carrier            @relation(fields: [carrierId], references: [id], onDelete: Restrict)
  productId      String             @db.Uuid
  product        Product            @relation(fields: [productId], references: [id], onDelete: Restrict)
  quantityLiters Int
  plannedDate    DateTime           @db.Date
  status         LoadingOrderStatus @default(CREATED)
  notes          String?
  createdById    String?            @db.Uuid
  createdBy      User?              @relation("LoadingOrderCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)
  createdAt      DateTime           @default(now()) @db.Timestamptz(3)
  updatedAt      DateTime           @updatedAt @db.Timestamptz(3)

  queueEntries QueueEntry[]

  @@index([driverId, plannedDate, status])
}

model QueueEntry {
  id             String           @id @default(uuid(7)) @db.Uuid
  orderId        String           @db.Uuid
  order          LoadingOrder     @relation(fields: [orderId], references: [id], onDelete: Restrict)
  activeOrderId  String?          @unique @db.Uuid
  day            DateTime         @db.Date
  sequenceNumber Int
  loadingPointId String?          @db.Uuid
  loadingPoint   LoadingPoint?    @relation(fields: [loadingPointId], references: [id], onDelete: Restrict)
  status         QueueEntryStatus @default(WAITING)
  checkedInAt    DateTime         @db.Timestamptz(3)
  checkedInVia   CheckInVia
  kioskId        String?
  calledAt       DateTime?        @db.Timestamptz(3)
  completedAt    DateTime?        @db.Timestamptz(3)
  removedById    String?          @db.Uuid
  removedBy      User?            @relation("QueueEntryRemovedBy", fields: [removedById], references: [id], onDelete: Restrict)
  removeReason   String?

  @@unique([day, sequenceNumber])
  @@index([day, status])
}

model QueueDayCounter {
  day  DateTime @id @db.Date
  next Int      @default(1)
}
```

Run: `pnpm turbo run db:validate --filter=@tms/db && (cd packages/db && pnpm exec prisma format --check)`
Expected: valid; `All files are formatted correctly!`.

- [ ] **Step 5: Regenerate the client and create migration 2**

Run: `pnpm turbo run generate --filter=@tms/db && ls packages/db/src/generated/prisma/models | wc -l`
Expected: `✔ Generated Prisma Client (7.10.0)`; `17` model files.

Bring `tms-p1-pg` to exactly the migrations on the branch, then diff (recreate the container with the Task 05 Step 6 commands if `migrate status` reports anything but the Task 05 migration applied or an empty database):

Run: `export DATABASE_URL=postgresql://tms:tms@localhost:55432/tms; pnpm turbo run db:migrate:deploy --filter=@tms/db && pnpm turbo run db:migrate:dev --filter=@tms/db -- --name drivers_master_data_operations`
Expected: `deploy` reports the identity migration applied (or already applied); `migrate dev` prints `Applying migration \`<timestamp>_drivers_master_data_operations\`` and creates `packages/db/prisma/migrations/<timestamp>_drivers_master_data_operations/migration.sql` containing only the new objects (no `ALTER` of Task 05 tables).

Run:
```bash
M=$(ls -d packages/db/prisma/migrations/*_drivers_master_data_operations)/migration.sql
grep -c 'CREATE TYPE' $M; grep -c 'CREATE TABLE' $M; grep -c 'CREATE UNIQUE INDEX' $M; grep -c 'CREATE INDEX' $M; grep -c 'ON DELETE RESTRICT' $M; grep -c 'ON DELETE CASCADE' $M
```
Expected: `8`, `9`, `9`, `2`, `12`, `0` — unique: `Carrier_name_key`, `Vehicle_registration_key`, `Product_code_key`, `LoadingPoint_code_key`, `IdentityCard_serial_key`, `IdentityCard_activeUserId_key`, `LoadingOrder_orderNumber_key`, `QueueEntry_activeOrderId_key`, `QueueEntry_day_sequenceNumber_key`; indexes: `LoadingOrder_driverId_plannedDate_status_idx`, `QueueEntry_day_status_idx`; `DriverProfile_pkey` is on `userId`; `QueueDayCounter_pkey` on `day` (`DATE`).

Run: `pnpm turbo run db:drift --filter=@tms/db; echo drift=$?; pnpm turbo run db:migrate:status --filter=@tms/db`
Expected: `No difference detected.`, `drift=0`, `Database schema is up to date!` (2 migrations found; `db:drift` prints the same status line first).

**Before merge (D7):** after `git rebase main`, delete this task's migration folder, recreate `tms-p1-pg`, `export DATABASE_URL=postgresql://tms:tms@localhost:55432/tms`, run `pnpm turbo run db:migrate:deploy --filter=@tms/db` then `pnpm turbo run db:migrate:dev --filter=@tms/db -- --name drivers_master_data_operations`, check `pnpm turbo run db:drift --filter=@tms/db` exits 0 and commit the regenerated folder (`chore(db): regenerate the operations migration after rebase`).

- [ ] **Step 6: Run the tests to verify they pass, then lint and build**

Run: `pnpm turbo run test --filter=@tms/db`
Expected: PASS — `enums-parity.spec.ts` 15 tests (1 + 14), `schema-identity.spec.ts` 7, `schema-operations.spec.ts` 11; harness suites unchanged.

Run: `pnpm turbo run lint --filter=@tms/db && pnpm turbo run typecheck --filter=@tms/db && pnpm turbo run build --filter=@tms/db`
Expected: exit 0 for all three.

Run: `node -e "const { \$Enums } = require('./packages/db/dist/index.js'); console.log(Object.keys(\$Enums).length)"`
Expected: `14`.

- [ ] **Step 7: Complete the data model documentation**

Replace the whole section `## Data model — phase 1 (ERD mirrors \`schema.prisma\`)` in `docs/architecture.md` (up to, not including, `## Authentication flows — phase 2`) with:

````md
## Data model — phase 1 (ERD mirrors `schema.prisma`)

Source of truth: `packages/db/prisma/schema.prisma`; every schema change ships with exactly one
migration under `packages/db/prisma/migrations/` (D7) and the CI `db-drift` job proves the
migrations rebuild the schema. Conventions: Prisma's default names (PascalCase tables, camelCase
columns, no `@@map`); primary keys are UUID v7 generated by the client (`@default(uuid(7))`, so ids
are time-ordered); every point in time is `TIMESTAMPTZ(3)`, every calendar day is `DATE`
(`dateOfBirth`, `adrExpiresAt`, `plannedDate`, `QueueEntry.day`, `QueueDayCounter.day`).
Bookkeeping timestamps (`createdAt`, `updatedAt`, `AuditLog.at`) default in the database; business
timestamps (`expiresAt`, `lastSeenAt`, `syncedAt`, `issuedAt`, `pinUpdatedAt`, `checkedInAt`) are
set by the owning service through the `Clock` port. Foreign keys towards `User` and towards master
data are `ON DELETE RESTRICT` (D9: users are deactivated, never deleted, so audit rows keep their
actor; master data is deactivated with `isActive`); the only cascade is `Role → RolePermission`.
Enums are declared once in `@tms/contracts` (`DB_MIRRORED_ENUMS`) and mirrored in the schema;
`packages/db/test/enums-parity.spec.ts` asserts set equality per enum and that both name sets
coincide (14 enums).

### Identity, access and audit

```mermaid
erDiagram
  Role ||--o{ User : "roleId"
  User o|--o{ User : "createdById"
  Role ||--o{ RolePermission : "roleId (cascade)"
  Permission ||--o{ RolePermission : "permissionCode (restrict)"
  User ||--o{ Session : "userId"
  User ||--o{ ActionToken : "userId"
  User o|--o{ ActionToken : "createdById"
  User ||--o{ RecoveryCode : "userId"
  User o|--o{ AuditLog : "actorUserId"

  User {
    uuid id PK
    UserKind kind
    text username UK
    text firstName
    text lastName
    date dateOfBirth "optional"
    text phone "optional"
    text email UK "optional"
    UserStatus status "default INVITED"
    text passwordHash "optional"
    text totpSecretEnc "optional"
    text totpKeyId "optional"
    timestamptz totpEnabledAt "optional"
    int totpLastUsedStep "optional"
    uuid roleId FK
    text locale "default en"
    timestamptz lastLoginAt "optional"
    int failedLoginCount "default 0"
    timestamptz lockedUntil "optional"
    uuid createdById FK "optional"
    timestamptz createdAt
    timestamptz updatedAt
  }
  Role {
    uuid id PK
    text key UK "optional, seeded roles only"
    text name UK
    text description
    bool isSystem "default false"
    UserKind appliesTo
    timestamptz createdAt
    timestamptz updatedAt
  }
  Permission {
    text code PK
    text group
    text name
    text description
    bool isDeprecated "default false"
    timestamptz syncedAt
    timestamptz createdAt
    timestamptz updatedAt
  }
  RolePermission {
    uuid roleId PK, FK
    text permissionCode PK, FK
  }
  Session {
    uuid id PK
    uuid userId FK
    text tokenHash UK
    SessionScope scope
    timestamptz mfaVerifiedAt "optional"
    text totpPendingSecretEnc "optional"
    int mfaAttempts "default 0"
    timestamptz expiresAt
    timestamptz lastSeenAt
    text ip "optional"
    text userAgent "optional"
    timestamptz createdAt
  }
  ActionToken {
    uuid id PK
    uuid userId FK
    ActionTokenType type
    text tokenHash UK
    timestamptz expiresAt
    timestamptz usedAt "optional"
    uuid createdById FK "optional"
    timestamptz createdAt
  }
  RecoveryCode {
    uuid id PK
    uuid userId FK
    text codeHash
    timestamptz usedAt "optional"
    timestamptz createdAt
  }
  AuditLog {
    uuid id PK
    timestamptz at "default now, indexed"
    AuditApp app
    uuid actorUserId FK "optional, indexed"
    text action "indexed"
    text targetType "optional, indexed with targetId"
    text targetId "optional"
    AuditOutcome outcome
    text ip "optional"
    text userAgent "optional"
    jsonb metadata
  }
```

### Drivers, master data and operations

`User` appears with its key only; its columns are in the diagram above. Queue position is never
stored: it is derived at read time (`ORDER BY checkedInAt, id` over WAITING/CALLED entries, section
10). `activeOrderId` equals `orderId` while an entry is WAITING or CALLED and is `null` afterwards,
so the unique index allows one active entry per order and lets a REMOVED order check in again.
`IdentityCard.activeUserId` works the same way: it equals `userId` while the card is ACTIVE and is
`null` once it is BLOCKED, so a driver has at most one ACTIVE card and blocked cards stay as history.
`QueueDayCounter.next` is bumped with `UPDATE … RETURNING` inside the check-in transaction, which
serialises concurrent check-ins on the row lock (phase 4 adds the property test).

```mermaid
erDiagram
  User ||--o| DriverProfile : "userId (1:1)"
  Carrier ||--o{ DriverProfile : "carrierId"
  User ||--o{ IdentityCard : "userId"
  Carrier ||--o{ Vehicle : "carrierId"
  User ||--o{ LoadingOrder : "driverId"
  User o|--o{ LoadingOrder : "createdById"
  Vehicle ||--o{ LoadingOrder : "vehicleId"
  Carrier ||--o{ LoadingOrder : "carrierId"
  Product ||--o{ LoadingOrder : "productId"
  LoadingOrder ||--o{ QueueEntry : "orderId"
  LoadingPoint o|--o{ QueueEntry : "loadingPointId"
  User o|--o{ QueueEntry : "removedById"

  User {
    uuid id PK "see the identity diagram"
  }
  DriverProfile {
    uuid userId PK, FK
    DriverType driverType
    uuid carrierId FK
    text licenseNumber "optional"
    date adrExpiresAt "optional"
    text pinHash
    int pinFailedCount "default 0"
    timestamptz pinLockedUntil "optional"
    timestamptz pinUpdatedAt
  }
  IdentityCard {
    uuid id PK
    text serial UK
    uuid userId FK
    uuid activeUserId UK "optional; equals userId while ACTIVE"
    IdentityCardStatus status "default ACTIVE"
    timestamptz issuedAt
  }
  Carrier {
    uuid id PK
    text name UK
    bool isActive "default true"
    timestamptz createdAt
    timestamptz updatedAt
  }
  Vehicle {
    uuid id PK
    text registration UK
    uuid carrierId FK
    VehicleKind kind
    bool isBlocked "default false"
    timestamptz createdAt
    timestamptz updatedAt
  }
  Product {
    uuid id PK
    text code UK
    text name
    bool isActive "default true"
    timestamptz createdAt
    timestamptz updatedAt
  }
  LoadingPoint {
    uuid id PK
    text code UK
    text name
    LoadingPointKind kind
    bool isActive "default true"
    timestamptz createdAt
    timestamptz updatedAt
  }
  LoadingOrder {
    uuid id PK
    text orderNumber UK
    TransportKind transportKind
    uuid driverId FK "indexed with plannedDate, status"
    uuid vehicleId FK
    uuid carrierId FK
    uuid productId FK
    int quantityLiters
    date plannedDate
    LoadingOrderStatus status "default CREATED"
    text notes "optional"
    uuid createdById FK "optional"
    timestamptz createdAt
    timestamptz updatedAt
  }
  QueueEntry {
    uuid id PK
    uuid orderId FK
    uuid activeOrderId UK "optional; equals orderId while WAITING or CALLED"
    date day "unique with sequenceNumber, indexed with status"
    int sequenceNumber
    uuid loadingPointId FK "optional"
    QueueEntryStatus status "default WAITING"
    timestamptz checkedInAt
    CheckInVia checkedInVia
    text kioskId "optional"
    timestamptz calledAt "optional"
    timestamptz completedAt "optional"
    uuid removedById FK "optional"
    text removeReason "optional"
  }
  QueueDayCounter {
    date day PK
    int next "default 1"
  }
```
````

Run (render both blocks, scratch files outside the repository):
```bash
awk '/^```mermaid$/{f=1;n++;next} /^```$/{f=0} f{print > "/tmp/erd-" n ".mmd"}' docs/architecture.md
for i in 3 4; do npx -y -p @mermaid-js/mermaid-cli@11.4.2 mmdc -i /tmp/erd-$i.mmd -o /tmp/erd-$i.svg -q; echo "erd-$i mmdc=$? $(stat -c %s /tmp/erd-$i.svg)"; done
```
Expected: `erd-3 mmdc=0` and `erd-4 mmdc=0`, each SVG roughly 250 kB (mermaid blocks 1 and 2 of the file are phase 0's C4 context and container flowcharts; 3 and 4 are the two ERDs; if the file gains other diagrams before them, adjust the numbers). Prefix with `PUPPETEER_EXECUTABLE_PATH=$HOME/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome` if needed.

Run: `pnpm exec prettier --write packages/db/src/testing packages/db/test docs/architecture.md && pnpm format:check`
Expected: exit 0.

- [ ] **Step 8: Whole-repository verification**

Run: `pnpm verify`
Expected: green; `@tms/db#test` shows 3 suites from Tasks 05–06 plus the harness suites; `git status --short | grep -c generated` prints `0`.

- [ ] **Step 9: Commit**

Append to `docs/efficiency/critical-path.md`:
`| 2026-09-23 | Task 06: Schema — drivers, master data and operations | subagent | HH:MM | HH:MM | <rework or none> | n/a | <migration timestamp, counts 15 + 7 + 11, drift exit 0, both ERDs rendered> |`

```bash
git add packages/db docs/architecture.md docs/efficiency/critical-path.md
git commit -m "feat(db): add the driver, master data and operations schema with its migration"
```
Expected: this commit passes all hooks (header 78 characters); `git show --stat HEAD` lists the migration folder, the schema, the three test files and the docs, nothing under `src/generated`.

**PR body notes:**
- Diagram: Mermaid `erDiagram` — the "Drivers, master data and operations" block (12 relations, 10 entities, `User` as the key-only bridge to the first ERD).
- Boundaries: `@tms/db` public API gains 9 model types and 8 enums (no new functions); no catalog or manifest change; no app changes.
- Migration: **yes** — `<timestamp>_drivers_master_data_operations`, additive (8 types, 9 tables, 11 indexes, 12 FKs, all RESTRICT), reversible by dropping those objects; regenerated after rebase (D7); merges after Task 05, serially.
- Verification plan: `pnpm verify`; the parity and operations suites RED then GREEN; `migrate deploy` + `migrate dev` + `db:drift` + `db:migrate:status` through turbo against `tms-p1-pg`; lint, typecheck, build, `dist` smoke; both ERD renders; CI `verify` and `db-drift`.
- Verification results (`scenario | layer | outcome`): `enum parity (14 enums) | unit (Jest) | 15 passed`; `activeOrderId partial uniqueness, one ACTIVE card per driver (activeUserId), (day, sequenceNumber), registration, serial, 1:1 profile, product/driver RESTRICT, counter bump | db (Testcontainers) | 11 passed`; `identity suite (regression) | db | 7 passed`; `migrate deploy + migrate dev + db:drift on tms-p1-pg | db | exit 0, "No difference detected"`; `lint/typecheck/build + dist smoke | static | exit 0, "14"`; `pnpm verify | repo | green`; `mmdc render of both ERDs | docs | exit 0`.
- Risks and notes: `DriverProfile` has no `createdAt`/`updatedAt` (section 7 lists none; `pinUpdatedAt` is the only timestamp) — add them in a later migration if the admin UI needs them; `checkedInAt`, `issuedAt` and `pinUpdatedAt` have no database default on purpose (services set them through `Clock`); the concurrency property of the day counter is phase 4's test; `QueueEntry.activeOrderId` and `IdentityCard.activeUserId` have no FK by design (copies of `orderId`/`userId` used only for the unique index; the card-issuing service in phase 3b keeps `activeUserId` in step with `status`).

---

### Task 07: Permission catalogue sync

**Branch:** `phase-1/07-permission-sync`
**PR title:** `feat(db): add the permission catalogue sync and its CLI`

Spec section 9 (sync semantics), section 13 (model-based property tests), D12 (never inside a Nest process); plan deviation 1 (pure function + CLI in `db`, not a `PermissionSyncService` in `domain/admin`) and deviation 3 (`Role.key`, `PermissionDefinition.audience`). Review Focus item 2 lists the edge cases every test below pins.

Spike notes (verified while writing, Node 24.21, Prisma 7.10.0, turbo 2.11.3): `process.loadEnvFile` never overrides a variable that is already set; `prisma migrate diff --exit-code` exits 0/1/2 (no difference / error / changes); `require.resolve('prisma/build/index.js')` works (explicit export of prisma 7.10.0); `@prisma/config` 7.10.0 declares `migrations.seed?: string` and resolves config paths relative to the config file; a root `"@tms/db#test"` entry in `turbo.json` replaces the base `test` definition instead of merging with it (Task 04's entry therefore restates `dependsOn` and `outputs`, and lists the package's own `build`, so the CLI specs find `dist/` without a `pretest` script racing the parallel `build`). The generated client is imported as `../generated/prisma/client` (Task 05's output `src/generated/prisma`); Task 05's fixtures create rows themselves (`makeRole(client, overrides)`, `makePermission(client, overrides)`); the package's specs import the harness as `../../src/testing`; `resetTestDatabase()` truncates the worker database and keeps `_prisma_migrations`.

**Files:**
- Create: `packages/db/src/sync/plan.ts`, `packages/db/src/sync/apply.ts`, `packages/db/src/sync/index.ts`, `packages/db/src/cli/support.ts`, `packages/db/src/cli/sync-permissions.ts`, `docs/adr/0004-permission-catalogue-and-sync.md`
- Modify: `packages/db/package.json` (`bin`, script `db:sync`, devDependency `fast-check`; `@tms/contracts` is already a dependency since Task 05), `packages/db/src/index.ts` (append one re-export line), `docs/adr/README.md:6-8` (the Accepted/Planned paragraph), `docs/architecture.md` (insert under `## RBAC and permission sync — phase 3a/3b`), `pnpm-lock.yaml`
- Test: `packages/db/test/support/sync-model.ts`, `packages/db/test/sync/plan.spec.ts`, `packages/db/test/sync/plan.property.spec.ts`, `packages/db/test/sync/apply.spec.ts`, `packages/db/test/cli/sync-permissions.spec.ts`

**Interfaces:**
- Consumes: `PERMISSIONS`, `PERMISSION_CODES`, `PermissionDefinition`, `validateCatalogue`, `CatalogueProblem` (`{ code, problem }`), `permissionCodesForAudience`, `SEEDED_ROLES`, `AuditMetadata` from `@tms/contracts`; `scrubString` from `@tms/contracts/security` (Task 03); `createPrismaClient`, `PrismaClient`, `Prisma` from `@tms/db` (Task 05); `testDatabaseUrl()`, `resetTestDatabase()` from the harness and the `makeRole`, `makePermission` builders of `@tms/db/testing` (Tasks 04–05, imported as `../../src/testing` inside the package); catalog `fast-check ^4.10.2` (Task 03).
- Produces (all exported from `@tms/db`):
  - `planPermissionSync(state: SyncState, catalogue: readonly PermissionDefinition[], opts: { lockedRoles: readonly LockedRole[] }): SyncPlan` — pure; throws `CatalogueInvalidError` before planning anything.
  - `isEmptyPlan(plan: SyncPlan): boolean`.
  - `syncPermissions(client: PrismaClient, catalogue = PERMISSIONS, opts?: SyncOptions): Promise<SyncReport>` — one `ReadCommitted` transaction holding `pg_advisory_xact_lock(LOCK_KEY)`.
  - `syncPermissionsInTx(tx: Prisma.TransactionClient, catalogue = PERMISSIONS, opts?: SyncOptions): Promise<SyncReport>` — the same body for callers that already hold a transaction (the seed, Task 08).
  - `SyncReport = { inserted: string[]; regrouped: string[]; reactivated: string[]; renamed: { from: string; to: string; grantsMoved: number; grantsDropped: number }[]; lockedRoleGrants: { roleKey: string; added: string[]; removed: string[] }[]; deprecated: string[]; deleted: string[] }`, `isEmptyReport(report)`, `summarizeSyncReport(report): AuditMetadata<'system.permissions.synced'>` (`{ inserted, reactivated, deprecated, deleted, renamed }` counters — phase 3b records them through `AuditService`; phase 1 only prints), `LOCK_KEY = 7301`.
  - CLI `tms-sync-permissions` (`dist/cli/sync-permissions.js`, script `db:sync`): stdout one line `{"event":"permissions.synced",...report}`, exit 0; exit 2 `DATABASE_URL is not set`; exit 1 `permission sync failed: <name>: <scrubbed message>`.

- [ ] **Step 1: Write the planner tests (RED)**

`packages/db/test/support/sync-model.ts` — the pure model of the database apply. `apply.ts` applies the same lists in the same order; the property tests treat this function as the specification of that order.

```ts
import type { GrantRow, PermissionRow, SyncPlan, SyncState } from '../../src/sync/plan';

/** Applies a plan to an in-memory state exactly as syncPermissionsInTx applies it to the database. */
export function applyPlanToState(state: SyncState, plan: SyncPlan): SyncState {
  const permissions = new Map<string, PermissionRow>(state.permissions.map((p) => [p.code, { ...p }]));
  for (const row of plan.inserts) permissions.set(row.code, { ...row });
  for (const { code, group } of plan.regroup) permissions.get(code)!.group = group;
  for (const code of plan.reactivate) permissions.get(code)!.isDeprecated = false;

  let grants: GrantRow[] = state.grants.map((g) => ({ ...g }));
  for (const rename of plan.renames) {
    grants = grants
      .filter((g) => g.permissionCode !== rename.from)
      .concat(rename.grantsToMove.map((g) => ({ roleId: g.roleId, permissionCode: rename.to })));
  }
  for (const locked of plan.lockedRoleGrants) {
    grants = grants
      .filter((g) => !(g.roleId === locked.roleId && locked.remove.includes(g.permissionCode)))
      .concat(locked.add.map((code) => ({ roleId: locked.roleId, permissionCode: code })));
  }

  for (const code of plan.deprecate) permissions.get(code)!.isDeprecated = true;
  for (const code of plan.delete) permissions.delete(code);

  return { permissions: [...permissions.values()], grants, roles: state.roles };
}
```

`packages/db/test/sync/plan.spec.ts`:

```ts
import type { PermissionDefinition } from '@tms/contracts';
import {
  CatalogueInvalidError,
  isEmptyPlan,
  planPermissionSync,
  type GrantRow,
  type PermissionRow,
  type RoleRow,
  type SyncPlan,
  type SyncState,
} from '../../src/sync/plan';
import { applyPlanToState } from '../support/sync-model';

const groupOf = (code: string): string => code.slice(0, code.indexOf(':'));
const def = (code: string, extra: Partial<PermissionDefinition> = {}): PermissionDefinition =>
  ({
    code,
    group: groupOf(code),
    audience: 'STAFF',
    defaultName: `${code} name`,
    defaultDescription: `${code} description`,
    ...extra,
  }) as PermissionDefinition;
const row = (code: string, extra: Partial<PermissionRow> = {}): PermissionRow => ({
  code,
  group: groupOf(code),
  name: `${code} name`,
  description: `${code} description`,
  isDeprecated: false,
  ...extra,
});
const ADMIN: RoleRow = { id: 'role-admin', key: 'admin', appliesTo: 'STAFF' };
const OPERATOR: RoleRow = { id: 'role-operator', key: 'operator', appliesTo: 'STAFF' };
const CUSTOM: RoleRow = { id: 'role-custom', key: null, appliesTo: 'STAFF' };
const grant = (role: RoleRow, code: string): GrantRow => ({ roleId: role.id, permissionCode: code });
const state = (
  permissions: PermissionRow[],
  grants: GrantRow[] = [],
  roles: RoleRow[] = [ADMIN, OPERATOR, CUSTOM],
): SyncState => ({ permissions, grants, roles });
const UNLOCKED = { lockedRoles: [] };
const LOCKED = { lockedRoles: [{ key: 'admin', appliesTo: 'STAFF' as const }] };
const EMPTY: SyncPlan = {
  inserts: [],
  regroup: [],
  reactivate: [],
  renames: [],
  lockedRoleGrants: [],
  deprecate: [],
  delete: [],
};

describe('planPermissionSync', () => {
  it('inserts catalogue codes missing from the database with their default texts', () => {
    const plan = planPermissionSync(state([row('users:read')]), [def('users:read'), def('users:create')], UNLOCKED);
    expect(plan).toEqual({ ...EMPTY, inserts: [row('users:create')] });
  });

  it('never touches an admin-edited name or description', () => {
    const edited = row('users:read', { name: 'See people', description: 'Edited in the UI' });
    expect(planPermissionSync(state([edited]), [def('users:read')], UNLOCKED)).toEqual(EMPTY);
  });

  it('regroups a code whose group changed in the catalogue', () => {
    const plan = planPermissionSync(state([row('queue:call', { group: 'orders' })]), [def('queue:call')], UNLOCKED);
    expect(plan).toEqual({ ...EMPTY, regroup: [{ code: 'queue:call', group: 'queue' }] });
  });

  it('reactivates a deprecated code that is back in the catalogue', () => {
    const plan = planPermissionSync(state([row('queue:call', { isDeprecated: true })]), [def('queue:call')], UNLOCKED);
    expect(plan).toEqual({ ...EMPTY, reactivate: ['queue:call'] });
  });

  it('moves grants from a renamed code and removes the old code', () => {
    const plan = planPermissionSync(
      state([row('queue:summon')], [grant(OPERATOR, 'queue:summon')]),
      [def('queue:call', { renamedFrom: ['queue:summon'] })],
      UNLOCKED,
    );
    expect(plan).toEqual({
      ...EMPTY,
      inserts: [row('queue:call')],
      renames: [{ from: 'queue:summon', to: 'queue:call', grantsToMove: [grant(OPERATOR, 'queue:summon')], grantsToDrop: [] }],
      delete: ['queue:summon'],
    });
  });

  it('drops the old grant when the role already holds the new code', () => {
    const plan = planPermissionSync(
      state(
        [row('queue:summon'), row('queue:call')],
        [grant(CUSTOM, 'queue:summon'), grant(CUSTOM, 'queue:call'), grant(OPERATOR, 'queue:summon')],
      ),
      [def('queue:call', { renamedFrom: ['queue:summon'] })],
      UNLOCKED,
    );
    expect(plan.renames).toEqual([
      {
        from: 'queue:summon',
        to: 'queue:call',
        grantsToMove: [grant(OPERATOR, 'queue:summon')],
        grantsToDrop: [grant(CUSTOM, 'queue:summon')],
      },
    ]);
    expect(plan.delete).toEqual(['queue:summon']);
  });

  it('resolves a chained rename a -> b -> c for databases on either old name', () => {
    const plan = planPermissionSync(
      state(
        [row('queue:page'), row('queue:summon')],
        [grant(OPERATOR, 'queue:page'), grant(CUSTOM, 'queue:summon'), grant(ADMIN, 'queue:page'), grant(ADMIN, 'queue:summon')],
      ),
      [def('queue:call', { renamedFrom: ['queue:page', 'queue:summon'] })],
      UNLOCKED,
    );
    expect(plan.renames).toEqual([
      {
        from: 'queue:page',
        to: 'queue:call',
        grantsToMove: [grant(OPERATOR, 'queue:page'), grant(ADMIN, 'queue:page')],
        grantsToDrop: [],
      },
      {
        from: 'queue:summon',
        to: 'queue:call',
        grantsToMove: [grant(CUSTOM, 'queue:summon')],
        grantsToDrop: [grant(ADMIN, 'queue:summon')],
      },
    ]);
    expect(plan.delete).toEqual(['queue:page', 'queue:summon']);
  });

  it('deprecates a referenced code and deletes an unreferenced one in the same run', () => {
    const plan = planPermissionSync(
      state([row('users:read'), row('legacy:referenced'), row('legacy:orphan')], [grant(CUSTOM, 'legacy:referenced')]),
      [def('users:read')],
      UNLOCKED,
    );
    expect(plan).toEqual({ ...EMPTY, deprecate: ['legacy:referenced'], delete: ['legacy:orphan'] });
  });

  it('does not deprecate an already deprecated referenced code again', () => {
    const plan = planPermissionSync(
      state([row('users:read'), row('legacy:referenced', { isDeprecated: true })], [grant(CUSTOM, 'legacy:referenced')]),
      [def('users:read')],
      UNLOCKED,
    );
    expect(plan).toEqual(EMPTY);
  });

  it('gives the locked Admin role every new STAFF code and takes deprecated ones away', () => {
    const plan = planPermissionSync(
      state([row('users:read'), row('legacy:old')], [grant(ADMIN, 'users:read'), grant(ADMIN, 'legacy:old')]),
      [def('users:read'), def('users:create'), def('checkin:perform', { audience: 'DRIVER' })],
      LOCKED,
    );
    expect(plan).toEqual({
      ...EMPTY,
      inserts: [row('users:create'), row('checkin:perform')],
      lockedRoleGrants: [{ roleId: ADMIN.id, add: ['users:create'], remove: ['legacy:old'] }],
      delete: ['legacy:old'],
    });
  });

  it('never grants a DRIVER-audience code to the locked STAFF admin', () => {
    const plan = planPermissionSync(
      state([row('users:read'), row('checkin:perform')], [], [ADMIN]),
      [def('users:read'), def('checkin:perform', { audience: 'DRIVER' })],
      LOCKED,
    );
    expect(plan.lockedRoleGrants).toEqual([{ roleId: ADMIN.id, add: ['users:read'], remove: [] }]);
  });

  it('leaves a locked role alone when its key is absent from the database', () => {
    expect(planPermissionSync(state([row('users:read')], [], [CUSTOM]), [def('users:read')], LOCKED)).toEqual(EMPTY);
  });

  it('throws CatalogueInvalidError before planning anything for an invalid catalogue', () => {
    const invalid = [def('users:read'), def('users:read')];
    expect(() => planPermissionSync(state([]), invalid, UNLOCKED)).toThrow(CatalogueInvalidError);
    let caught: unknown;
    try {
      planPermissionSync(state([]), invalid, UNLOCKED);
    } catch (error) {
      caught = error;
    }
    expect((caught as CatalogueInvalidError).name).toBe('CatalogueInvalidError');
    expect((caught as CatalogueInvalidError).problems.length).toBeGreaterThan(0);
  });

  it('is idempotent on a scenario exercising every rule', () => {
    const catalogue = [
      def('users:read'),
      def('users:create'),
      def('queue:call', { renamedFrom: ['queue:summon'] }),
      def('checkin:perform', { audience: 'DRIVER' }),
    ];
    const before = state(
      [
        row('users:read', { name: 'People' }),
        row('queue:summon'),
        row('legacy:kept'),
        row('legacy:orphan'),
        row('checkin:perform', { isDeprecated: true, group: 'kiosk' }),
      ],
      [
        grant(ADMIN, 'users:read'),
        grant(ADMIN, 'legacy:kept'),
        grant(OPERATOR, 'queue:summon'),
        grant(CUSTOM, 'legacy:kept'),
        grant(CUSTOM, 'queue:summon'),
      ],
    );
    const plan = planPermissionSync(before, catalogue, LOCKED);
    expect(isEmptyPlan(plan)).toBe(false);
    const after = applyPlanToState(before, plan);
    const second = planPermissionSync(after, catalogue, LOCKED);
    expect(second).toEqual(EMPTY);
    expect(isEmptyPlan(second)).toBe(true);
    expect(after.permissions.find((p) => p.code === 'users:read')?.name).toBe('People');
  });
});
```

`packages/db/test/sync/plan.property.spec.ts` (fast-check, model-based: random catalogues with rename histories against random databases with grants):

```ts
import fc from 'fast-check';
import { validateCatalogue, type PermissionDefinition } from '@tms/contracts';
import { isEmptyPlan, planPermissionSync, type GrantRow, type RoleRow, type SyncState } from '../../src/sync/plan';
import { applyPlanToState } from '../support/sync-model';

const GROUPS = ['users', 'roles', 'queue', 'checkin'] as const;
const ACTIONS = ['read', 'manage', 'call', 'remove'] as const;
const ALL_CODES = GROUPS.flatMap((g) => ACTIONS.map((a) => `${g}:${a}`));
const ROLES: readonly RoleRow[] = [
  { id: 'r-admin', key: 'admin', appliesTo: 'STAFF' },
  { id: 'r-operator', key: 'operator', appliesTo: 'STAFF' },
  { id: 'r-custom', key: null, appliesTo: 'STAFF' },
  { id: 'r-driver', key: 'driver', appliesTo: 'DRIVER' },
];
const LOCKED = {
  lockedRoles: [
    { key: 'admin', appliesTo: 'STAFF' as const },
    { key: 'driver', appliesTo: 'DRIVER' as const },
  ],
};
const groupOf = (code: string): string => code.slice(0, code.indexOf(':'));

// Live codes plus up to three retired codes, each attached to one live entry's renamedFrom.
const catalogueArb: fc.Arbitrary<PermissionDefinition[]> = fc
  .uniqueArray(fc.constantFrom(...ALL_CODES), { minLength: 1, maxLength: 6 })
  .chain((live) => {
    const spare = ALL_CODES.filter((c) => !live.includes(c));
    return fc
      .tuple(
        fc.subarray(spare, { maxLength: 3 }),
        fc.array(fc.nat({ max: live.length - 1 }), { minLength: 3, maxLength: 3 }),
      )
      .map(([retired, targets]) =>
        live.map((code, i) => {
          const renamedFrom = retired.filter((_, j) => targets[j] === i);
          return {
            code,
            group: groupOf(code),
            audience: groupOf(code) === 'checkin' ? 'DRIVER' : 'STAFF',
            defaultName: `${code} name`,
            defaultDescription: `${code} description`,
            ...(renamedFrom.length > 0 ? { renamedFrom } : {}),
          } as unknown as PermissionDefinition;
        }),
      );
  })
  .filter((catalogue) => validateCatalogue(catalogue).length === 0);

const stateArb: fc.Arbitrary<SyncState> = fc
  .uniqueArray(fc.constantFrom(...ALL_CODES), { maxLength: 8 })
  .chain((codes) =>
    fc
      .tuple(
        fc.array(fc.record({ isDeprecated: fc.boolean(), regrouped: fc.boolean(), edited: fc.boolean() }), {
          minLength: codes.length,
          maxLength: codes.length,
        }),
        fc.subarray(ROLES.flatMap((r) => codes.map((code) => ({ roleId: r.id, permissionCode: code })))),
        fc.subarray([...ROLES], { minLength: 1 }),
      )
      .map(([flags, grants, roles]) => ({
        permissions: codes.map((code, i) => ({
          code,
          group: flags[i]!.regrouped ? 'legacy' : groupOf(code),
          name: flags[i]!.edited ? `${code} (edited)` : `${code} name`,
          description: `${code} description`,
          isDeprecated: flags[i]!.isDeprecated,
        })),
        grants: grants.filter((g) => roles.some((r) => r.id === g.roleId)),
        roles,
      })),
  );

const renameTarget = (catalogue: readonly PermissionDefinition[]): Map<string, string> =>
  new Map(catalogue.flatMap((d) => (d.renamedFrom ?? []).map((from) => [from, d.code as string])));
const key = (g: GrantRow, resolve: (code: string) => string): string => `${g.roleId}|${resolve(g.permissionCode)}`;

describe('planPermissionSync properties', () => {
  it('A: planning against the applied state yields an empty plan (sync(sync(c)) == sync(c))', () => {
    fc.assert(
      fc.property(stateArb, catalogueArb, (state, catalogue) => {
        const plan = planPermissionSync(state, catalogue, LOCKED);
        const after = applyPlanToState(state, plan);
        expect(isEmptyPlan(planPermissionSync(after, catalogue, LOCKED))).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('B: every grant of a non-locked role is preserved modulo renames', () => {
    fc.assert(
      fc.property(stateArb, catalogueArb, (state, catalogue) => {
        const lockedKeys = new Set(LOCKED.lockedRoles.map((l) => l.key));
        const free = new Set(state.roles.filter((r) => r.key === null || !lockedKeys.has(r.key)).map((r) => r.id));
        const targets = renameTarget(catalogue);
        const resolve = (code: string): string => targets.get(code) ?? code;
        const plan = planPermissionSync(state, catalogue, LOCKED);
        const after = applyPlanToState(state, plan);
        const before = new Set(state.grants.filter((g) => free.has(g.roleId)).map((g) => key(g, resolve)));
        const afterKeys = new Set(after.grants.filter((g) => free.has(g.roleId)).map((g) => key(g, (c) => c)));
        expect(afterKeys).toEqual(before);
      }),
      { numRuns: 300 },
    );
  });

  it('C: a code still referenced after renames is never deleted, and no grant dangles', () => {
    fc.assert(
      fc.property(stateArb, catalogueArb, (state, catalogue) => {
        const plan = planPermissionSync(state, catalogue, LOCKED);
        const after = applyPlanToState(state, plan);
        const codes = new Set(after.permissions.map((p) => p.code));
        for (const g of after.grants) {
          expect(plan.delete).not.toContain(g.permissionCode);
          expect(codes.has(g.permissionCode)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });
});
```

Run: `pnpm install && pnpm turbo run test --filter=@tms/db`
Expected: `pnpm install` adds `fast-check` to the lockfile (after Step 3's `package.json` edit; run it now with the manifest change of Step 3 already in place or accept `Cannot find module 'fast-check'` as part of the RED). Both new suites FAIL with `Cannot find module '../../src/sync/plan'` — 14 planner tests and 3 properties not executed. Existing Task 05/06 suites unchanged.

- [ ] **Step 2: Write the planner**

`packages/db/src/sync/plan.ts` (pure, no I/O):

```ts
import {
  permissionCodesForAudience,
  validateCatalogue,
  type CatalogueProblem,
  type PermissionDefinition,
} from '@tms/contracts';

export type Audience = 'STAFF' | 'DRIVER';

export interface PermissionRow {
  code: string;
  group: string;
  name: string;
  description: string;
  isDeprecated: boolean;
}
export interface GrantRow {
  roleId: string;
  permissionCode: string;
}
export interface RoleRow {
  id: string;
  key: string | null;
  appliesTo: Audience;
}
export interface SyncState {
  permissions: readonly PermissionRow[];
  grants: readonly GrantRow[];
  roles: readonly RoleRow[];
}
export interface LockedRole {
  key: string;
  appliesTo: Audience;
}
export interface RenameStep {
  from: string;
  to: string;
  grantsToMove: GrantRow[];
  grantsToDrop: GrantRow[];
}
export interface LockedRoleStep {
  roleId: string;
  add: string[];
  remove: string[];
}
export interface SyncPlan {
  inserts: PermissionRow[];
  regroup: { code: string; group: string }[];
  reactivate: string[];
  renames: RenameStep[];
  lockedRoleGrants: LockedRoleStep[];
  deprecate: string[];
  delete: string[];
}

export class CatalogueInvalidError extends Error {
  override readonly name = 'CatalogueInvalidError';

  constructor(readonly problems: readonly CatalogueProblem[]) {
    super(`invalid permission catalogue (${problems.length} problem${problems.length === 1 ? '' : 's'}): ${JSON.stringify(problems)}`);
  }
}

/**
 * Computes the writes that bring the database in line with the catalogue. Names and
 * descriptions are written only on insert (section 9: admins own them afterwards).
 */
export function planPermissionSync(
  state: SyncState,
  catalogue: readonly PermissionDefinition[],
  opts: { lockedRoles: readonly LockedRole[] },
): SyncPlan {
  const problems = validateCatalogue(catalogue);
  if (problems.length > 0) throw new CatalogueInvalidError(problems);

  const live = new Map<string, PermissionDefinition>(catalogue.map((d) => [d.code, d]));
  const inDb = new Map<string, PermissionRow>(state.permissions.map((p) => [p.code, p]));

  // Rule 2: insert missing codes with defaults; align group and deprecation of present ones.
  const inserts: PermissionRow[] = [];
  const regroup: { code: string; group: string }[] = [];
  const reactivate: string[] = [];
  for (const d of catalogue) {
    const row = inDb.get(d.code);
    if (!row) {
      inserts.push({ code: d.code, group: d.group, name: d.defaultName, description: d.defaultDescription, isDeprecated: false });
      continue;
    }
    if (row.group !== d.group) regroup.push({ code: d.code, group: d.group });
    if (row.isDeprecated) reactivate.push(d.code);
  }

  // Rule 3: renames move grants to the new code; a role that already holds it drops the old grant.
  let grants: GrantRow[] = state.grants.map((g) => ({ ...g }));
  const renames: RenameStep[] = [];
  for (const d of catalogue) {
    for (const from of d.renamedFrom ?? []) {
      // A live code is never an old name; skipping keeps the planner idempotent on odd input.
      if (!inDb.has(from) || live.has(from)) continue;
      const holdingTarget = new Set(grants.filter((g) => g.permissionCode === d.code).map((g) => g.roleId));
      const old = grants.filter((g) => g.permissionCode === from);
      const grantsToMove = old.filter((g) => !holdingTarget.has(g.roleId));
      const grantsToDrop = old.filter((g) => holdingTarget.has(g.roleId));
      renames.push({ from, to: d.code, grantsToMove, grantsToDrop });
      grants = grants
        .filter((g) => g.permissionCode !== from)
        .concat(grantsToMove.map((g) => ({ roleId: g.roleId, permissionCode: d.code })));
    }
  }

  // Rule 4: a locked role holds exactly the active catalogue codes of its audience.
  const lockedRoleGrants: LockedRoleStep[] = [];
  for (const locked of opts.lockedRoles) {
    const role = state.roles.find((r) => r.key === locked.key);
    if (!role) continue;
    const target = new Set<string>(permissionCodesForAudience(locked.appliesTo, catalogue));
    const current = new Set(grants.filter((g) => g.roleId === role.id).map((g) => g.permissionCode));
    const add = [...target].filter((c) => !current.has(c)).sort();
    const remove = [...current].filter((c) => !target.has(c)).sort();
    if (add.length === 0 && remove.length === 0) continue;
    lockedRoleGrants.push({ roleId: role.id, add, remove });
    grants = grants
      .filter((g) => !(g.roleId === role.id && remove.includes(g.permissionCode)))
      .concat(add.map((code) => ({ roleId: role.id, permissionCode: code })));
  }

  // Rule 5: codes the catalogue no longer names stay (deprecated) while any role references them.
  const referenced = new Set(grants.map((g) => g.permissionCode));
  const deprecate: string[] = [];
  const toDelete: string[] = [];
  for (const row of state.permissions) {
    if (live.has(row.code)) continue;
    if (referenced.has(row.code)) {
      if (!row.isDeprecated) deprecate.push(row.code);
    } else {
      toDelete.push(row.code);
    }
  }
  deprecate.sort();
  toDelete.sort();

  return { inserts, regroup, reactivate, renames, lockedRoleGrants, deprecate, delete: toDelete };
}

export function isEmptyPlan(plan: SyncPlan): boolean {
  return Object.values(plan).every((list) => list.length === 0);
}
```

Run: `pnpm turbo run test --filter=@tms/db`
Expected: `plan.spec.ts` PASS (14 tests), `plan.property.spec.ts` PASS (3 properties, 300 runs each). If property A finds a counterexample, fast-check prints the shrunk `state`/`catalogue`; the fix belongs in `plan.ts` (or, if the model diverged from the intended order, in `sync-model.ts` and `apply.ts` together), never in the property.

- [ ] **Step 3: Write the database and CLI tests (RED)**

`packages/db/package.json` — add these keys (the rest of the manifest is Task 05's, including the `@tms/contracts` dependency the sync imports at runtime):

```json
{
  "bin": { "tms-sync-permissions": "dist/cli/sync-permissions.js" },
  "scripts": {
    "db:sync": "node dist/cli/sync-permissions.js"
  },
  "devDependencies": { "fast-check": "catalog:" }
}
```

The CLI specs execute the built entry points: Task 04's `"@tms/db#test"` entry in `turbo.json` lists the package's own `build` in `dependsOn`, so `dist/` is complete before Jest starts and no second `tsc` writes `dist/` in parallel with `build` (a `pretest` script would race it). Docker variables still reach the task through `globalPassThroughEnv`.

`packages/db/test/sync/apply.spec.ts`:

```ts
import { PERMISSION_CODES, PERMISSIONS, permissionCodesForAudience, type PermissionDefinition } from '@tms/contracts';
import { createPrismaClient, type PrismaClient } from '../../src/index';
import { isEmptyReport, summarizeSyncReport, syncPermissions } from '../../src/sync/apply';
import { CatalogueInvalidError } from '../../src/sync/plan';
import { makePermission, makeRole, resetTestDatabase, testDatabaseUrl } from '../../src/testing';

const FIXED = new Date('2026-09-23T10:00:00.000Z');
const ALL_CODES: string[] = [...PERMISSION_CODES].sort();
const STAFF_CODES: string[] = [...permissionCodesForAudience('STAFF')].sort();
const withRename = (from: string, to: string): PermissionDefinition[] =>
  PERMISSIONS.map((d) => (d.code === to ? ({ ...d, renamedFrom: [...(d.renamedFrom ?? []), from] } as PermissionDefinition) : d));

describe('syncPermissions (database)', () => {
  let client: PrismaClient;

  beforeAll(() => {
    client = createPrismaClient({ url: testDatabaseUrl() });
  });
  afterAll(async () => {
    await client.$disconnect();
  });
  beforeEach(async () => {
    await resetTestDatabase();
  });

  const codes = async (): Promise<string[]> =>
    (await client.permission.findMany({ select: { code: true } })).map((p) => p.code).sort();
  const grantsOf = async (roleId: string): Promise<string[]> =>
    (await client.rolePermission.findMany({ where: { roleId } })).map((g) => g.permissionCode).sort();

  it('inserts the whole catalogue into an empty database with default texts', async () => {
    const report = await syncPermissions(client, PERMISSIONS, { now: () => FIXED });
    expect([...report.inserted].sort()).toEqual(ALL_CODES);
    expect(isEmptyReport({ ...report, inserted: [] })).toBe(true);
    expect(summarizeSyncReport(report)).toEqual({
      inserted: PERMISSIONS.length,
      reactivated: 0,
      deprecated: 0,
      deleted: 0,
      renamed: 0,
    });
    const def = PERMISSIONS.find((p) => p.code === 'queue:call')!;
    expect(await client.permission.findUniqueOrThrow({ where: { code: 'queue:call' } })).toMatchObject({
      group: 'queue',
      name: def.defaultName,
      description: def.defaultDescription,
      isDeprecated: false,
      syncedAt: FIXED,
    });
  });

  it('does zero writes on a second run (syncedAt and updatedAt untouched)', async () => {
    await syncPermissions(client);
    const before = await client.permission.findMany({ orderBy: { code: 'asc' } });
    const report = await syncPermissions(client);
    expect(isEmptyReport(report)).toBe(true);
    expect(await client.permission.findMany({ orderBy: { code: 'asc' } })).toEqual(before);
  });

  it('keeps a name and description edited by an admin', async () => {
    await syncPermissions(client);
    await client.permission.update({
      where: { code: 'queue:call' },
      data: { name: 'Call the next driver', description: 'Edited in the UI' },
    });
    expect(isEmptyReport(await syncPermissions(client))).toBe(true);
    expect(await client.permission.findUniqueOrThrow({ where: { code: 'queue:call' } })).toMatchObject({
      name: 'Call the next driver',
      description: 'Edited in the UI',
    });
  });

  it('migrates grants through renamedFrom and removes the old code', async () => {
    await syncPermissions(client);
    await makePermission(client, { code: 'queue:summon', group: 'queue' });
    const operator = await makeRole(client, { key: 'operator', name: 'Operator', appliesTo: 'STAFF' });
    const custom = await makeRole(client, { name: 'Dispatcher', appliesTo: 'STAFF' });
    await client.rolePermission.createMany({
      data: [
        { roleId: operator.id, permissionCode: 'queue:summon' },
        { roleId: custom.id, permissionCode: 'queue:summon' },
        { roleId: custom.id, permissionCode: 'queue:call' },
      ],
    });
    const report = await syncPermissions(client, withRename('queue:summon', 'queue:call'));
    expect(report.renamed).toEqual([{ from: 'queue:summon', to: 'queue:call', grantsMoved: 1, grantsDropped: 1 }]);
    expect(report.deleted).toEqual(['queue:summon']);
    expect(summarizeSyncReport(report)).toEqual({ inserted: 0, reactivated: 0, deprecated: 0, deleted: 1, renamed: 1 });
    expect(await grantsOf(operator.id)).toEqual(['queue:call']);
    expect(await grantsOf(custom.id)).toEqual(['queue:call']);
    expect(await client.permission.findUnique({ where: { code: 'queue:summon' } })).toBeNull();
  });

  it('keeps a referenced retired code as deprecated and deletes an unreferenced one', async () => {
    await syncPermissions(client);
    await makePermission(client, { code: 'legacy:referenced', group: 'legacy' });
    await makePermission(client, { code: 'legacy:orphan', group: 'legacy' });
    const custom = await makeRole(client, { name: 'Dispatcher', appliesTo: 'STAFF' });
    await client.rolePermission.create({ data: { roleId: custom.id, permissionCode: 'legacy:referenced' } });
    const report = await syncPermissions(client, PERMISSIONS, { now: () => FIXED });
    expect(report.deprecated).toEqual(['legacy:referenced']);
    expect(report.deleted).toEqual(['legacy:orphan']);
    expect(await client.permission.findUniqueOrThrow({ where: { code: 'legacy:referenced' } })).toMatchObject({
      isDeprecated: true,
      syncedAt: FIXED,
    });
    expect(await client.permission.findUnique({ where: { code: 'legacy:orphan' } })).toBeNull();
    expect(isEmptyReport(await syncPermissions(client))).toBe(true);
  });

  it('makes the locked Admin role hold exactly the active STAFF codes', async () => {
    await makePermission(client, { code: 'legacy:old', group: 'legacy' });
    const admin = await makeRole(client, { key: 'admin', name: 'Admin', appliesTo: 'STAFF', isSystem: true });
    await client.rolePermission.create({ data: { roleId: admin.id, permissionCode: 'legacy:old' } });
    const report = await syncPermissions(client);
    expect(report.lockedRoleGrants).toEqual([{ roleKey: 'admin', added: STAFF_CODES, removed: ['legacy:old'] }]);
    expect(report.deleted).toEqual(['legacy:old']);
    expect(await grantsOf(admin.id)).toEqual(STAFF_CODES);
    expect(STAFF_CODES).not.toContain('checkin:perform');
  });

  it('serialises two concurrent runs through the advisory lock', async () => {
    const reports = await Promise.all([syncPermissions(client), syncPermissions(client)]);
    expect(reports.filter(isEmptyReport)).toHaveLength(1);
    expect([...reports.find((r) => !isEmptyReport(r))!.inserted].sort()).toEqual(ALL_CODES);
    expect(await codes()).toEqual(ALL_CODES);
  });

  it('writes nothing for an invalid catalogue', async () => {
    await expect(syncPermissions(client, [...PERMISSIONS, PERMISSIONS[0]!])).rejects.toBeInstanceOf(CatalogueInvalidError);
    expect(await client.permission.count()).toBe(0);
  });
});
```

`packages/db/test/cli/sync-permissions.spec.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PERMISSION_CODES } from '@tms/contracts';
import { resetTestDatabase, testDatabaseUrl } from '../../src/testing';

jest.setTimeout(120_000);

const CLI = resolve(__dirname, '../../dist/cli/sync-permissions.js');
// A cwd without a `.env`, so the CLI's guarded load cannot pick up a developer's local file.
const cwd = mkdtempSync(join(tmpdir(), 'tms-sync-cli-'));

function run(url: string | undefined) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env['DATABASE_URL'];
  if (url) env['DATABASE_URL'] = url;
  return spawnSync(process.execPath, [CLI], { cwd, env, encoding: 'utf8' });
}
const lastJsonLine = (stdout: string): Record<string, unknown> =>
  JSON.parse(stdout.trim().split('\n').at(-1)!) as Record<string, unknown>;

describe('tms-sync-permissions CLI', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('syncs on the first run and reports an empty second run', () => {
    const first = run(testDatabaseUrl());
    expect(first.stderr).toBe('');
    expect(first.status).toBe(0);
    const report = lastJsonLine(first.stdout);
    expect(report['event']).toBe('permissions.synced');
    expect([...(report['inserted'] as string[])].sort()).toEqual([...PERMISSION_CODES].sort());

    const second = run(testDatabaseUrl());
    expect(second.status).toBe(0);
    expect(lastJsonLine(second.stdout)).toEqual({
      event: 'permissions.synced',
      inserted: [],
      regrouped: [],
      reactivated: [],
      renamed: [],
      lockedRoleGrants: [],
      deprecated: [],
      deleted: [],
    });
  });

  it('exits 2 and names DATABASE_URL when it is missing', () => {
    const result = run(undefined);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('DATABASE_URL is not set');
    expect(result.stdout).toBe('');
  });

  it('exits 1 on a wrong password without echoing it', () => {
    const url = new URL(testDatabaseUrl());
    url.password = 'not-the-password-7f3a';
    const result = run(url.toString());
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^permission sync failed: \w+: /);
    expect(result.stderr).not.toContain('not-the-password-7f3a');
    expect(result.stdout).toBe('');
  });
});
```

Run: `pnpm install && pnpm turbo run test --filter=@tms/db`
Expected: `pnpm-lock.yaml` gains `fast-check`; `@tms/db#build` compiles first (turbo); `apply.spec.ts` FAILS with `Cannot find module '../../src/sync/apply'` (8 tests not run); `sync-permissions.spec.ts` FAILS in all 3 tests (`dist/cli/sync-permissions.js` does not exist, `status` is `null`/`1`); the two planner suites stay green.

- [ ] **Step 4: Write the apply function, the CLI support and the CLI entry**

`packages/db/src/sync/apply.ts`:

```ts
import { PERMISSIONS, SEEDED_ROLES, type AuditMetadata, type PermissionDefinition } from '@tms/contracts';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { planPermissionSync, type LockedRole, type RoleRow, type SyncPlan, type SyncState } from './plan';

/** Fixed advisory-lock key: every sync in every process serialises on it (predev, compose, seed). */
export const LOCK_KEY = 7301;

export interface SyncOptions {
  lockedRoles?: readonly LockedRole[];
  now?: () => Date;
}

export interface SyncReport {
  inserted: string[];
  regrouped: string[];
  reactivated: string[];
  renamed: { from: string; to: string; grantsMoved: number; grantsDropped: number }[];
  lockedRoleGrants: { roleKey: string; added: string[]; removed: string[] }[];
  deprecated: string[];
  deleted: string[];
}

const DEFAULT_LOCKED_ROLES: readonly LockedRole[] = SEEDED_ROLES.filter((r) => r.permissionsLocked).map((r) => ({
  key: r.key,
  appliesTo: r.appliesTo,
}));

export function isEmptyReport(report: SyncReport): boolean {
  return Object.values(report).every((list) => list.length === 0);
}

/** The five counters of the `system.permissions.synced` audit metadata (recorded from phase 3b on). */
export function summarizeSyncReport(report: SyncReport): AuditMetadata<'system.permissions.synced'> {
  return {
    inserted: report.inserted.length,
    reactivated: report.reactivated.length,
    deprecated: report.deprecated.length,
    deleted: report.deleted.length,
    renamed: report.renamed.length,
  };
}

/**
 * Synchronises the catalogue in one transaction. ReadCommitted, not Serializable, on purpose:
 * the advisory lock is the first statement, and under snapshot isolation the snapshot would be
 * taken before the lock is granted, so a run that waited for a concurrent run would still see the
 * old rows and try to insert them again. Under ReadCommitted every statement after the lock sees
 * the previous run's commit and plans an empty diff.
 */
export async function syncPermissions(
  client: PrismaClient,
  catalogue: readonly PermissionDefinition[] = PERMISSIONS,
  opts: SyncOptions = {},
): Promise<SyncReport> {
  return client.$transaction((tx) => syncPermissionsInTx(tx, catalogue, opts), {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 10_000,
    timeout: 60_000,
  });
}

/** The body of syncPermissions for callers that already hold a transaction (the seed). */
export async function syncPermissionsInTx(
  tx: Prisma.TransactionClient,
  catalogue: readonly PermissionDefinition[] = PERMISSIONS,
  opts: SyncOptions = {},
): Promise<SyncReport> {
  const lockedRoles = opts.lockedRoles ?? DEFAULT_LOCKED_ROLES;
  const now = opts.now ?? ((): Date => new Date());

  // Re-entrant within the session: the seed may already hold it through its own transaction.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY}::bigint)`;
  const state = await readState(tx);
  const plan = planPermissionSync(state, catalogue, { lockedRoles });
  await applyPlan(tx, plan, now());
  return toReport(plan, state.roles);
}

async function readState(tx: Prisma.TransactionClient): Promise<SyncState> {
  const permissions = await tx.permission.findMany({
    select: { code: true, group: true, name: true, description: true, isDeprecated: true },
    orderBy: { code: 'asc' },
  });
  const grants = await tx.rolePermission.findMany({ select: { roleId: true, permissionCode: true } });
  const roles = await tx.role.findMany({ select: { id: true, key: true, appliesTo: true } });
  return { permissions, grants, roles };
}

// Same order as test/support/sync-model.ts applyPlanToState; syncedAt only on rows that change.
async function applyPlan(tx: Prisma.TransactionClient, plan: SyncPlan, at: Date): Promise<void> {
  if (plan.inserts.length > 0) {
    await tx.permission.createMany({ data: plan.inserts.map((row) => ({ ...row, syncedAt: at })) });
  }
  for (const { code, group } of plan.regroup) {
    await tx.permission.update({ where: { code }, data: { group, syncedAt: at } });
  }
  if (plan.reactivate.length > 0) {
    await tx.permission.updateMany({ where: { code: { in: plan.reactivate } }, data: { isDeprecated: false, syncedAt: at } });
  }
  for (const rename of plan.renames) {
    if (rename.grantsToMove.length > 0) {
      await tx.rolePermission.createMany({
        data: rename.grantsToMove.map((g) => ({ roleId: g.roleId, permissionCode: rename.to })),
      });
    }
    await tx.rolePermission.deleteMany({ where: { permissionCode: rename.from } });
  }
  for (const locked of plan.lockedRoleGrants) {
    if (locked.remove.length > 0) {
      await tx.rolePermission.deleteMany({ where: { roleId: locked.roleId, permissionCode: { in: locked.remove } } });
    }
    if (locked.add.length > 0) {
      await tx.rolePermission.createMany({ data: locked.add.map((code) => ({ roleId: locked.roleId, permissionCode: code })) });
    }
  }
  if (plan.deprecate.length > 0) {
    await tx.permission.updateMany({ where: { code: { in: plan.deprecate } }, data: { isDeprecated: true, syncedAt: at } });
  }
  if (plan.delete.length > 0) {
    await tx.permission.deleteMany({ where: { code: { in: plan.delete } } });
  }
}

function toReport(plan: SyncPlan, roles: readonly RoleRow[]): SyncReport {
  const keyOf = new Map(roles.map((r) => [r.id, r.key ?? r.id]));
  return {
    inserted: plan.inserts.map((row) => row.code),
    regrouped: plan.regroup.map((r) => r.code),
    reactivated: [...plan.reactivate],
    renamed: plan.renames.map((r) => ({
      from: r.from,
      to: r.to,
      grantsMoved: r.grantsToMove.length,
      grantsDropped: r.grantsToDrop.length,
    })),
    lockedRoleGrants: plan.lockedRoleGrants.map((l) => ({
      roleKey: keyOf.get(l.roleId) ?? l.roleId,
      added: [...l.add],
      removed: [...l.remove],
    })),
    deprecated: [...plan.deprecate],
    deleted: [...plan.delete],
  };
}
```

`packages/db/src/sync/index.ts`:

```ts
export {
  CatalogueInvalidError,
  isEmptyPlan,
  planPermissionSync,
  type Audience,
  type GrantRow,
  type LockedRole,
  type LockedRoleStep,
  type PermissionRow,
  type RenameStep,
  type RoleRow,
  type SyncPlan,
  type SyncState,
} from './plan';
export {
  LOCK_KEY,
  isEmptyReport,
  summarizeSyncReport,
  syncPermissions,
  syncPermissionsInTx,
  type SyncOptions,
  type SyncReport,
} from './apply';
```

`packages/db/src/index.ts` — append after Task 05's exports:

```ts
export * from './sync';
```

`packages/db/src/cli/support.ts` (shared by the CLI entry points only; library code never reads `.env`):

```ts
import { existsSync } from 'node:fs';
import { scrubString } from '@tms/contracts/security';

export const EXIT_FAILURE = 1;
export const EXIT_CONFIG = 2;

/** Loads `./.env` when present. Node never overrides variables already set in the environment. */
export function loadDotEnv(): void {
  if (existsSync('.env')) process.loadEnvFile('.env');
}

export function requireDatabaseUrl(env: NodeJS.ProcessEnv, stderr: NodeJS.WritableStream): string | undefined {
  const url = env['DATABASE_URL'];
  if (!url) {
    stderr.write('DATABASE_URL is not set\n');
    return undefined;
  }
  return url;
}

/** One JSON line per event on stdout: machine-readable for CI, grep-able for humans. */
export function printEvent(event: string, payload: object): void {
  process.stdout.write(`${JSON.stringify({ event, ...payload })}\n`);
}

/** `<prefix>: <ErrorName>: <message>` with URL credentials, tokens and passwords scrubbed. */
export function describeFailure(prefix: string, error: unknown): string {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : String(error);
  return `${prefix}: ${name}: ${scrubString(message)}`;
}
```

`packages/db/src/cli/sync-permissions.ts`:

```ts
#!/usr/bin/env node
import { PERMISSIONS } from '@tms/contracts';
import { createPrismaClient } from '../index';
import { syncPermissions } from '../sync/apply';
import { describeFailure, EXIT_CONFIG, EXIT_FAILURE, loadDotEnv, printEvent, requireDatabaseUrl } from './support';

async function main(): Promise<number> {
  loadDotEnv();
  const url = requireDatabaseUrl(process.env, process.stderr);
  if (!url) return EXIT_CONFIG;

  const client = createPrismaClient({ url });
  try {
    const report = await syncPermissions(client, PERMISSIONS);
    printEvent('permissions.synced', report);
    return 0;
  } catch (error) {
    process.stderr.write(`${describeFailure('permission sync failed', error)}\n`);
    return EXIT_FAILURE;
  } finally {
    await client.$disconnect();
  }
}

void main().then((code) => {
  process.exitCode = code;
});
```

Run: `pnpm exec prettier --write packages/db/src packages/db/test && pnpm turbo run test --filter=@tms/db`
Expected: PASS — `plan.spec.ts` 14, `plan.property.spec.ts` 3, `apply.spec.ts` 8, `sync-permissions.spec.ts` 3 (28 new tests) plus Task 05/06 suites unchanged. The concurrency test must not print a Prisma `P2002` (unique violation) or a transaction timeout: either would mean the lock or the isolation level is wrong.

Run: `pnpm turbo run lint --filter=@tms/db && pnpm turbo run typecheck --filter=@tms/db && pnpm turbo run build --filter=@tms/db && ls packages/db/dist/cli`
Expected: exit 0 for all three; the listing shows `support.js`, `sync-permissions.js` (plus `.d.ts`/`.map` files). No `[boundaries]` warning: `db` importing `contracts` is allowed by the dependency rule.

- [ ] **Step 5: Run the CLI against a throwaway Postgres**

```bash
docker network create tms-p1-net 2>/dev/null; docker rm -f tms-p1-pg 2>/dev/null
docker run -d --name tms-p1-pg --network tms-p1-net -p 55432:5432 -e POSTGRES_USER=tms -e POSTGRES_PASSWORD=tms -e POSTGRES_DB=tms postgres:18-alpine
sleep 5
mkdir -p .cache; export DATABASE_URL=postgresql://tms:tms@localhost:55432/tms
pnpm turbo run db:migrate:deploy --filter=@tms/db
node packages/db/dist/cli/sync-permissions.js | tail -n 1
node packages/db/dist/cli/sync-permissions.js | tail -n 1
DATABASE_URL=postgresql://tms:not-the-password@localhost:55432/tms node packages/db/dist/cli/sync-permissions.js >.cache/sync-stdout.txt 2>.cache/sync-stderr.txt; echo exit=$?
grep -c not-the-password .cache/sync-stderr.txt; wc -c < .cache/sync-stdout.txt; cat .cache/sync-stderr.txt
rm -f .cache/sync-stdout.txt .cache/sync-stderr.txt; unset DATABASE_URL
```

(The CLI is run with `node` directly — the `db:sync` script is exactly this command, and there is no turbo task for it; the repository root has no `.env`, so only the exported variable counts.)

Expected: `migrate deploy` applies the Task 05/06 migrations. First sync prints one line `{"event":"permissions.synced","inserted":["users:read", … every catalogue code …],"regrouped":[],"reactivated":[],"renamed":[],"lockedRoleGrants":[],"deprecated":[],"deleted":[]}` (`lockedRoleGrants` is empty because no role exists yet). Second sync prints `{"event":"permissions.synced","inserted":[],"regrouped":[],"reactivated":[],"renamed":[],"lockedRoleGrants":[],"deprecated":[],"deleted":[]}`. The wrong-password run: `exit=1`, `grep -c` prints `0`, stdout is `0` bytes, stderr is one line starting `permission sync failed: PrismaClientInitializationError:` (Prisma's authentication message names the user, never the password). Leave `tms-p1-pg` running for Task 08.

- [ ] **Step 6: Write ADR 0004 and the architecture paragraph**

`docs/adr/0004-permission-catalogue-and-sync.md`:

```markdown
# ADR-0004: Permission catalogue in code, synchronised by a pure planner

- Status: accepted
- Date: 2026-09-23
- Spec reference: section 9 (RBAC), section 6 (structure), D12 (who runs migrations)

## Context

Permission codes are referenced by `@RequirePermissions(...)` in controllers, so they must exist at
compile time and be reviewed in pull requests. Administrators still own the display name and
description of every permission and the grants of every role (section 9). Codes get renamed and
retired over time; a retired code must not break a role that still references it, and the sync must
run in every environment before the apps start (D12: the compose `migrate` one-shot, `predev`, the
seed) — never inside a Nest process. Section 6 places a `PermissionSyncService` in `domain/admin`,
which would pull Nest and the domain layer into the migrate image.

## Decision

- The catalogue lives in `@tms/contracts` (`PERMISSIONS`: `code`, `group`, `audience`,
  `defaultName`, `defaultDescription`, `renamedFrom?`); `validateCatalogue` guards its invariants.
- The sync lives in `@tms/db` as a pure planner plus an applier plus a CLI (plan deviation 1):
  `planPermissionSync(state, catalogue)` returns a `SyncPlan`; `syncPermissionsInTx` applies it in
  one `ReadCommitted` transaction under `pg_advisory_xact_lock(7301)`; `tms-sync-permissions` prints
  the `SyncReport` as one JSON line.
- Insert-only texts: `name` and `description` are written when a code first appears and never again.
- `renamedFrom` moves `RolePermission` rows to the new code (dropping a grant the role already holds),
  after which the old code is unreferenced and deleted in the same run.
- A code missing from the catalogue is deprecated while any role references it and deleted otherwise.
- Roles with `permissionsLocked` in `SEEDED_ROLES` (Admin) are matched by `Role.key`, not by name,
  and always hold exactly the active codes of their `audience`.
- Consumers: the `migrate` one-shot, `predev` (`db:setup`) and the seed. The applications never sync.

## Alternatives considered

- Sync at application startup: rejected by D12 — two processes would race on the same rows, a failed
  sync would surface as an app crash loop instead of a failed step, and the kiosk API would carry
  back-office write logic.
- A Nest `PermissionSyncService` in `domain/admin` executed by a Nest CLI inside the migrate image:
  rejected — the image would need `@nestjs/*` and `@tms/domain`, roughly tripling its size, and the
  seed (which runs before any module exists) could not call it.
- Permissions as database-only rows created and deleted in the UI: rejected by section 9 — a code the
  code base does not know cannot protect a route, and a deleted code would silently open one.

## Consequences

- Adding a permission is a catalogue entry in a pull request; renaming one adds the old code to
  `renamedFrom`, which stays until every deployment has passed the rename.
- Phase 3b's `domain/admin` edits names and descriptions through Prisma and reuses `SyncReport` for
  the "deprecated" flag; it never writes codes.
- Renaming the Admin role in the UI is safe because locking is keyed by `Role.key`.
- Two concurrent runs (for example `predev` and the compose one-shot on the same database) serialise
  on the advisory lock; the second plans an empty diff.
- Property tests (`fast-check`) pin `sync(sync(c)) == sync(c)` and grant preservation modulo renames
  for random catalogue diffs (section 13).
```

`docs/adr/README.md:6-8` — replace the Accepted/Planned paragraph (phase 0 wording: "Accepted: 0001 … 0002 … 0007 … Planned: 0003 …, 0004 permission catalogue and sync, 0005 …, 0006 …") with:

```markdown
Accepted: 0001 two Nest processes with shared packages, 0002 Prisma as the ORM, 0004 permission
catalogue and sync, 0007 client name kept out of the repository by convention. Planned: 0003
origin/CSRF/sessions, 0005 kiosk device key model, 0006 transactions and events.
```

`docs/architecture.md` — insert directly under the heading `## RBAC and permission sync — phase 3a/3b` (after Tasks 02–06 it sits right below Task 06's data-model section):

````markdown
### Permission sync (phase 1)

The catalogue (`PERMISSIONS` in `@tms/contracts`) owns the codes; the database owns the
admin-edited name/description and the role grants. `planPermissionSync` (pure) turns the current
rows and the catalogue into a `SyncPlan`; `syncPermissionsInTx` applies it in one transaction under
advisory lock 7301 and returns a `SyncReport`, which the CLI, the seed and the `migrate` one-shot print
as one JSON line. Rules: insert-only texts, `renamedFrom` moves grants and removes the old code, a
retired code is deprecated while referenced and deleted otherwise, and roles locked in
`SEEDED_ROLES` (matched by `Role.key`) hold exactly the active codes of their audience (ADR-0004).

```mermaid
flowchart LR
  cat[PERMISSIONS catalogue] --> plan[planPermissionSync]
  rows[(Permission / RolePermission)] --> plan
  plan -->|SyncPlan| apply[syncPermissionsInTx<br/>advisory lock 7301]
  apply --> rows
  apply -->|SyncReport| out[JSON line on stdout]
  migrate[migrate one-shot] -.-> apply
  predev[predev / db:setup] -.-> apply
  seed[seedDatabase] -.-> apply
```
````

Run: `pnpm exec prettier --write docs/adr/0004-permission-catalogue-and-sync.md docs/adr/README.md docs/architecture.md && pnpm format:check`
Expected: exit 0.

- [ ] **Step 7: Verify the whole repository and commit**

Run: `pnpm verify`
Expected: all turbo tasks green (lint, typecheck, test, build for every package), `prettier --check` clean, `hygiene: ok (<n> tracked files, single copies ok)`, gitleaks `no leaks found`.

Append the journal row to `docs/efficiency/critical-path.md` (start/end from the session clock; rework `none` or what was reworked):

```
| 2026-09-23 | Task 07: Permission catalogue sync | subagent | HH:MM | HH:MM | none | n/a | Planner 14 table tests + 3 fast-check properties (300 runs), 8 database cases incl. two concurrent runs, CLI twice + wrong password (0 hits of the password in stderr). ReadCommitted + advisory lock 7301 chosen over Serializable (snapshot before lock grant). `@tms/db#test` depends on the package's own `build` (turbo.json), so the CLI specs run against a complete dist and nothing writes dist twice in parallel. |
```

```bash
git add packages/db turbo.json pnpm-lock.yaml pnpm-workspace.yaml docs/adr/0004-permission-catalogue-and-sync.md docs/adr/README.md docs/architecture.md docs/efficiency/critical-path.md
git commit -m "feat(db): add the permission catalogue sync and its CLI"
```
Expected: this commit passes all hooks (header 55 characters). (`turbo.json` and `pnpm-workspace.yaml` are listed in case `pnpm install` touched `minimumReleaseAgeExclude`; `git add` of an unchanged file is a no-op.)

**PR body notes:**
- Diagram: Mermaid `flowchart LR` — catalogue and current rows → `planPermissionSync` → `SyncPlan` → `syncPermissionsInTx` (advisory lock 7301) → rows + `SyncReport`; dotted consumers `migrate`, `predev`, `seedDatabase`.
- Boundaries: `@tms/db` public API (`planPermissionSync`, `syncPermissions`, `syncPermissionsInTx`, `SyncReport`, `summarizeSyncReport`, `CatalogueInvalidError`, `LOCK_KEY`) and the `tms-sync-permissions` CLI; `db` uses its runtime dependency on `contracts` (Task 05) for `PERMISSIONS`. Migration: no.
- Verification plan: `pnpm verify`; planner and property suites RED then GREEN; database and CLI suites RED then GREEN; the manual CLI run twice plus the wrong password against `tms-p1-pg`; CI `verify`.
- Verification results (`scenario | layer | outcome`): planner tables | unit | 14 passed; idempotence, grant preservation, no dangling grants | property (fast-check, 300 runs each) | 3 passed; empty DB / second run zero writes / edited name / rename / deprecate vs delete / locked admin / two concurrent runs / invalid catalogue | database (Testcontainers) | 8 passed; CLI first run, empty second run, missing `DATABASE_URL`, wrong password not echoed | CLI (spawn) | 3 passed; manual CLI twice against `tms-p1-pg` + wrong password | manual | first report N inserted, second empty, exit=1 and 0 hits; `pnpm verify` | repo | green.
- Risks and notes: deviation 1 (pure function in `db`, ADR-0004); `renamedFrom` history must stay in the catalogue until every deployment has crossed the rename; a code both live and listed in some `renamedFrom` is skipped by the planner (the validator rejects it upstream); `@tms/db#test` depends on `@tms/db#build` (turbo `pkg#task` overrides replace the base task, so the entry restates `dependsOn`/`outputs`).

---

---

### Task 08: Idempotent seed and the D12 `predev` flow

**Branch:** `phase-1/08-seed-predev`
**PR title:** `feat(db): add the idempotent seed and make predev deploy, check drift, sync and seed`

Spec section 9 (seeded roles Admin/Operator/Driver), section 8 step 1 (bootstrap admin INVITED by the seed — phase 1 creates it without token, URL or email: deviation 4), section 7 (Products and LoadingPoints are seed-only master data), D12 with deviation 6 (`predev` = build → `migrate deploy` → drift check → sync → seed, one CLI so the hint is printable), section 13 and Review Focus item 3 (seed re-runs after admin edits, ACTIVE/BLOCKED admin, changed or missing email, two concurrent seeds).

**Files:**
- Create: `packages/db/src/seed/data.ts`, `packages/db/src/seed/seed.ts`, `packages/db/src/seed/index.ts`, `packages/db/src/cli/seed.ts`, `packages/db/src/cli/dev-setup.ts`
- Modify: `packages/db/src/cli/support.ts` (append `DRIFT_HINT`, `readBootstrapAdmin`), `packages/db/src/index.ts` (append one line), `packages/db/package.json` (`bin.tms-seed`, scripts `db:seed`, `db:setup`), `packages/db/prisma.config.ts:9` (`migrations` line), `packages/db/.env.example` (whole file), `turbo.json` (task `db:setup` after `dev`), `package.json:10` (root `predev`), `README.md:21-27` and `:59` (line numbers before this task's edits; 18–24 and 56 on `main`, Task 04's prerequisite bullet adds three lines above them), `CLAUDE.md:27-28`, `docs/architecture.md` (the `Migrations` row of the Environments table)
- Test: `packages/db/test/seed/seed.spec.ts`, `packages/db/test/cli/seed.spec.ts`, `packages/db/test/cli/dev-setup.spec.ts`

**Interfaces:**
- Consumes: `syncPermissionsInTx`, `SyncReport`, `isEmptyReport`, `LOCK_KEY` and the CLI support helpers (Task 07); `SEEDED_ROLES`, `SeededRoleKey`, `ADMIN_ROLE_KEY`, `PERMISSIONS`, `permissionCodesForAudience`, `resolveRolePermissions(role, catalogue = PERMISSIONS)` (expands `ALL_FOR_AUDIENCE`), `EmailSchema`, `AuditMetadata` from `@tms/contracts` (Task 03); `createPrismaClient`, `Prisma`, `PrismaClient` (Task 05); harness (Task 04); Prisma CLI `prisma/build/index.js` (explicit package export, verified for 7.10.0).
- Produces (exported from `@tms/db`):
  - `seedDatabase(client: PrismaClient, options: SeedOptions): Promise<SeedReport>` with `SeedOptions = { bootstrapAdmin: { email: string | undefined; username?: string }; now?: () => Date }` — one `ReadCommitted` transaction under `pg_advisory_xact_lock(SEED_LOCK_KEY)`; create-only for roles, products, loading points and the bootstrap admin; the permission sync runs inside it first.
  - `SeedReport = { sync: SyncReport; rolesCreated: SeededRoleKey[]; productsCreated: string[]; loadingPointsCreated: string[]; bootstrapAdmin: 'created' | 'exists'; warnings: string[] }`.
  - `summarizeSeedReport(report): AuditMetadata<'system.seed.applied'>` = `{ created, unchanged }` over the 17 seeded entities (3 roles + 5 products + 8 loading points + 1 admin); phase 3b records it through `AuditService`, phase 1 only prints the report.
  - `SeedConfigError` (message `BOOTSTRAP_ADMIN_EMAIL is required while no admin exists`), `SEED_LOCK_KEY = 7302`, `SEED_PRODUCTS`, `SEED_LOADING_POINTS`.
  - CLIs: `tms-seed` (`dist/cli/seed.js`; `prisma db seed` runs it through `migrations.seed`) prints `{"event":"seed.applied",...report}`; `dist/cli/dev-setup.js` (`db:setup`) runs `migrate deploy` → `migrate diff --exit-code` → sync → seed and prints `permissions.synced` then `seed.applied`. Exit codes: 0 ok; 2 configuration (`DATABASE_URL is not set`, `BOOTSTRAP_ADMIN_EMAIL is not a valid email address`, `SeedConfigError`, drift with the hint); 1 any other failure.
  - turbo task `db:setup` (`db:migrate:dev`, named in the drift hint, exists since Task 02); root `predev: turbo run db:setup --filter=@tms/db`; env `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_USERNAME` (default `admin`).

- [ ] **Step 1: Write the seed tests (RED)**

`packages/db/test/seed/seed.spec.ts`:

```ts
import { PERMISSIONS, permissionCodesForAudience } from '@tms/contracts';
import { createPrismaClient, type PrismaClient } from '../../src/index';
import { SEED_LOADING_POINTS, SEED_PRODUCTS } from '../../src/seed/data';
import { SeedConfigError, seedDatabase, summarizeSeedReport } from '../../src/seed/seed';
import { isEmptyReport } from '../../src/sync/apply';
import { resetTestDatabase, testDatabaseUrl } from '../../src/testing';

// Section 9: orders:*, queue:*, and read access to the master data and the audit log.
const OPERATOR_CODES = [
  'audit:read',
  'cards:read',
  'carriers:read',
  'drivers:read',
  'loading-points:read',
  'orders:manage',
  'orders:read',
  'products:read',
  'queue:assign-point',
  'queue:call',
  'queue:complete',
  'queue:manual-checkin',
  'queue:read',
  'queue:remove',
  'vehicles:read',
];

describe('seedDatabase', () => {
  let client: PrismaClient;

  beforeAll(() => {
    client = createPrismaClient({ url: testDatabaseUrl() });
  });
  afterAll(async () => {
    await client.$disconnect();
  });
  beforeEach(async () => {
    await resetTestDatabase();
  });

  const seed = (email: string | undefined = 'admin@example.com') => seedDatabase(client, { bootstrapAdmin: { email } });
  const roleByKey = (key: string) => client.role.findUniqueOrThrow({ where: { key } });
  const grantsOf = async (roleId: string): Promise<string[]> =>
    (await client.rolePermission.findMany({ where: { roleId } })).map((g) => g.permissionCode).sort();
  const snapshot = async () => ({
    roles: await client.role.findMany({ orderBy: { key: 'asc' } }),
    permissions: await client.permission.findMany({ orderBy: { code: 'asc' } }),
    grants: await client.rolePermission.findMany({ orderBy: [{ roleId: 'asc' }, { permissionCode: 'asc' }] }),
    products: await client.product.findMany({ orderBy: { code: 'asc' } }),
    loadingPoints: await client.loadingPoint.findMany({ orderBy: { code: 'asc' } }),
    users: await client.user.findMany({ orderBy: { username: 'asc' } }),
  });

  it('creates roles, permissions, master data and the INVITED bootstrap admin on an empty database', async () => {
    const report = await seed();
    expect([...report.rolesCreated].sort()).toEqual(['admin', 'driver', 'operator']);
    expect(report.productsCreated).toEqual(SEED_PRODUCTS.map((p) => p.code));
    expect(report.loadingPointsCreated).toEqual(SEED_LOADING_POINTS.map((p) => p.code));
    expect(report.bootstrapAdmin).toBe('created');
    expect(report.warnings).toEqual([]);
    expect(report.sync.inserted).toHaveLength(PERMISSIONS.length);
    expect(summarizeSeedReport(report)).toEqual({ created: 17, unchanged: 0 });

    expect(await client.role.count()).toBe(3);
    expect(await client.permission.count()).toBe(PERMISSIONS.length);
    expect(await client.product.count()).toBe(5);
    expect(await client.loadingPoint.count()).toBe(8);
    expect(await client.loadingPoint.findMany({ where: { kind: 'RAIL_TRACK' }, select: { code: true } })).toEqual([
      { code: 'TRACK-01' },
      { code: 'TRACK-02' },
    ]);
    const admin = await roleByKey('admin');
    expect(await client.user.findMany()).toMatchObject([
      {
        kind: 'STAFF',
        username: 'admin',
        firstName: 'Bootstrap',
        lastName: 'Admin',
        email: 'admin@example.com',
        status: 'INVITED',
        roleId: admin.id,
        locale: 'en',
      },
    ]);
  });

  it('grants Admin every STAFF code, Operator the 15 operational codes and Driver checkin:perform', async () => {
    await seed();
    const [admin, operator, driver] = await Promise.all([roleByKey('admin'), roleByKey('operator'), roleByKey('driver')]);
    expect(admin).toMatchObject({ isSystem: true, appliesTo: 'STAFF' });
    expect(driver).toMatchObject({ isSystem: true, appliesTo: 'DRIVER' });
    expect(await grantsOf(admin.id)).toEqual([...permissionCodesForAudience('STAFF')].sort());
    expect(await grantsOf(operator.id)).toEqual(OPERATOR_CODES);
    expect(await grantsOf(driver.id)).toEqual(['checkin:perform']);
  });

  it('changes nothing on a second run', async () => {
    await seed();
    const before = await snapshot();
    const report = await seed();
    expect(isEmptyReport(report.sync)).toBe(true);
    expect(report).toMatchObject({
      rolesCreated: [],
      productsCreated: [],
      loadingPointsCreated: [],
      bootstrapAdmin: 'exists',
      warnings: [],
    });
    expect(summarizeSeedReport(report)).toEqual({ created: 0, unchanged: 17 });
    expect(await snapshot()).toEqual(before);
  });

  it('keeps an Operator role that an admin renamed and trimmed', async () => {
    await seed();
    const operator = await roleByKey('operator');
    await client.role.update({ where: { id: operator.id }, data: { name: 'Dispatch', description: 'Renamed in the UI' } });
    await client.rolePermission.delete({
      where: { roleId_permissionCode: { roleId: operator.id, permissionCode: 'audit:read' } },
    });
    const report = await seed();
    expect(report.rolesCreated).toEqual([]);
    expect(await client.role.findUniqueOrThrow({ where: { id: operator.id } })).toMatchObject({
      name: 'Dispatch',
      description: 'Renamed in the UI',
    });
    expect(await grantsOf(operator.id)).toEqual(OPERATOR_CODES.filter((c) => c !== 'audit:read'));
  });

  it.each(['ACTIVE', 'BLOCKED'] as const)('creates no second admin once the bootstrap admin is %s', async (status) => {
    await seed();
    await client.user.updateMany({ data: { status } });
    const report = await seed();
    expect(report.bootstrapAdmin).toBe('exists');
    expect(report.warnings).toEqual([]);
    expect(await client.user.count()).toBe(1);
  });

  it('warns when BOOTSTRAP_ADMIN_EMAIL matches no existing admin and still creates nobody', async () => {
    await seed();
    const report = await seed('someone-else@example.com');
    expect(report.bootstrapAdmin).toBe('exists');
    expect(report.warnings).toEqual([
      'BOOTSTRAP_ADMIN_EMAIL (someone-else@example.com) matches no existing admin account; the seed never modifies existing users',
    ]);
    expect(await client.user.count()).toBe(1);
    expect((await client.user.findFirstOrThrow()).email).toBe('admin@example.com');
  });

  it('rejects a missing BOOTSTRAP_ADMIN_EMAIL on an empty database and writes nothing', async () => {
    await expect(seed(undefined)).rejects.toThrow(new SeedConfigError('BOOTSTRAP_ADMIN_EMAIL is required while no admin exists'));
    await expect(seed(undefined)).rejects.toBeInstanceOf(SeedConfigError);
    expect(await client.role.count()).toBe(0);
    expect(await client.permission.count()).toBe(0);
    expect(await client.product.count()).toBe(0);
    expect(await client.loadingPoint.count()).toBe(0);
    expect(await client.user.count()).toBe(0);
  });

  it('creates exactly one admin when two seeds run concurrently', async () => {
    const reports = await Promise.all([seed(), seed()]);
    expect(reports.map((r) => r.bootstrapAdmin).sort()).toEqual(['created', 'exists']);
    expect(await client.user.count()).toBe(1);
    expect(await client.role.count()).toBe(3);
    expect(await client.product.count()).toBe(5);
  });
});
```

Run: `pnpm turbo run test --filter=@tms/db`
Expected: `seed.spec.ts` FAILS with `Cannot find module '../../src/seed/data'` (9 tests not run: 8 `it` + the two-case `it.each`); Task 07 suites stay green.

- [ ] **Step 2: Write the seed**

`packages/db/src/seed/data.ts` (generic master data, derived from nothing in `docs/client/`):

```ts
export const SEED_PRODUCTS: readonly { code: string; name: string }[] = [
  { code: 'DIESEL', name: 'Diesel' },
  { code: 'GASOLINE_95', name: 'Gasoline 95' },
  { code: 'GASOLINE_98', name: 'Gasoline 98' },
  { code: 'JET_A1', name: 'Jet A-1' },
  { code: 'HEATING_OIL', name: 'Heating oil' },
];

export type SeedLoadingPointKind = 'TRUCK_ISLAND' | 'RAIL_TRACK';

export const SEED_LOADING_POINTS: readonly { code: string; name: string; kind: SeedLoadingPointKind }[] = [
  { code: 'ISLAND-01', name: 'Island 1', kind: 'TRUCK_ISLAND' },
  { code: 'ISLAND-02', name: 'Island 2', kind: 'TRUCK_ISLAND' },
  { code: 'ISLAND-03', name: 'Island 3', kind: 'TRUCK_ISLAND' },
  { code: 'ISLAND-04', name: 'Island 4', kind: 'TRUCK_ISLAND' },
  { code: 'ISLAND-05', name: 'Island 5', kind: 'TRUCK_ISLAND' },
  { code: 'ISLAND-06', name: 'Island 6', kind: 'TRUCK_ISLAND' },
  { code: 'TRACK-01', name: 'Rail track 1', kind: 'RAIL_TRACK' },
  { code: 'TRACK-02', name: 'Rail track 2', kind: 'RAIL_TRACK' },
];
```

`packages/db/src/seed/seed.ts`:

```ts
import {
  ADMIN_ROLE_KEY,
  PERMISSIONS,
  resolveRolePermissions,
  SEEDED_ROLES,
  type AuditMetadata,
  type SeededRoleKey,
} from '@tms/contracts';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { syncPermissionsInTx, type SyncReport } from '../sync/apply';
import { SEED_LOADING_POINTS, SEED_PRODUCTS } from './data';

/** Serialises predev and the compose one-shot on one database; the inner sync adds LOCK_KEY. */
export const SEED_LOCK_KEY = 7302;

export interface SeedOptions {
  bootstrapAdmin: { email: string | undefined; username?: string };
  now?: () => Date;
}

export interface SeedReport {
  sync: SyncReport;
  rolesCreated: SeededRoleKey[];
  productsCreated: string[];
  loadingPointsCreated: string[];
  bootstrapAdmin: 'created' | 'exists';
  warnings: string[];
}

export class SeedConfigError extends Error {
  override readonly name = 'SeedConfigError';
}

/** Roles, products, loading points and the one bootstrap admin the seed is responsible for. */
export const SEEDED_ENTITY_COUNT = SEEDED_ROLES.length + SEED_PRODUCTS.length + SEED_LOADING_POINTS.length + 1;

/** The `system.seed.applied` audit metadata (recorded from phase 3b on). */
export function summarizeSeedReport(report: SeedReport): AuditMetadata<'system.seed.applied'> {
  const created =
    report.rolesCreated.length +
    report.productsCreated.length +
    report.loadingPointsCreated.length +
    (report.bootstrapAdmin === 'created' ? 1 : 0);
  return { created, unchanged: SEEDED_ENTITY_COUNT - created };
}

/**
 * Create-only and idempotent: rows that exist are never renamed, re-granted or re-activated
 * (admins own them, section 9); only the permission sync keeps locked roles exact.
 */
export async function seedDatabase(client: PrismaClient, options: SeedOptions): Promise<SeedReport> {
  return client.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SEED_LOCK_KEY}::bigint)`;
      const sync = await syncPermissionsInTx(tx, PERMISSIONS, options.now ? { now: options.now } : {});
      const rolesCreated = await seedRoles(tx);
      const productsCreated = await seedProducts(tx);
      const loadingPointsCreated = await seedLoadingPoints(tx);
      const admin = await seedBootstrapAdmin(tx, options.bootstrapAdmin);
      return { sync, rolesCreated, productsCreated, loadingPointsCreated, ...admin };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10_000, timeout: 60_000 },
  );
}

async function seedRoles(tx: Prisma.TransactionClient): Promise<SeededRoleKey[]> {
  const created: SeededRoleKey[] = [];
  for (const role of SEEDED_ROLES) {
    const existing = await tx.role.findUnique({ where: { key: role.key }, select: { id: true } });
    if (existing) continue;
    const row = await tx.role.create({
      data: {
        key: role.key,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        appliesTo: role.appliesTo,
      },
    });
    const codes = resolveRolePermissions(role, PERMISSIONS);
    if (codes.length > 0) {
      await tx.rolePermission.createMany({ data: codes.map((permissionCode) => ({ roleId: row.id, permissionCode })) });
    }
    created.push(role.key);
  }
  return created;
}

async function seedProducts(tx: Prisma.TransactionClient): Promise<string[]> {
  const existing = new Set((await tx.product.findMany({ select: { code: true } })).map((p) => p.code));
  const missing = SEED_PRODUCTS.filter((p) => !existing.has(p.code));
  if (missing.length > 0) {
    await tx.product.createMany({ data: missing.map((p) => ({ code: p.code, name: p.name, isActive: true })) });
  }
  return missing.map((p) => p.code);
}

async function seedLoadingPoints(tx: Prisma.TransactionClient): Promise<string[]> {
  const existing = new Set((await tx.loadingPoint.findMany({ select: { code: true } })).map((p) => p.code));
  const missing = SEED_LOADING_POINTS.filter((p) => !existing.has(p.code));
  if (missing.length > 0) {
    await tx.loadingPoint.createMany({
      data: missing.map((p) => ({ code: p.code, name: p.name, kind: p.kind, isActive: true })),
    });
  }
  return missing.map((p) => p.code);
}

async function seedBootstrapAdmin(
  tx: Prisma.TransactionClient,
  { email, username }: SeedOptions['bootstrapAdmin'],
): Promise<{ bootstrapAdmin: 'created' | 'exists'; warnings: string[] }> {
  const adminRole = await tx.role.findUniqueOrThrow({ where: { key: ADMIN_ROLE_KEY }, select: { id: true } });
  const admins = await tx.user.findMany({ where: { roleId: adminRole.id }, select: { email: true } });
  if (admins.length > 0) {
    const warnings =
      email && !admins.some((a) => a.email === email)
        ? [`BOOTSTRAP_ADMIN_EMAIL (${email}) matches no existing admin account; the seed never modifies existing users`]
        : [];
    return { bootstrapAdmin: 'exists', warnings };
  }
  if (!email) throw new SeedConfigError('BOOTSTRAP_ADMIN_EMAIL is required while no admin exists');
  // INVITED without a token, URL or email: phase 2 adds them with auth-core (plan deviation 4).
  await tx.user.create({
    data: {
      kind: 'STAFF',
      username: username ?? 'admin',
      firstName: 'Bootstrap',
      lastName: 'Admin',
      email,
      status: 'INVITED',
      roleId: adminRole.id,
      locale: 'en',
    },
  });
  return { bootstrapAdmin: 'created', warnings: [] };
}
```

`packages/db/src/seed/index.ts`:

```ts
export { SEED_LOADING_POINTS, SEED_PRODUCTS, type SeedLoadingPointKind } from './data';
export {
  SEED_LOCK_KEY,
  SEEDED_ENTITY_COUNT,
  SeedConfigError,
  seedDatabase,
  summarizeSeedReport,
  type SeedOptions,
  type SeedReport,
} from './seed';
```

`packages/db/src/index.ts` — append:

```ts
export * from './seed';
```

Run: `pnpm exec prettier --write packages/db/src/seed packages/db/test/seed && pnpm turbo run test --filter=@tms/db`
Expected: `seed.spec.ts` PASS, 9 tests. The concurrent test must show one `created` and one `exists` — two `created` would mean the advisory lock is not taken before the admin lookup; a `P2002` on `Role.key` would mean the same for roles.

- [ ] **Step 3: Write the CLI tests (RED)**

`packages/db/test/cli/seed.spec.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createPrismaClient, type PrismaClient } from '../../src/index';
import { resetTestDatabase, testDatabaseUrl } from '../../src/testing';

jest.setTimeout(120_000);

const CLI = resolve(__dirname, '../../dist/cli/seed.js');
const cwd = mkdtempSync(join(tmpdir(), 'tms-seed-cli-'));

function run(extra: Record<string, string | undefined>) {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: testDatabaseUrl() };
  delete env['BOOTSTRAP_ADMIN_EMAIL'];
  delete env['BOOTSTRAP_ADMIN_USERNAME'];
  for (const [name, value] of Object.entries(extra)) {
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
  return spawnSync(process.execPath, [CLI], { cwd, env, encoding: 'utf8' });
}
const lastJsonLine = (stdout: string): Record<string, unknown> =>
  JSON.parse(stdout.trim().split('\n').at(-1)!) as Record<string, unknown>;

describe('tms-seed CLI', () => {
  let client: PrismaClient;

  beforeAll(() => {
    client = createPrismaClient({ url: testDatabaseUrl() });
  });
  afterAll(async () => {
    await client.$disconnect();
  });
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('exits 2 when no admin exists and BOOTSTRAP_ADMIN_EMAIL is missing, writing nothing', async () => {
    const result = run({});
    expect(result.status).toBe(2);
    expect(result.stderr).toBe('seed failed: SeedConfigError: BOOTSTRAP_ADMIN_EMAIL is required while no admin exists\n');
    expect(result.stdout).toBe('');
    expect(await client.role.count()).toBe(0);
  });

  it('exits 2 on an invalid BOOTSTRAP_ADMIN_EMAIL before touching the database', async () => {
    const result = run({ BOOTSTRAP_ADMIN_EMAIL: 'not-an-email' });
    expect(result.status).toBe(2);
    expect(result.stderr).toBe('BOOTSTRAP_ADMIN_EMAIL is not a valid email address\n');
    expect(await client.permission.count()).toBe(0);
  });

  it('seeds with a normalised email and username and prints seed.applied', async () => {
    const result = run({ BOOTSTRAP_ADMIN_EMAIL: '  Admin@Example.com ', BOOTSTRAP_ADMIN_USERNAME: 'root' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(lastJsonLine(result.stdout)).toMatchObject({ event: 'seed.applied', bootstrapAdmin: 'created', warnings: [] });
    expect(await client.user.findMany()).toMatchObject([{ username: 'root', email: 'admin@example.com', status: 'INVITED' }]);
  });
});
```

`packages/db/test/cli/dev-setup.spec.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DRIFT_HINT } from '../../src/cli/support';
import { createPrismaClient, type PrismaClient } from '../../src/index';
import { resetTestDatabase, testDatabaseUrl } from '../../src/testing';

jest.setTimeout(180_000);

const CLI = resolve(__dirname, '../../dist/cli/dev-setup.js');
// A cwd without `.env` or `prisma.config.ts`: the CLI must find its own package files.
const cwd = mkdtempSync(join(tmpdir(), 'tms-dev-setup-'));

function run(extra: Record<string, string | undefined>) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [name, value] of Object.entries(extra)) {
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
  return spawnSync(process.execPath, [CLI], { cwd, env, encoding: 'utf8' });
}
const events = (stdout: string): Record<string, unknown>[] =>
  stdout
    .split('\n')
    .filter((line) => line.startsWith('{"event":'))
    .map((line) => JSON.parse(line) as Record<string, unknown>);

describe('dev-setup CLI (the predev pipeline)', () => {
  let client: PrismaClient;

  beforeAll(() => {
    client = createPrismaClient({ url: testDatabaseUrl() });
  });
  afterAll(async () => {
    await client.$disconnect();
  });
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('deploys, checks drift, syncs and seeds, printing both events', async () => {
    const result = run({ DATABASE_URL: testDatabaseUrl(), BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No pending migrations to apply.');
    const [synced, seeded] = events(result.stdout);
    expect(synced?.['event']).toBe('permissions.synced');
    expect(seeded).toMatchObject({ event: 'seed.applied', bootstrapAdmin: 'created' });
    expect([...(seeded?.['rolesCreated'] as string[])].sort()).toEqual(['admin', 'driver', 'operator']);
    expect(await client.user.count()).toBe(1);
  });

  it('exits 2 with the migration hint when the database drifted from the schema', async () => {
    await client.$executeRawUnsafe('ALTER TABLE "Product" ADD COLUMN drift_probe integer');
    try {
      const result = run({ DATABASE_URL: testDatabaseUrl(), BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com' });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(DRIFT_HINT);
      expect(events(result.stdout)).toEqual([]);
      expect(await client.user.count()).toBe(0);
    } finally {
      await client.$executeRawUnsafe('ALTER TABLE "Product" DROP COLUMN drift_probe');
    }
  });

  it('exits 2 naming DATABASE_URL when it is not set', () => {
    const result = run({ DATABASE_URL: undefined });
    expect(result.status).toBe(2);
    expect(result.stderr).toBe('DATABASE_URL is not set\n');
    expect(result.stdout).toBe('');
  });
});
```

Run: `pnpm turbo run test --filter=@tms/db`
Expected: `dev-setup.spec.ts` FAILS at import (`'../../src/cli/support'` has no export `DRIFT_HINT`), `cli/seed.spec.ts` FAILS in all 3 tests (`dist/cli/seed.js` missing, `status` not 0/2). Everything else green.

- [ ] **Step 4: Write the CLIs, wire Prisma's seed hook, turbo and `predev`**

`packages/db/src/cli/support.ts` — append (and add `import { EmailSchema } from '@tms/contracts';` to the imports):

```ts
export const DRIFT_HINT =
  'Schema has changes without a migration. Create one with: pnpm turbo run db:migrate:dev --filter=@tms/db -- --name <change>';

/** Validated bootstrap-admin settings, or undefined after the reason was written to stderr. */
export function readBootstrapAdmin(
  env: NodeJS.ProcessEnv,
  stderr: NodeJS.WritableStream,
): { email: string | undefined; username?: string } | undefined {
  const username = env['BOOTSTRAP_ADMIN_USERNAME'] || undefined;
  const raw = env['BOOTSTRAP_ADMIN_EMAIL'];
  if (!raw) return { email: undefined, username };
  const parsed = EmailSchema.safeParse(raw);
  if (!parsed.success) {
    stderr.write('BOOTSTRAP_ADMIN_EMAIL is not a valid email address\n');
    return undefined;
  }
  return { email: parsed.data, username };
}
```

`packages/db/src/cli/seed.ts`:

```ts
#!/usr/bin/env node
import { createPrismaClient } from '../index';
import { SeedConfigError, seedDatabase } from '../seed/seed';
import {
  describeFailure,
  EXIT_CONFIG,
  EXIT_FAILURE,
  loadDotEnv,
  printEvent,
  readBootstrapAdmin,
  requireDatabaseUrl,
} from './support';

async function main(): Promise<number> {
  loadDotEnv();
  const url = requireDatabaseUrl(process.env, process.stderr);
  if (!url) return EXIT_CONFIG;
  const bootstrapAdmin = readBootstrapAdmin(process.env, process.stderr);
  if (!bootstrapAdmin) return EXIT_CONFIG;

  const client = createPrismaClient({ url });
  try {
    const report = await seedDatabase(client, { bootstrapAdmin });
    printEvent('seed.applied', report);
    return 0;
  } catch (error) {
    process.stderr.write(`${describeFailure('seed failed', error)}\n`);
    return error instanceof SeedConfigError ? EXIT_CONFIG : EXIT_FAILURE;
  } finally {
    await client.$disconnect();
  }
}

void main().then((code) => {
  process.exitCode = code;
});
```

`packages/db/src/cli/dev-setup.ts` — the D12 local flow as one process, so the drift hint and both reports come from one place:

```ts
#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createPrismaClient } from '../index';
import { SeedConfigError, seedDatabase } from '../seed/seed';
import { syncPermissions } from '../sync/apply';
import {
  describeFailure,
  DRIFT_HINT,
  EXIT_CONFIG,
  EXIT_FAILURE,
  loadDotEnv,
  printEvent,
  readBootstrapAdmin,
  requireDatabaseUrl,
} from './support';

// dist/cli -> package root. Prisma gets explicit paths, so the caller's cwd does not matter.
const PACKAGE_ROOT = resolve(__dirname, '..', '..');
const PRISMA_CONFIG = resolve(PACKAGE_ROOT, 'prisma.config.ts');
const SCHEMA = resolve(PACKAGE_ROOT, 'prisma', 'schema.prisma');
const PRISMA_CLI = require.resolve('prisma/build/index.js');

/** Runs the Prisma CLI in-process-adjacent (same stdio) and returns its exit code. */
function prisma(args: string[]): number {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args, '--config', PRISMA_CONFIG], {
    stdio: 'inherit',
    // No update-check network call from a pipeline step.
    env: { ...process.env, CHECKPOINT_DISABLE: '1' },
  });
  if (result.error) throw result.error;
  return result.status ?? EXIT_FAILURE;
}

async function main(): Promise<number> {
  loadDotEnv();
  const url = requireDatabaseUrl(process.env, process.stderr);
  if (!url) return EXIT_CONFIG;
  const bootstrapAdmin = readBootstrapAdmin(process.env, process.stderr);
  if (!bootstrapAdmin) return EXIT_CONFIG;

  const deploy = prisma(['migrate', 'deploy']);
  if (deploy !== 0) {
    process.stderr.write(`prisma migrate deploy failed (exit ${deploy})\n`);
    return EXIT_FAILURE;
  }

  // 0 = in sync, 2 = the schema has changes no migration describes, 1 = error.
  const drift = prisma(['migrate', 'diff', '--from-config-datasource', '--to-schema', SCHEMA, '--exit-code']);
  if (drift === 2) {
    process.stderr.write(`${DRIFT_HINT}\n`);
    return EXIT_CONFIG;
  }
  if (drift !== 0) {
    process.stderr.write(`prisma migrate diff failed (exit ${drift})\n`);
    return EXIT_FAILURE;
  }

  const client = createPrismaClient({ url });
  try {
    printEvent('permissions.synced', await syncPermissions(client));
    printEvent('seed.applied', await seedDatabase(client, { bootstrapAdmin }));
    return 0;
  } catch (error) {
    process.stderr.write(`${describeFailure('dev setup failed', error)}\n`);
    return error instanceof SeedConfigError ? EXIT_CONFIG : EXIT_FAILURE;
  } finally {
    await client.$disconnect();
  }
}

void main().then((code) => {
  process.exitCode = code;
});
```

`packages/db/package.json` — add to the keys from Task 07:

```json
{
  "bin": { "tms-sync-permissions": "dist/cli/sync-permissions.js", "tms-seed": "dist/cli/seed.js" },
  "scripts": {
    "db:seed": "prisma db seed",
    "db:setup": "node dist/cli/dev-setup.js"
  }
}
```

`packages/db/prisma.config.ts:9` — replace the `migrations` line:

```ts
  // `prisma db seed` runs the built seed CLI; predev and the migrate image call the same file.
  migrations: { path: 'prisma/migrations', seed: 'node dist/cli/seed.js' },
```

`packages/db/.env.example` (whole file; the first two lines are phase 0's):

```ini
# Password and port must match infra/.env (POSTGRES_PASSWORD, POSTGRES_PORT) when using compose.
DATABASE_URL=postgresql://tms:tms@localhost:5432/tms
# Email of the bootstrap administrator the seed creates (INVITED) while no admin exists.
# Required by `pnpm dev` (predev) and the migrate one-shot on an empty database, ignored afterwards.
BOOTSTRAP_ADMIN_EMAIL=admin@example.com
# Optional login name of that account; defaults to `admin`.
# BOOTSTRAP_ADMIN_USERNAME=admin
```

`turbo.json` — insert after the `"dev"` entry of `tasks` (Task 02's file; its `db:migrate:dev` entry already exists and stays as it is):

```json
    "db:setup": {
      "cache": false,
      "dependsOn": ["build"],
      "passThroughEnv": ["DATABASE_URL", "BOOTSTRAP_ADMIN_EMAIL", "BOOTSTRAP_ADMIN_USERNAME"]
    },
```

Root `package.json:10`:

```json
    "predev": "turbo run db:setup --filter=@tms/db",
```

Run: `pnpm exec prettier --write packages/db turbo.json package.json && pnpm turbo run test --filter=@tms/db`
Expected: PASS — `seed.spec.ts` 9, `cli/seed.spec.ts` 3, `cli/dev-setup.spec.ts` 3 (15 new tests); Task 07's 28 and the Task 05/06 suites unchanged. The dev-setup happy path prints Prisma's `No pending migrations to apply.` before the two JSON lines.

Run: `pnpm turbo run lint --filter=@tms/db && pnpm turbo run typecheck --filter=@tms/db && pnpm turbo run build --filter=@tms/db && ls packages/db/dist/cli`
Expected: exit 0 three times; the listing shows `dev-setup.js`, `seed.js`, `support.js`, `sync-permissions.js`.

- [ ] **Step 5: Run `predev` and `prisma db seed` against the throwaway Postgres (still running from Task 07)**

```bash
export DATABASE_URL=postgresql://tms:tms@localhost:55432/tms BOOTSTRAP_ADMIN_EMAIL=admin@example.com
pnpm predev < /dev/null; echo exit=$?
pnpm predev < /dev/null | grep -o '{"event":"seed.applied".*'; echo exit=${PIPESTATUS[0]}
(cd packages/db && pnpm run db:seed); echo exit=$?
env -u BOOTSTRAP_ADMIN_EMAIL sh -c 'cd packages/db && pnpm run db:seed'; echo exit=$?
unset DATABASE_URL BOOTSTRAP_ADMIN_EMAIL
docker rm -f tms-p1-pg && docker network rm tms-p1-net
```

Expected: first `pnpm predev` runs `@tms/contracts#build`, `@tms/db#build` (with its `generate` dependency) and `@tms/db#db:setup`, prints Prisma's `No pending migrations to apply.` (Task 07 deployed them), a `permissions.synced` line with every list empty (Task 07 synced the codes), then `{"event":"seed.applied","sync":{…all empty…},"rolesCreated":["admin","operator","driver"],"productsCreated":["DIESEL","GASOLINE_95","GASOLINE_98","JET_A1","HEATING_OIL"],"loadingPointsCreated":["ISLAND-01",…,"TRACK-02"],"bootstrapAdmin":"created","warnings":[]}`, `exit=0`. Second run: the grep shows `"rolesCreated":[]`, `"bootstrapAdmin":"exists"`, `"warnings":[]`, `exit=0`. `db:seed` (run inside `packages/db`, where `prisma.config.ts` lives; there is no turbo task for it): Prisma prints ``Running seed command `node dist/cli/seed.js` ...``, our `seed.applied` line with `"bootstrapAdmin":"exists"`, then `The seed command has been executed.`, `exit=0`. The run without the email also exits 0 with `"bootstrapAdmin":"exists"` (an admin exists, so the variable is optional — the error only fires on an empty database, covered by the tests; a local `packages/db/.env` may supply the variable again, with the same result).

- [ ] **Step 6: Update README, CLAUDE.md and the architecture table**

`README.md:21-27` — replace the Quick start block (the fenced `bash` block, fences included):

```bash
pnpm install                                   # installs dependencies and git hooks
cp infra/.env.example infra/.env
cp packages/db/.env.example packages/db/.env   # set BOOTSTRAP_ADMIN_EMAIL to your address
pnpm compose up -d --build && infra/smoke.sh   # postgres :5432, mailpit :8025, migrations applied
pnpm dev                                       # predev: migrate deploy, drift check, permission sync, seed;
                                               # then api-admin :3001, api-driver :3002, web-admin :5173, web-driver :5174
```

Insert after that block (before "Production-like stack"):

```markdown
`predev` is idempotent and create-only: it deploys pending migrations, fails with a hint if
`schema.prisma` changed without a migration (`pnpm turbo run db:migrate:dev --filter=@tms/db -- --name <change>`),
synchronises the permission catalogue and seeds the system roles (Admin, Operator, Driver), five
products, eight loading points and one INVITED bootstrap administrator (`BOOTSTRAP_ADMIN_EMAIL`,
username `admin`). Rows an administrator edited later are never overwritten. Phase 2 adds the invite email.
```

`README.md:59` — the `## Status` paragraph (line 59 before this task's edits):

```markdown
Phase 0 (bootstrap) complete. Phase 1 (foundation) in progress: contracts, schema, permission sync and
seed landed; logger, health, Sentry and the shared domain module follow.
```

`CLAUDE.md:27-28` — replace the `pnpm dev` bullet:

```markdown
- `pnpm dev` — `predev` deploys migrations, checks drift, syncs permissions and seeds (needs
  `BOOTSTRAP_ADMIN_EMAIL` in `packages/db/.env` on an empty database); api-admin :3001,
  api-driver :3002, web-admin :5173, web-driver :5174 (Vite proxies `/api`)
```

`docs/architecture.md` — replace the `Migrations` row of the Environments table (`| Migrations | \`pnpm dev\` → \`predev\` | \`migrate\` one-shot, apps wait for it |`; Prettier realigns the columns):

```markdown
| Migrations | `pnpm dev` → `predev` (deploy, drift check, sync, seed) | `migrate` one-shot, apps wait for it |
```

Run: `pnpm exec prettier --write README.md CLAUDE.md docs/architecture.md && pnpm format:check && wc -l CLAUDE.md`
Expected: exit 0; `77 CLAUDE.md` (Task 04's 76 + one line; the hygiene check enforces 150).

- [ ] **Step 7: Verify the whole repository and commit**

Run: `pnpm verify`
Expected: all turbo tasks green; `prettier --check` clean; `hygiene: ok (<n> tracked files, single copies ok)`; gitleaks `no leaks found` (`admin@example.com` is a documentation address, not a secret).

Append the journal row to `docs/efficiency/critical-path.md`:

```
| 2026-09-23 | Task 08: Idempotent seed and the D12 predev flow | subagent | HH:MM | HH:MM | none | n/a | Seed matrix 9 tests (empty DB counts, exact grants per role, second run byte-identical snapshots, renamed/trimmed Operator kept, ACTIVE/BLOCKED admin, foreign email warning, missing email rolls back everything, two concurrent seeds → one admin); CLI 6 tests incl. drift probe → exit 2 with the hint. `predev < /dev/null` twice against tms-p1-pg (created, then exists), `prisma db seed` through `migrations.seed`. Deviation 6 applied: no `migrate dev` in predev. |
```

```bash
git add packages/db turbo.json package.json README.md CLAUDE.md docs/architecture.md docs/efficiency/critical-path.md
git commit -m "feat(db): add the idempotent seed and make predev deploy, check drift, sync and seed"
```
Expected: this commit passes all hooks (header 84 characters).

**PR body notes:**
- Diagram: Mermaid `flowchart TD` of the `predev` pipeline — `pnpm dev` → `predev: turbo run db:setup` → `build (contracts, db)` → `prisma migrate deploy` → `prisma migrate diff --exit-code` → {0: `syncPermissions` → `seedDatabase` → `dev`; 2: `exit 2 + hint`; 1: `exit 1`}; the seed box notes "roles, products, loading points, INVITED admin — create-only, lock 7302".
- Boundaries: root scripts (`predev`), turbo task `db:setup`, `@tms/db` public API (`seedDatabase`, `SeedReport`, `summarizeSeedReport`, `SeedConfigError`, `SEED_*`), CLIs `tms-seed` and `dev-setup`, `prisma.config.ts` (`migrations.seed`), `packages/db/.env.example`. Migration: no.
- Verification plan: `pnpm verify`; seed suite RED then GREEN; seed and dev-setup CLI suites RED then GREEN; `pnpm predev < /dev/null` twice and `prisma db seed` against `tms-p1-pg`; CI `verify` and `db-drift`.
- Verification results (`scenario | layer | outcome`): seed matrix | database (Testcontainers) | 9 passed; seed CLI (missing email exit 2, invalid email exit 2, normalised email created) | CLI (spawn) | 3 passed; dev-setup happy path / drift probe exit 2 with hint / missing `DATABASE_URL` exit 2 | CLI (spawn, real Prisma CLI) | 3 passed; `pnpm predev < /dev/null` twice | manual | exit 0, `created` then `exists`; `prisma db seed` | manual | exit 0 via `migrations.seed`; `pnpm verify` | repo | green.
- Risks and notes: D12 wording change (deviation 6: `migrate deploy` + drift check instead of `migrate dev`, which in Prisma 7 runs neither `generate` nor the seed and would create an unnamed migration without a TTY); deviation 4 (bootstrap admin INVITED without token/URL/email until phase 2); deviation 5 for Task 09 (the `migrate` image runs `node dist/cli/seed.js` after `migrate deploy` and needs `BOOTSTRAP_ADMIN_EMAIL` passed by compose); `SeedConfigError` maps to exit 2 so an empty database without the variable fails the pipeline clearly; `summarizeSyncReport`/`summarizeSeedReport` match the `system.permissions.synced` / `system.seed.applied` audit metadata schemas from Task 03 and are recorded through `AuditService` from phase 3b on (phase 1 prints only).

---

### Task 09: Migrate image — deploy, sync and seed from production dependencies

**Branch:** `phase-1/09-migrate-image`
**PR title:** `build(infra): run migrations, permission sync and seed from a production-only migrate image`

D12 (the one-shot `migrate` service runs migrations and the permission sync; apps wait for it), deviation 5 (it also runs the create-only seed), deviation 10 (root-owned code, read-only root filesystem), deviation 11 (`@prisma/dev` stays because the CLI needs it; `prisma` becomes an optional dependency so the API images drop it in Task 11), Review Focus item 7 (container runtime). The seed runs the permission sync first inside its own transaction (Task 08), so the image runs two commands, not three.

Spike notes (verified while writing): `prisma migrate deploy --config ./prisma.config.ts` and the seed run on a read-only root filesystem with `/app` itself mounted read-only (`docker run --read-only --tmpfs /tmp --user node -v out-db:/app:ro …` against a throwaway Postgres: `All migrations have been successfully applied.`, seed exit 0, `/tmp` stayed empty), so compose gets `read_only: true` for `migrate` and `/tmp` is only a safety margin. The S1 figure "329 MB vs 760 MB" compared a `du` of the deployed tree with a whole image; measured the same way (`docker image inspect .Size`, containerd snapshotter) phase 0 `tms-migrate` is 760 416 930 B and an image built from the S1 `out-db` tree 786 923 334 B, `/app` (`du -sb`) 296 888 280 B today vs 321 318 274 B: `deploy --prod` drops eslint/typescript/babel, but the seed now needs `@prisma/client` (71 MB of per-provider query-compiler wasm), `@prisma/adapter-pg` and `pg`, so the image does not shrink — hence "production-only" in the PR title instead of "slim", and a CI budget on `/app` (storage-driver independent, unaffected by the floating `node:26-bookworm-slim` base). pnpm 12.5.1 accepts `packageExtensions` for a package that is not in the graph yet and only adds `packageExtensionsChecksum: sha256-…` to the lockfile, so `pnpm install` must run and the lockfile is part of the commit. The smoke check reads the catalogue size from the migrate image (`compose run --rm --no-deps -T migrate node -e …`), not from the host's `packages/contracts/dist`: the CI `e2e` job never builds packages and a fresh clone has no `dist/`, while the image holds exactly the catalogue it synced; it checks "at least one user with the `admin` role" plus "a second run changes nothing" rather than one INVITED user, because a developer's `tms` stack keeps `pgdata` and the bootstrap admin becomes ACTIVE in phase 2.

**Files:**
- Modify: `infra/docker/migrate.Dockerfile` (whole file), `infra/docker-compose.yml:40-50` (the `migrate` service and its comment; 36–46 before `main` 0d5f4ac added the postgres 18 volume note), `infra/.env.example` (append after line 7), `infra/smoke.sh` (whole file), `.github/workflows/e2e.yml:32-33` (new step after "Smoke test the stack"), `packages/db/package.json` (`prisma` moves to `optionalDependencies`), `packages/db/README.md` (append), `pnpm-workspace.yaml` (block after `allowBuilds`), `pnpm-lock.yaml`, `docs/architecture.md:29` (Containers diagram) and the "Migrations" row of the Environments table, `README.md` (Quick start compose line; paragraph after "Production-like stack"), `docs/efficiency/critical-path.md`
- Test: `infra/smoke.sh` (stack-level checks 1–2, run RED against the phase 0 image, then GREEN); manual `docker run` checks in Steps 3–4

**Interfaces:**
- Consumes: `dist/cli/seed.js` (Task 08: sync then seed in one transaction, prints `{"event":"seed.applied",…,"rolesCreated":[…],…,"bootstrapAdmin":"created"|"exists","warnings":[…]}`, exit 0 / 2 config / 1 failure); `@tms/db` `generate` (`prisma generate`) and `build` (`tsc -p tsconfig.build.json`) (Task 05); `files: ["dist", "prisma", "prisma.config.ts"]` (Task 04); `PERMISSIONS` from `@tms/contracts` (Task 03); tables `Permission` (`isDeprecated`, `syncedAt`), `Role` (`key`), `RolePermission`, `User` (`roleId`), `Product`, `LoadingPoint` (Tasks 05–06); env `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_USERNAME` (Task 08); catalog `prisma: 7.10.0` (Task 05).
- Produces: image `migrate` = production dependencies of `@tms/db` under a root-owned `/app`, `USER node`, `ENV NODE_ENV=production CHECKPOINT_DISABLE=1`, CMD `prisma migrate deploy --config ./prisma.config.ts && exec node dist/cli/seed.js`; compose `migrate` env `BOOTSTRAP_ADMIN_EMAIL` (default `admin@example.com`), `BOOTSTRAP_ADMIN_USERNAME` (default `admin`), `read_only: true`; `infra/smoke.sh` check 2 (catalogue = active permissions, 3 system roles, ≥ 1 admin, second run changes nothing) and "exported variables beat `infra/.env`"; CI step "Migrate image budget" (`MIGRATE_APP_MAX_BYTES`); `@tms/db` `optionalDependencies: { prisma }`; `packageExtensions` for `@nestjs-cls/transactional-adapter-prisma` (consumed by Task 14).

- [ ] **Step 1: Make the Prisma CLI an optional dependency of `@tms/db`**

Free port 55432 first: the Task 07/08 throwaway `tms-p1-pg` publishes it and the compose project below needs it.

Run: `docker rm -f tms-p1-pg 2>/dev/null; docker network rm tms-p1-net 2>/dev/null; true`
Expected: exit 0 whether or not the container existed.

`packages/db/package.json` — keep every other field from Tasks 04–08 and move one entry:

```jsonc
// dependencies: remove
"prisma": "catalog:",

// new block after dependencies
"optionalDependencies": {
  "prisma": "catalog:"
},
```

`pnpm-workspace.yaml` — insert between the `allowBuilds:` block and `minimumReleaseAgeExclude:`:

```yaml
# The Prisma transaction adapter (Task 14) declares the CLI as a required peer, but only
# @prisma/client is needed at runtime; optional keeps the `--no-optional` API deploys valid.
packageExtensions:
  '@nestjs-cls/transactional-adapter-prisma':
    peerDependenciesMeta:
      prisma:
        optional: true
```

Append to `packages/db/README.md`:

```md
The Prisma CLI (`prisma`) is an **optional** dependency. `pnpm install` installs it (development,
CI, the `migrate` image built with `pnpm deploy --prod`), while the API images deploy with
`--no-optional` and ship only `@prisma/client`, the driver adapter and `pg`. Nothing under `src/`
may import `prisma` at runtime; only `prisma.config.ts` and the `dev-setup` CLI (local `predev`) use it.
```

Run: `pnpm install && git diff --stat pnpm-lock.yaml && grep -n 'packageExtensionsChecksum' pnpm-lock.yaml`
Expected: the lockfile changes in the `packages/db` importer (`prisma` listed under `optionalDependencies`) and gains one `packageExtensionsChecksum: sha256-…` line; no peer-dependency warning, no `ERR_PNPM_IGNORED_BUILDS`.

Run: `test -x packages/db/node_modules/.bin/prisma && echo cli-linked && pnpm turbo run test --filter=@tms/db`
Expected: `cli-linked` (optional dependencies are installed by default); every `@tms/db` suite from Tasks 04–08 passes with the counts recorded in those tasks.

- [ ] **Step 2: Write the stack checks first and run them against the phase 0 image (RED)**

`infra/smoke.sh` (whole file; checks 1, 3 and `--full` are unchanged from phase 0):

```bash
#!/usr/bin/env bash
# Smoke test for the compose stack. Usage: infra/smoke.sh [--full]
# Default profile: postgres, mailpit, migrate. --full: also api-admin, api-driver, caddy.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# infra/.env supplies defaults only: variables already set (alternate ports, COMPOSE_PROJECT_NAME)
# win, the precedence docker compose itself applies. Sourcing the file would override them.
if [ -f .env ]; then
  while IFS='=' read -r key value; do
    if [ -z "${!key+set}" ]; then export "$key=$value"; fi
  done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env)
fi

compose() { docker compose -f docker-compose.yml "$@"; }
fail() { echo "FAIL $*" >&2; exit 1; }
sql() { compose exec -T postgres psql -U tms -d tms -Atc "$1"; }

wait_http() { # name url
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null "$2"; then echo "ok   $1 reachable ($2)"; return 0; fi
    sleep 2
  done
  fail "$1 not reachable at $2"
}

# 1. migrate is a one-shot service: it must exit 0.
for _ in $(seq 1 60); do
  cid=$(compose ps -aq migrate)
  state=$(docker inspect --format '{{.State.Status}}:{{.State.ExitCode}}' "$cid" 2>/dev/null || echo missing)
  case "$state" in
    exited:0) echo "ok   migrate exited 0"; break ;;
    exited:*) compose logs migrate; fail "migrate $state" ;;
  esac
  sleep 2
done
[ "$state" = "exited:0" ] || fail "migrate did not finish (state $state)"

# 2. migrate deployed, synced and seeded (D12, deviation 5); a second run changes nothing.
# The catalogue size comes from the image: exactly the codes it synced, no host build needed.
catalogue=$(compose run --rm --no-deps -T migrate node -e \
  "process.stdout.write(String(require('@tms/contracts').PERMISSIONS.length))") \
  || fail "could not read the permission catalogue from the migrate image"
permissions=$(sql 'SELECT count(*) FROM "Permission" WHERE "isDeprecated" = false')
roles=$(sql "SELECT count(*) FROM \"Role\" WHERE \"key\" IN ('admin', 'operator', 'driver')")
admins=$(sql "SELECT count(*) FROM \"User\" u JOIN \"Role\" r ON r.id = u.\"roleId\" WHERE r.\"key\" = 'admin'")
[ "$permissions" = "$catalogue" ] || fail "migrate: $permissions active permissions, the catalogue has $catalogue"
[ "$roles" = 3 ] || fail "migrate: $roles of the 3 system roles exist"
[ "$admins" -ge 1 ] || fail "migrate: no administrator (BOOTSTRAP_ADMIN_EMAIL unset on an empty database?)"
echo "ok   migrate seeded: $permissions active permissions (= catalogue), 3 system roles, $admins admin(s)"

snapshot() {
  sql "SELECT concat_ws(' ', (SELECT count(*) FROM \"Permission\"), (SELECT max(\"syncedAt\") FROM \"Permission\"),
    (SELECT count(*) FROM \"RolePermission\"), (SELECT count(*) FROM \"Role\"), (SELECT count(*) FROM \"User\"),
    (SELECT count(*) FROM \"Product\"), (SELECT count(*) FROM \"LoadingPoint\"))"
}
before=$(snapshot)
rerun=$(compose run --rm -T migrate 2>&1) || { echo "$rerun" >&2; fail "second migrate run failed"; }
grep -q '"rolesCreated":\[\]' <<<"$rerun" || fail "second migrate run created roles: $rerun"
grep -q '"bootstrapAdmin":"exists"' <<<"$rerun" || fail "second migrate run did not find the admin: $rerun"
after=$(snapshot)
[ "$after" = "$before" ] || fail "second migrate run changed the database: [$before] -> [$after]"
echo "ok   migrate is idempotent (second run created nothing; row counts and syncedAt unchanged)"

# 3. mailpit API answers.
wait_http mailpit "http://localhost:${MAILPIT_UI_PORT:-8025}/api/v1/info"

if [ "${1:-}" = "--full" ]; then
  check_origin() { # name port title
    wait_http "$1" "http://localhost:$2/"
    curl -fsS "http://localhost:$2/" | grep -q "<title>$3</title>" || fail "$1: title '$3' not served"
    echo "ok   $1 serves the SPA"
    # Caddy starts before Nest has bound its port (depends_on = started), so retry until the API answers.
    code=""
    for _ in $(seq 1 30); do
      code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$2/api/does-not-exist")
      [ "$code" = "404" ] && break
      sleep 2
    done
    [ "$code" = "404" ] || fail "$1: /api answered $code, expected 404 from the API"
    body=$(curl -sS "http://localhost:$2/api/does-not-exist")
    echo "$body" | grep -q '"statusCode":404' || fail "$1: /api did not reach the API (got: $body)"
    echo "ok   $1 forwards /api to the API (JSON 404, not index.html)"
    # Regression: Caddy's path matcher `/api/*` alone does not match the bare `/api`
    # path (no trailing slash), so it fell through to the SPA handler and served
    # index.html instead of the API's 404. Guard both the status and the content type.
    code=""
    for _ in $(seq 1 30); do
      code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$2/api")
      [ "$code" = "404" ] && break
      sleep 2
    done
    [ "$code" = "404" ] || fail "$1: bare /api answered $code, expected 404 from the API"
    headers=$(curl -sS -D- -o /dev/null "http://localhost:$2/api")
    echo "$headers" | grep -qi '^content-type: application/json' \
      || fail "$1: bare /api did not return JSON (got headers: $headers)"
    echo "ok   $1 forwards bare /api to the API (JSON 404, not index.html)"
  }
  check_origin web-admin "${CADDY_ADMIN_PORT:-8080}" "TMS Admin"
  check_origin web-driver "${CADDY_KIOSK_PORT:-8081}" "TMS Kiosk"
fi

echo "smoke: all checks passed"
```

`infra/docker-compose.yml:40-50` — replace the `migrate` service and its one-line comment (the `x-database-url` anchor at the top of the file stays the single spelling of the in-network URL):

```yaml
  # One-shot (D12, deviation 5): applies migrations, syncs the permission catalogue and seeds
  # (create-only). Never runs inside an app; the APIs start only after it exited 0.
  migrate:
    build:
      context: ..
      dockerfile: infra/docker/migrate.Dockerfile
    environment:
      DATABASE_URL: *database-url
      BOOTSTRAP_ADMIN_EMAIL: ${BOOTSTRAP_ADMIN_EMAIL:-admin@example.com}
      BOOTSTRAP_ADMIN_USERNAME: ${BOOTSTRAP_ADMIN_USERNAME:-admin}
    # Code stays root-owned and immutable (deviation 10); Prisma and the seed write nothing to disk.
    read_only: true
    tmpfs:
      - /tmp
    depends_on:
      postgres:
        condition: service_healthy
    restart: 'no'
```

Append to `infra/.env.example` (after phase 0's seven lines):

```ini
# Bootstrap administrator the migrate one-shot creates (INVITED) while no admin exists.
BOOTSTRAP_ADMIN_EMAIL=admin@example.com
BOOTSTRAP_ADMIN_USERNAME=admin
```

Run (the Dockerfile is still the phase 0 one; project `tms-p1`, alternate ports as in the Execution notes):

```bash
export POSTGRES_PORT=55432 MAILPIT_UI_PORT=58025 MAILPIT_SMTP_PORT=51025 CADDY_ADMIN_PORT=58080 CADDY_KIOSK_PORT=58081
pnpm compose -p tms-p1 up -d --build
COMPOSE_PROJECT_NAME=tms-p1 infra/smoke.sh; echo exit=$?
```

Expected: `ok   migrate exited 0` (the phase 0 image runs `migrate deploy` only, and it works on the read-only root filesystem), then `FAIL could not read the permission catalogue from the migrate image` — the phase 0 image deploys `@tms/db` without building anything, so `@tms/contracts` has no `dist/` — and `exit=1`. Before the env-loading change the same run would have probed the `tms` project's Mailpit on :8025 (`infra/.env` overrode the exported ports).

- [ ] **Step 3: Rewrite the migrate image and inspect it**

`infra/docker/migrate.Dockerfile` (whole file; the pnpm install from `packageManager` and the build-stage OpenSSL are phase 0's):

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:26-bookworm-slim AS build
# OpenSSL here too (matching the runtime stage): the @prisma/engines postinstall detects the
# OpenSSL version and downloads the matching schema engine at build time.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
# pnpm version from package.json#packageManager, the single place it is pinned.
COPY package.json ./
RUN npm install -g "$(node -p "require('./package.json').packageManager")"
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@tms/db..."
# The Prisma client first, then topological builds (@tms/contracts, then @tms/db). --prod keeps the
# optional Prisma CLI and drops every devDependency.
RUN pnpm --filter "@tms/db" run generate \
 && pnpm --filter "@tms/db..." run build \
 && pnpm --filter "@tms/db" deploy --legacy --prod /out

FROM node:26-bookworm-slim AS runtime
# The schema engine behind `prisma migrate deploy` links against OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production CHECKPOINT_DISABLE=1
WORKDIR /app
# Root-owned on purpose (deviation 10): the runtime user cannot rewrite its own code.
COPY --from=build /out .
USER node
# D12 + deviation 5: migrations, then the create-only seed, which runs the permission sync first.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy --config ./prisma.config.ts && exec node dist/cli/seed.js"]
```

Run: `docker build -f infra/docker/migrate.Dockerfile -t tms-p1-migrate . 2>&1 | grep -E 'Generated Prisma Client|legacy deploy|naming to'`
Expected: `✔ Generated Prisma Client (7.10.0) to ./src/generated/prisma`, `[WARN] Shared workspace lockfile detected but configuration forces legacy deploy implementation.` (expected, S1), `naming to docker.io/library/tms-p1-migrate`; exit 0.

Run: `docker image inspect -f '{{.Size}}' tms-p1-migrate && docker run --rm --entrypoint du tms-p1-migrate -sb /app | cut -f1`
Expected: image ≈ 790 000 000 bytes on a containerd-snapshotter Docker (phase 0 `tms-migrate`: 760 416 930) and `/app` ≈ 322 000 000 bytes (phase 0: 296 888 280; spike tree 321 318 274). Record both numbers for the PR table and Step 5; the image is not smaller because the seed ships `@prisma/client` (see the Spike notes).

Run: `docker run --rm --entrypoint sh tms-p1-migrate -c 'test ! -e node_modules/typescript && test ! -e node_modules/eslint && test -x node_modules/.bin/prisma && ls dist/cli/*.js && stat -c %U dist node_modules && ls node_modules/@prisma node_modules/@tms && id -un'`
Expected: `dist/cli/dev-setup.js dist/cli/seed.js dist/cli/support.js dist/cli/sync-permissions.js`, `root` twice, `adapter-pg  client`, `contracts`, `node`; exit 0.

- [ ] **Step 4: Run the image twice against a throwaway database with a read-only root filesystem**

```bash
docker network create tms-p1-net && docker run -d --name tms-p1-pg --network tms-p1-net \
  -e POSTGRES_USER=tms -e POSTGRES_PASSWORD=tms -e POSTGRES_DB=tms postgres:18-alpine && sleep 5
RUN_MIGRATE='docker run --rm --network tms-p1-net --read-only --tmpfs /tmp -e DATABASE_URL=postgresql://tms:tms@tms-p1-pg:5432/tms'
for run in 1 2; do
  $RUN_MIGRATE -e BOOTSTRAP_ADMIN_EMAIL=admin@example.com tms-p1-migrate \
    | grep -Eo 'All migrations have been successfully applied|No pending migrations to apply|"rolesCreated":\[[^]]*\]|"bootstrapAdmin":"[a-z]+"'
  echo "run $run exit=${PIPESTATUS[0]}"
done
$RUN_MIGRATE tms-p1-migrate > /dev/null; echo "without email, admin exists: exit=$?"
docker exec tms-p1-pg createdb -U tms empty
docker run --rm --network tms-p1-net --read-only --tmpfs /tmp -e DATABASE_URL=postgresql://tms:tms@tms-p1-pg:5432/empty tms-p1-migrate 2>&1 | tail -1; echo "empty database without email: exit=${PIPESTATUS[0]}"
docker rm -f tms-p1-pg && docker network rm tms-p1-net
```

(No published port: the image reaches Postgres over `tms-p1-net`, and the compose project `tms-p1` from Step 2 still holds host port 55432.)

Expected:
```
All migrations have been successfully applied
"rolesCreated":["admin","operator","driver"]
"bootstrapAdmin":"created"
run 1 exit=0
No pending migrations to apply
"rolesCreated":[]
"bootstrapAdmin":"exists"
run 2 exit=0
without email, admin exists: exit=0
seed failed: SeedConfigError: BOOTSTRAP_ADMIN_EMAIL is required while no admin exists
empty database without email: exit=2
```
The last case is what compose shows when `BOOTSTRAP_ADMIN_EMAIL` is empty on a fresh volume: `migrate` exits 2 and the APIs never start (D12: a failure fails clearly as a separate step).

- [ ] **Step 5: Run the stack checks against the new image (GREEN) and add the CI budget**

```bash
pnpm compose -p tms-p1 down -v
pnpm compose -p tms-p1 up -d --build
COMPOSE_PROJECT_NAME=tms-p1 infra/smoke.sh; echo exit=$?
pnpm compose -p tms-p1 down -v
unset POSTGRES_PORT MAILPIT_UI_PORT MAILPIT_SMTP_PORT CADDY_ADMIN_PORT CADDY_KIOSK_PORT
```

Expected:
```
ok   migrate exited 0
ok   migrate seeded: 33 active permissions (= catalogue), 3 system roles, 1 admin(s)
ok   migrate is idempotent (second run created nothing; row counts and syncedAt unchanged)
ok   mailpit reachable (http://localhost:58025/api/v1/info)
smoke: all checks passed
exit=0
```
(33 = `PERMISSIONS.length` of Task 03's catalogue, read from the image by the script.)

`.github/workflows/e2e.yml` — insert after the "Smoke test the stack" step (`pnpm compose` builds the image as `tms-migrate`: project `tms` + service `migrate`):

```yaml
      - name: Migrate image budget
        env:
          # /app of tms-migrate measured in Task 09 plus 10 %; raise it only with a reason in the PR.
          MIGRATE_APP_MAX_BYTES: '355000000'
        run: |
          size=$(docker run --rm --entrypoint du tms-migrate -sb /app | cut -f1)
          echo "migrate /app: ${size} bytes (budget ${MIGRATE_APP_MAX_BYTES}); whole image: $(docker image inspect -f '{{.Size}}' tms-migrate) bytes"
          if [ "$size" -gt "$MIGRATE_APP_MAX_BYTES" ]; then
            echo "::error::migrate image /app is ${size} bytes, over the ${MIGRATE_APP_MAX_BYTES} budget"
            exit 1
          fi
```

`355000000` is the spike measurement (321 318 274) plus the Task 03–08 code, ×1.1, rounded up to 5 MB. If Step 3 measured `/app` outside 300–340 MB, write `measured × 1.1` rounded up to a multiple of 5 000 000 instead and note it in the journal row. `/app` is budgeted instead of the whole image: `.Size` differs between storage drivers (containerd snapshotter locally, overlay2 on runners) and moves with the floating `node:26-bookworm-slim` base.

Run: `size=$(docker run --rm --entrypoint du tms-p1-migrate -sb /app | cut -f1); [ "$size" -le 355000000 ] && echo "within budget: $size"`
Expected: `within budget: <the Step 3 number>`.

- [ ] **Step 6: Update the architecture table and README**

`docs/architecture.md:29` (Containers diagram; phase 0: `migrate["migrate one-shot: prisma migrate deploy (+ permission sync, phase 1)"] --> db`):

```
  migrate["migrate one-shot: migrate deploy, permission sync, seed"] --> db
```

`docs/architecture.md` Environments table, "Migrations" row (Task 08's development column unchanged):

```markdown
| Migrations | `pnpm dev` → `predev` (deploy, drift check, sync, seed) | `migrate` one-shot: deploy, sync, seed; apps wait for it |
```

`README.md` Quick start (Task 08's block) — the compose line becomes:

```bash
pnpm compose up -d --build && infra/smoke.sh   # postgres :5432, mailpit :8025, migrate: deploy, sync, seed
```

`README.md` — insert after the "Production-like stack (Caddy on one origin per app) …" paragraph:

```markdown
The compose `migrate` one-shot applies migrations, synchronises the permission catalogue and runs
the same create-only seed as `predev`; the APIs start only after it exited 0. The INVITED bootstrap
administrator comes from `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_USERNAME` in `infra/.env`
(defaults `admin@example.com` / `admin`); on an empty database without an email `migrate` exits 2.
```

Run: `pnpm exec prettier --write README.md docs/architecture.md packages/db/README.md packages/db/package.json pnpm-workspace.yaml .github/workflows/e2e.yml infra/docker-compose.yml && pnpm format:check`
Expected: exit 0 (Prettier re-aligns the Environments table).

- [ ] **Step 7: Verify the repository**

Run: `bash -n infra/smoke.sh && pnpm verify`
Expected: no syntax error; all turbo tasks green; `prettier --check` clean; `hygiene: ok (<n> tracked files, single copies ok)`; gitleaks `no leaks found`.

After pushing: the CI `e2e` job runs the new smoke checks against `tms` and prints `migrate /app: <n> bytes (budget 355000000)`; `verify`, `hygiene`, `db-drift`, `e2e` green.

- [ ] **Step 8: Commit**

Append the journal row to `docs/efficiency/critical-path.md`:

```
| 2026-MM-DD | Task 09: Migrate image | subagent | HH:MM | HH:MM | none | n/a | `prisma` optional in @tms/db, packageExtensions for the Task 14 adapter; image = `deploy --legacy --prod` of @tms/db, CMD migrate deploy + seed (sync inside), root-owned /app on a read-only root FS. RED: smoke against the phase 0 image failed on the missing catalogue; GREEN: counts + idempotent rerun on tms-p1. docker run twice (created → exists), empty DB without email exit 2. Sizes from Step 3 in the PR table; not smaller than phase 0 because the seed ships @prisma/client. CI budget on /app (MIGRATE_APP_MAX_BYTES). |
```

```bash
git add infra/docker/migrate.Dockerfile infra/docker-compose.yml infra/.env.example infra/smoke.sh .github/workflows/e2e.yml packages/db/package.json packages/db/README.md pnpm-workspace.yaml pnpm-lock.yaml docs/architecture.md README.md docs/efficiency/critical-path.md
git commit -m "build(infra): run migrations, permission sync and seed from a production-only migrate image"
```
Expected: this commit passes all hooks (header 91 characters).

**PR body notes:**
- Diagram: Mermaid `flowchart LR` — build stage (`pnpm install --filter @tms/db...` → `build`: contracts → db with `prisma generate`) → `deploy --legacy --prod` (`/out`: dist, prisma/, prisma.config.ts, prod deps + optional CLI) → runtime `/app` (root-owned, `USER node`, read-only) → `prisma migrate deploy` → `node dist/cli/seed.js` (sync inside, advisory locks 7301/7302) → Postgres; dotted: APIs wait on `service_completed_successfully`, smoke reruns the one-shot.
- Boundaries: `infra/docker/migrate.Dockerfile`, compose `migrate` (env, `read_only`), `infra/.env.example`, `infra/smoke.sh`, CI `e2e` step, `@tms/db` manifest (`optionalDependencies`), `pnpm-workspace.yaml` (`packageExtensions`). No application code. Migration: no.
- Verification plan: `pnpm verify`; smoke RED against the phase 0 image, then GREEN on project `tms-p1`; `docker build` + contents check; the image twice on a read-only root filesystem, plus the empty-database case; CI `e2e` with the new budget step.
- Verification results (`scenario | layer | outcome`): `pnpm install` / `@tms/db` tests | repo | lockfile +checksum, suites unchanged; smoke vs phase 0 image | compose `tms-p1` | FAIL on missing catalogue (RED); `docker build` | image | sizes (image, `/app`) vs 760 416 930 / 296 888 280; contents check | image | no typescript/eslint, CLI present, `root` owner, user `node`; `docker run` ×2 read-only | container | created → exists, exit 0/0; empty DB without email | container | exit 2 with `SeedConfigError`; smoke | compose `tms-p1` | all checks passed incl. idempotent rerun; `pnpm verify` | repo | green; CI `e2e` | CI | green, budget line printed.
- Risks and notes: deviation 5 (seed in the one-shot), 10 (root-owned code, read-only root filesystem — verified for Prisma), 11 (`@prisma/dev` and `@prisma/studio-core` stay in this image because the CLI hard-depends on them); the image is not smaller than phase 0 (Spike notes) — the gain is no dev tooling and a reproducible seed; the budget guards `/app` only. `optionalDependencies` semantics are documented in `packages/db/README.md`; `packageExtensions` lands ahead of its consumer (Task 14) so both deploy modes settle in one PR. Smoke checks "≥ 1 admin" rather than "1 INVITED user" (Spike notes). `BOOTSTRAP_ADMIN_EMAIL` has a compose default, so an existing `infra/.env` without the new lines still seeds.

---

---

### Task 10: `@tms/logger` — pino logger module with redaction, request id and rolling files

**Branch:** `phase-1/10-logger`
**PR title:** `feat(logger): add the pino logger module with redaction, request id and rolling files`

Spec: section 11 (logs, request id, redaction list), D14 (file logs, `LOG_DIR` volume, `LOG_FILE_ENABLED`), Review Focus 1 and 8. Depends on Task 03 (`@tms/contracts/security`) and Task 02 (presets). Nothing consumes the package yet; Task 11 wires it into both APIs.

Spike notes (read in the installed packages of the S4 scratch project: `nestjs-pino@5.2.0`, `pino@10.3.1`, `pino-http@11.0.0`, `pino-roll@4.0.0`, `@nestjs/core@12.1.0`): nestjs-pino 5.2 keeps one pino-http instance per process (`dist/rootLogger.js`, module-level `middleware`, reset only by an unexported test helper), so a second Nest app booted in the same Jest file logs into the first app's destination — `LoggerShutdown` therefore ends only transports created by `createLogDestination` (tracked in a `WeakSet`), never an injected stream, and a test file that boots several apps overrides `LOG_DESTINATION` with one shared `MemoryLogStream`. pino runs `formatters.log` / `formatters.bindings` before the serializers (`lib/tools.js` `_asJson`, `asChindings`), so the formatters skip the serializer-owned keys `req`, `res`, `err`, and the serializers call pino's standard ones themselves (`wrapSerializers: false`) so pino-http and plain pino emit one shape. When an `Error` is logged without a message — which is what Nest 12's `BaseExceptionFilter` does for an unhandled exception (`logger.error(exception)`, nestjs-pino turns it into `{ err, context }`) — pino copies `err.message` into `msg` after the hooks and formatters; the raw text is reachable only on the finished line, hence `hooks.streamWrite: scrubString` as the last pass, plus `hooks.logMethod` for messages and `%j`/`%o` arguments (escaped JSON inside `msg` is not reachable by `scrubString`); both hooks live in `buildPinoOptions`, which `buildPinoHttpOptions` spreads. Multi-target transports default every target to level `info` inside the worker (`lib/multistream.js` `DEFAULT_INFO_LEVEL`), so both targets get `level: options.level`. pino-roll's `removeOtherLogFiles` deletes only files whose name starts with the base name, but `detectLastNumber` reads the trailing number of every file in the directory and cleanup runs only on a roll (never at startup) — per-app directories keep numbering and retention per app (deviation 7).

**Files:**
- Create: `packages/logger/package.json`, `packages/logger/tsconfig.json`, `packages/logger/tsconfig.build.json`, `packages/logger/eslint.config.mjs`, `packages/logger/jest.config.mjs`, `packages/logger/README.md`, `packages/logger/src/index.ts`, `packages/logger/src/options.ts`, `packages/logger/src/redaction.ts`, `packages/logger/src/request-id.ts`, `packages/logger/src/destination.ts`, `packages/logger/src/logger.module.ts`, `packages/logger/src/testing/index.ts`, `packages/logger/src/testing/memory-log-stream.ts`
- Modify: `pnpm-workspace.yaml` (catalog: new `# logging` group after the `# nest` group, i.e. after the line `  '@types/express': ^5.0.6`), `pnpm-lock.yaml`, `docs/architecture.md` (directly under the heading `## Observability — phase 1 (logs, Sentry, audit)`), `README.md` (new section after `## Verification`), `docs/efficiency/critical-path.md`
- Test: `packages/logger/test/request-id.spec.ts`, `packages/logger/test/options.spec.ts`, `packages/logger/test/redaction.spec.ts`, `packages/logger/test/file-transport.spec.ts`, `packages/logger/test/logger.e2e-spec.ts`, `packages/logger/test/logger-file.e2e-spec.ts`

**Interfaces:**
- Consumes: `REDACTED`, `isSensitiveKey(key)`, `scrubDeep(value)`, `scrubString(text)`, `scrubUrl(url)` from `@tms/contracts/security` (Task 03); `@tms/config/tsconfig/nest-library.json`, `nodeConfig`, `createJestConfig({ rootDir })` (Task 02); catalog `fast-check` (Task 03).
- Produces (`@tms/logger`, CommonJS, exports `.` and `./testing`):
  - `LOG_LEVELS` (owned here; `@tms/nest-bootstrap` imports and re-exports it for `z.enum(LOG_LEVELS)`), `type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'`, `interface LoggerOptions { app: 'api-admin' | 'api-driver'; level: LogLevel; file: { enabled: boolean; dir: string; retentionDays: number } }`
  - `createLoggerModule(options: LoggerOptions): DynamicModule` — nestjs-pino `LoggerModule.forRootAsync` with providers `LOG_DESTINATION` (factory `createLogDestination(options)`) and `LoggerShutdown`; throws `Error('LOG_DIR is not writable: <dir>')` synchronously when `file.enabled` and `LOG_DIR/<app>` cannot be created or written.
  - `LOG_DESTINATION: symbol`; `createLogDestination(options): pino.DestinationStream` (`process.stdout`, or a worker transport with targets `pino/file` fd 1 + pino-roll); `closeLogDestination(destination): Promise<void>` (ends only transports it created).
  - `buildPinoOptions(options): pino.LoggerOptions`, `buildPinoHttpOptions(options): pinoHttp.Options`, `buildFileTransportOptions(options): FileTransportOptions` (`{ file: <abs LOG_DIR>/<app>/<app>, frequency: 'daily', dateFormat: 'yyyy-MM-dd', mkdir: true, limit: { count: retentionDays, removeOtherLogFiles: true } }`).
  - `REQUEST_ID_HEADER = 'x-request-id'`, `REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/`, `resolveRequestId(req: IncomingMessage, res?: ServerResponse): string`.
  - Re-exports `Logger`, `PinoLogger`, `InjectPinoLogger` from nestjs-pino.
  - `@tms/logger/testing`: `class MemoryLogStream extends Writable`, `type LogRecord`, `interface WaitForOptions`.

Decisions stated once. Log lines are JSON on stdout always; with `file.enabled` the same lines also go to `LOG_DIR/<app>/<app>.<yyyy-MM-dd>.<n>.log` (deviation 7). `quietReqLogger: true`: lines logged while handling a request carry only `reqId`; the full `req`/`res` objects appear once, on `request completed`. pino-http's default messages (`request completed`, `request errored`) are kept: they are short and Tasks 12 and 14 search for them. The `app` field is a pino `base` binding rather than pino-http `customProps`, because `customProps` binds only to the full request logger and would miss in-request lines and Nest's own bootstrap lines.

- [ ] **Step 1: Add the catalog entries and the package skeleton**

`pnpm-workspace.yaml`, new catalog group after the `# nest` group:

```yaml
  # logging
  nestjs-pino: ^5.2.0
  pino: ^10.3.1
  pino-http: ^11.0.0
  pino-roll: ^4.0.0
```

`packages/logger/package.json`:

```json
{
  "name": "@tms/logger",
  "version": "0.0.0",
  "private": true,
  "type": "commonjs",
  "description": "Structured logging for the TMS APIs: nestjs-pino with the shared redaction rules, request ids and rolling files",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./testing": { "types": "./dist/testing/index.d.ts", "default": "./dist/testing/index.js" }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' jest"
  },
  "dependencies": {
    "@tms/contracts": "workspace:*",
    "nestjs-pino": "catalog:",
    "pino": "catalog:",
    "pino-http": "catalog:",
    "pino-roll": "catalog:"
  },
  "peerDependencies": {
    "@nestjs/common": "catalog:",
    "@nestjs/core": "catalog:",
    "reflect-metadata": "catalog:",
    "rxjs": "catalog:"
  },
  "devDependencies": {
    "@nestjs/common": "catalog:",
    "@nestjs/core": "catalog:",
    "@nestjs/platform-express": "catalog:",
    "@nestjs/testing": "catalog:",
    "@tms/config": "workspace:*",
    "@types/jest": "catalog:",
    "@types/node": "catalog:",
    "@types/supertest": "catalog:",
    "eslint": "catalog:",
    "fast-check": "catalog:",
    "jest": "catalog:",
    "reflect-metadata": "catalog:",
    "rxjs": "catalog:",
    "supertest": "catalog:",
    "ts-jest": "catalog:",
    "typescript": "catalog:nest-ts6"
  }
}
```

(`typescript` comes from `catalog:nest-ts6` because ts-jest needs TypeScript 6's JS API; see `main`'s CLAUDE.md.) (`@nestjs/core` is a peer because nestjs-pino peers it; `@tms/logger` itself imports only `@nestjs/common`.)

`packages/logger/tsconfig.json`:

```json
{
  "extends": "@tms/config/tsconfig/nest-library.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true, "types": ["node", "jest"] },
  "include": ["src", "test"]
}
```

`packages/logger/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "rootDir": "./src", "outDir": "./dist", "noEmit": false, "types": ["node"] },
  "include": ["src"],
  "exclude": ["**/*.spec.ts", "**/*.test.ts"]
}
```

`packages/logger/eslint.config.mjs`:

```js
import { nodeConfig } from '@tms/config/eslint/node';

export default nodeConfig({ tsconfigRootDir: import.meta.dirname });
```

`packages/logger/jest.config.mjs`:

```js
import { createJestConfig } from '@tms/config/jest';

export default createJestConfig({ rootDir: import.meta.dirname });
```

`packages/logger/README.md`:

```md
# @tms/logger

Structured logging for both NestJS APIs (spec section 11, D14). `createLoggerModule({ app, level, file })`
wires nestjs-pino with the redaction rules of `@tms/contracts/security`, request ids (`X-Request-Id`, see
`resolveRequestId`) and, when `file.enabled`, one worker-thread transport writing stdout plus rolling files
`LOG_DIR/<app>/<app>.<yyyy-MM-dd>.<n>.log` (pino-roll, daily, `retentionDays` rotated files kept).
`LoggerShutdown` flushes that transport on `app.close()`; nestjs-pino does not.

Tests override the `LOG_DESTINATION` provider with `MemoryLogStream` from `@tms/logger/testing`. nestjs-pino
keeps one pino-http instance per process, so a test file that boots several apps gives all of them one stream.
```

Run: `pnpm install`
Expected: exit 0; the lockfile gains `nestjs-pino@5.2.0`, `pino@10.3.1`, `pino-http@11.0.0`, `pino-roll@4.0.0` (plus `thread-stream`, `sonic-boom`, `pino-std-serializers`, `date-fns`); nothing is appended to `minimumReleaseAgeExclude` (all four are older than pnpm's 24 h gate, spike S4) and no `ERR_PNPM_IGNORED_BUILDS`.

- [ ] **Step 2: Write the test support stream**

`packages/logger/src/testing/memory-log-stream.ts`:

```ts
import { Writable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';

export type LogRecord = Record<string, unknown> & { level: number; time: number; msg?: string };

export interface WaitForOptions {
  /** Only records at or after this `mark()`. */
  from?: number;
  timeoutMs?: number;
}

/** In-memory pino destination for tests: override `LOG_DESTINATION` with an instance. */
export class MemoryLogStream extends Writable {
  readonly lines: string[] = [];

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.lines.push(...chunk.toString().split('\n').filter((line) => line.length > 0));
    callback();
  }

  records(): LogRecord[] {
    return this.lines.map((line) => JSON.parse(line) as LogRecord);
  }

  text(): string {
    return this.lines.join('\n');
  }

  mark(): number {
    return this.lines.length;
  }

  since(mark: number): LogRecord[] {
    return this.records().slice(mark);
  }

  /** pino-http logs on the response `finish` event, which can trail the client by a tick. */
  async waitFor(
    predicate: (record: LogRecord) => boolean,
    { from = 0, timeoutMs = 2000 }: WaitForOptions = {},
  ): Promise<LogRecord> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const match = this.since(from).find(predicate);
      if (match) return match;
      if (Date.now() > deadline) throw new Error(`no log record matched within ${timeoutMs} ms`);
      await sleep(10);
    }
  }
}
```

`packages/logger/src/testing/index.ts`:

```ts
export { MemoryLogStream, type LogRecord, type WaitForOptions } from './memory-log-stream';
```

- [ ] **Step 3: Write the failing tests**

`packages/logger/test/request-id.spec.ts` (real `IncomingMessage`/`ServerResponse` objects; a CRLF header cannot be sent through an HTTP client, so hostile values are set directly):

```ts
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import * as fc from 'fast-check';
import { REQUEST_ID_HEADER, REQUEST_ID_PATTERN, resolveRequestId } from '../src/request-id';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type RequestWithId = IncomingMessage & { id?: unknown };

function exchange(header?: string | string[]): { req: RequestWithId; res: ServerResponse } {
  const req: RequestWithId = new IncomingMessage(new Socket());
  if (header !== undefined) req.headers[REQUEST_ID_HEADER] = header;
  return { req, res: new ServerResponse(req) };
}

describe('resolveRequestId', () => {
  it('keeps a well-formed caller id, stores it on req.id and echoes it', () => {
    const { req, res } = exchange('abc-123._XYZ');
    expect(resolveRequestId(req, res)).toBe('abc-123._XYZ');
    expect(req.id).toBe('abc-123._XYZ');
    expect(res.getHeader('x-request-id')).toBe('abc-123._XYZ');
  });

  it('accepts exactly 64 characters and replaces 65', () => {
    expect(resolveRequestId(exchange('a'.repeat(64)).req)).toBe('a'.repeat(64));
    expect(resolveRequestId(exchange('a'.repeat(65)).req)).toMatch(UUID_V4);
  });

  it.each([
    ['CR/LF injection', 'bad\r\nid'],
    ['200 characters', 'x'.repeat(200)],
    ['spaces', 'bad id with spaces'],
    ['an empty value', ''],
    ['non-ASCII', 'id-ü'],
    ['duplicate headers', ['a', 'b']],
  ])('replaces %s with a UUID and echoes the UUID', (_label, header) => {
    const { req, res } = exchange(header);
    const id = resolveRequestId(req, res);
    expect(id).toMatch(UUID_V4);
    expect(res.getHeader('x-request-id')).toBe(id);
  });

  it('mints a UUID when the header is absent and memoizes it on req.id', () => {
    const { req, res } = exchange();
    const first = resolveRequestId(req, res);
    expect(first).toMatch(UUID_V4);
    expect(resolveRequestId(req, res)).toBe(first);
    expect(resolveRequestId(exchange().req)).not.toBe(first);
  });

  it('prefers an id already on req.id, so pino-http and the CLS middleware agree', () => {
    const { req } = exchange('from-header');
    req.id = 'set-by-the-first-caller';
    expect(resolveRequestId(req)).toBe('set-by-the-first-caller');
  });

  it('works without a response object', () => {
    expect(resolveRequestId(exchange('no-response').req)).toBe('no-response');
  });

  it('always returns a pattern-conforming id that equals the header exactly when the header conforms', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ unit: 'binary', maxLength: 80 }),
          fc.stringMatching(/^[A-Za-z0-9._-]{1,64}$/),
        ),
        (header) => {
          const id = resolveRequestId(exchange(header).req);
          expect(id).toMatch(REQUEST_ID_PATTERN);
          expect(id === header).toBe(REQUEST_ID_PATTERN.test(header));
        },
      ),
      { numRuns: 300 },
    );
  });
});
```

`packages/logger/test/options.spec.ts`:

```ts
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { scrubString } from '@tms/contracts/security';
import { buildFileTransportOptions, buildPinoHttpOptions, type LoggerOptions } from '../src/options';
import { resolveRequestId } from '../src/request-id';

const OPTIONS: LoggerOptions = {
  app: 'api-driver',
  level: 'debug',
  file: { enabled: true, dir: '/var/log/tms', retentionDays: 14 },
};

describe('buildPinoHttpOptions', () => {
  it('sets level, header redaction, request ids, the quiet request logger and the app binding', () => {
    const options = buildPinoHttpOptions(OPTIONS);
    expect(options.level).toBe('debug');
    expect(options.redact).toEqual({
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-device-key"]',
        'res.headers["set-cookie"]',
      ],
      censor: '[REDACTED]',
    });
    expect(options.genReqId).toBe(resolveRequestId);
    expect(options.quietReqLogger).toBe(true);
    expect(options.wrapSerializers).toBe(false);
    expect(Object.keys(options.serializers ?? {}).sort()).toEqual(['err', 'req', 'res']);
    expect(options.base).toMatchObject({ app: 'api-driver', pid: process.pid });
    // Inherited from buildPinoOptions: the message pass and the finished-line pass.
    expect(options.hooks).toEqual({ logMethod: expect.any(Function), streamWrite: scrubString });
  });

  it.each([
    ['/api/health', true],
    ['/api/health?probe=1', true],
    ['/api/healthz', false],
    ['/api/echo', false],
    [undefined, false],
  ])('autoLogging.ignore(%s) is %s', (url, ignored) => {
    const { autoLogging } = buildPinoHttpOptions(OPTIONS);
    const ignore = typeof autoLogging === 'object' ? autoLogging.ignore : undefined;
    expect(ignore?.({ url } as unknown as IncomingMessage)).toBe(ignored);
  });

  it('returns fresh objects on every call (pino-http mutates the options it receives)', () => {
    const first = buildPinoHttpOptions(OPTIONS);
    const second = buildPinoHttpOptions(OPTIONS);
    expect(second).not.toBe(first);
    expect(second.autoLogging).not.toBe(first.autoLogging);
    expect(second.serializers).not.toBe(first.serializers);
  });
});

describe('buildFileTransportOptions', () => {
  it('writes LOG_DIR/<app>/<app>.<yyyy-MM-dd>.<n>.log daily, keeps retentionDays files, no symlink', () => {
    expect(buildFileTransportOptions(OPTIONS)).toEqual({
      file: '/var/log/tms/api-driver/api-driver',
      frequency: 'daily',
      dateFormat: 'yyyy-MM-dd',
      mkdir: true,
      limit: { count: 14, removeOtherLogFiles: true },
    });
  });

  it('resolves a relative LOG_DIR against the working directory', () => {
    const relative: LoggerOptions = { ...OPTIONS, file: { ...OPTIONS.file, dir: 'logs' } };
    expect(buildFileTransportOptions(relative).file).toBe(
      path.resolve('logs', 'api-driver', 'api-driver'),
    );
  });
});
```

`packages/logger/test/redaction.spec.ts` (plain pino with `buildPinoOptions`; every test asserts the raw secret is absent, not only that a marker exists):

```ts
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import pino from 'pino';
import { REDACTED } from '@tms/contracts/security';
import { buildPinoOptions, type LoggerOptions } from '../src/options';
import { MemoryLogStream, type LogRecord } from '../src/testing';

const OPTIONS: LoggerOptions = {
  app: 'api-admin',
  level: 'trace',
  file: { enabled: false, dir: 'unused', retentionDays: 1 },
};
const S = {
  password: 'pw-secret-1a2b', // gitleaks:allow (test fixture, not a secret)
  pin: 'pin-secret-3c4d',
  bearer: 'bearer-secret-5e6f',
  cookie: 'cookie-secret-7a8b',
  token: 'token-secret-9c0d',
  dsn: 'dsn-secret-1e2f',
  deviceKey: 'device-key-secret-5a5a',
  card: 'card-secret-6b6b',
} as const;

function fresh(): { logs: MemoryLogStream; logger: pino.Logger } {
  const logs = new MemoryLogStream();
  return { logs, logger: pino(buildPinoOptions(OPTIONS), logs) };
}

function last(logs: MemoryLogStream): LogRecord {
  const record = logs.records().at(-1);
  if (!record) throw new Error('nothing was logged');
  return record;
}

function expectAbsent(logs: MemoryLogStream, secrets: readonly string[]): void {
  const text = logs.text();
  for (const secret of secrets) expect(text).not.toContain(secret);
}

describe('buildPinoOptions redaction', () => {
  it('redacts nested, array and header values under sensitive keys and keeps harmless keys', () => {
    const { logs, logger } = fresh();
    logger.info(
      {
        user: { name: 'Ana', password: S.password },
        items: [{ pin: S.pin, label: 'main' }],
        headers: { AUTHORIZATION: `Bearer ${S.bearer}`, 'Set-Cookie': [`sid=${S.cookie}`], 'x-request-id': 'r-1' },
        shipping: 'express',
        mapping: 'm-1',
        keyId: 'k-1',
      },
      'nested',
    );
    expect(last(logs)).toMatchObject({
      app: 'api-admin',
      msg: 'nested',
      user: { name: 'Ana', password: REDACTED },
      items: [{ pin: REDACTED, label: 'main' }],
      headers: { AUTHORIZATION: REDACTED, 'Set-Cookie': REDACTED, 'x-request-id': 'r-1' },
      shipping: 'express',
      mapping: 'm-1',
      keyId: 'k-1',
    });
    expectAbsent(logs, [S.password, S.pin, S.bearer, S.cookie]);
  });

  it('scrubs messages and interpolation arguments before pino formats them', () => {
    const { logs, logger } = fresh();
    logger.info(`GET /accept?token=${S.token} Authorization: Bearer ${S.bearer}`);
    logger.info('payload %j', { password: S.password, ok: true });
    logger.info('dsn %s', `postgresql://tms:${S.dsn}@db/tms`);
    logger.info(`body {"pin":"${S.pin}","kioskId":"k1"}`);
    expect(logs.records().map((record) => record.msg)).toEqual([
      `GET /accept?token=${REDACTED} Authorization: Bearer ${REDACTED}`,
      `payload {"password":"${REDACTED}","ok":true}`,
      `dsn postgresql://${REDACTED}@db/tms`,
      `body {"pin":"${REDACTED}","kioskId":"k1"}`,
    ]);
    expectAbsent(logs, [S.token, S.bearer, S.password, S.dsn, S.pin]);
  });

  it('scrubs the message pino copies from a lone Error (finished-line pass)', () => {
    const { logs, logger } = fresh();
    logger.error(new Error(`connect postgresql://tms:${S.dsn}@db/tms failed`));
    expect(last(logs)).toMatchObject({
      msg: `connect postgresql://${REDACTED}@db/tms failed`,
      err: { type: 'Error', message: `connect postgresql://${REDACTED}@db/tms failed` },
    });
    expectAbsent(logs, [S.dsn]);
  });

  it('serializes errors with scrubbed message, stack, causes and own properties', () => {
    const { logs, logger } = fresh();
    const error = Object.assign(
      new Error(`upstream failed token=${S.token}`, {
        cause: new Error(`db postgresql://tms:${S.dsn}@db/tms`),
      }),
      { config: { headers: { authorization: `Bearer ${S.bearer}` }, url: `/x?pin=${S.pin}` } },
    );
    logger.error({ err: error }, 'request to upstream failed');
    const record = last(logs);
    expect(record).toMatchObject({
      msg: 'request to upstream failed',
      err: { type: 'Error', config: { headers: { authorization: REDACTED }, url: `/x?pin=${REDACTED}` } },
    });
    expect((record['err'] as { message: string }).message).toContain(`token=${REDACTED}`);
    expectAbsent(logs, [S.token, S.dsn, S.bearer, S.pin]);
  });

  it('scrubs child bindings (keys and URL values)', () => {
    const { logs, logger } = fresh();
    logger
      .child({ token: S.token, path: `/accept?token=${S.token}`, cardSerial: S.card })
      .info('child line');
    expect(last(logs)).toMatchObject({
      msg: 'child line',
      token: REDACTED,
      path: `/accept?token=${REDACTED}`,
      cardSerial: REDACTED,
    });
    expectAbsent(logs, [S.token, S.card]);
  });

  it('logs a request as id, method, scrubbed url and headers, remote address; a response as its status', () => {
    const { logs, logger } = fresh();
    const req = new IncomingMessage(new Socket());
    req.method = 'POST';
    req.url = `/api/login?token=${S.token}`;
    req.headers = {
      authorization: `Bearer ${S.bearer}`,
      cookie: `sid=${S.cookie}`,
      'x-device-key': S.deviceKey,
      'user-agent': 'UA/1',
    };
    const res = { statusCode: 201, getHeaders: () => ({ 'set-cookie': [`sid=${S.cookie}`] }) };
    logger.info({ req, res }, 'manual');
    const record = last(logs);
    expect(record).toMatchObject({
      req: {
        method: 'POST',
        url: `/api/login?token=${REDACTED}`,
        headers: { authorization: REDACTED, cookie: REDACTED, 'x-device-key': REDACTED, 'user-agent': 'UA/1' },
      },
      res: { statusCode: 201 },
    });
    expect(Object.keys(record['res'] as object)).toEqual(['statusCode']);
    expectAbsent(logs, [S.token, S.bearer, S.cookie, S.deviceKey]);
  });
});
```

`packages/logger/test/file-transport.spec.ts` (real pino-roll worker threads into `mkdtemp` directories; the `createLogDestination` test also prints its one JSON line on the Jest output through the stdout target):

```ts
import { once } from 'node:events';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import pino from 'pino';
import {
  buildFileTransportOptions,
  buildPinoOptions,
  closeLogDestination,
  createLogDestination,
  createLoggerModule,
  type LoggerOptions,
} from '../src';

type Transport = ReturnType<typeof pino.transport>;

const SECRET = 'file-secret-3141';
const FILE_NAME = /^api-admin\.\d{4}-\d{2}-\d{2}\.\d+\.log$/;
const itUnlessRoot = process.getuid?.() === 0 ? it.skip : it;

const tempDir = (): string => mkdtempSync(path.join(tmpdir(), 'tms-logger-'));
const options = (dir: string, file: Partial<LoggerOptions['file']> = {}): LoggerOptions => ({
  app: 'api-admin',
  level: 'info',
  file: { enabled: true, dir, retentionDays: 3, ...file },
});
const readAll = (dir: string): string =>
  readdirSync(dir)
    .map((file) => readFileSync(path.join(dir, file), 'utf8'))
    .join('');

/** pino-roll alone (no stdout target) with a test-only size limit that forces rotation. */
function rollTransport(opts: LoggerOptions): Transport {
  return pino.transport({
    targets: [
      { target: require.resolve('pino-roll'), options: { ...buildFileTransportOptions(opts), size: '1k' } },
    ],
  });
}

// pino-roll counts bytes per chunk the worker receives: a synchronous burst arrives as one chunk and
// never rolls, so lines go out in spaced batches (spike S4); the final pause lets cleanup finish.
async function logInBatches(logger: pino.Logger, lines: number): Promise<void> {
  for (let i = 0; i < lines; i += 1) {
    logger.info({ i, password: SECRET }, `line ${i} Bearer ${SECRET} padding to reach the size limit`);
    if (i % 5 === 4) await sleep(40);
  }
  await sleep(200);
}

async function end(transport: Transport): Promise<void> {
  const closed = once(transport, 'close');
  transport.end();
  await closed;
}

describe('file transport', () => {
  it('rolls into <app>.<yyyy-MM-dd>.<n>.log files, within the retention limit, without secrets', async () => {
    const opts = options(tempDir());
    const transport = rollTransport(opts);
    await logInBatches(pino(buildPinoOptions(opts), transport), 30);
    await end(transport);
    const appDir = path.join(opts.file.dir, 'api-admin');
    const files = readdirSync(appDir);
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files.length).toBeLessThanOrEqual(opts.file.retentionDays + 1);
    expect(files.every((file) => FILE_NAME.test(file))).toBe(true);
    const content = readAll(appDir);
    expect(content).toContain('Bearer [REDACTED] padding');
    expect(content).toContain('"password":"[REDACTED]"');
    expect(content).not.toContain(SECRET);
  }, 20_000);

  it("retention deletes this application's old files and never the other application's", async () => {
    const dir = tempDir();
    const oldDays = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'];
    for (const app of ['api-admin', 'api-driver']) {
      mkdirSync(path.join(dir, app));
      for (const day of oldDays) {
        writeFileSync(path.join(dir, app, `${app}.${day}.1.log`), `{"old":"${app} ${day}"}\n`);
      }
    }
    const driverBefore = readdirSync(path.join(dir, 'api-driver')).sort();
    const opts = options(dir, { retentionDays: 1 });
    const transport = rollTransport(opts);
    await logInBatches(pino(buildPinoOptions(opts), transport), 20);
    await end(transport);
    expect(readdirSync(path.join(dir, 'api-admin')).filter((file) => file.includes('.2026-01-'))).toEqual([]);
    expect(readdirSync(path.join(dir, 'api-driver')).sort()).toEqual(driverBefore);
    expect(readAll(path.join(dir, 'api-driver'))).toContain('"old":"api-driver 2026-01-04"');
  }, 20_000);

  it('createLogDestination writes LOG_DIR/<app>/ (and stdout) and closeLogDestination flushes it', async () => {
    const opts = options(tempDir());
    const destination = createLogDestination(opts);
    pino(buildPinoOptions(opts), destination).info({ password: SECRET }, 'destination probe');
    await closeLogDestination(destination);
    await closeLogDestination(destination);
    const appDir = path.join(opts.file.dir, 'api-admin');
    const files = readdirSync(appDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^api-admin\.\d{4}-\d{2}-\d{2}\.1\.log$/);
    const content = readAll(appDir);
    expect(content).toContain('"msg":"destination probe"');
    expect(content).toContain('"password":"[REDACTED]"');
    expect(content).not.toContain(SECRET);
  });

  it('with file logging disabled uses process.stdout, creates no directory and never ends stdout', async () => {
    const dir = path.join(tempDir(), 'never-created');
    const opts = options(dir, { enabled: false });
    createLoggerModule(opts);
    const destination = createLogDestination(opts);
    expect(destination).toBe(process.stdout);
    await closeLogDestination(destination);
    expect(process.stdout.writableEnded).toBe(false);
    expect(existsSync(dir)).toBe(false);
  });

  itUnlessRoot('fails while the module is built, naming LOG_DIR, when the directory is not writable', () => {
    const dir = tempDir();
    chmodSync(dir, 0o500);
    try {
      expect(() => createLoggerModule(options(dir))).toThrow(`LOG_DIR is not writable: ${dir}`);
      expect(() => createLogDestination(options(dir))).toThrow(`LOG_DIR is not writable: ${dir}`);
    } finally {
      chmodSync(dir, 0o700);
    }
  });
});
```

`packages/logger/test/logger.e2e-spec.ts` (one app per file — nestjs-pino keeps one pino-http per process, see the Spike notes):

```ts
import { Controller, Get, Query, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  InjectPinoLogger,
  LOG_DESTINATION,
  Logger,
  PinoLogger,
  createLoggerModule,
  type LoggerOptions,
} from '../src';
import { MemoryLogStream, type LogRecord } from '../src/testing';

const SECRETS = {
  bearer: 'bearer-secret-7f3a',
  cookie: 'cookie-secret-9b1c',
  deviceKey: 'device-key-secret-2d4e',
  password: 'password-secret-5a6b',
  pin: 'pin-secret-481516',
  queryToken: 'query-token-secret-2342',
  nestedAuth: 'nested-auth-secret-8c9d',
  assigned: 'assigned-token-secret-1e2f',
  thrown: 'thrown-token-secret-6c7d',
} as const;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

@Controller()
class ProbeController {
  constructor(@InjectPinoLogger(ProbeController.name) private readonly logger: PinoLogger) {}

  @Get('probe')
  probe(): { ok: true } {
    this.logger.info(
      {
        user: { password: SECRETS.password },
        items: [{ pin: SECRETS.pin }],
        err: { config: { headers: { authorization: `Bearer ${SECRETS.nestedAuth}` } } },
      },
      `probe ?token=${SECRETS.queryToken}`,
    );
    return { ok: true };
  }

  @Get('assign')
  assign(): { ok: true } {
    this.logger.assign({ token: SECRETS.assigned });
    this.logger.info('after assign');
    return { ok: true };
  }

  @Get('echo')
  echo(@Query('n') n: string): { n: string } {
    this.logger.info({ n }, 'echo');
    return { n };
  }

  @Get('boom')
  boom(): never {
    throw new Error(`boom token=${SECRETS.thrown}`);
  }
}

type LoggedRequest = { id?: string; url?: string; headers?: Record<string, string> };
const reqOf = (record: LogRecord): LoggedRequest => (record['req'] as LoggedRequest | undefined) ?? {};
const completed =
  (url: string) =>
  (record: LogRecord): boolean =>
    record.msg === 'request completed' && reqOf(record).url === url;
const logs = new MemoryLogStream();
const echoLine = (n: string): LogRecord | undefined =>
  logs.records().find((r) => r.msg === 'echo' && r['n'] === n);

describe('createLoggerModule in a Nest app (e2e)', () => {
  const options: LoggerOptions = {
    app: 'api-admin',
    level: 'info',
    file: { enabled: false, dir: 'unused', retentionDays: 1 },
  };
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [createLoggerModule(options)],
      controllers: [ProbeController],
    })
      .overrideProvider(LOG_DESTINATION)
      .useValue(logs)
      .compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    app.useLogger(app.get(Logger));
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps every secret out of the stream and marks where each one was', async () => {
    await request(app.getHttpServer())
      .get(`/api/probe?token=${SECRETS.queryToken}`)
      .set('Authorization', `Bearer ${SECRETS.bearer}`)
      .set('Cookie', `sid=${SECRETS.cookie}`)
      .set('X-Device-Key', SECRETS.deviceKey)
      .expect(200);
    await request(app.getHttpServer()).get('/api/assign').expect(200);
    const probeDone = await logs.waitFor(completed('/api/probe?token=[REDACTED]'));
    await logs.waitFor(completed('/api/assign'));

    expect(reqOf(probeDone).headers).toMatchObject({
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      'x-device-key': '[REDACTED]',
    });
    expect(logs.records().find((r) => r.msg === 'probe ?token=[REDACTED]')).toMatchObject({
      user: { password: '[REDACTED]' },
      items: [{ pin: '[REDACTED]' }],
      err: { config: { headers: { authorization: '[REDACTED]' } } },
    });
    expect(logs.records().find((r) => r.msg === 'after assign')).toMatchObject({ token: '[REDACTED]' });
    const text = logs.text();
    for (const secret of Object.values(SECRETS)) expect(text).not.toContain(secret);
    expect(logs.records().every((r) => r['app'] === 'api-admin')).toBe(true);
  });

  it('echoes a well-formed X-Request-Id and logs it as req.id and reqId', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/echo?n=id-1')
      .set('X-Request-Id', 'my-id-1')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('my-id-1');
    const done = await logs.waitFor(completed('/api/echo?n=id-1'));
    expect(reqOf(done).id).toBe('my-id-1');
    expect(done['reqId']).toBe('my-id-1');
    expect(echoLine('id-1')?.['reqId']).toBe('my-id-1');
  });

  it.each([
    ['long', 'x'.repeat(200)],
    ['spaces', 'bad id with spaces'],
    ['absent', undefined],
  ])('mints a UUID when the caller id is %s and uses it in response and log', async (label, header) => {
    const url = `/api/echo?n=${label}`;
    let call = request(app.getHttpServer()).get(url);
    if (header !== undefined) call = call.set('X-Request-Id', header);
    const res = await call.expect(200);
    const id = res.headers['x-request-id'] as string;
    expect(id).toMatch(UUID_V4);
    expect(reqOf(await logs.waitFor(completed(url))).id).toBe(id);
  });

  it('keeps 50 concurrent requests apart: header, req.id and reqId agree per request', async () => {
    const responses = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        request(app.getHttpServer()).get(`/api/echo?n=c${i}`).set('X-Request-Id', `conc-${i}`),
      ),
    );
    for (const [i, res] of responses.entries()) {
      expect(res.status).toBe(200);
      expect(res.headers['x-request-id']).toBe(`conc-${i}`);
      expect(res.body).toEqual({ n: `c${i}` });
      expect(reqOf(await logs.waitFor(completed(`/api/echo?n=c${i}`))).id).toBe(`conc-${i}`);
      expect(echoLine(`c${i}`)?.['reqId']).toBe(`conc-${i}`);
    }
  });

  it('does not auto-log GET /api/health', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(404);
    await request(app.getHttpServer()).get('/api/echo?n=after-health').expect(200);
    await logs.waitFor(completed('/api/echo?n=after-health'));
    expect(logs.records().filter((r) => (reqOf(r).url ?? '').startsWith('/api/health'))).toEqual([]);
  });

  it("scrubs the message Nest's exception handler logs for an unhandled error", async () => {
    await request(app.getHttpServer()).get('/api/boom').expect(500);
    // Nest 12 calls logger.error(exception); pino copies err.message into msg after the hooks.
    const line = await logs.waitFor((r) => r['context'] === 'ExceptionsHandler');
    expect(line.msg).toContain('token=[REDACTED]');
    expect(line.msg).not.toContain(SECRETS.thrown);
    await logs.waitFor(completed('/api/boom'));
    expect(logs.text()).not.toContain(SECRETS.thrown);
  });

  it("routes Nest's own lines through the same logger", () => {
    const mapped = logs.records().filter((r) => r['context'] === 'RouterExplorer');
    expect(mapped.map((r) => r.msg)).toEqual(
      expect.arrayContaining(['Mapped {/api/probe, GET} route', 'Mapped {/api/echo, GET} route']),
    );
  });
});
```

`packages/logger/test/logger-file.e2e-spec.ts` (regression for spike S4: `app.close()` alone left the file empty or missing under a parallel run):

```ts
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { InjectPinoLogger, Logger, PinoLogger, createLoggerModule } from '../src';

const SECRET = 'file-e2e-secret-2718';

@Controller()
class FileProbeController {
  constructor(@InjectPinoLogger(FileProbeController.name) private readonly logger: PinoLogger) {}

  @Get('file-probe')
  probe(): { ok: true } {
    this.logger.warn({ authorization: `Bearer ${SECRET}` }, 'file probe');
    return { ok: true };
  }
}

describe('file logging inside a Nest app (e2e)', () => {
  it('writes LOG_DIR/<app>/<app>.<date>.1.log and LoggerShutdown flushes it on app.close()', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tms-logger-nest-'));
    const moduleRef = await Test.createTestingModule({
      imports: [
        createLoggerModule({ app: 'api-driver', level: 'warn', file: { enabled: true, dir, retentionDays: 3 } }),
      ],
      controllers: [FileProbeController],
    }).compile();
    const app: INestApplication<App> = moduleRef.createNestApplication({ bufferLogs: true });
    app.useLogger(app.get(Logger));
    app.setGlobalPrefix('api');
    await app.init();
    await request(app.getHttpServer()).get('/api/file-probe').expect(200);
    await app.close();

    const appDir = path.join(dir, 'api-driver');
    const files = readdirSync(appDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^api-driver\.\d{4}-\d{2}-\d{2}\.1\.log$/);
    const content = readFileSync(path.join(appDir, files[0] ?? ''), 'utf8');
    expect(content).toContain('"msg":"file probe"');
    expect(content).toContain('"app":"api-driver"');
    expect(content).toContain('"authorization":"[REDACTED]"');
    expect(content).not.toContain(SECRET);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm turbo run test --filter=@tms/logger`
Expected: RED, exit 1: `Test Suites: 6 failed, 6 total`, each suite failing to load with `Cannot find module '../src/request-id' from 'test/request-id.spec.ts'`, `Cannot find module '../src/options' from 'test/options.spec.ts'` / `'test/redaction.spec.ts'`, `Cannot find module '../src' from 'test/file-transport.spec.ts'` / `'test/logger.e2e-spec.ts'` / `'test/logger-file.e2e-spec.ts'`.

- [ ] **Step 5: Write the request id, redaction and options modules**

`packages/logger/src/request-id.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';
/** At most 64 characters of `[A-Za-z0-9._-]`: no CR/LF, no spaces, safe in headers and logs. */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

type RequestWithId = IncomingMessage & { id?: unknown };

/**
 * The id of this exchange. An id already on `req.id` wins (pino-http's `genReqId` and the CLS
 * middleware of Task 14 both call this; whichever runs first decides), then a conforming
 * `X-Request-Id` from the caller, else a fresh UUID. Stored on `req.id` and echoed on the response.
 */
export function resolveRequestId(req: IncomingMessage, res?: ServerResponse): string {
  const request = req as RequestWithId;
  const current = request.id;
  const id =
    typeof current === 'string' && REQUEST_ID_PATTERN.test(current)
      ? current
      : (fromHeader(req) ?? randomUUID());
  request.id = id;
  if (res && !res.headersSent) res.setHeader('X-Request-Id', id);
  return id;
}

function fromHeader(req: IncomingMessage): string | undefined {
  const value = req.headers[REQUEST_ID_HEADER];
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value) ? value : undefined;
}
```

`packages/logger/src/redaction.ts`:

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import pino, { type LogFn } from 'pino';
import {
  REDACTED,
  isSensitiveKey,
  scrubDeep,
  scrubString,
  scrubUrl,
} from '@tms/contracts/security';

// pino calls formatters.log / formatters.bindings BEFORE the serializers, so these keys still hold
// raw IncomingMessage / ServerResponse / Error objects there; their serializers scrub them.
const SERIALIZED_KEYS: ReadonlySet<string> = new Set(['req', 'res', 'err']);

/** formatters.log and formatters.bindings: every field except the serializer-owned ones. */
export function scrubLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  const scrubbed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SERIALIZED_KEYS.has(key)) scrubbed[key] = value;
    else scrubbed[key] = isSensitiveKey(key) ? REDACTED : scrubDeep(value);
  }
  return scrubbed;
}

/** hooks.logMethod: the message and the interpolation arguments, before pino formats them. */
export function scrubLogArguments(args: Parameters<LogFn>): Parameters<LogFn> {
  return (args as unknown[]).map((arg, index) => {
    if (typeof arg === 'string') return scrubString(arg);
    // Index 0 is the merging object (formatters.log handles it); later objects feed %j / %o.
    if (index > 0 && typeof arg === 'object' && arg !== null) return scrubDeep(arg);
    return arg;
  }) as Parameters<LogFn>;
}

/** `req`: id, method, URL without query secrets, scrubbed headers, remote address. Never the body. */
export function serializeRequest(value: unknown): Record<string, unknown> {
  const req = pino.stdSerializers.req(value as IncomingMessage);
  return {
    id: req.id,
    method: req.method,
    url: typeof req.url === 'string' ? scrubUrl(req.url) : req.url,
    headers: scrubDeep(req.headers),
    remoteAddress: req.remoteAddress,
  };
}

/** `res`: the status code only; response headers (Set-Cookie) are never logged. */
export function serializeResponse(value: unknown): Record<string, unknown> {
  return { statusCode: (value as Partial<ServerResponse>).statusCode };
}

/** `err`: pino's standard shape (type, message and stack with causes, own properties), scrubbed. */
export function serializeError(value: unknown): unknown {
  return scrubDeep(value instanceof Error ? pino.stdSerializers.err(value) : value);
}
```

`packages/logger/src/options.ts`:

```ts
import type { IncomingMessage } from 'node:http';
import { hostname } from 'node:os';
import path from 'node:path';
import type { LoggerOptions as PinoOptions } from 'pino';
import type { Options as PinoHttpOptions } from 'pino-http';
import { REDACTED, scrubString } from '@tms/contracts/security';
import { resolveRequestId } from './request-id';
import {
  scrubLogArguments,
  scrubLogFields,
  serializeError,
  serializeRequest,
  serializeResponse,
} from './redaction';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LoggerOptions {
  app: 'api-admin' | 'api-driver';
  level: LogLevel;
  /** D14: LOG_FILE_ENABLED, LOG_DIR, LOG_RETENTION_DAYS. */
  file: { enabled: boolean; dir: string; retentionDays: number };
}

export type FileTransportOptions = {
  file: string;
  frequency: 'daily';
  dateFormat: 'yyyy-MM-dd';
  mkdir: true;
  limit: { count: number; removeOtherLogFiles: true };
};

// Served by HealthModule (@tms/nest-bootstrap, Task 12) under the global prefix; polled constantly.
const HEALTH_PATH = '/api/health';

// A second guard behind the req/res serializers, which already scrub or drop every header.
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-device-key"]',
  'res.headers["set-cookie"]',
];

/**
 * The pino half of the options, shared by the HTTP logger and plain pino. Redaction uses the rules
 * of @tms/contracts/security at four points: serializers (req/res/err), formatters (every other
 * field and all child bindings), hooks.logMethod (message and interpolation arguments) and
 * hooks.streamWrite (the finished line, e.g. a msg that pino copied from err.message).
 */
export function buildPinoOptions(options: LoggerOptions): PinoOptions {
  return {
    level: options.level,
    base: { app: options.app, pid: process.pid, hostname: hostname() },
    redact: { paths: [...REDACT_PATHS], censor: REDACTED },
    serializers: { req: serializeRequest, res: serializeResponse, err: serializeError },
    formatters: { log: scrubLogFields, bindings: scrubLogFields },
    hooks: {
      logMethod(args, method) {
        method.apply(this, scrubLogArguments(args));
      },
      streamWrite: scrubString,
    },
  };
}

export function buildPinoHttpOptions(options: LoggerOptions): PinoHttpOptions {
  return {
    ...buildPinoOptions(options),
    // The serializers call pino's standard ones themselves: one shape for pino and pino-http.
    wrapSerializers: false,
    genReqId: resolveRequestId,
    // In-request lines carry only reqId; req/res appear once, on "request completed".
    quietReqLogger: true,
    autoLogging: { ignore: (req: IncomingMessage) => (req.url ?? '').split('?')[0] === HEALTH_PATH },
  };
}

/** pino-roll options: LOG_DIR/<app>/<app>.<yyyy-MM-dd>.<n>.log, daily, retentionDays rotated files. */
export function buildFileTransportOptions(options: LoggerOptions): FileTransportOptions {
  return {
    file: path.resolve(options.file.dir, options.app, options.app),
    frequency: 'daily',
    dateFormat: 'yyyy-MM-dd',
    mkdir: true,
    limit: { count: options.file.retentionDays, removeOtherLogFiles: true },
  };
}
```

Run: `pnpm turbo run test --filter=@tms/logger`
Expected: still exit 1, but only the three suites that import `../src` fail to load; `request-id.spec.ts` (12 tests), `options.spec.ts` (9) and `redaction.spec.ts` (6) pass: `Tests: 27 passed, 27 total`, `Test Suites: 3 failed, 3 passed, 6 total`.

- [ ] **Step 6: Write the destination, the module and the package entry**

`packages/logger/src/destination.ts`:

```ts
import { once } from 'node:events';
import { accessSync, constants, mkdirSync } from 'node:fs';
import path from 'node:path';
import pino, { type DestinationStream } from 'pino';
import { buildFileTransportOptions, type LoggerOptions } from './options';

/** DI token of the pino destination; tests override it with a MemoryLogStream. */
export const LOG_DESTINATION = Symbol('LOG_DESTINATION');

type LogTransport = ReturnType<typeof pino.transport>;

// Only transports created here are ended on shutdown; an injected test stream belongs to its test.
const ownedTransports = new WeakSet<object>();

/** Creates LOG_DIR/<app> if needed and fails with a message naming LOG_DIR unless it is writable. */
export function assertLogDirWritable(options: LoggerOptions): void {
  const appDir = path.resolve(options.file.dir, options.app);
  try {
    mkdirSync(appDir, { recursive: true });
    accessSync(appDir, constants.W_OK);
  } catch (cause) {
    throw new Error(`LOG_DIR is not writable: ${options.file.dir}`, { cause });
  }
}

/**
 * process.stdout when file logging is off (D14: LOG_FILE_ENABLED=false); otherwise one worker
 * thread writing every line to stdout (fd 1) and to pino-roll under LOG_DIR/<app>/.
 */
export function createLogDestination(options: LoggerOptions): DestinationStream {
  if (!options.file.enabled) return process.stdout;
  assertLogDirWritable(options);
  // Worker targets default to level info; 'silent' reaches no target, so any level works for it.
  const level = options.level === 'silent' ? 'fatal' : options.level;
  // Explicit type argument: otherwise TypeScript infers the first target's options for both.
  const transport = pino.transport<Record<string, unknown>>({
    targets: [
      { target: 'pino/file', level, options: { destination: 1 } },
      // Absolute path: pino resolves a bare target relative to the file that calls pino.transport.
      { target: require.resolve('pino-roll'), level, options: buildFileTransportOptions(options) },
    ],
  });
  ownedTransports.add(transport);
  return transport;
}

/** Flushes and closes a transport created by createLogDestination; anything else is left alone. */
export async function closeLogDestination(destination: DestinationStream): Promise<void> {
  if (!ownedTransports.has(destination)) return;
  ownedTransports.delete(destination);
  const transport = destination as LogTransport;
  // A line logged by a later shutdown hook reaches an ended worker; it must not crash the exit.
  transport.on('error', () => undefined);
  const closed = once(transport, 'close');
  transport.end();
  await closed;
}
```

`packages/logger/src/logger.module.ts`:

```ts
import { type DynamicModule, Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { LoggerModule, type Params } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import {
  LOG_DESTINATION,
  assertLogDirWritable,
  closeLogDestination,
  createLogDestination,
} from './destination';
import { buildPinoHttpOptions, type LoggerOptions } from './options';

/**
 * Ends the file transport on app.close(), which enableShutdownHooks() also runs on SIGTERM:
 * nestjs-pino has no shutdown hook, and buffered lines would otherwise be lost (spike S4).
 */
@Injectable()
export class LoggerShutdown implements OnApplicationShutdown {
  constructor(@Inject(LOG_DESTINATION) private readonly destination: DestinationStream) {}

  async onApplicationShutdown(): Promise<void> {
    await closeLogDestination(this.destination);
  }
}

export function createLoggerModule(options: LoggerOptions): DynamicModule {
  // Checked while the module is built, before NestFactory.create: a failing provider factory
  // would take Nest's abort-on-error path instead of surfacing this message.
  if (options.file.enabled) assertLogDirWritable(options);
  return LoggerModule.forRootAsync({
    providers: [
      { provide: LOG_DESTINATION, useFactory: () => createLogDestination(options) },
      LoggerShutdown,
    ],
    inject: [LOG_DESTINATION],
    useFactory: (destination: DestinationStream): Params => ({
      pinoHttp: [buildPinoHttpOptions(options), destination],
    }),
  });
}
```

`packages/logger/src/index.ts`:

```ts
export { InjectPinoLogger, Logger, PinoLogger } from 'nestjs-pino';
export { LOG_DESTINATION, closeLogDestination, createLogDestination } from './destination';
export { createLoggerModule } from './logger.module';
export {
  LOG_LEVELS,
  buildFileTransportOptions,
  buildPinoHttpOptions,
  buildPinoOptions,
  type FileTransportOptions,
  type LogLevel,
  type LoggerOptions,
} from './options';
export { REQUEST_ID_HEADER, REQUEST_ID_PATTERN, resolveRequestId } from './request-id';
```

- [ ] **Step 7: Run the tests to verify they pass, also with open-handle detection**

Run: `pnpm turbo run test --filter=@tms/logger`
Expected: GREEN, exit 0: `Test Suites: 6 passed, 6 total`, `Tests: 42 passed, 42 total` (request-id 12, options 9, redaction 6, file-transport 5, logger e2e 9, logger-file e2e 1). Two JSON lines appear raw in the output (`destination probe`, `file probe`): the stdout target of the worker transport writing fd 1. When the suite runs as root, `Tests: 1 skipped, 41 passed, 42 total` (the unwritable-directory case cannot fail for root).

Run: `pnpm turbo run test --filter=@tms/logger -- --detectOpenHandles`
Expected: the same counts, no `Jest has detected the following ... open handle` block and no `Jest did not exit one second after the test run` line (spike S4: pino unrefs its workers; the tests end every transport they create).

- [ ] **Step 8: Lint, typecheck, build and check the built package**

Run: `pnpm turbo run lint --filter=@tms/logger`
Expected: exit 0, no `[boundaries]` message (`logger` imports only `contracts`).

Run: `pnpm turbo run typecheck --filter=@tms/logger`
Expected: exit 0.

Run: `pnpm turbo run build --filter=@tms/logger && ls packages/logger/dist packages/logger/dist/testing`
Expected: exit 0; `destination.js`, `index.js`, `index.d.ts`, `logger.module.js`, `options.js`, `redaction.js`, `request-id.js` (with `.d.ts`/`.map`) and `testing/index.js`, `testing/memory-log-stream.js`.

Run (built CommonJS entry, file target, stdout target, `./testing` export):
```bash
cd packages/logger && node -e "
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const pino = require('pino');
const { buildPinoOptions, closeLogDestination, createLogDestination } = require('@tms/logger');
const { MemoryLogStream } = require('@tms/logger/testing');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tms-logger-dist-'));
const options = { app: 'api-admin', level: 'info', file: { enabled: true, dir, retentionDays: 3 } };
const destination = createLogDestination(options);
pino(buildPinoOptions(options), destination).info({ password: 'dist-secret-1' }, 'dist probe Bearer dist-secret-2');
const keepAlive = setInterval(() => {}, 1000); // the worker is unref'd: without a handle node exits before 'close'
closeLogDestination(destination).then(() => { clearInterval(keepAlive); console.log('files:', fs.readdirSync(path.join(dir, 'api-admin')).join(','), '| MemoryLogStream:', typeof MemoryLogStream); });
"; cd ../..
```
Expected: one JSON line containing `"app":"api-admin"`, `"password":"[REDACTED]"` and `"msg":"dist probe Bearer [REDACTED]"` (no `dist-secret`), then `files: api-admin.<today>.1.log | MemoryLogStream: function`.

Run: `node tools/scripts/check-hygiene.mjs`
Expected: exit 0; the single-copy check (Task 02) still finds one `@nestjs+common@…` and one `@nestjs+core@…` directory.

- [ ] **Step 9: Document the logs**

`docs/architecture.md`, directly under `## Observability — phase 1 (logs, Sentry, audit)` (Tasks 12, 13, 14 append their paragraphs below this one):

```md
**Logs.** Both APIs log through `@tms/logger` (nestjs-pino 5 over pino 10): one JSON object per line
on stdout and, unless `LOG_FILE_ENABLED=false` (D14), the same lines in
`LOG_DIR/<app>/<app>.<yyyy-MM-dd>.<n>.log`, written by `pino-roll` in a worker thread, rolled daily and
kept for `LOG_RETENTION_DAYS` rotated files. Per-application directories (deviation 7) keep numbering
and retention apart: pino-roll numbers from every file in its directory. Redaction applies the rules of
`@tms/contracts/security` in four places: the `req`/`res`/`err` serializers (headers through
`scrubDeep`, the URL through `scrubUrl`, response headers dropped, bodies never logged), the
`log`/`bindings` formatters (every other field, child loggers and `PinoLogger.assign`),
`hooks.logMethod` (message and interpolation arguments) and `hooks.streamWrite` (`scrubString` over
the finished line); pino `redact` paths for the four credential headers stay as a second guard.
Request ids: a caller's `X-Request-Id` is kept when it matches `^[A-Za-z0-9._-]{1,64}$`, otherwise a
UUID is minted; the id is echoed on the response, logged as `req.id` on `request completed` and as
`reqId` on every line logged while the request is handled. `GET /api/health` is never auto-logged.
`LoggerShutdown` ends the file transport on `app.close()` (SIGTERM via `enableShutdownHooks()`);
nestjs-pino alone would drop buffered lines.
```

`README.md`, new section between `## Verification` and `## Repository layout`:

```md
## Observability

- Logs: JSON on stdout and, unless `LOG_FILE_ENABLED=false`, rolling files `LOG_DIR/<app>/<app>.<yyyy-MM-dd>.<n>.log`
  (daily, `LOG_RETENTION_DAYS` rotated files kept); secrets are redacted with the shared rules from `@tms/contracts`.
- Every API response carries `X-Request-Id` (a well-formed caller value is kept); log lines of that request carry the same id.
```

- [ ] **Step 10: Whole-repository verification**

Run: `pnpm exec prettier --write packages/logger docs/architecture.md README.md && pnpm format:check`
Expected: `All matched files use Prettier code style!`

Run: `pnpm verify`
Expected: exit 0; the turbo summary lists `@tms/logger#lint`, `#typecheck`, `#test`, `#build` as successful; hygiene and gitleaks pass.

- [ ] **Step 11: Commit**

Append to `docs/efficiency/critical-path.md`:
`| 2026-MM-DD | Task 10: @tms/logger (redaction, request id, rolling files) | subagent | HH:MM | HH:MM | <rework or none> | n/a | <42 tests (27 pure + 15 with pino/Nest/pino-roll), detectOpenHandles clean, dist smoke file name; spike facts applied: formatters before serializers, streamWrite pass, one pino-http per process> |`

```bash
git add packages/logger pnpm-workspace.yaml pnpm-lock.yaml docs/architecture.md README.md docs/efficiency/critical-path.md
git commit -m "feat(logger): add the pino logger module with redaction, request id and rolling files"
```
Expected: this commit passes all hooks (header 85 characters).

**PR body notes:**
- Diagram: Mermaid `flowchart LR` — HTTP request → pino-http middleware (`resolveRequestId` → `req.id`, `X-Request-Id` header) → handler lines via `PinoLogger` (`reqId`) → serializers `req`/`res`/`err` + formatters `log`/`bindings` + `hooks.logMethod` → `redact` paths → `hooks.streamWrite` (`scrubString`) → `LOG_DESTINATION` → either `process.stdout` (`LOG_FILE_ENABLED=false`) or the worker transport → `pino/file` fd 1 and `pino-roll` `LOG_DIR/<app>/`; side edge `app.close()` → `LoggerShutdown` → `transport.end()` + `close`.
- Boundaries: new package `@tms/logger` (element `logger`, imports only `@tms/contracts`), exports `.` and `./testing`; catalog group `# logging` (4 entries); no app or image change (Task 11 wires it). Migration: no.
- Verification plan: `pnpm verify`; `@tms/logger` tests RED (modules missing) then GREEN, again with `--detectOpenHandles`; lint, typecheck, build and the `dist` smoke; hygiene single-copy check; CI `verify`.
- Verification results (`scenario | layer | outcome`): `request id (hostile header table, 64/65 boundary, memo, fast-check 300 runs) | unit (Jest) | 12 passed`; `pino-http options, health ignore, file options | unit | 9 passed`; `redaction matrix: nested/array/headers/messages/%j/Error msg/causes/child bindings/req-res | unit (pino) | 6 passed`; `pino-roll rotation, retention across two apps, createLogDestination, disabled, unwritable LOG_DIR | worker threads | 5 passed (1 skipped as root)`; `Nest e2e: secrets absent, X-Request-Id echo, UUID for hostile ids, 50 concurrent, health not logged, ExceptionsHandler msg scrubbed, Nest lines | e2e (supertest) | 9 passed`; `file flushed by LoggerShutdown on app.close() | e2e | 1 passed`; `--detectOpenHandles | Jest | clean`; `dist require + file + ./testing | node | files: api-admin.<date>.1.log`; `lint/typecheck/build, hygiene, pnpm verify | repo | exit 0`.
- Risks and notes: deviation 7 (file naming `LOG_DIR/<app>/<app>.<date>.<n>.log`, not `LOG_DIR/api-admin.log`); size rotation is chunk-granular, so the test asserts `>= 2` files, not exact counts; retention runs on a roll, not at startup; nestjs-pino keeps one pino-http per process (Spike notes) — multi-app test files share one stream; `hooks.streamWrite` adds one `scrubString` pass per line (acceptable at POC volume); the header list in `redact` is a second guard only.

---

---

### Task 11: `@tms/nest-bootstrap` — shared env, app setup and bootstrap; the API image builds its dependencies

**Branch:** `phase-1/11-nest-bootstrap`
**PR title:** `feat(nest-bootstrap): share env, app setup and bootstrap between both APIs`

Deviation 2 (new package and boundaries element `bootstrap`, ADR 0008), deviation 8 (typed `loadEnv` before Nest starts, no `@nestjs/config`), deviation 10 (root-owned code, read-only root filesystem), deviation 16 (`.env` loaded by Node's `--env-file-if-exists`), D14 (file logs in containers, `LOG_DIR` is a volume, `LOG_FILE_ENABLED` switch), spec section 11 (logger wired into both APIs), Review Focus item 7 (container runtime). Phase 0's `src/app.ts` and `src/config/env.ts` move out of both apps; the Sentry slot stays on line 1 of `main.ts` (spike S4 C6: `import './instrument'` compiles to the first `require`). Task 12 (`PrismaModule`, `HealthModule`) and Task 13 (Sentry) extend `CoreModule` and `baseEnvSchema` only. Journal inputs from the phase 0 architect review: A-6 (`HOST`: 127.0.0.1 in development, 0.0.0.0 otherwise) and A-4 (a process-level `PORT` test: a real Node process, real exit code).

Composition pattern (Tasks 12 and 13 follow it): a later variable is one more entry at the end of the `baseEnvSchema` object literal in `src/env.ts` (no chained `.extend()`), so `createEnvSchema`, `BaseEnv` and both apps pick it up unchanged; a later module is one more entry of the `imports` array that `CoreModule.forRoot` returns (`createLoggerModule(...)` stays first), plus a `providers` array when a global provider is needed.

Spike notes (verified while writing): `bootstrapApi` resolves `undefined` instead of rethrowing on an invalid environment, because with `void bootstrapApi(...)` a rethrow becomes an unhandled rejection that prints the message a second time with a stack trace. Nest 12.1 HTTP apps flush the `bufferLogs` buffer only in the `listen` callback (`autoFlushLogs`), so `configureApp` keeps an explicit `app.flushLogs()`; a failing `listen` would otherwise log into the buffer. `NestFactory.create` + `listen` + `close` under Jest 30 with `--experimental-vm-modules` passes with `--detectOpenHandles` clean. nestjs-pino's middleware (`/api{/*splat}`) sets `X-Request-Id` on an unknown `/api/*` 404 but not on `/` (outside the prefix). `nest start --exec "node --env-file-if-exists=.env"` loads the app's `.env` (Nest CLI 12.0.5 spawns through a shell by default). pnpm 12.5.1 resolves `catalog:` in `peerDependencies`, and `deploy --legacy --prod --no-optional` of a consumer works. Node 24.21 prints no `ExperimentalWarning` for `require(esm)`, so a CommonJS `dist/main.js` loading the ESM Nest packages writes nothing extra to stderr. nestjs-pino 5.2.0 builds one pino-http instance per process (Task 10's spike notes), so each spec file boots apps with one logger configuration (`core.module.spec.ts` / `core.module.file.spec.ts`), and pino-http writes "request completed" on the response `finish` event, which can fire after supertest resolved — specs poll with `MemoryLogStream.waitFor`. Dependency lists follow "declare what you import": `@tms/nest-bootstrap` gets `@tms/logger` + `zod` (no `@tms/contracts` until Task 12 imports `PUBLIC_ROUTE_KEY`); apps get `@tms/nest-bootstrap` only. From Task 10 this task relies on: `createLoggerModule` provides `LOG_DESTINATION`, creates `LOG_DIR/<app>` while the module is built when `file.enabled`, `LoggerShutdown` ends the file transport on `app.close()`, `Logger`, `PinoLogger` and `LOG_LEVELS` are exported from `@tms/logger` and `MemoryLogStream` from `@tms/logger/testing`; from Task 02: the `bootstrap` element with `bootstrap → contracts, db, logger` and `api → … + bootstrap`, and the hygiene single-copy check.

**Files:**
- Create: `packages/nest-bootstrap/package.json`, `packages/nest-bootstrap/tsconfig.json`, `packages/nest-bootstrap/tsconfig.build.json`, `packages/nest-bootstrap/eslint.config.mjs`, `packages/nest-bootstrap/jest.config.mjs`, `packages/nest-bootstrap/README.md`, `packages/nest-bootstrap/src/env.ts`, `packages/nest-bootstrap/src/app.ts`, `packages/nest-bootstrap/src/core.module.ts`, `packages/nest-bootstrap/src/bootstrap.ts`, `packages/nest-bootstrap/src/index.ts`, `docs/adr/0008-nest-bootstrap-package.md`
- Modify (both apps; `apps/api-admin` shown, `apps/api-driver` differs only in name, port 3002 and comments): `apps/api-admin/package.json` (whole file), `apps/api-admin/src/app.module.ts` (whole file), `apps/api-admin/src/main.ts` (whole file), `apps/api-admin/.env.example` (whole file); `infra/docker/api.Dockerfile` (whole file), `infra/docker-compose.yml:59-87` (services `api-admin`, `api-driver`; 52–80 on `main`, moved by Task 09's `migrate` block) and `:102-103` (top-level `volumes`), `infra/smoke.sh` (inside the `--full` block), `.dockerignore` (append), `docs/adr/README.md:6-8` (Task 07's Accepted/Planned paragraph), `docs/architecture.md:33-37` (the paragraph under the Containers diagram) and the Environments table, `README.md` (Quick start, Repository layout row), `CLAUDE.md` ("Where things live"), `turbo.json` (`@tms/nest-bootstrap#test`), `pnpm-lock.yaml`, `docs/efficiency/critical-path.md`
- Delete (both apps): `src/app.ts`, `src/config/env.ts`, `src/config/env.spec.ts`
- Test: `packages/nest-bootstrap/test/env.spec.ts`, `packages/nest-bootstrap/test/core.module.spec.ts`, `packages/nest-bootstrap/test/core.module.file.spec.ts`, `packages/nest-bootstrap/test/bootstrap.spec.ts`, `packages/nest-bootstrap/test/bootstrap.process.spec.ts`, `packages/nest-bootstrap/test/support/test-app.module.ts`; `apps/api-admin/test/env.spec.ts` (new), `apps/api-admin/test/app.e2e-spec.ts` (whole file; phase 0's probe route, `/api`-prefix and SIGTERM cases kept); same for `apps/api-driver`

**Interfaces:**
- Consumes: `createLoggerModule(options: LoggerOptions): DynamicModule` with `LoggerOptions = { app: 'api-admin' | 'api-driver'; level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'; file: { enabled: boolean; dir: string; retentionDays: number } }`, `Logger` and `PinoLogger` (nestjs-pino, re-exported), `LOG_LEVELS`, `LogLevel` and `LOG_DESTINATION` from `@tms/logger` and `MemoryLogStream` from `@tms/logger/testing` (Task 10); `@tms/config/tsconfig/nest-library.json`, `createJestConfig`, `nodeConfig`, boundaries element `bootstrap` (`bootstrap → contracts, db, logger`; `api → … + bootstrap`), the hygiene single-copy check (Task 02); apps' `"files": ["dist"]` (phase 0); catalog `zod`, `@nestjs/*`, `reflect-metadata`, `rxjs`, `jest`, `ts-jest`, `supertest` (phase 0).
- Produces (`@tms/nest-bootstrap`, CommonJS, `exports["."]` only):
  - `LOG_LEVELS` and `type LogLevel`, re-exported from `@tms/logger` (which owns them: `['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const`).
  - `baseEnvSchema = z.object({ NODE_ENV: enum development|test|production (default development), HOST: string ≥ 1 (optional), LOG_LEVEL: z.enum(LOG_LEVELS) (default info), LOG_FILE_ENABLED: z.stringbool() (default true), LOG_DIR: string ≥ 1 (default 'logs'), LOG_RETENTION_DAYS: int 1–365 (default 14) })`. Task 12 adds `DATABASE_URL`, `HEALTH_DB_TIMEOUT_MS` and Task 13 `SENTRY_*` as further entries of this object literal (see the composition pattern above); `BaseEnv`, `createEnvSchema` and both apps pick them up unchanged.
  - `listenHost(env: Pick<BaseEnv, 'NODE_ENV' | 'HOST'>): string` — `HOST` when set, else `127.0.0.1` for `NODE_ENV=development` and `0.0.0.0` for `test` and `production`.
  - `createEnvSchema({ defaultPort }: { defaultPort: number })` = `baseEnvSchema.extend({ PORT: int 1–65535, default defaultPort })`; `type BaseEnv = z.infer<typeof baseEnvSchema> & { PORT: number }`.
  - `loadEnv<S extends z.ZodType>(schema: S, source: NodeJS.ProcessEnv): z.infer<S>` — throws `Error('Invalid environment: <VAR>: <zod message>; <VAR>: …')` (phase 0 format, schema order).
  - `configureApp<T extends INestApplication>(app: T): T` — `useLogger(app.get(Logger))`, `flushLogs()`, `setGlobalPrefix('api')`, `enableShutdownHooks()`.
  - `type ApiName = LoggerOptions['app']`; `CoreModule.forRoot({ app, env }: { app: ApiName; env: BaseEnv }): DynamicModule` — imports `createLoggerModule({ app, level: env.LOG_LEVEL, file: { enabled: env.LOG_FILE_ENABLED, dir: env.LOG_DIR, retentionDays: env.LOG_RETENTION_DAYS } })`.
  - `interface BootstrapOptions<E extends BaseEnv> { name: ApiName; envSchema: z.ZodType<E>; module: (env: E) => Type<unknown> | DynamicModule; source?: NodeJS.ProcessEnv; stderr?: { write(message: string): unknown } }`; `bootstrapApi<E extends BaseEnv>(options): Promise<INestApplication | undefined>` — invalid env: `<name>: Invalid environment: …\n` on stderr, `process.exitCode = 1`, resolves `undefined`, the module factory is never called; otherwise `NestFactory.create(module(env), { bufferLogs: true })` → `configureApp` → `listen(env.PORT, listenHost(env))` → the app.
  - `export type { Logger } from '@tms/logger'`; `export { LOG_LEVELS, type LogLevel } from '@tms/logger'`.
- Produces (apps): `envSchema = createEnvSchema({ defaultPort: 3001 | 3002 })`, `type Env = z.infer<typeof envSchema>`, `AppModule.forRoot(env: Env): DynamicModule`; `main.ts` = one `bootstrapApi` call; scripts `dev: nest start --watch --exec "node --env-file-if-exists=.env"`, `start: node --env-file-if-exists=.env dist/main.js`; API image with `LOG_DIR=/var/log/tms` owned by `node`, deployed with `--no-optional`; compose volume `logs`.

- [ ] **Step 1: Create the package skeleton and the env tests (RED)**

`packages/nest-bootstrap/package.json`:

```json
{
  "name": "@tms/nest-bootstrap",
  "version": "0.0.0",
  "private": true,
  "type": "commonjs",
  "description": "Typed environment, application setup and bootstrap shared by both TMS NestJS APIs",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' jest"
  },
  "dependencies": {
    "@tms/logger": "workspace:*",
    "zod": "catalog:"
  },
  "peerDependencies": {
    "@nestjs/common": "catalog:",
    "@nestjs/core": "catalog:",
    "@nestjs/platform-express": "catalog:",
    "reflect-metadata": "catalog:",
    "rxjs": "catalog:"
  },
  "devDependencies": {
    "@nestjs/common": "catalog:",
    "@nestjs/core": "catalog:",
    "@nestjs/platform-express": "catalog:",
    "@nestjs/testing": "catalog:",
    "@tms/config": "workspace:*",
    "@types/jest": "catalog:",
    "@types/node": "catalog:",
    "@types/supertest": "catalog:",
    "eslint": "catalog:",
    "jest": "catalog:",
    "reflect-metadata": "catalog:",
    "rxjs": "catalog:",
    "supertest": "catalog:",
    "ts-jest": "catalog:",
    "typescript": "catalog:nest-ts6"
  }
}
```

`typescript` comes from `catalog:nest-ts6` (ts-jest needs TypeScript 6's JS API). `@tms/contracts` is not a dependency yet: nothing here imports it; Task 12 adds it with `PUBLIC_ROUTE_KEY`. `catalog:` in `peerDependencies` resolves in pnpm 12.5.1 like in any other field (checked with a deploy of a consumer).

`packages/nest-bootstrap/tsconfig.json`:

```json
{
  "extends": "@tms/config/tsconfig/nest-library.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true, "types": ["node", "jest"] },
  "include": ["src", "test"]
}
```

`packages/nest-bootstrap/tsconfig.build.json` (restates the `${configDir}/src` and `${configDir}/dist` of `nest-library.json` and undoes the `rootDir: "."` of `tsconfig.json`):

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "rootDir": "./src", "outDir": "./dist", "noEmit": false, "types": ["node"] },
  "include": ["src"],
  "exclude": ["**/*.spec.ts", "**/*.test.ts"]
}
```

`packages/nest-bootstrap/eslint.config.mjs`:

```js
import { nodeConfig } from '@tms/config/eslint/node';

export default nodeConfig({ tsconfigRootDir: import.meta.dirname });
```

`packages/nest-bootstrap/jest.config.mjs`:

```js
import { createJestConfig } from '@tms/config/jest';

export default createJestConfig({ rootDir: import.meta.dirname });
```

`packages/nest-bootstrap/README.md`:

```md
# @tms/nest-bootstrap

Process-level setup both NestJS APIs share, so each app stays at `main.ts` plus its `AppModule`
(ADR-0008):

- `createEnvSchema({ defaultPort })`, `loadEnv(schema, source)` — the zod-validated environment,
  parsed before Nest starts (`NODE_ENV`, `PORT`, `HOST`, `LOG_*`); `listenHost(env)` — 127.0.0.1 in
  development, 0.0.0.0 otherwise, unless `HOST` is set.
- `CoreModule.forRoot({ app, env })` — the logger from `@tms/logger`; database and health (Task 12)
  and Sentry (Task 13) join here.
- `configureApp(app)` — pino as Nest's logger, `/api` prefix, shutdown hooks; e2e tests call it too.
- `bootstrapApi({ name, envSchema, module })` — the whole `main.ts`.
```

`packages/nest-bootstrap/test/env.spec.ts` (phase 0's app env cases moved here and extended; messages are zod 4.6.5's, verified):

```ts
import { LOG_LEVELS } from '@tms/logger';
import { z } from 'zod';
import { createEnvSchema, listenHost, loadEnv } from '../src/env';

const adminSchema = createEnvSchema({ defaultPort: 3001 });

const DEFAULTS = {
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
  LOG_FILE_ENABLED: true,
  LOG_DIR: 'logs',
  LOG_RETENTION_DAYS: 14,
  PORT: 3001,
};

/** loadEnv's error: every offending variable, in schema order, joined with '; '. */
const invalid = (details: string): Error => new Error(`Invalid environment: ${details}`);

describe('loadEnv(createEnvSchema(...))', () => {
  it('applies every default', () => {
    expect(loadEnv(adminSchema, {})).toEqual(DEFAULTS);
  });

  it('takes the default port from the app', () => {
    expect(loadEnv(createEnvSchema({ defaultPort: 3002 }), {})).toEqual({ ...DEFAULTS, PORT: 3002 });
  });

  it('coerces PORT from a string', () => {
    expect(loadEnv(adminSchema, { PORT: '3005' }).PORT).toBe(3005);
  });

  it.each<[string, string]>([
    ['abc', 'Invalid input: expected number, received NaN'],
    ['0', 'Too small: expected number to be >=1'],
    ['70000', 'Too big: expected number to be <=65535'],
    ['-1', 'Too small: expected number to be >=1'],
    ['3001.5', 'Invalid input: expected int, received number'],
  ])('rejects PORT=%s naming the variable', (port, message) => {
    expect(() => loadEnv(adminSchema, { PORT: port })).toThrow(invalid(`PORT: ${message}`));
  });

  it.each(['development', 'test', 'production'])('accepts NODE_ENV=%s', (nodeEnv) => {
    expect(loadEnv(adminSchema, { NODE_ENV: nodeEnv }).NODE_ENV).toBe(nodeEnv);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadEnv(adminSchema, { NODE_ENV: 'staging' })).toThrow(
      invalid('NODE_ENV: Invalid option: expected one of "development"|"test"|"production"'),
    );
  });

  it.each(LOG_LEVELS)('accepts LOG_LEVEL=%s', (level) => {
    expect(loadEnv(adminSchema, { LOG_LEVEL: level }).LOG_LEVEL).toBe(level);
  });

  it('rejects an unknown LOG_LEVEL', () => {
    expect(() => loadEnv(adminSchema, { LOG_LEVEL: 'verbose' })).toThrow(
      invalid(
        'LOG_LEVEL: Invalid option: expected one of "fatal"|"error"|"warn"|"info"|"debug"|"trace"|"silent"',
      ),
    );
  });

  it.each<[string, boolean]>([
    ['true', true],
    ['false', false],
    ['1', true],
    ['0', false],
    ['FALSE', false],
  ])('reads LOG_FILE_ENABLED=%s as %s', (raw, expected) => {
    expect(loadEnv(adminSchema, { LOG_FILE_ENABLED: raw }).LOG_FILE_ENABLED).toBe(expected);
  });

  it('rejects a LOG_FILE_ENABLED that is not a boolean word, naming it', () => {
    expect(() => loadEnv(adminSchema, { LOG_FILE_ENABLED: 'maybe' })).toThrow(
      invalid(
        'LOG_FILE_ENABLED: Invalid option: expected one of "true"|"1"|"yes"|"on"|"y"|"enabled"|"false"|"0"|"no"|"off"|"n"|"disabled"',
      ),
    );
  });

  it('coerces LOG_RETENTION_DAYS', () => {
    expect(loadEnv(adminSchema, { LOG_RETENTION_DAYS: '7' }).LOG_RETENTION_DAYS).toBe(7);
  });

  it.each<[string, string]>([
    ['0', 'Too small: expected number to be >=1'],
    ['366', 'Too big: expected number to be <=365'],
  ])('rejects LOG_RETENTION_DAYS=%s', (days, message) => {
    expect(() => loadEnv(adminSchema, { LOG_RETENTION_DAYS: days })).toThrow(
      invalid(`LOG_RETENTION_DAYS: ${message}`),
    );
  });

  it('rejects an empty LOG_DIR', () => {
    expect(() => loadEnv(adminSchema, { LOG_DIR: '' })).toThrow(
      invalid('LOG_DIR: Too small: expected string to have >=1 characters'),
    );
  });

  it.each<[string, string]>([
    ['development', '127.0.0.1'],
    ['test', '0.0.0.0'],
    ['production', '0.0.0.0'],
  ])('listens on the NODE_ENV=%s default %s while HOST is unset', (nodeEnv, host) => {
    expect(listenHost(loadEnv(adminSchema, { NODE_ENV: nodeEnv }))).toBe(host);
  });

  it('lets an explicit HOST win over the default', () => {
    expect(listenHost(loadEnv(adminSchema, { NODE_ENV: 'production', HOST: '10.0.0.5' }))).toBe(
      '10.0.0.5',
    );
    expect(listenHost(loadEnv(adminSchema, { HOST: '0.0.0.0' }))).toBe('0.0.0.0');
  });

  it('rejects an empty HOST', () => {
    expect(() => loadEnv(adminSchema, { HOST: '' })).toThrow(
      invalid('HOST: Too small: expected string to have >=1 characters'),
    );
  });

  it('names every offending variable in one message', () => {
    expect(() => loadEnv(adminSchema, { PORT: 'abc', NODE_ENV: 'staging' })).toThrow(
      invalid(
        'NODE_ENV: Invalid option: expected one of "development"|"test"|"production"; PORT: Invalid input: expected number, received NaN',
      ),
    );
  });

  it('ignores unrelated variables', () => {
    expect(loadEnv(adminSchema, { HOME: '/home/x', PATH: '/bin' })).toEqual(DEFAULTS);
  });

  it('validates the variables an app adds with .extend()', () => {
    const extended = adminSchema.extend({ EXTRA_URL: z.string().min(1) });
    expect(loadEnv(extended, { EXTRA_URL: 'x' })).toEqual({ ...DEFAULTS, EXTRA_URL: 'x' });
    expect(() => loadEnv(extended, {})).toThrow(
      invalid('EXTRA_URL: Invalid input: expected string, received undefined'),
    );
  });
});
```

Run: `pnpm install && pnpm turbo run test --filter=@tms/nest-bootstrap`
Expected: the lockfile gains the `packages/nest-bootstrap` importer (no new external packages, no `minimumReleaseAgeExclude` lines); turbo builds `@tms/contracts` and `@tms/logger` first; FAIL `test/env.spec.ts` — `Cannot find module '../src/env'` (TS2307), 0 tests run.

- [ ] **Step 2: Write `src/env.ts` (GREEN)**

`packages/nest-bootstrap/src/env.ts` (`LOG_LEVELS` comes from `@tms/logger`, which owns pino's vocabulary and types `LoggerOptions.level` with it):

```ts
import { LOG_LEVELS } from '@tms/logger';
import { z } from 'zod';

/**
 * Variables both APIs read. Later tasks add theirs as further entries of this object (Task 12:
 * DATABASE_URL, HEALTH_DB_TIMEOUT_MS; Task 13: SENTRY_*); an app extends its own schema.
 */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Interface to listen on; unset means the NODE_ENV default of listenHost().
  HOST: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  // D14: file logs are on by default; false where the platform collects stdout.
  LOG_FILE_ENABLED: z.stringbool().default(true),
  LOG_DIR: z.string().min(1).default('logs'),
  LOG_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(14),
});

/** The schema of one API: the shared variables plus PORT with the app's default. */
export function createEnvSchema({ defaultPort }: { defaultPort: number }) {
  return baseEnvSchema.extend({
    PORT: z.coerce.number().int().min(1).max(65535).default(defaultPort),
  });
}

export type BaseEnv = z.infer<typeof baseEnvSchema> & { PORT: number };

/**
 * The interface an API listens on: HOST when set; otherwise 127.0.0.1 in development (a laptop's
 * API is not reachable from the LAN) and 0.0.0.0 in test and production (a container must accept
 * Caddy's connections). A field default cannot depend on NODE_ENV, hence a function.
 */
export function listenHost(env: Pick<BaseEnv, 'NODE_ENV' | 'HOST'>): string {
  return env.HOST ?? (env.NODE_ENV === 'development' ? '127.0.0.1' : '0.0.0.0');
}

/** Validates the environment before Nest starts; fails fast with every offending variable named. */
export function loadEnv<S extends z.ZodType>(schema: S, source: NodeJS.ProcessEnv): z.infer<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }
  return result.data;
}
```

Run: `pnpm turbo run test --filter=@tms/nest-bootstrap`
Expected: PASS, 1 suite, 38 tests (3 singles + 5 PORT + 3 NODE_ENV + 1 + 7 LOG_LEVEL + 1 + 5 LOG_FILE_ENABLED + 1 + 1 + 2 LOG_RETENTION_DAYS + 1 + 3 HOST defaults + 1 + 1 + 1 + 1 + 1).

- [ ] **Step 3: Write the module and bootstrap tests (RED)**

`packages/nest-bootstrap/test/support/test-app.module.ts`:

```ts
import { type DynamicModule, Module } from '@nestjs/common';
import { type BaseEnv, CoreModule } from '../../src';

/** Stand-in for an app's AppModule: only the shared core, no controllers. */
@Module({})
export class TestAppModule {
  static forRoot(env: BaseEnv): DynamicModule {
    return { module: TestAppModule, imports: [CoreModule.forRoot({ app: 'api-admin', env })] };
  }
}
```

`packages/nest-bootstrap/test/core.module.spec.ts`:

```ts
// nestjs-pino 5.2 builds one pino-http instance per process and the first app wins (its
// rootLogger singleton has no public reset), so every spec file starts exactly one app with one
// logger configuration. File logging on: core.module.file.spec.ts.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LOG_DESTINATION, Logger, PinoLogger } from '@tms/logger';
import { MemoryLogStream, type LogRecord } from '@tms/logger/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { configureApp, createEnvSchema, loadEnv } from '../src';
import { TestAppModule } from './support/test-app.module';

const reqId = (record: LogRecord): string | undefined => (record['req'] as { id?: string } | undefined)?.id;

describe('CoreModule.forRoot (file logging off)', () => {
  // pino-http writes "request completed" on the response's finish event, which can fire after
  // supertest has already resolved: MemoryLogStream.waitFor polls instead of reading once.
  const logs = new MemoryLogStream();
  const logDir = mkdtempSync(join(tmpdir(), 'nest-bootstrap-'));
  let app: INestApplication<App>;

  beforeAll(async () => {
    // debug, not the default info: proves LOG_LEVEL travels from the environment to pino.
    const env = loadEnv(createEnvSchema({ defaultPort: 3001 }), {
      LOG_LEVEL: 'debug',
      LOG_FILE_ENABLED: 'false',
      LOG_DIR: logDir,
    });
    const moduleRef = await Test.createTestingModule({ imports: [TestAppModule.forRoot(env)] })
      .overrideProvider(LOG_DESTINATION)
      .useValue(logs)
      .compile();
    app = configureApp(moduleRef.createNestApplication<INestApplication<App>>());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(logDir, { recursive: true, force: true });
  });

  it('provides the pino Logger that configureApp installs', () => {
    expect(app.get(Logger)).toBeInstanceOf(Logger);
  });

  it('passes LOG_LEVEL to the root logger', () => {
    expect(PinoLogger.root.level).toBe('debug');
  });

  it('logs each request with the id the response echoes', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/does-not-exist')
      .set('X-Request-Id', 'core-spec-1')
      .expect(404);
    expect(res.headers['x-request-id']).toBe('core-spec-1');
    const line = await logs.waitFor((record) => reqId(record) === 'core-spec-1');
    expect(line['res']).toEqual({ statusCode: 404 });
  });

  it('creates no log directory when LOG_FILE_ENABLED=false', () => {
    expect(existsSync(join(logDir, 'api-admin'))).toBe(false);
  });
});
```

`packages/nest-bootstrap/test/core.module.file.spec.ts` (the one app of this file keeps the default `LOG_FILE_ENABLED=true`):

```ts
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PinoLogger } from '@tms/logger';
import { configureApp, createEnvSchema, loadEnv } from '../src';
import { TestAppModule } from './support/test-app.module';

describe('CoreModule.forRoot (file logging on, the default)', () => {
  const logDir = mkdtempSync(join(tmpdir(), 'nest-bootstrap-file-'));
  let app: INestApplication;

  beforeAll(async () => {
    const env = loadEnv(createEnvSchema({ defaultPort: 3001 }), { LOG_LEVEL: 'silent', LOG_DIR: logDir });
    const moduleRef = await Test.createTestingModule({ imports: [TestAppModule.forRoot(env)] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(logDir, { recursive: true, force: true });
  });

  it('opens LOG_DIR/<app> for the rolling files', () => {
    expect(existsSync(join(logDir, 'api-admin'))).toBe(true);
  });

  it('passes LOG_LEVEL=silent to the root logger', () => {
    expect(PinoLogger.root.level).toBe('silent');
  });
});
```

`packages/nest-bootstrap/test/bootstrap.spec.ts`:

```ts
import { createServer } from 'node:net';
import request from 'supertest';
import { type BaseEnv, bootstrapApi, createEnvSchema } from '../src';
import { TestAppModule } from './support/test-app.module';

const envSchema = createEnvSchema({ defaultPort: 3001 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A port nobody listens on right now (PORT must be 1-65535, so 0 is not an option). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer().once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

describe('bootstrapApi', () => {
  const exitCodeBefore = process.exitCode;

  afterEach(() => {
    process.exitCode = exitCodeBefore;
  });

  it('reports an invalid environment in one stderr line, sets exit code 1 and builds nothing', async () => {
    const written: string[] = [];
    const module = jest.fn((env: BaseEnv) => TestAppModule.forRoot(env));

    const app = await bootstrapApi({
      name: 'api-admin',
      envSchema,
      module,
      source: { PORT: 'abc', NODE_ENV: 'staging' },
      stderr: { write: (message: string) => written.push(message) },
    });

    expect(app).toBeUndefined();
    expect(written).toEqual([
      'api-admin: Invalid environment: NODE_ENV: Invalid option: expected one of "development"|"test"|"production"; PORT: Invalid input: expected number, received NaN\n',
    ]);
    expect(process.exitCode).toBe(1);
    expect(module).not.toHaveBeenCalled();
  });

  it('builds the module from the parsed environment, applies configureApp and listens on PORT at the development host', async () => {
    const port = await freePort();
    const module = jest.fn((env: BaseEnv) => TestAppModule.forRoot(env));

    const app = await bootstrapApi({
      name: 'api-admin',
      envSchema,
      module,
      source: { PORT: String(port), LOG_LEVEL: 'silent', LOG_FILE_ENABLED: 'false' },
    });
    try {
      expect(module).toHaveBeenCalledWith({
        NODE_ENV: 'development',
        LOG_LEVEL: 'silent',
        LOG_FILE_ENABLED: false,
        LOG_DIR: 'logs',
        LOG_RETENTION_DAYS: 14,
        PORT: port,
      });
      // NODE_ENV defaults to development, so listenHost() binds the loopback interface only.
      expect(app?.getHttpServer().address()).toMatchObject({ address: '127.0.0.1', port });
      const res = await request(`http://127.0.0.1:${port}`).get('/api/does-not-exist').expect(404);
      expect(res.body).toEqual({ statusCode: 404, error: 'Not Found', message: 'Cannot GET /api/does-not-exist' });
      expect(res.headers['x-request-id']).toMatch(UUID);
      await request(`http://127.0.0.1:${port}`).get('/').expect(404);
    } finally {
      await app?.close();
    }
    expect(process.exitCode).toBe(exitCodeBefore);
  });
});
```

`packages/nest-bootstrap/test/bootstrap.process.spec.ts` (journal A-4: the environment check of a real process — real `process.env`, real exit code, real stderr — through the compiled package, the way an app's `dist/main.js` loads it):

```ts
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const PACKAGE_ROOT = resolve(__dirname, '..');
// Built by turbo's @tms/nest-bootstrap#build, which @tms/nest-bootstrap#test depends on (turbo.json).
const DIST = resolve(PACKAGE_ROOT, 'dist', 'index.js');
const MAIN = [
  "require('reflect-metadata');",
  `const { bootstrapApi, createEnvSchema } = require(${JSON.stringify(DIST)});`,
  "void bootstrapApi({ name: 'api-admin', envSchema: createEnvSchema({ defaultPort: 3001 }),",
  "  module: () => { throw new Error('the module factory ran'); } });",
].join('\n');

function runMain(env: Record<string, string>) {
  // cwd = the package, so `-e` resolves reflect-metadata from its node_modules.
  return spawnSync(process.execPath, ['-e', MAIN], {
    cwd: PACKAGE_ROOT,
    env: { PATH: process.env['PATH'] ?? '', ...env },
    encoding: 'utf8',
    timeout: 20_000,
  });
}

describe('bootstrapApi in a real Node process', () => {
  it.each<[string, string]>([
    ['abc', 'PORT: Invalid input: expected number, received NaN'],
    // 0 would make Node pick a random port; the schema refuses it before listen().
    ['0', 'PORT: Too small: expected number to be >=1'],
  ])('PORT=%s exits 1 with one stderr line, no stack trace and no module built', (port, detail) => {
    const result = runMain({ PORT: port });
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(`api-admin: Invalid environment: ${detail}\n`);
    expect(result.stdout).toBe('');
  });
});
```

`turbo.json` — add after the `"@tms/db#test"` entry (the compiled `dist/` must exist before the process spec runs; a `pretest` `tsc` would write `dist/` in parallel with `@tms/nest-bootstrap#build`):

```json
    "@tms/nest-bootstrap#test": { "dependsOn": ["^build", "build"], "outputs": [] },
```

Run: `pnpm turbo run test --filter=@tms/nest-bootstrap`
Expected: `env.spec.ts` PASS (38); `core.module.spec.ts`, `core.module.file.spec.ts` and `bootstrap.spec.ts` FAIL — `Cannot find module '../src'` / `'../../src'` (TS2307), 0 of their 8 tests run; `bootstrap.process.spec.ts` FAILS both cases — `@tms/nest-bootstrap#build` compiled only `src/env.ts`, so the child exits 1 with `Cannot find module '…/dist/index.js'` and a stack trace instead of the one line.

- [ ] **Step 4: Write `configureApp`, `CoreModule`, `bootstrapApi` and the entry (GREEN)**

`packages/nest-bootstrap/src/app.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@tms/logger';

/** Settings shared by bootstrapApi and every e2e test that builds an app from a testing module. */
export function configureApp<T extends INestApplication>(app: T): T {
  app.useLogger(app.get(Logger));
  // Nest flushes the bufferLogs buffer of an HTTP app only once listen() succeeded; flushing here
  // sends a failing listen (port in use) through pino instead of leaving it in the buffer.
  app.flushLogs();
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  return app;
}
```

`packages/nest-bootstrap/src/core.module.ts`:

```ts
import { type DynamicModule, Module } from '@nestjs/common';
import { createLoggerModule, type LoggerOptions } from '@tms/logger';
import type { BaseEnv } from './env';

/** The two deployables; also the name of each app's log directory and files. */
export type ApiName = LoggerOptions['app'];

/**
 * Infrastructure every API imports: the logger now; the Prisma client and /api/health (Task 12)
 * and Sentry (Task 13) join as further `imports` entries after the logger. Feature modules never
 * import it.
 */
@Module({})
export class CoreModule {
  static forRoot({ app, env }: { app: ApiName; env: BaseEnv }): DynamicModule {
    return {
      module: CoreModule,
      imports: [
        createLoggerModule({
          app,
          level: env.LOG_LEVEL,
          file: {
            enabled: env.LOG_FILE_ENABLED,
            dir: env.LOG_DIR,
            retentionDays: env.LOG_RETENTION_DAYS,
          },
        }),
      ],
    };
  }
}
```

`packages/nest-bootstrap/src/bootstrap.ts`:

```ts
import type { DynamicModule, INestApplication, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { z } from 'zod';
import { configureApp } from './app';
import type { ApiName } from './core.module';
import { type BaseEnv, listenHost, loadEnv } from './env';

export interface BootstrapOptions<E extends BaseEnv> {
  name: ApiName;
  envSchema: z.ZodType<E>;
  /** Builds the root module from the parsed environment, e.g. `(env) => AppModule.forRoot(env)`. */
  module: (env: E) => Type<unknown> | DynamicModule;
  /** Defaults to `process.env`. */
  source?: NodeJS.ProcessEnv;
  /** Defaults to `process.stderr`. */
  stderr?: { write(message: string): unknown };
}

/**
 * The whole main.ts of an API. An invalid environment is reported in one stderr line with exit
 * code 1 and resolves `undefined` instead of throwing: `void bootstrapApi(...)` would otherwise turn
 * it into an unhandled rejection that prints the message again with a stack trace.
 */
export async function bootstrapApi<E extends BaseEnv>({
  name,
  envSchema,
  module,
  source = process.env,
  stderr = process.stderr,
}: BootstrapOptions<E>): Promise<INestApplication | undefined> {
  let env: E;
  try {
    env = loadEnv(envSchema, source);
  } catch (error) {
    stderr.write(`${name}: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return undefined;
  }
  const app = await NestFactory.create(module(env), { bufferLogs: true });
  configureApp(app);
  await app.listen(env.PORT, listenHost(env));
  return app;
}
```

`packages/nest-bootstrap/src/index.ts`:

```ts
export { configureApp } from './app';
export { bootstrapApi, type BootstrapOptions } from './bootstrap';
export { type ApiName, CoreModule } from './core.module';
export { type BaseEnv, baseEnvSchema, createEnvSchema, listenHost, loadEnv } from './env';
export { LOG_LEVELS, type LogLevel } from '@tms/logger';
export type { Logger } from '@tms/logger';
```

Run: `pnpm exec prettier --write packages/nest-bootstrap && pnpm turbo run test --filter=@tms/nest-bootstrap`
Expected: PASS, 5 suites, 48 tests (env 38, core.module 4, core.module.file 2, bootstrap 2, bootstrap.process 2).

Run: `pnpm turbo run test --filter=@tms/nest-bootstrap -- --detectOpenHandles`
Expected: the same 48 passing, no "Jest has detected the following open handle" block, no "did not exit one second after the test run" line (the real `listen` in `bootstrap.spec.ts` is closed; `LoggerShutdown` from Task 10 ends the file transport of `core.module.file.spec.ts`).

Run: `pnpm turbo run lint --filter=@tms/nest-bootstrap && pnpm turbo run typecheck --filter=@tms/nest-bootstrap && pnpm turbo run build --filter=@tms/nest-bootstrap && ls packages/nest-bootstrap/dist/*.js`
Expected: exit 0, no `[boundaries]` message (`bootstrap → logger` is allowed); `packages/nest-bootstrap/dist/{app,bootstrap,core.module,env,index}.js` listed (five files).

- [ ] **Step 5: Rewrite the app tests against the package (RED)**

`apps/api-admin/package.json` (whole file; phase 0's `files` kept; `@tms/nest-bootstrap` added; `dev` and `start` load an optional `.env` through Node, deviation 16):

```json
{
  "name": "@tms/api-admin",
  "version": "0.0.0",
  "private": true,
  "description": "Back-office API (admin and operator) of the TMS platform",
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "nest build",
    "dev": "nest start --watch --exec \"node --env-file-if-exists=.env\"",
    "start": "node --env-file-if-exists=.env dist/main.js",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' jest"
  },
  "dependencies": {
    "@nestjs/common": "catalog:",
    "@nestjs/core": "catalog:",
    "@nestjs/platform-express": "catalog:",
    "@tms/nest-bootstrap": "workspace:*",
    "reflect-metadata": "catalog:",
    "rxjs": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@nestjs/cli": "catalog:",
    "@nestjs/schematics": "catalog:",
    "@nestjs/testing": "catalog:",
    "@tms/config": "workspace:*",
    "@types/express": "catalog:",
    "@types/jest": "catalog:",
    "@types/node": "catalog:",
    "@types/supertest": "catalog:",
    "eslint": "catalog:",
    "jest": "catalog:",
    "supertest": "catalog:",
    "ts-jest": "catalog:",
    "typescript": "catalog:nest-ts6"
  }
}
```

`typescript` keeps `main`'s `catalog:nest-ts6` (Nest CLI and ts-jest need TypeScript 6's JS API). The Nest packages stay direct dependencies: they satisfy `@tms/nest-bootstrap`'s peers. `apps/api-driver/package.json` is identical except `name` and `description` (phase 0 values).

`apps/api-admin/test/env.spec.ts` (pins the app's own contract; the variable matrix lives in the package):

```ts
import { loadEnv } from '@tms/nest-bootstrap';
import { envSchema } from '../src/app.module';

describe('api-admin environment', () => {
  it('defaults to port 3001 and JSON log files under ./logs', () => {
    expect(loadEnv(envSchema, {})).toEqual({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      LOG_FILE_ENABLED: true,
      LOG_DIR: 'logs',
      LOG_RETENTION_DAYS: 14,
      PORT: 3001,
    });
  });
});
```

(`apps/api-driver/test/env.spec.ts`: `describe('api-driver environment'`, test name and `PORT: 3002`.)

`apps/api-admin/test/app.e2e-spec.ts` (whole file; phase 0's four cases unchanged — JSON 404, nothing outside `/api`, the test-only probe route under `/api`, one SIGTERM listener — the app now built from `AppModule.forRoot(env)` and `configureApp` from the package, plus the request id):

```ts
import { Test } from '@nestjs/testing';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { configureApp, loadEnv } from '@tms/nest-bootstrap';
import { AppModule, envSchema } from '../src/app.module';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Test-only route: the skeleton has none, so the /api prefix is otherwise unobservable. */
@Controller('probe')
class ProbeController {
  @Get()
  get(): { ok: true } {
    return { ok: true };
  }
}

describe('api-admin skeleton (e2e)', () => {
  let app: INestApplication<App>;
  let sigtermListenersBefore: number;

  beforeAll(async () => {
    const env = loadEnv(envSchema, { LOG_LEVEL: 'silent', LOG_FILE_ENABLED: 'false' });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
      controllers: [ProbeController],
    }).compile();
    sigtermListenersBefore = process.listenerCount('SIGTERM');
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers an unknown /api route with a JSON 404, no stack trace and a request id', async () => {
    const res = await request(app.getHttpServer()).get('/api/does-not-exist').expect(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Cannot GET /api/does-not-exist',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js:\d+/);
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('serves nothing outside the /api prefix', async () => {
    await request(app.getHttpServer()).get('/').expect(404);
  });

  it('mounts routes under /api only', async () => {
    await request(app.getHttpServer()).get('/api/probe').expect(200, { ok: true });
    await request(app.getHttpServer()).get('/probe').expect(404);
  });

  it('listens for SIGTERM so a container stops gracefully', () => {
    expect(process.listenerCount('SIGTERM')).toBe(sigtermListenersBefore + 1);
  });
});
```

(`apps/api-driver/test/app.e2e-spec.ts`: `describe('api-driver skeleton (e2e)'`; nothing else differs.) The request id is asserted only under `/api`: nestjs-pino mounts its middleware on `/api{/*splat}`, so `/` carries none (verified).

Run: `git rm -q apps/api-admin/src/config/env.spec.ts apps/api-driver/src/config/env.spec.ts && pnpm install && pnpm turbo run test --filter=@tms/api-admin`
Expected: FAIL, 2 suites: `test/env.spec.ts` — `TypeError: Cannot read properties of undefined (reading 'safeParse')` (`envSchema` is not exported yet; ts-jest does not type-check under `isolatedModules: true`); `test/app.e2e-spec.ts` — `TypeError: AppModule.forRoot is not a function` in `beforeAll`; 0 tests pass (`pnpm turbo run typecheck --filter=@tms/api-admin` shows TS2305/TS2339). Same for `--filter=@tms/api-driver`.

- [ ] **Step 6: Reduce both apps to `main.ts` + `AppModule` (GREEN)**

Run: `git rm -q apps/api-admin/src/app.ts apps/api-admin/src/config/env.ts apps/api-driver/src/app.ts apps/api-driver/src/config/env.ts`

`apps/api-admin/src/app.module.ts`:

```ts
import { type DynamicModule, Module } from '@nestjs/common';
import { CoreModule, createEnvSchema } from '@tms/nest-bootstrap';
import type { z } from 'zod';

/** The back-office API's environment: the shared variables, PORT defaulting to 3001. */
export const envSchema = createEnvSchema({ defaultPort: 3001 });
export type Env = z.infer<typeof envSchema>;

/** Root module; feature modules join `imports` next to CoreModule from phase 2 on. */
@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return { module: AppModule, imports: [CoreModule.forRoot({ app: 'api-admin', env })] };
  }
}
```

`apps/api-admin/src/main.ts`:

```ts
// Phase 1 Task 13: `import './instrument';` (Sentry) must stay the first import of this file.
import 'reflect-metadata';
import { bootstrapApi } from '@tms/nest-bootstrap';
import { AppModule, envSchema } from './app.module';

void bootstrapApi({ name: 'api-admin', envSchema, module: (env) => AppModule.forRoot(env) });
```

`apps/api-driver/src/app.module.ts` and `main.ts`: the same with `defaultPort: 3002`, `app: 'api-driver'`, `name: 'api-driver'` and "kiosk API" in the doc comments.

`apps/api-admin/.env.example` (whole file; phase 0's note on turbo's strict env mode kept):

```ini
# Back-office API. `pnpm dev` and `pnpm start` load ./.env through Node (--env-file-if-exists);
# variables set in the shell win over the file, but the root `pnpm dev` runs through turbo, whose
# strict env mode drops shell variables such as PORT: set them here, or run `pnpm dev` inside
# apps/api-admin. Never commit a real .env.
NODE_ENV=development
# HTTP port; the web-admin Vite proxy and Caddy forward /api here.
PORT=3001
# Interface to listen on. Unset: 127.0.0.1 in development (not reachable from the LAN), 0.0.0.0 in
# test and production (containers).
# HOST=127.0.0.1
# fatal | error | warn | info | debug | trace | silent
LOG_LEVEL=info
# JSON log files next to stdout (D14); set false where the platform collects stdout.
LOG_FILE_ENABLED=true
# Files: LOG_DIR/api-admin/api-admin.<yyyy-MM-dd>.<n>.log, relative to the app directory.
LOG_DIR=logs
# Rotated files kept per app (1-365).
LOG_RETENTION_DAYS=14
```

(`apps/api-driver/.env.example`: first line "Kiosk API.", `apps/api-driver` in the turbo note, `PORT=3002`, "the web-driver Vite proxy", `LOG_DIR/api-driver/api-driver.<yyyy-MM-dd>.<n>.log`.)

Run: `pnpm exec prettier --write apps/api-admin apps/api-driver && pnpm turbo run test --filter=@tms/api-admin && pnpm turbo run test --filter=@tms/api-driver`
Expected: PASS for each: 2 suites (unchanged count), 5 tests (`env.spec.ts` 1, `app.e2e-spec.ts` 4; phase 0's 10 env cases now live in the package).

Run: `pnpm turbo run lint --filter=@tms/nest-bootstrap --filter=@tms/api-admin --filter=@tms/api-driver && pnpm turbo run typecheck --filter=@tms/nest-bootstrap --filter=@tms/api-admin --filter=@tms/api-driver && pnpm turbo run build --filter=@tms/api-admin --filter=@tms/api-driver`
Expected: exit 0 for all three; the lint output contains no `[boundaries]` line and no `no-restricted-imports` error (api-driver's rule restricts only `@tms/domain`).

Run: `sed -n 1,5p apps/api-admin/dist/main.js`
Expected: `"use strict";`, the `__esModule` line, then `require("reflect-metadata");` as the first `require` — the slot Task 13 fills with `require("./instrument")` (S4 C6).

Run:
```bash
(PORT=3101 LOG_FILE_ENABLED=false timeout 15 node apps/api-admin/dist/main.js > /dev/null &) ; sleep 3
curl -sD- -o /dev/null -H 'X-Request-Id: manual-1' http://localhost:3101/api/x | tr -d '\r' | grep -Ei '^HTTP/|^x-request-id'
curl -sD- -o /dev/null http://localhost:3101/api/x | tr -d '\r' | grep -i '^x-request-id'
node -e "require('node:http').get('http://localhost:3101/api/x', (r) => console.log('node http via localhost:', r.statusCode))"
PORT=abc node apps/api-admin/dist/main.js; echo exit=$?
```
Expected: `HTTP/1.1 404 Not Found`, `X-Request-Id: manual-1`, then `X-Request-Id: <uuid>`, then `node http via localhost: 404` — the development default binds 127.0.0.1 only, and a Node HTTP client (what Vite's dev proxy uses for `http://localhost:3001`) still connects because `autoSelectFamily` tries `127.0.0.1` after `::1`; the last command prints exactly `api-admin: Invalid environment: PORT: Invalid input: expected number, received NaN` (no stack trace) and `exit=1`. Repeat for `apps/api-driver` on 3102 (`api-driver:` prefix).

Run (the `dev` script's `.env` loading; skipped when a developer `.env` already exists, so nothing of theirs is touched):
```bash
if [ ! -e apps/api-admin/.env ]; then
  printf 'PORT=3104\nLOG_FILE_ENABLED=false\n' > apps/api-admin/.env
  (timeout 45 pnpm turbo run dev --filter=@tms/api-admin > /dev/null 2>&1 &) ; sleep 30
  curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3104/api/x
  rm apps/api-admin/.env
else echo "skipped: apps/api-admin/.env exists"; fi
```
Expected: `404` (the app listens on the port from `.env`, not the default 3001).

- [ ] **Step 7: Build dependencies in the API image, add the logs volume and check both images**

`infra/docker/api.Dockerfile` (whole file; the pnpm install from `packageManager` is phase 0's; phase 0 built only the app and deployed without `--no-optional`):

```dockerfile
# syntax=docker/dockerfile:1.7
ARG APP
FROM node:26-bookworm-slim AS build
ARG APP
WORKDIR /repo
# pnpm version from package.json#packageManager, the single place it is pinned.
COPY package.json ./
RUN npm install -g "$(node -p "require('./package.json').packageManager")"
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@tms/${APP}..."
# Workspace dependencies first (topological), then the app. --no-optional keeps the Prisma CLI,
# an optional dependency of @tms/db from Task 12 on, out of the image (spike S1).
RUN pnpm --filter "@tms/${APP}..." run --if-present generate \
 && pnpm --filter "@tms/${APP}..." run build \
 && pnpm --filter "@tms/${APP}" deploy --legacy --prod --no-optional /out

FROM node:26-bookworm-slim AS runtime
ENV NODE_ENV=production LOG_DIR=/var/log/tms
# A new `logs` volume is initialised from this directory, ownership included (D14).
RUN mkdir -p /var/log/tms && chown node:node /var/log/tms
WORKDIR /app
# Root-owned on purpose (deviation 10): the writable paths are LOG_DIR and /tmp.
COPY --from=build /out .
USER node
CMD ["node", "dist/main.js"]
```

`.dockerignore` — append (local `pnpm dev` writes `apps/*/logs/`):

```
**/logs
```

`infra/docker-compose.yml:59-87` (after Task 09; locate by service name) — replace the `api-admin` and `api-driver` services (`DATABASE_URL` keeps phase 0's `*database-url` alias; no `HOST`: production binds 0.0.0.0) and, at `:102-103`, the top-level `volumes`:

```yaml
  api-admin:
    profiles: [full]
    build:
      context: ..
      dockerfile: infra/docker/api.Dockerfile
      args:
        APP: api-admin
    environment:
      NODE_ENV: production
      PORT: '3001'
      DATABASE_URL: *database-url
      LOG_DIR: /var/log/tms
      LOG_FILE_ENABLED: 'true'
    # Read-only root filesystem (deviation 10); the writable paths are the logs volume and /tmp.
    read_only: true
    tmpfs:
      - /tmp
    volumes:
      - logs:/var/log/tms
    depends_on:
      migrate:
        condition: service_completed_successfully

  api-driver:
    profiles: [full]
    build:
      context: ..
      dockerfile: infra/docker/api.Dockerfile
      args:
        APP: api-driver
    environment:
      NODE_ENV: production
      PORT: '3002'
      DATABASE_URL: *database-url
      LOG_DIR: /var/log/tms
      LOG_FILE_ENABLED: 'true'
    read_only: true
    tmpfs:
      - /tmp
    volumes:
      - logs:/var/log/tms
    depends_on:
      migrate:
        condition: service_completed_successfully
```

```yaml
volumes:
  pgdata:
  # D14: both APIs write LOG_DIR/<app>/<app>.<date>.<n>.log here; per-app directories keep
  # pino-roll's retention from deleting the other app's files (deviation 7).
  logs:
```

`infra/smoke.sh` — inside the `--full` block, after `check_origin web-driver "${CADDY_KIOSK_PORT:-8081}" "TMS Kiosk"`:

```bash
  # D14: each API writes JSON log files into the shared `logs` volume, one directory per app.
  check_log_file() { # service
    local file=""
    for _ in $(seq 1 10); do
      file=$(compose exec -T "$1" sh -c "ls /var/log/tms/$1/*.log 2>/dev/null | head -1")
      [ -n "$file" ] && break
      sleep 1
    done
    [ -n "$file" ] || fail "$1: no log file under /var/log/tms/$1"
    echo "ok   $1 writes $file"
  }
  check_log_file api-admin
  check_log_file api-driver
```

Run:
```bash
docker build --build-arg APP=api-admin -f infra/docker/api.Dockerfile -t tms-p1-api-admin .
docker build --build-arg APP=api-driver -f infra/docker/api.Dockerfile -t tms-p1-api-driver .
RUN_API='docker run --rm -d --read-only --tmpfs /tmp -v tms-p1-logs:/var/log/tms'
$RUN_API --name tms-p1-api-admin -p 53001:3001 tms-p1-api-admin
$RUN_API --name tms-p1-api-driver -p 53002:3002 tms-p1-api-driver
sleep 3
for port in 53001 53002; do curl -sS -D- http://localhost:$port/api/does-not-exist | tr -d '\r' | grep -Eio '^HTTP/1.1 404|^x-request-id: .*|"statusCode":404'; done
sleep 1
docker exec tms-p1-api-admin sh -c 'ls /var/log/tms; ls /var/log/tms/api-admin; grep -c "\"statusCode\":404" /var/log/tms/api-admin/*.log; id -u; touch /app/probe'; echo exit=$?
docker run --rm --entrypoint sh tms-p1-api-admin -c 'ls dist/main.js && stat -c %U dist node_modules && test ! -e src && test ! -e test && ls node_modules/@tms'
docker run --rm --entrypoint node tms-p1-api-admin -e "require.resolve('prisma/package.json')" 2>&1 | grep -o MODULE_NOT_FOUND | head -1
docker rm -f tms-p1-api-admin tms-p1-api-driver
```
Expected: both builds end with `[WARN] Shared workspace lockfile detected but configuration forces legacy deploy implementation.` and succeed; for each port `HTTP/1.1 404`, `X-Request-Id: <uuid>`, `"statusCode":404`; the `docker exec` prints `api-admin` and `api-driver` (one directory per app in the shared volume), `api-admin.<yyyy-MM-dd>.1.log`, `1` (the request line), `1000`, then `touch: cannot touch '/app/probe': Read-only file system` and `exit=1`; the contents check prints `dist/main.js`, `root` twice, `nest-bootstrap`; the Prisma probe prints `MODULE_NOT_FOUND` (trivially true until Task 12 adds `@tms/db`; the flag is what keeps it true then). The published ports answer only because `NODE_ENV=production` makes `listenHost` bind 0.0.0.0 inside the container.

Run (Review Focus 7: `LOG_FILE_ENABLED=false` really disables file logging):
```bash
docker run --rm -d --read-only --tmpfs /tmp -v tms-p1-logs-off:/var/log/tms --name tms-p1-api-admin -p 53001:3001 -e LOG_FILE_ENABLED=false tms-p1-api-admin
sleep 3; curl -s -o /dev/null -w '%{http_code}\n' http://localhost:53001/api/x
docker exec tms-p1-api-admin sh -c 'ls -A /var/log/tms | wc -l'
docker logs tms-p1-api-admin 2>&1 | grep -c '"statusCode":404'
docker rm -f tms-p1-api-admin && docker volume rm tms-p1-logs tms-p1-logs-off
```
Expected: `404`, `0` (empty volume), `1` (the request is still logged to stdout).

Run (the production-like stack, alternate ports):
```bash
export POSTGRES_PORT=55432 MAILPIT_UI_PORT=58025 MAILPIT_SMTP_PORT=51025 CADDY_ADMIN_PORT=58080 CADDY_KIOSK_PORT=58081
pnpm compose -p tms-p1 --profile full up -d --build
COMPOSE_PROJECT_NAME=tms-p1 infra/smoke.sh --full; echo exit=$?
E2E_ADMIN_URL=http://localhost:58080 E2E_DRIVER_URL=http://localhost:58081 pnpm e2e
pnpm compose -p tms-p1 --profile full down -v
unset POSTGRES_PORT MAILPIT_UI_PORT MAILPIT_SMTP_PORT CADDY_ADMIN_PORT CADDY_KIOSK_PORT
```
Expected: Task 09's lines, both `check_origin` blocks, `ok   api-admin writes /var/log/tms/api-admin/api-admin.<yyyy-MM-dd>.1.log`, `ok   api-driver writes /var/log/tms/api-driver/api-driver.<yyyy-MM-dd>.1.log`, `smoke: all checks passed`, `exit=0`; Playwright `8 passed` (phase 0's 4 smoke tests per project, unchanged).

- [ ] **Step 8: ADR 0008 and documentation**

`docs/adr/0008-nest-bootstrap-package.md`:

```markdown
# ADR-0008: Shared Nest bootstrap package (`@tms/nest-bootstrap`)

- Status: accepted
- Date: 2026-09-23
- Spec reference: sections 3, 5, 6 and 11; D5, D14; phase 1 plan deviations 2 and 8

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
`CoreModule.forRoot({ app, env })` (the logger now; the Prisma client and `HealthModule` in Task 12;
the Sentry module and filter plus the Nest-free `@tms/nest-bootstrap/sentry` subpath in Task 13).
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
```

`docs/adr/README.md:6-8` — replace the Accepted/Planned paragraph (Task 07's wording) with:

```markdown
Accepted: 0001 two Nest processes with shared packages, 0002 Prisma as the ORM, 0004 permission
catalogue and sync, 0007 client name kept out of the repository by convention, 0008 shared Nest
bootstrap package. Planned: 0003 origin/CSRF/sessions, 0005 kiosk device key model, 0006
transactions and events.
```

`docs/architecture.md:33-37` — replace the paragraph under the Containers diagram (phase 0's sentence on the kiosk network kept):

```markdown
Two NestJS processes share `contracts`, `db`, `auth-core` and `domain` through workspace packages
(ADR-0001). Both APIs boot through `@tms/nest-bootstrap` (ADR-0008): a zod-validated environment
before Nest starts, the `/api` prefix, shutdown hooks and the pino logger, so each app is `main.ts`
plus its `AppModule`; they listen on `127.0.0.1` in development and on `0.0.0.0` in containers
(`HOST` overrides). Each SPA and its API sit behind one origin: Caddy in compose, Vite's dev proxy
locally (D11). Migrations run only in the one-shot `migrate` service or `predev`, never in an app
(D12). In production the kiosk origin runs on an isolated terminal network; the compose stack
serves both origins from one Caddy container on one Docker network.
```

`docs/architecture.md` Environments table — insert after the "Migrations" row:

```markdown
| Logs       | stdout + `apps/api-*/logs/<app>/` (`LOG_DIR`) | stdout + volume `logs` at `/var/log/tms/<app>/` |
```

`README.md` Quick start block (Task 08's) — insert after the `cp packages/db/.env.example packages/db/.env   # set BOOTSTRAP_ADMIN_EMAIL …` line:

```bash
cp apps/api-admin/.env.example apps/api-admin/.env
cp apps/api-driver/.env.example apps/api-driver/.env
```

and after the block (before Task 08's `predev` paragraph):

```markdown
The API `.env` files are optional: `pnpm dev` and `pnpm start` load them through Node's
`--env-file-if-exists`, and without them the APIs use their defaults (ports 3001/3002 on 127.0.0.1,
JSON logs on stdout and in `apps/api-*/logs/`). An invalid variable stops the API before Nest
starts, naming it.
```

`README.md` Repository layout, `packages/*` row:

```markdown
| `packages/*`                        | shared code: `config`, `db` (Prisma), `contracts`, `logger`, `nest-bootstrap` (shared Nest setup); `auth-core`, `domain`, `ui` as their phases land |
```

`CLAUDE.md` "Where things live" — insert after line 41 (``- `packages/contracts`, `auth-core`, `domain`, `logger`, `ui` — arrive in phases 1–6 (see spec §6)``; line 40 on `main`, moved by Task 08's three-line `pnpm dev` bullet):

```markdown
- `packages/nest-bootstrap` — env, app setup, health, Sentry (apps stay at `main.ts` + `AppModule`)
```

Run: `pnpm exec prettier --write docs/adr/0008-nest-bootstrap-package.md docs/adr/README.md docs/architecture.md README.md CLAUDE.md infra/docker-compose.yml && pnpm format:check && wc -l CLAUDE.md`
Expected: exit 0; `78 CLAUDE.md` (Task 08's 77 + one line; limit 150).

- [ ] **Step 9: Verify the repository**

Run: `node tools/scripts/check-hygiene.mjs && ls node_modules/.pnpm | grep -cE '^@nestjs\+common@' && ls node_modules/.pnpm | grep -cE '^@nestjs\+core@'`
Expected: `hygiene: ok (<n> tracked files, single copies ok)` — the Task 02 single-copy rule now sees a library with Nest peers and still finds one directory each — then `1` and `1`.

Run: `bash -n infra/smoke.sh && pnpm verify`
Expected: all turbo tasks green (`@tms/nest-bootstrap` 5 suites / 48 tests; each API 2 suites / 5 tests); `prettier --check` clean; `hygiene: ok`; gitleaks `no leaks found`.

After pushing: CI `verify`, `hygiene`, `db-drift`, `e2e` green (`e2e` runs the new log-file checks in `smoke.sh --full`).

- [ ] **Step 10: Commit**

Append the journal row to `docs/efficiency/critical-path.md`:

```
| 2026-MM-DD | Task 11: @tms/nest-bootstrap, app refactor, api image builds dependencies | subagent | HH:MM | HH:MM | none | n/a | Env matrix 38 (exact zod messages, HOST defaults per NODE_ENV), CoreModule 4 + 2 (one app per spec file: nestjs-pino keeps one pino-http per process; level, request id, file off / on), bootstrapApi 2 (invalid env → one stderr line + exit 1, real listen on 127.0.0.1) + 2 in a real process (PORT=abc / PORT=0 → exit 1, one line); apps 2 suites / 5 tests each, X-Request-Id on the 404, probe route and SIGTERM kept. PORT=abc → exit 1 without stack. Both images read-only, uid 1000, LOG_DIR volume with api-admin/ + api-driver/, LOG_FILE_ENABLED=false → empty volume, no Prisma CLI. smoke --full + Playwright 8/8 on tms-p1. ADR 0008. dev script loads .env via --exec. |
```

```bash
git add turbo.json packages/nest-bootstrap apps/api-admin apps/api-driver infra/docker/api.Dockerfile infra/docker-compose.yml infra/smoke.sh .dockerignore docs/adr/0008-nest-bootstrap-package.md docs/adr/README.md docs/architecture.md README.md CLAUDE.md pnpm-lock.yaml docs/efficiency/critical-path.md
git commit -m "feat(nest-bootstrap): share env, app setup and bootstrap between both APIs"
```
Expected: this commit passes all hooks (header 74 characters); `git status` shows the six deleted app files as part of the commit (staged by `git rm` in Steps 5–6).

**PR body notes:**
- Diagram: Mermaid `flowchart TB` — `main.ts` → `bootstrapApi` → `loadEnv(envSchema, process.env)` → {invalid: stderr line + exit code 1; valid: `module(env)` = `AppModule.forRoot(env)` → `NestFactory.create(…, { bufferLogs })` → `configureApp` (useLogger, flushLogs, `/api`, shutdown hooks) → `listen(PORT)`}; `AppModule` → `CoreModule.forRoot({ app, env })` → `createLoggerModule` (stdout + pino-roll into `LOG_DIR/<app>/`); dotted boxes for Task 12 (`PrismaModule`, `HealthModule`) and Task 13 (Sentry) inside `CoreModule`.
- Boundaries: new package `@tms/nest-bootstrap` (element `bootstrap`, public API above), both apps (`src/app.ts` and `src/config/*` removed, `AppModule.forRoot`, `dev`/`start` scripts), `infra/docker/api.Dockerfile` (builds workspace dependencies, `--no-optional`, `LOG_DIR`), compose (volume `logs`, `read_only`), `smoke.sh --full`, `.dockerignore`, ADR 0008. Migration: no.
- Verification plan: `pnpm verify`; `@tms/nest-bootstrap` tests RED then GREEN, again with `--detectOpenHandles`; app suites RED then GREEN; manual `PORT=abc`, request-id, `localhost` and `.env` checks; both images read-only with and without file logs; `smoke.sh --full` + Playwright on `tms-p1`; CI `verify`, `hygiene`, `db-drift`, `e2e`.
- Verification results (`scenario | layer | outcome`): env matrix incl. HOST | unit | 38 passed (RED first: cannot find `../src/env`); CoreModule + bootstrapApi | Nest testing module / real listen | 8 passed, `--detectOpenHandles` clean; `PORT=abc` / `PORT=0` in a real process | process (spawn) | 2 passed; api-admin / api-driver | e2e | 2 suites, 5 tests each (RED first: no `forRoot`); `PORT=abc` | process | one line, `exit=1`; request id | curl | echoed / UUID; `dev` with `.env` | process | port from `.env`; images | docker | 404 JSON + `X-Request-Id`, log file, uid 1000, read-only `/app`, no Prisma CLI; `LOG_FILE_ENABLED=false` | docker | empty volume, stdout still logs; smoke `--full` + Playwright | compose `tms-p1` | all checks passed, 8 passed; hygiene single copy | repo | one `@nestjs/common`, one `@nestjs/core`; `pnpm verify` | repo | green.
- Risks and notes: deviation 2 (new package and element, ADR 0008), 8 (no `@nestjs/config`), 10 (read-only root filesystem now also for the APIs), 16 (`dev` gained `--exec "node --env-file-if-exists=.env"`, verified with Nest CLI 12.0.5, which spawns through a shell by default); Node 26 from `main` covers Sentry 11's `Module.registerHooks` (Task 13); `--no-optional` also drops any other optional dependency of the app tree — none is needed at runtime today (S1 booted the deployed app), re-check when adding native packages; `bootstrapApi` resolves `undefined` instead of rethrowing on an invalid environment (single clean error line); `HOST` defaults to 127.0.0.1 in development (journal A-6: a laptop's API is not on the LAN; Node HTTP clients such as Vite's proxy fall back from `::1` to it) and 0.0.0.0 in containers, where compose sets nothing; the apps' `test/env.spec.ts` and `test/app.e2e-spec.ts` gain `DATABASE_URL` in Task 12, which makes it required in `baseEnvSchema`.

---

### Task 12: Health endpoint and `@tms/db/nest`

**Branch:** `phase-1/12-health`
**PR title:** `feat(nest-bootstrap): add /api/health with a database ping on both APIs`

**Split (recommended):** Steps 1–4 (`@tms/db/nest`, fault proxy, db manifest) ship first as `feat(db): add the Nest PrismaModule and a TCP fault proxy for tests` on `phase-1/12a-db-nest`; Steps 5–16 follow on `phase-1/12b-health` with the title above. Both stay green alone.

Spec: D5 (`/health` public, only `ok`/`degraded`, no database details), section 11 (Health: terminus on both APIs), Review Focus 5 and 7, deviation 9 (degraded = HTTP 503, the body names the service). Journal inputs from the phase 0 architect review: I7-1 (routing identity — today's smoke and Playwright cannot tell api-admin and api-driver apart by their identical 404s, so the health body names the service and both check it per origin) and M6-6 (API healthchecks, restart policies and a migrate-ordering proof in `smoke.sh --full`). Depends on Tasks 04 (harness), 05 (`createPrismaClient`, generated client), 10 (`@tms/logger`), 11 (`@tms/nest-bootstrap`, apps' `AppModule.forRoot(env)`, the composition pattern: new variables are entries of the `baseEnvSchema` object literal, new modules are entries of `CoreModule.forRoot`'s `imports`).

Spike notes (read in the installed packages of the S4 scratch project, `@nestjs/core@12.1.0`, `@prisma/adapter-pg@7.10.0`, `zod@4.6.5`): Nest applies `@Header()` values before invoking the handler (`router-execution-context.js`), so `Cache-Control: no-store` is also on the 503 built by the exception filter. `z.url({ protocol: /^postgres(ql)?$/, hostname: /^.+$/, error })` accepts `postgres://` and `postgresql://` (also `[::1]`), rejects `mysql://`, `postgresql:/x` and `postgresql://`, and its message never contains the input. `@prisma/adapter-pg` 7.10 attaches its own pool `error` listener (`onIdleClientError`), so a database that drops idle connections does not crash the process; `$disconnect` ends the pool. Prisma 7's `PrismaClient` constructor returns a proxy, so `instanceof PrismaService` is false by design: identity checks compare references or the constructor. A container restart may get a new random host port, so the recovery tests use an in-process TCP fault proxy (`startFaultProxy`) in front of a dedicated Testcontainers Postgres; the only real container action is a final `container.stop()`. The scratch run of the service-name variant: 27/27 tests, `tsc` and the repository's lint rules clean.

**Files:**
- Create: `packages/db/src/nest/index.ts`, `packages/db/src/nest/prisma.service.ts`, `packages/db/src/nest/prisma.module.ts`, `packages/db/src/testing/fault-proxy.ts`, `packages/nest-bootstrap/src/health/health.options.ts`, `packages/nest-bootstrap/src/health/health.service.ts`, `packages/nest-bootstrap/src/health/health.controller.ts`, `packages/nest-bootstrap/src/health/health.module.ts`
- Modify: `packages/db/package.json` (`exports["./nest"]`, optional Nest peers, devDependencies), `packages/db/src/testing/index.ts` (one export line), `packages/db/README.md` (one line), `packages/nest-bootstrap/package.json` (dependencies), `packages/nest-bootstrap/src/env.ts` (two entries of `baseEnvSchema`), `packages/nest-bootstrap/src/core.module.ts` (two imports), `packages/nest-bootstrap/src/index.ts` (export `HealthModule`), Task 11's `packages/nest-bootstrap/test/{env,core.module,core.module.file,bootstrap,bootstrap.process}.spec.ts` (inputs gain `DATABASE_URL`), `apps/api-admin/{package.json,jest.config.mjs,.env.example,test/env.spec.ts,test/app.e2e-spec.ts}` and the same five in `apps/api-driver`, `infra/docker-compose.yml` (API healthchecks and `restart`, `caddy.depends_on`), `infra/smoke.sh` (`check_origin` with the service, migrate-ordering proof), `e2e/tests/support/smoke.ts` (whole file), `e2e/tests/web-admin/smoke.spec.ts`, `e2e/tests/web-driver/smoke.spec.ts`, `pnpm-workspace.yaml` (catalog `# nest`), `pnpm-lock.yaml`, `docs/architecture.md` (Observability), `README.md` (Observability), `docs/efficiency/critical-path.md`
- Test: `packages/db/test/nest.spec.ts`, `packages/nest-bootstrap/test/env-database.spec.ts`, `packages/nest-bootstrap/test/health.controller.spec.ts`, `packages/nest-bootstrap/test/health.e2e-spec.ts`, both apps' `test/app.e2e-spec.ts`

**Interfaces:**
- Consumes: `CreatePrismaClientOptions`, `PrismaClient` from `@tms/db` (Task 05); `testDatabaseUrl()`, `resetTestDatabase()`, `withAdminClient(fn)`, `POSTGRES_TEST_IMAGE`, Jest preset `database: true` (Task 04); `createLoggerModule`, `LOG_DESTINATION`, `InjectPinoLogger`, `PinoLogger`, `MemoryLogStream` (Task 10); `PUBLIC_ROUTE_KEY` from `@tms/contracts`, `scrubString` from `@tms/contracts/security` (Task 03); `baseEnvSchema`, `createEnvSchema({ defaultPort })`, `loadEnv(schema, source)`, `configureApp(app)`, `CoreModule.forRoot({ app, env })`, apps' `envSchema` and `AppModule.forRoot(env)` (Task 11).
- Produces:
  - `@tms/db/nest`: `class PrismaService extends PrismaClient implements OnModuleDestroy` (`constructor(options: CreatePrismaClientOptions)`, `onModuleDestroy(): Promise<void>` → `$disconnect()`); `PrismaModule.forRoot(options: CreatePrismaClientOptions): DynamicModule` (global, provides and exports `PrismaService`, `connectTimeoutMs` default 5000).
  - `@tms/db/testing` (added): `type FaultMode = 'forward' | 'refuse' | 'blackhole'`; `interface FaultProxy { readonly port: number; readonly accepted: number; setMode(mode: FaultMode): void; close(): Promise<void> }`; `startFaultProxy(options?: { upstream?: { host: string; port: number }; mode?: FaultMode }): Promise<FaultProxy>`.
  - `@tms/nest-bootstrap`: `HealthModule.forRoot(options: HealthModuleOptions): DynamicModule`, `HealthModuleOptions = { service: ApiName; dbTimeoutMs: number }`, `type HealthBody = { status: 'ok' | 'degraded'; service: ApiName }`; `GET /api/health` → 200 `{"status":"ok","service":"api-admin"}` (or `api-driver`) / 503 `{"status":"degraded","service":"<api>"}`, `Cache-Control: no-store`, metadata `PUBLIC_ROUTE_KEY = true`; `baseEnvSchema` gains `DATABASE_URL: string` (required, `postgres://` or `postgresql://`) and `HEALTH_DB_TIMEOUT_MS: number` (integer 100–10000, default 1000); `CoreModule.forRoot` also imports `PrismaModule.forRoot({ url: env.DATABASE_URL })` and `HealthModule.forRoot({ service: app, dbTimeoutMs: env.HEALTH_DB_TIMEOUT_MS })`.
  - Playwright: `registerSmokeSuite({ name, title, service })` (`service: 'api-admin' | 'api-driver'`).

Decisions stated once. The ping is a direct ``prisma.$queryRaw`SELECT 1` `` raced against `HEALTH_DB_TIMEOUT_MS` and reported through terminus' `HealthIndicatorService` (`check('db').up()/down()`): exact timeout semantics with one moving part and no optional `@prisma/client` peer inside terminus; `HealthCheckService` cannot produce the D5 body (its body always carries `info`/`error`/`details`, and its `degraded` is HTTP 200 — spike S4). Two bounds apply (spike S3): the shared `PrismaService` keeps the app-wide `connectionTimeoutMillis` of 5000 ms (a real request may wait that long for a connection), while health gives up after `HEALTH_DB_TIMEOUT_MS`; the db spec proves the pool bound, the health spec the health bound. Prisma connects lazily, so no `$connect` at startup: an API boots with the database down and recovers without a restart. `@nestjs/common`, `reflect-metadata` and `rxjs` become **optional** peers of `@tms/db`: the migrate image and the CLIs never load `@tms/db/nest`, the APIs bring Nest themselves; the boundaries rule is unchanged (`db` still imports only `contracts`).

- [ ] **Step 1: Add terminus to the catalog and extend the manifests**

`pnpm-workspace.yaml`, catalog group `# nest`, after `'@nestjs/schematics'`:

```yaml
  '@nestjs/terminus': ^12.1.0
```

`packages/db/package.json` — keep every field Tasks 04–09 set and add:

```jsonc
// exports: add after "./testing/jest-global-teardown"
"./nest": { "types": "./dist/nest/index.d.ts", "default": "./dist/nest/index.js" },

// new blocks
"peerDependencies": {
  "@nestjs/common": "catalog:",
  "reflect-metadata": "catalog:",
  "rxjs": "catalog:"
},
"peerDependenciesMeta": {
  "@nestjs/common": { "optional": true },
  "reflect-metadata": { "optional": true },
  "rxjs": { "optional": true }
},

// devDependencies: add (alphabetical order)
"@nestjs/common": "catalog:",
"@nestjs/core": "catalog:",
"@nestjs/testing": "catalog:",
"reflect-metadata": "catalog:",
"rxjs": "catalog:"
```

`packages/nest-bootstrap/package.json` — add to `dependencies`: `"@nestjs/terminus": "catalog:"`, `"@tms/contracts": "workspace:*"` (`PUBLIC_ROUTE_KEY`, `scrubString`), `"@tms/db": "workspace:*"`; add to `devDependencies`: `"@testcontainers/postgresql": "catalog:"` (`@nestjs/testing`, `supertest` and `@types/supertest` are already there from Task 11).

`apps/api-admin/package.json` and `apps/api-driver/package.json` — add to `devDependencies`: `"@tms/db": "workspace:*"` (the Jest preset resolves `@tms/db/testing/jest-global-setup` from the app, and the e2e spec imports `testDatabaseUrl`; at runtime `@tms/db` still arrives through `@tms/nest-bootstrap`).

Run: `pnpm install`
Expected: exit 0; the lockfile gains `@nestjs/terminus@12.1.0` (published 2026-09-20, older than the 24 h gate: no `minimumReleaseAgeExclude` line), no `ERR_PNPM_IGNORED_BUILDS`, no peer warning (terminus' ORM/gRPC peers are optional).

- [ ] **Step 2: Add the network fault proxy to the harness and write the failing `@tms/db/nest` test**

`packages/db/src/testing/fault-proxy.ts`:

```ts
import net from 'node:net';

export type FaultMode = 'forward' | 'refuse' | 'blackhole';

export interface FaultProxy {
  /** Local port to put into DATABASE_URL instead of the real one. */
  readonly port: number;
  /** Connections accepted so far, in every mode. */
  readonly accepted: number;
  /** Switching away from `forward` also drops every open connection. */
  setMode(mode: FaultMode): void;
  close(): Promise<void>;
}

/**
 * In-process TCP proxy on 127.0.0.1 for database failure tests: `forward` pipes to `upstream`,
 * `refuse` accepts and drops at once, `blackhole` accepts and never answers (a bare `nc -l`
 * closes immediately, spike S3). Without an upstream the proxy is a black hole.
 */
export async function startFaultProxy(
  options: { upstream?: { host: string; port: number }; mode?: FaultMode } = {},
): Promise<FaultProxy> {
  const { upstream } = options;
  let mode: FaultMode = options.mode ?? (upstream ? 'forward' : 'blackhole');
  let accepted = 0;
  const sockets = new Set<net.Socket>();
  const track = (socket: net.Socket): net.Socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    return socket;
  };

  const server = net.createServer((client) => {
    accepted += 1;
    track(client);
    if (mode === 'refuse') {
      client.destroy();
      return;
    }
    if (mode === 'blackhole' || !upstream) return;
    const target = track(net.connect(upstream.port, upstream.host));
    client.pipe(target).pipe(client);
    client.on('close', () => target.destroy());
    target.on('close', () => client.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;

  return {
    port,
    get accepted() {
      return accepted;
    },
    setMode(next) {
      mode = next;
      if (next !== 'forward') for (const socket of sockets) socket.destroy();
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const socket of sockets) socket.destroy();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
```

Append to `packages/db/src/testing/index.ts`:

```ts
export { startFaultProxy, type FaultMode, type FaultProxy } from './fault-proxy';
```

`packages/db/test/nest.spec.ts`:

```ts
import { Injectable, Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient, type CreatePrismaClientOptions } from '../src';
import { PrismaModule, PrismaService } from '../src/nest';
import { resetTestDatabase, startFaultProxy, testDatabaseUrl, withAdminClient } from '../src/testing';

@Injectable()
class NeedsPrisma {
  constructor(readonly prisma: PrismaService) {}
}

@Module({ providers: [NeedsPrisma] })
class ConsumerModule {}

async function start(options: CreatePrismaClientOptions): Promise<TestingModule> {
  const moduleRef = await Test.createTestingModule({
    imports: [PrismaModule.forRoot(options), ConsumerModule],
  }).compile();
  await moduleRef.init();
  return moduleRef;
}

async function backendsOnTestDatabase(): Promise<number> {
  const database = new URL(testDatabaseUrl()).pathname.slice(1);
  return withAdminClient(async (client) => {
    const result = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [database],
    );
    return Number(result.rows[0]?.count ?? '0');
  });
}

async function eventually(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return check();
}

describe('@tms/db/nest', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('provides one global PrismaService built on the generated client', async () => {
    const moduleRef = await start({ url: testDatabaseUrl() });
    const prisma = moduleRef.get(PrismaService);
    expect(Object.getPrototypeOf(PrismaService.prototype)).toBe(PrismaClient.prototype);
    // Prisma 7's constructor returns a proxy, so `instanceof` is false by design; the constructor survives.
    expect(prisma.constructor).toBe(PrismaService);
    expect(moduleRef.get(NeedsPrisma).prisma).toBe(prisma);
    await expect(prisma.$queryRaw`SELECT 1 AS one`).resolves.toEqual([{ one: 1 }]);
    await moduleRef.close();
  });

  it('connects lazily: starting the module opens no connection', async () => {
    const hole = await startFaultProxy();
    const moduleRef = await start({ url: `postgresql://tms:tms@127.0.0.1:${hole.port}/tms` });
    expect(hole.accepted).toBe(0);
    await moduleRef.close();
    await hole.close();
  });

  it('bounds a black-holed connect with connectTimeoutMs (the pool layer)', async () => {
    const hole = await startFaultProxy();
    const moduleRef = await start({
      url: `postgresql://tms:tms@127.0.0.1:${hole.port}/tms`,
      connectTimeoutMs: 300,
    });
    const started = performance.now();
    await expect(moduleRef.get(PrismaService).$queryRaw`SELECT 1`).rejects.toThrow(/connection timeout/i);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(2000);
    expect(hole.accepted).toBeGreaterThanOrEqual(1);
    await hole.close();
    await moduleRef.close();
  });

  it('disconnects on module destroy: no backend stays on the database', async () => {
    const moduleRef = await start({ url: testDatabaseUrl() });
    const prisma = moduleRef.get(PrismaService);
    await prisma.$queryRaw`SELECT 1`;
    expect(await backendsOnTestDatabase()).toBeGreaterThanOrEqual(1);
    const disconnect = jest.spyOn(prisma, '$disconnect');
    await moduleRef.close();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(await eventually(async () => (await backendsOnTestDatabase()) === 0, 5000)).toBe(true);
  });
});
```

- [ ] **Step 3: Run the db tests to verify they fail**

Run: `pnpm turbo run test --filter=@tms/db`
Expected: RED, exit 1: `test/nest.spec.ts` fails to load with `Cannot find module '../src/nest' from 'test/nest.spec.ts'`; every suite from Tasks 04–08 still passes.

- [ ] **Step 4: Write `@tms/db/nest`**

`packages/db/src/nest/prisma.service.ts`:

```ts
import type { OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import type { CreatePrismaClientOptions } from '../index';

/**
 * The generated client as the applications' single Nest provider. Prisma connects lazily on the
 * first query, so an unreachable database never fails startup; the health endpoint reports it.
 */
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor({ url, connectTimeoutMs = 5000 }: CreatePrismaClientOptions) {
    super({
      adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: connectTimeoutMs }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

`packages/db/src/nest/prisma.module.ts`:

```ts
import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { CreatePrismaClientOptions } from '../index';
import { PrismaService } from './prisma.service';

/** Global: any module (and Task 14's transaction host) injects PrismaService without importing this. */
@Global()
@Module({})
export class PrismaModule {
  static forRoot(options: CreatePrismaClientOptions): DynamicModule {
    return {
      module: PrismaModule,
      providers: [{ provide: PrismaService, useFactory: () => new PrismaService(options) }],
      exports: [PrismaService],
    };
  }
}
```

`packages/db/src/nest/index.ts`:

```ts
export { PrismaModule } from './prisma.module';
export { PrismaService } from './prisma.service';
```

Append to `packages/db/README.md`:

```md
Nest applications use `PrismaModule.forRoot({ url })` from `@tms/db/nest` instead of `createPrismaClient` (global
`PrismaService` over the same adapter and connect timeout, lazy connect, `$disconnect` on shutdown); `@nestjs/common` is an
optional peer, so the CLIs and the migrate image never load Nest.
```

Run: `pnpm turbo run test --filter=@tms/db`
Expected: GREEN, exit 0; `nest.spec.ts` 4 passed next to the unchanged Task 04–08 suites.

Run: `pnpm turbo run build --filter=@tms/db && ls packages/db/dist/nest packages/db/dist/testing/fault-proxy.js`
Expected: `index.js`, `index.d.ts`, `prisma.module.js`, `prisma.service.js` (with maps) and the fault proxy file.

- [ ] **Step 5: Write the failing nest-bootstrap tests**

`packages/nest-bootstrap/test/env-database.spec.ts`:

```ts
import { createEnvSchema, loadEnv } from '../src';

const schema = createEnvSchema({ defaultPort: 3001 });
const DATABASE_URL = 'postgresql://tms:tms@localhost:5432/tms';
const MESSAGE = 'Invalid environment: DATABASE_URL: must be a postgresql:// URL';

function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected loadEnv to throw');
}

describe('DATABASE_URL and HEALTH_DB_TIMEOUT_MS', () => {
  it('requires DATABASE_URL', () => {
    expect(messageOf(() => loadEnv(schema, {}))).toBe(MESSAGE);
  });

  it.each([
    'postgresql://tms:tms@localhost:5432/tms',
    'postgres://tms@db/tms',
    'postgresql://u:p@[::1]:5432/db',
  ])('accepts %s and defaults the health timeout to 1000 ms', (url) => {
    expect(loadEnv(schema, { DATABASE_URL: url })).toMatchObject({
      DATABASE_URL: url,
      HEALTH_DB_TIMEOUT_MS: 1000,
    });
  });

  it.each([
    'mysql://tms:env-secret-pw@db/tms',
    'http://tms:env-secret-pw@db/tms',
    'postgresql:/env-secret-pw',
    'env-secret-pw',
    '',
  ])('rejects %j without echoing the value', (url) => {
    const message = messageOf(() => loadEnv(schema, { DATABASE_URL: url }));
    expect(message).toBe(MESSAGE);
    expect(message).not.toContain('env-secret-pw');
  });

  it('reads HEALTH_DB_TIMEOUT_MS as an integer', () => {
    expect(loadEnv(schema, { DATABASE_URL, HEALTH_DB_TIMEOUT_MS: '2500' }).HEALTH_DB_TIMEOUT_MS).toBe(2500);
  });

  it.each(['99', '10001', 'abc', '1.5'])('rejects HEALTH_DB_TIMEOUT_MS=%s naming the variable', (value) => {
    expect(() => loadEnv(schema, { DATABASE_URL, HEALTH_DB_TIMEOUT_MS: value })).toThrow(
      /HEALTH_DB_TIMEOUT_MS/,
    );
  });
});
```

`packages/nest-bootstrap/test/health.controller.spec.ts`:

```ts
import 'reflect-metadata';
import { ServiceUnavailableException } from '@nestjs/common';
import type { HealthIndicatorResult } from '@nestjs/terminus';
import { PUBLIC_ROUTE_KEY } from '@tms/contracts';
import { HealthController } from '../src/health/health.controller';
import type { HealthService } from '../src/health/health.service';

const controllerWith = (status: 'up' | 'down'): HealthController =>
  new HealthController(
    {
      checkDatabase: (): Promise<HealthIndicatorResult<'db'>> => Promise.resolve({ db: { status } }),
    } as unknown as HealthService,
    { service: 'api-driver', dbTimeoutMs: 1000 },
  );

describe('HealthController', () => {
  it('is marked public for the phase 3a guard', () => {
    const handler = Object.getOwnPropertyDescriptor(HealthController.prototype, 'check')?.value as object;
    expect(Reflect.getMetadata(PUBLIC_ROUTE_KEY, handler)).toBe(true);
  });

  it('answers { status: "ok", service } when the database is up', async () => {
    await expect(controllerWith('up').check()).resolves.toEqual({ status: 'ok', service: 'api-driver' });
  });

  it('throws a 503 whose body is exactly { status: "degraded", service } when the database is down', async () => {
    const error = await controllerWith('down')
      .check()
      .then(
        () => undefined,
        (thrown: unknown) => thrown,
      );
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getStatus()).toBe(503);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      status: 'degraded',
      service: 'api-driver',
    });
  });
});
```

`packages/nest-bootstrap/test/health.e2e-spec.ts` (a dedicated container so the last test can stop it; a fault proxy in front of it for refuse/black-hole/recovery without restarting Docker; one shared log stream because nestjs-pino keeps one pino-http per process):

```ts
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import type { App } from 'supertest/types';
import { POSTGRES_TEST_IMAGE, startFaultProxy, type FaultProxy } from '@tms/db/testing';
import { LOG_DESTINATION } from '@tms/logger';
import { MemoryLogStream, type LogRecord } from '@tms/logger/testing';
import { CoreModule, configureApp, createEnvSchema, loadEnv } from '../src';
import { DEGRADED_LOG_MESSAGE } from '../src/health/health.service';

const TIMEOUT_MS = 1000;
const PASSWORD = 'health-secret-pw-7731'; // gitleaks:allow (test fixture, not a secret)
const envSchema = createEnvSchema({ defaultPort: 3001 });
const logs = new MemoryLogStream();

type HealthResult = { status: number; text: string; body: unknown; cacheControl?: string; elapsedMs: number };

async function health(app: INestApplication<App>): Promise<HealthResult> {
  const started = performance.now();
  const res = await request(app.getHttpServer()).get('/api/health');
  return {
    status: res.status,
    text: res.text,
    body: res.body as unknown,
    cacheControl: res.headers['cache-control'],
    elapsedMs: performance.now() - started,
  };
}

function expectDegraded(result: HealthResult): void {
  expect(result.status).toBe(503);
  expect(result.text).toBe('{"status":"degraded","service":"api-admin"}');
  expect(result.cacheControl).toBe('no-store');
}

const healthRequestLines = (records: LogRecord[]): LogRecord[] =>
  records.filter((r) => ((r['req'] as { url?: string } | undefined)?.url ?? '').startsWith('/api/health'));
const degradedWarning = (record: LogRecord): boolean =>
  record.level === 40 && record.msg === DEGRADED_LOG_MESSAGE;

describe('GET /api/health (e2e, dedicated Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let containerStopped = false;
  let proxy: FaultProxy;
  let primary: INestApplication<App>;
  const apps: INestApplication<App>[] = [];
  const proxies: FaultProxy[] = [];

  const urlThrough = (p: FaultProxy): string =>
    `postgresql://health:${PASSWORD}@127.0.0.1:${p.port}/health`;

  async function track(started: Promise<FaultProxy>): Promise<FaultProxy> {
    const p = await started;
    proxies.push(p);
    return p;
  }

  async function boot(databaseUrl: string): Promise<INestApplication<App>> {
    const env = loadEnv(envSchema, {
      DATABASE_URL: databaseUrl,
      HEALTH_DB_TIMEOUT_MS: String(TIMEOUT_MS),
      LOG_FILE_ENABLED: 'false',
      LOG_LEVEL: 'info',
    });
    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule.forRoot({ app: 'api-admin', env })],
    })
      .overrideProvider(LOG_DESTINATION)
      .useValue(logs)
      .compile();
    const app: INestApplication<App> = configureApp(moduleRef.createNestApplication({ bufferLogs: true }));
    await app.init();
    apps.push(app);
    return app;
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_TEST_IMAGE)
      .withUsername('health')
      .withPassword(PASSWORD)
      .withDatabase('health')
      .start();
    proxy = await track(startFaultProxy({ upstream: { host: container.getHost(), port: container.getPort() } }));
    primary = await boot(urlThrough(proxy));
  }, 120_000);

  afterAll(async () => {
    // Proxies first: dropping their sockets ends pending connects, so each pool drains at once.
    for (const p of proxies) await p.close();
    for (const app of apps) await app.close();
    if (!containerStopped) await container.stop();
  }, 60_000);

  it('answers 200 {"status":"ok","service":"api-admin"} with Cache-Control: no-store and writes no request line', async () => {
    const mark = logs.mark();
    const result = await health(primary);
    expect(result.status).toBe(200);
    expect(result.text).toBe('{"status":"ok","service":"api-admin"}');
    expect(result.cacheControl).toBe('no-store');
    await request(primary.getHttpServer()).get('/api/does-not-exist').expect(404);
    await logs.waitFor((r) => r.msg === 'request completed', { from: mark });
    expect(healthRequestLines(logs.since(mark))).toEqual([]);
  });

  it('answers 503 fast while the database refuses connections, warns once, then recovers', async () => {
    const mark = logs.mark();
    proxy.setMode('refuse');
    const down = await health(primary);
    expectDegraded(down);
    expect(down.elapsedMs).toBeLessThan(TIMEOUT_MS);
    const warning = await logs.waitFor(degradedWarning, { from: mark });
    expect(typeof warning['reason']).toBe('string');
    proxy.setMode('forward');
    const up = await health(primary);
    expect(up.status).toBe(200);
    expect(up.body).toEqual({ status: 'ok', service: 'api-admin' });
  });

  it('bounds a black-holed database by HEALTH_DB_TIMEOUT_MS', async () => {
    const hole = await track(startFaultProxy({ mode: 'blackhole' }));
    const app = await boot(urlThrough(hole));
    const mark = logs.mark();
    const result = await health(app);
    expectDegraded(result);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(TIMEOUT_MS - 50);
    expect(result.elapsedMs).toBeLessThan(TIMEOUT_MS + 500);
    expect(hole.accepted).toBeGreaterThanOrEqual(1);
    const warning = await logs.waitFor(degradedWarning, { from: mark });
    expect(warning['reason']).toBe(`database ping timed out after ${TIMEOUT_MS} ms`);
  });

  it('boots while the database is unreachable and recovers when it comes back', async () => {
    const gate = await track(
      startFaultProxy({ upstream: { host: container.getHost(), port: container.getPort() }, mode: 'refuse' }),
    );
    const app = await boot(urlThrough(gate));
    expectDegraded(await health(app));
    gate.setMode('forward');
    const up = await health(app);
    expect(up.status).toBe(200);
    expect(up.body).toEqual({ status: 'ok', service: 'api-admin' });
  });

  it('answers 503 within the budget after the database container stops', async () => {
    const app = await boot(container.getConnectionUri());
    expect((await health(app)).status).toBe(200);
    await container.stop();
    containerStopped = true;
    const result = await health(app);
    expectDegraded(result);
    expect(result.elapsedMs).toBeLessThan(TIMEOUT_MS + 500);
  }, 60_000);

  it('never logs the connection string or the password, and never an access line for /api/health', () => {
    const text = logs.text();
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toMatch(/postgres(ql)?:\/\//);
    expect(healthRequestLines(logs.records())).toEqual([]);
    expect(logs.records().filter(degradedWarning).length).toBeGreaterThanOrEqual(4);
  });
});
```

- [ ] **Step 6: Run the nest-bootstrap tests to verify they fail**

Run: `pnpm turbo run test --filter=@tms/nest-bootstrap`
Expected: RED, exit 1: `health.controller.spec.ts` and `health.e2e-spec.ts` fail to load (`Cannot find module '../src/health/health.controller'` / `'../src/health/health.service'`); `env-database.spec.ts` runs and fails all 14 cases (the schema still strips both keys; ts-jest does not type-check under `isolatedModules: true`, so TS2339 shows only in `typecheck`); Task 11's suites pass.

- [ ] **Step 7: Extend the environment schema and Task 11's env inputs**

`packages/nest-bootstrap/src/env.ts` — add two entries at the end of the `baseEnvSchema` object literal, after `LOG_RETENTION_DAYS` (Task 11's composition pattern; Task 13 adds its entries after these):

```ts
  // Required. The message never echoes the value: it may carry a password.
  DATABASE_URL: z.url({
    protocol: /^postgres(ql)?$/,
    hostname: /^.+$/,
    error: 'must be a postgresql:// URL',
  }),
  // Upper bound of the database ping behind GET /api/health (D5).
  HEALTH_DB_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(1000),
```

Run: `pnpm turbo run test --filter=@tms/nest-bootstrap -- test/env-database.spec.ts test/env.spec.ts test/core.module.spec.ts`
Expected: `env-database.spec.ts` 14 passed; Task 11's `env.spec.ts` and `core.module.spec.ts` now fail with `Invalid environment: DATABASE_URL: must be a postgresql:// URL` wherever their input has no `DATABASE_URL`.

Edit Task 11's five specs (the variable is required now; the values below are never queried — Prisma connects lazily):
- `packages/nest-bootstrap/test/env.spec.ts`: add `const DB = { DATABASE_URL: 'postgresql://tms:tms@localhost:5432/tms' } as const;` below `adminSchema`, spread `...DB` into every `loadEnv(...)` input object (including the `.extend()` case and the HOST cases), and add `DATABASE_URL: 'postgresql://tms:tms@localhost:5432/tms', HEALTH_DB_TIMEOUT_MS: 1000` to `DEFAULTS`; every expected error message stays exactly as it is.
- `packages/nest-bootstrap/test/core.module.spec.ts` and `test/core.module.file.spec.ts`: add `DATABASE_URL: 'postgresql://tms:tms@127.0.0.1:9/tms'` to the `loadEnv` input.
- `packages/nest-bootstrap/test/bootstrap.spec.ts`: add `DATABASE_URL: 'postgresql://tms:tms@127.0.0.1:9/tms'` to both `source` objects (the invalid-environment message keeps naming only `NODE_ENV` and `PORT`) and `DATABASE_URL: 'postgresql://tms:tms@127.0.0.1:9/tms', HEALTH_DB_TIMEOUT_MS: 1000` to the `toHaveBeenCalledWith` object.
- `packages/nest-bootstrap/test/bootstrap.process.spec.ts`: `runMain({ PORT: port, DATABASE_URL: 'postgresql://tms:tms@127.0.0.1:9/tms' })`, so the child still reports `PORT` alone.

Run: `pnpm turbo run test --filter=@tms/nest-bootstrap -- test/env-database.spec.ts test/env.spec.ts test/core.module.spec.ts test/core.module.file.spec.ts test/bootstrap.spec.ts test/bootstrap.process.spec.ts`
Expected: the six suites pass: `env-database.spec.ts` 14 plus Task 11's counts unchanged (38 + 4 + 2 + 2 + 2).

- [ ] **Step 8: Write the health module and wire it into `CoreModule`**

`packages/nest-bootstrap/src/health/health.options.ts`:

```ts
import type { ApiName } from '../core.module';

export const HEALTH_OPTIONS = Symbol('HEALTH_OPTIONS');

export interface HealthModuleOptions {
  /** Answered in every body: proves which API an origin reaches (routing identity, journal I7-1). */
  service: ApiName;
  /** HEALTH_DB_TIMEOUT_MS: after this the database counts as down. */
  dbTimeoutMs: number;
}

/** D5 body: the state and the service name, never a database detail. */
export type HealthBody = { status: 'ok' | 'degraded'; service: ApiName };
```

`packages/nest-bootstrap/src/health/health.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import { scrubString } from '@tms/contracts/security';
import { PrismaService } from '@tms/db/nest';
import { InjectPinoLogger, PinoLogger } from '@tms/logger';
import { HEALTH_OPTIONS, type HealthModuleOptions } from './health.options';

export const DEGRADED_LOG_MESSAGE = 'health degraded: database ping failed';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly indicators: HealthIndicatorService,
    @Inject(HEALTH_OPTIONS) private readonly options: HealthModuleOptions,
    @InjectPinoLogger(HealthService.name) private readonly logger: PinoLogger,
  ) {}

  /** `up` when `SELECT 1` answers within dbTimeoutMs; `down` otherwise. Never throws. */
  async checkDatabase(): Promise<HealthIndicatorResult<'db'>> {
    const indicator = this.indicators.check('db');
    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, this.options.dbTimeoutMs);
      return indicator.up();
    } catch (error) {
      // The reason only: never the connection string, never the stack.
      this.logger.warn({ reason: reasonOf(error) }, DEGRADED_LOG_MESSAGE);
      return indicator.down();
    }
  }
}

async function withTimeout<T>(work: PromiseLike<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`database ping timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return scrubString(message).slice(0, 500);
}
```

`packages/nest-bootstrap/src/health/health.controller.ts`:

```ts
import {
  Controller,
  Get,
  Header,
  Inject,
  ServiceUnavailableException,
  SetMetadata,
} from '@nestjs/common';
import { PUBLIC_ROUTE_KEY } from '@tms/contracts';
import { HEALTH_OPTIONS, type HealthBody, type HealthModuleOptions } from './health.options';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthService,
    @Inject(HEALTH_OPTIONS) private readonly options: HealthModuleOptions,
  ) {}

  /**
   * D5: `ok` / `degraded` plus the service name, never database details; degraded is HTTP 503
   * (deviation 9). Nest sets route headers before the handler runs, so `no-store` is also on the 503.
   */
  @Get()
  @SetMetadata(PUBLIC_ROUTE_KEY, true)
  @Header('Cache-Control', 'no-store')
  async check(): Promise<HealthBody> {
    const { service } = this.options;
    const database = await this.health.checkDatabase();
    if (!Object.values(database).every((entry) => entry.status === 'up')) {
      throw new ServiceUnavailableException({ status: 'degraded', service } satisfies HealthBody);
    }
    return { status: 'ok', service };
  }
}
```

`packages/nest-bootstrap/src/health/health.module.ts`:

```ts
import { type DynamicModule, Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { HEALTH_OPTIONS, type HealthModuleOptions } from './health.options';
import { HealthService } from './health.service';

@Module({})
export class HealthModule {
  static forRoot(options: HealthModuleOptions): DynamicModule {
    return {
      module: HealthModule,
      // logger: false, or terminus prints its own error JSON on every 503.
      imports: [TerminusModule.forRoot({ logger: false, errorLogStyle: 'json' })],
      controllers: [HealthController],
      providers: [{ provide: HEALTH_OPTIONS, useValue: options }, HealthService],
    };
  }
}
```

`packages/nest-bootstrap/src/core.module.ts` — add the imports

```ts
import { PrismaModule } from '@tms/db/nest';
import { HealthModule } from './health/health.module';
```

and append to the `imports` array returned by `CoreModule.forRoot`, after `createLoggerModule(...)`:

```ts
        PrismaModule.forRoot({ url: env.DATABASE_URL }),
        HealthModule.forRoot({ service: app, dbTimeoutMs: env.HEALTH_DB_TIMEOUT_MS }),
```

`packages/nest-bootstrap/src/index.ts` — add:

```ts
export { HealthModule } from './health/health.module';
export type { HealthBody, HealthModuleOptions } from './health/health.options';
```

Run: `pnpm turbo run test --filter=@tms/nest-bootstrap`
Expected: GREEN, exit 0: `Test Suites: 8 passed, 8 total`, `Tests: 71 passed, 71 total` — new suites `env-database.spec.ts` 14, `health.controller.spec.ts` 3, `health.e2e-spec.ts` 6, Task 11's five suites unchanged (48). The black-hole case takes about 1 s, the container start about 3 s.

- [ ] **Step 9: Point both apps' tests at the harness and check the endpoint there**

`apps/api-admin/jest.config.mjs` (same for `apps/api-driver`):

```js
import { createJestConfig } from '@tms/config/jest';

export default createJestConfig({ rootDir: import.meta.dirname, database: true });
```

`apps/api-admin/test/app.e2e-spec.ts` (Task 11's file; same for api-driver) — add the import `import { testDatabaseUrl } from '@tms/db/testing';`, add `DATABASE_URL: testDatabaseUrl(),` to the object passed to `loadEnv(envSchema, { ... })`, and append inside the `describe` block, after the SIGTERM case:

```ts
  it('answers GET /api/health with 200, the service name and no-store', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.text).toBe('{"status":"ok","service":"api-admin"}');
    expect(res.headers['cache-control']).toBe('no-store');
  });
```

(api-driver expects `'{"status":"ok","service":"api-driver"}'`.) The SIGTERM case keeps its `+ 1`: Prisma 7 with a driver adapter and terminus register no signal handlers.

`apps/api-admin/test/env.spec.ts` (Task 11's file, whole; the harness URL satisfies the now required variable; api-driver: `describe('api-driver environment'`, test name and `PORT: 3002`):

```ts
import { testDatabaseUrl } from '@tms/db/testing';
import { loadEnv } from '@tms/nest-bootstrap';
import { envSchema } from '../src/app.module';

describe('api-admin environment', () => {
  it('defaults to port 3001, JSON log files under ./logs and a 1000 ms health budget', () => {
    const DATABASE_URL = testDatabaseUrl();
    expect(loadEnv(envSchema, { DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      LOG_FILE_ENABLED: true,
      LOG_DIR: 'logs',
      LOG_RETENTION_DAYS: 14,
      DATABASE_URL,
      HEALTH_DB_TIMEOUT_MS: 1000,
      PORT: 3001,
    });
  });
});
```

Append to `apps/api-admin/.env.example` and `apps/api-driver/.env.example`:

```ini
# PostgreSQL connection (required); compose sets its own value for the containers.
DATABASE_URL=postgresql://tms:tms@localhost:5432/tms
# Upper bound in ms of the database ping behind GET /api/health (100-10000).
HEALTH_DB_TIMEOUT_MS=1000
```

Run: `pnpm turbo run test --filter=@tms/api-admin`
Expected: GREEN, `Test Suites: 2 passed, 2 total`, `Tests: 6 passed, 6 total` — Task 11's 5 plus the health case (the harness container starts in `globalSetup`, ~3.5 s).

Run: `pnpm turbo run test --filter=@tms/api-driver`
Expected: GREEN, same shape.

- [ ] **Step 10: Compose healthchecks, smoke and Playwright**

`infra/docker-compose.yml` — in both `api-admin` and `api-driver` (Task 11's services: `DATABASE_URL: *database-url`, `LOG_DIR`, `LOG_FILE_ENABLED`, `read_only`, `tmpfs`, the `logs` volume stay as they are), add after the `environment:` map (the images have Node but no curl):

```yaml
    healthcheck:
      test:
        [
          'CMD',
          'node',
          '-e',
          "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))",
        ]
      interval: 10s
      timeout: 3s
      retries: 6
      start_period: 20s
    # Journal M6-6: a crashed API comes back; `migrate` keeps restart: 'no' (one-shot).
    restart: unless-stopped
```

and replace the `caddy` service's `depends_on` list (phase 0: `- api-admin` / `- api-driver`, i.e. "started") with:

```yaml
    depends_on:
      api-admin:
        condition: service_healthy
      api-driver:
        condition: service_healthy
```

`infra/smoke.sh` (Task 11's file: phase 0's `--full` block plus Task 11's `check_log_file` calls) — four edits inside the `--full` block:
- the function header `check_origin() { # name port title` becomes `check_origin() { # name port title service`;
- the comment `# Caddy starts before Nest has bound its port (depends_on = started), so retry until the API answers.` becomes `# Caddy waits for healthy APIs; the retries only absorb Caddy's own start-up.`;
- append at the end of the function body, after the bare `/api` check (`echo "ok   $1 forwards bare /api to the API (JSON 404, not index.html)"`):

```bash
    # D5 + routing identity (journal I7-1): exactly {"status":"ok","service":"<api>"} with 200,
    # never cached, so the kiosk origin provably reaches api-driver and the back office api-admin.
    health=$(curl -sS -w ' %{http_code}' "http://localhost:$2/api/health")
    expected="{\"status\":\"ok\",\"service\":\"$4\"} 200"
    [ "$health" = "$expected" ] || fail "$1: /api/health answered '$health', expected '$expected'"
    headers=$(curl -sS -D- -o /dev/null "http://localhost:$2/api/health")
    echo "$headers" | grep -qi '^cache-control: no-store' || fail "$1: /api/health lacks Cache-Control: no-store"
    echo "ok   $1 /api/health answers 200 from $4 with no-store"
```

- replace the two calls `check_origin web-admin "${CADDY_ADMIN_PORT:-8080}" "TMS Admin"` and `check_origin web-driver "${CADDY_KIOSK_PORT:-8081}" "TMS Kiosk"` (Task 11's `check_log_file` block after them stays) with:

```bash
  # D12 ordering proof (journal M6-6): both APIs started only after migrate finished with exit 0.
  # Docker's timestamps have a variable-length fraction, so they are compared as epoch nanoseconds.
  check_migrate_ordering() {
    local migrate finished api id started
    migrate=$(compose ps -aq migrate)
    [ "$(docker inspect -f '{{.State.ExitCode}}' "$migrate")" = "0" ] || fail "migrate did not exit 0"
    finished=$(docker inspect -f '{{.State.FinishedAt}}' "$migrate")
    for api in api-admin api-driver; do
      id=$(compose ps -q "$api")
      [ -n "$id" ] || fail "$api is not running"
      started=$(docker inspect -f '{{.State.StartedAt}}' "$id")
      [ "$(date -d "$started" +%s%N)" -gt "$(date -d "$finished" +%s%N)" ] \
        || fail "$api started at $started, before migrate finished at $finished"
    done
    echo "ok   api-admin and api-driver started after migrate finished ($finished)"
  }
  check_migrate_ordering
  check_origin web-admin "${CADDY_ADMIN_PORT:-8080}" "TMS Admin" api-admin
  check_origin web-driver "${CADDY_KIOSK_PORT:-8081}" "TMS Kiosk" api-driver
```

(`date -d` is GNU date: Linux hosts and the Ubuntu CI runner; the README already targets Linux for Docker work.)

`e2e/tests/support/smoke.ts` (whole file; phase 0's four tests unchanged except the comment of the forwarding test, plus the health test and the `service` parameter):

```ts
import { expect, test } from '@playwright/test';

export function registerSmokeSuite({
  name,
  title,
  service,
}: {
  name: string;
  title: string;
  service: 'api-admin' | 'api-driver';
}): void {
  test.describe(`${name} smoke`, () => {
    test(`serves the SPA on the ${name} origin`, async ({ page }) => {
      await page.goto('/');
      await expect(page).toHaveTitle(title);
      await expect(page.getByTestId('app-root')).toBeAttached();
    });

    // Proves the origin forwards /api to a Nest API; the health test below proves which one.
    test('forwards /api to a Nest API on the same origin (D11)', async ({ request }) => {
      for (const path of ['/api', '/api/does-not-exist']) {
        const res = await request.get(path);
        expect(res.status()).toBe(404);
        expect(res.headers()['content-type']).toContain('application/json');
        expect(await res.json()).toMatchObject({
          statusCode: 404,
          error: 'Not Found',
        });
      }
    });

    test(`health endpoint answers ok from ${service} on the ${name} origin`, async ({ request }) => {
      const res = await request.get('/api/health');
      expect(res.status()).toBe(200);
      expect(res.headers()['cache-control']).toBe('no-store');
      expect(await res.json()).toEqual({ status: 'ok', service });
    });

    test('answers a browser navigation to bare /api from the API, not with index.html', async ({
      page,
    }) => {
      // page.goto sends what a browser sends (Accept: text/html, Sec-Fetch-Mode: navigate), the
      // request shape of the bare-/api bug; the `request` fixture above is a Node-side client.
      const res = await page.goto('/api');
      expect(res?.status()).toBe(404);
      expect(res?.headers()['content-type']).toContain('application/json');
    });

    test('deep links fall back to the SPA, not to a 404', async ({ page }) => {
      const res = await page.goto('/some/client/route');
      expect(res?.status()).toBe(200);
      await expect(page.getByTestId('app-root')).toBeAttached();
    });
  });
}
```

`e2e/tests/web-admin/smoke.spec.ts`:

```ts
import { registerSmokeSuite } from '../support/smoke.js';

registerSmokeSuite({ name: 'web-admin', title: 'TMS Admin', service: 'api-admin' });
```

`e2e/tests/web-driver/smoke.spec.ts`:

```ts
import { registerSmokeSuite } from '../support/smoke.js';

registerSmokeSuite({ name: 'web-driver', title: 'TMS Kiosk', service: 'api-driver' });
```

Run: `pnpm compose config --quiet && bash -n infra/smoke.sh && pnpm turbo run typecheck --filter=@tms/e2e && pnpm turbo run lint --filter=@tms/e2e`
Expected: exit 0 for all four (compose file valid, script parses, the e2e project type-checks and lints).

- [ ] **Step 11: Lint, typecheck and build the touched packages**

Run: `pnpm turbo run lint --filter=@tms/db` and the same for `@tms/nest-bootstrap`, `@tms/api-admin`, `@tms/api-driver` (one command each)
Expected: exit 0, no `[boundaries]` message (`db` still imports only `contracts`; `bootstrap` imports `contracts`, `db`, `logger`).

Run: `pnpm turbo run typecheck --filter=@tms/nest-bootstrap` and `pnpm turbo run build --filter=@tms/api-admin` and `pnpm turbo run build --filter=@tms/api-driver`
Expected: exit 0 (the app builds pull `@tms/db`, `@tms/logger`, `@tms/nest-bootstrap` builds through `^build`).

Run: `node tools/scripts/check-hygiene.mjs`
Expected: exit 0 (one `@nestjs+common` and one `@prisma+client` directory).

- [ ] **Step 12: Images against a throwaway database: ok, degraded, recovered**

```bash
docker network inspect tms-p1-net >/dev/null 2>&1 || docker network create tms-p1-net
docker rm -f tms-p1-pg tms-p1-api-admin tms-p1-api-driver 2>/dev/null
docker run -d --name tms-p1-pg --network tms-p1-net -p 55432:5432 -e POSTGRES_USER=tms -e POSTGRES_PASSWORD=tms -e POSTGRES_DB=tms postgres:18-alpine
docker build --build-arg APP=api-admin -f infra/docker/api.Dockerfile -t tms-p1-api-admin .
docker build --build-arg APP=api-driver -f infra/docker/api.Dockerfile -t tms-p1-api-driver .
docker run --rm -d --name tms-p1-api-admin --network tms-p1-net --read-only --tmpfs /tmp -v tms-p1-logs:/var/log/tms -p 53001:3001 -e PORT=3001 -e DATABASE_URL=postgresql://tms:tms@tms-p1-pg:5432/tms tms-p1-api-admin
docker run --rm -d --name tms-p1-api-driver --network tms-p1-net --read-only --tmpfs /tmp -v tms-p1-logs:/var/log/tms -p 53002:3002 -e PORT=3002 -e DATABASE_URL=postgresql://tms:tms@tms-p1-pg:5432/tms tms-p1-api-driver
sleep 4
```

Run: `curl -s -w ' %{http_code}\n' http://localhost:53001/api/health; curl -s -w ' %{http_code}\n' http://localhost:53002/api/health`
Expected: `{"status":"ok","service":"api-admin"} 200`, then `{"status":"ok","service":"api-driver"} 200`.

Run: `docker exec tms-p1-api-admin node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"; echo exit=$?`
Expected: `exit=0` (the compose healthcheck command works in the read-only image).

Run: `docker stop tms-p1-pg && curl -s -w ' %{http_code}\n' http://localhost:53001/api/health && docker exec tms-p1-api-admin node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"; echo exit=$?`
Expected: `{"status":"degraded","service":"api-admin"} 503` within about a second, then `exit=1`.

Run: `docker start tms-p1-pg && sleep 3 && curl -s -w ' %{http_code}\n' http://localhost:53001/api/health`
Expected: `{"status":"ok","service":"api-admin"} 200` — recovered without restarting the API.

Run: `docker logs tms-p1-api-admin 2>&1 | grep -c '"url":"/api/health'; docker logs tms-p1-api-admin 2>&1 | grep '"level":40' | grep -c 'health degraded: database ping failed'; docker logs tms-p1-api-admin 2>&1 | grep -c 'tms:tms@'`
Expected: `0`, then at least `2` (the curl and the exec probe), then `0`.

Run: `docker run --rm tms-p1-api-admin node -e "require.resolve('prisma/package.json')"; echo exit=$?`
Expected: `Cannot find module 'prisma/package.json'` and a non-zero exit (the API image still has no Prisma CLI).

Clean up: `docker rm -f tms-p1-api-admin tms-p1-api-driver tms-p1-pg && docker volume rm tms-p1-logs && docker network rm tms-p1-net`.

- [ ] **Step 13: The full compose stack as project `tms-p1`, smoke and Playwright**

```bash
export POSTGRES_PORT=55432 MAILPIT_UI_PORT=58025 MAILPIT_SMTP_PORT=51025 CADDY_ADMIN_PORT=58080 CADDY_KIOSK_PORT=58081
pnpm compose -p tms-p1 --profile full up -d --build
```

Run: `docker inspect --format '{{.State.Health.Status}}' tms-p1-api-admin-1 tms-p1-api-driver-1`
Expected: `healthy` twice (`up -d` returns only after both APIs are healthy, because `caddy` waits on `service_healthy`).

Run: `docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' tms-p1-api-admin-1 tms-p1-api-driver-1`
Expected: `unless-stopped` twice.

Run: `COMPOSE_PROJECT_NAME=tms-p1 infra/smoke.sh --full`
Expected: every earlier `ok` line (Tasks 09 and 11), `ok   api-admin and api-driver started after migrate finished (<timestamp>)`, `ok   web-admin /api/health answers 200 from api-admin with no-store`, `ok   web-driver /api/health answers 200 from api-driver with no-store`, then `smoke: all checks passed`.

Run: `E2E_ADMIN_URL=http://localhost:58080 E2E_DRIVER_URL=http://localhost:58081 pnpm e2e`
Expected: `10 passed` (phase 0's 4 smoke tests + 1 health test per project).

Clean up: `pnpm compose -p tms-p1 --profile full down -v`.

- [ ] **Step 14: Document the health endpoint**

`docs/architecture.md`, section `## Observability — phase 1 (logs, Sentry, audit)`, after Task 10's **Logs** paragraph:

```md
**Health.** Both APIs serve `GET /api/health` from `HealthModule` in `@tms/nest-bootstrap` (D5):
`200 {"status":"ok","service":"<api>"}` or `503 {"status":"degraded","service":"<api>"}` (deviation 9);
`service` proves which API an origin reaches and carries no database detail. `Cache-Control: no-store`, marked
public through `PUBLIC_ROUTE_KEY` for the phase 3a guard, never auto-logged. The only check is
`SELECT 1` through the shared global `PrismaService` (`@tms/db/nest`), raced against
`HEALTH_DB_TIMEOUT_MS` (default 1000 ms) and reported through terminus' `HealthIndicatorService`
(`HealthCheckService` cannot produce this body). The pool's own connect timeout (5000 ms) bounds the
connection attempt behind it, so a black-holed database answers 503 after about one second instead of
hanging. A failed ping logs one `warn` with the scrubbed reason, never the URL. Prisma connects lazily:
an API boots while the database is down and recovers without a restart. Compose healthchecks call the
endpoint with `node -e "fetch(...)"` (the images have no curl), the APIs restart `unless-stopped`, Caddy
starts only when both APIs are healthy, and `infra/smoke.sh --full` proves both APIs started after
`migrate` finished.
```

`README.md`, section `## Observability` (Task 10), append:

```md
- Health: `GET /api/health` answers `200 {"status":"ok","service":"api-admin"}` (or `api-driver`) / `503 {"status":"degraded",...}`
  (database ping only, bounded by `HEALTH_DB_TIMEOUT_MS`); compose healthchecks, `infra/smoke.sh --full` and Playwright use it.
```

- [ ] **Step 15: Whole-repository verification**

Run: `pnpm exec prettier --write packages/db packages/nest-bootstrap apps/api-admin apps/api-driver infra/docker-compose.yml e2e/tests docs/architecture.md README.md && pnpm format:check && bash -n infra/smoke.sh`
Expected: `All matched files use Prettier code style!`

Run: `pnpm verify`
Expected: exit 0; `@tms/db#test`, `@tms/nest-bootstrap#test`, `@tms/api-admin#test`, `@tms/api-driver#test` green (Docker running); hygiene and gitleaks pass. After push, the CI `e2e` job is green with the new smoke lines and 10 Playwright tests.

- [ ] **Step 16: Commit**

Append to `docs/efficiency/critical-path.md`:
`| 2026-MM-DD | Task 12: health endpoint and @tms/db/nest | subagent | HH:MM | HH:MM | <rework or none> | n/a | <db nest 4, env-database 14, controller 3, health e2e 6 (black hole ≈ 1000 ms, stop < 1500 ms), apps 6 each; image ok/degraded/recovered with the service name; tms-p1 smoke (ordering proof, routing identity) + 10/10 Playwright; restart unless-stopped> |`

```bash
git add packages/db packages/nest-bootstrap apps/api-admin apps/api-driver infra/docker-compose.yml infra/smoke.sh e2e/tests pnpm-workspace.yaml pnpm-lock.yaml docs/architecture.md README.md docs/efficiency/critical-path.md
git commit -m "feat(nest-bootstrap): add /api/health with a database ping on both APIs"
```
Expected: this commit passes all hooks (header 71 characters).

**PR body notes:**
- Diagram: Mermaid `sequenceDiagram` — participants Docker healthcheck / smoke `curl`, Caddy, `HealthController`, `HealthService`, `PrismaService` (pg pool), PostgreSQL: `GET /api/health` → `checkDatabase()` → ``$queryRaw`SELECT 1` `` raced against `HEALTH_DB_TIMEOUT_MS`; `alt` answer in time → `up` → 200 `{"status":"ok","service":"<api>"}`; `else` error or timeout → `warn` (scrubbed reason) → `down` → 503 `{"status":"degraded","service":"<api>"}`; note that Caddy starts only after both APIs report healthy and that smoke checks the service per origin.
- Boundaries: `@tms/db` gains the `./nest` subpath, optional Nest peers (`peerDependenciesMeta` for `@nestjs/common`, `reflect-metadata`, `rxjs`) and `startFaultProxy` in `./testing`; `@tms/nest-bootstrap` gains `HealthModule` (`HealthBody` with `service`), `DATABASE_URL` (required) and `HEALTH_DB_TIMEOUT_MS`, plus dependencies on `@tms/contracts`, `@tms/db` and `@nestjs/terminus`; both apps' tests use the harness; compose healthchecks, `restart: unless-stopped` and `caddy` ordering; smoke (routing identity, migrate ordering) and the Playwright suite signature (`service`). Migration: no.
- Verification plan: `pnpm verify`; `@tms/db` and `@tms/nest-bootstrap` tests RED then GREEN; both app suites; images ok → degraded → recovered against a throwaway database; the full stack as `tms-p1` with `smoke.sh --full` and Playwright; CI `verify` and `e2e`.
- Verification results (`scenario | layer | outcome`): `PrismaModule global, lazy connect, pool connect bound 300 ms, disconnect on destroy | db (Testcontainers) | 4 passed`; `DATABASE_URL / HEALTH_DB_TIMEOUT_MS validation, no value echo | unit | 14 passed`; `controller: public metadata, ok and 503 bodies with service | unit | 3 passed`; `ok + no-store + no access line; refuse → 503 fast → recover; black hole ≈ 1000 ms; boot while down → recover; container stop → 503; no URL/password in logs | e2e (dedicated Postgres + fault proxy) | 6 passed`; `apps /api/health with service | e2e (harness) | 6 passed each`; `images: ok, degraded, recovered, healthcheck exit codes, no access lines, no Prisma CLI | docker run | as expected`; `migrate ordering (StartedAt > FinishedAt) | compose smoke | ok`; `routing identity per origin | smoke + Playwright | api-admin on :58080, api-driver on :58081`; `restart policy | docker inspect | unless-stopped ×2`; `tms-p1 full smoke + Playwright | compose | smoke passed, 10 passed`; `pnpm verify`, CI `e2e` | repo/CI | green`.
- Risks and notes: deviation 9 (503 for degraded); `DATABASE_URL` is now required, so a local `pnpm dev` needs each app's `.env` (README quick start, Task 11) — the error names the variable without echoing it; every health poll during an outage logs one `warn` (six per minute from compose), accepted for a POC; the fault proxy lives in `@tms/db/testing` (dev-only, never deployed: `pnpm deploy --prod` ships `dist/testing` but no test dependencies are loaded unless it is imported); one pino-http per process means the health spec shares a single log stream across its four apps; the ordering proof uses GNU `date -d`; `service` in the health body is the routing-identity check (journal I7-1), not a database detail — the plan header's deviation 9 says so.

---

### Task 13: Sentry, disabled without a DSN

**Branch:** `phase-1/13-sentry`
**PR title:** `feat(nest-bootstrap): wire Sentry, disabled without a DSN, with the shared scrub list`

Spec section 11 (Sentry: DSN from env, disabled when empty, release = git SHA, no PII, `beforeSend` scrub list shared from `contracts`, no user context on the kiosk), section 3 (Sentry sits behind a seam that tests replace: here a recording transport), section 17 step 10 (a test event, needs a DSN); plan deviation 14 (`dataCollection` replaces the removed `sendDefaultPii`). Depends on Task 11 (`CoreModule`, env schema, apps' `main.ts`), Task 12 (`DATABASE_URL` in the schema) and Task 03 (scrub list). Review Focus 1 (Sentry breadcrumbs, `request.data`, headers, query strings) is pinned by `scrub.spec.ts` and `capture.e2e-spec.ts`.

Spike notes (confirmed in a scratch project on 2026-09-24 with `@sentry/nestjs` 11.0.0, Jest 30.5 + ts-jest 29.4, nestjs-pino 5.2.0, Prisma 7.10.0 on Node 24.21; every file below compiled with the repository's flags, linted with its `nodeConfig` and run: 5 suites / 46 tests, `--detectOpenHandles` clean): Sentry 11 filters some values itself before `beforeSend` — `authorization` and `x-device-key` headers and `?token=` arrive as `[Filtered]`, while `?pin=`, `?cardSerial=` and secrets inside other headers (`X-Note: password=…`) arrive verbatim, and the `Cookie` header is absent with `dataCollection.cookies: false`. Task 03's `scrubString`/`scrubUrl` keep bracketed markers whole (`token=[Filtered]` → `token=[REDACTED]`); `scrubSentryEvent` still turns `[Filtered]` into `[REDACTED]` first, so every marker in an event reads the same. `require('@sentry/nestjs')` resolves no `@nestjs/*` specifier (traced with `module.registerHooks`), so the Nest-free `@tms/nest-bootstrap/sentry` really initialises Sentry before Nest loads; without `SentryModule.forRoot()` + `SentryGlobalFilter` the capture spec fails with `Expected length: 1, Received length: 0` (the intermediate RED of Step 5). Sentry fills `release` itself from `SENTRY_RELEASE` and, when that is unset, from CI variables such as `GITHUB_SHA` (`getSentryRelease` in `@sentry/node` 11), so the capture spec does not assert `event.release`; `buildSentryOptions` passes `SENTRY_RELEASE` explicitly and `options.spec.ts` pins it. Nest's `ExceptionsHandler` (also behind `SentryGlobalFilter`) logs the exception, whose message pino copies into `msg`; Task 10's `hooks.streamWrite` pass scrubs it (pinned by its ExceptionsHandler e2e case). From Tasks 10–12 this task relies on: `createLoggerModule` with the `LOG_DESTINATION` provider, `Logger` from `@tms/logger`; `createEnvSchema`, `loadEnv` (`Invalid environment: <path>: <message>`), `configureApp`, `CoreModule.forRoot({ app, env })` returning `{ module, imports }` with the logger first (Task 11's composition pattern: new variables are entries of the `baseEnvSchema` object literal, new modules entries of `imports`); `PrismaModule.forRoot({ url })` global and lazily connected; `DATABASE_URL` required since Task 12; `LOG_LEVEL` accepts `silent`.

**Files:**
- Create: `packages/nest-bootstrap/src/sentry/index.ts`, `packages/nest-bootstrap/src/sentry/options.ts`, `packages/nest-bootstrap/src/sentry/scrub.ts`, `apps/api-admin/src/instrument.ts`, `apps/api-driver/src/instrument.ts`
- Modify: `pnpm-workspace.yaml` (catalog `# nest` block; `minimumReleaseAgeExclude` if pnpm appends), `pnpm-lock.yaml`, `packages/nest-bootstrap/package.json` (`exports["./sentry"]`, dependency), `packages/nest-bootstrap/eslint.config.mjs` (whole file), `packages/nest-bootstrap/src/env.ts` (one helper + three keys of `baseEnvSchema`), `packages/nest-bootstrap/src/core.module.ts` (`SentryModule` import + `APP_FILTER` provider), `apps/api-admin/src/main.ts:1`, `apps/api-driver/src/main.ts:1`, `apps/api-admin/.env.example` and `apps/api-driver/.env.example` (append), `infra/docker/api.Dockerfile` (runtime stage, before `USER node`), `infra/docker-compose.yml` (`api-admin`, `api-driver`: `build.args`, `environment`), `infra/.env.example` (append), `.github/workflows/e2e.yml:19` (job `env`), `docs/architecture.md` (section "Observability — phase 1"), `README.md` (new section before `## Repository layout`), `docs/efficiency/critical-path.md`
- Test: `packages/nest-bootstrap/test/sentry/support.ts`, `packages/nest-bootstrap/test/sentry/boom-app.ts`, `packages/nest-bootstrap/test/sentry/options.spec.ts`, `packages/nest-bootstrap/test/sentry/scrub.spec.ts`, `packages/nest-bootstrap/test/sentry/env.spec.ts`, `packages/nest-bootstrap/test/sentry/capture.e2e-spec.ts`, `packages/nest-bootstrap/test/sentry/disabled.e2e-spec.ts`

**Interfaces:**
- Consumes: `REDACTED`, `isSensitiveKey`, `scrubDeep`, `scrubString`, `scrubUrl` from `@tms/contracts/security` (Task 03); `baseEnvSchema`, `createEnvSchema`, `loadEnv`, `configureApp`, `CoreModule.forRoot({ app, env })` from `@tms/nest-bootstrap` (Task 11, `DATABASE_URL` required since Task 12); new catalog entry `@sentry/nestjs 11.0.0`.
- Produces:
  - `@tms/nest-bootstrap/sentry` (Nest-free, enforced by lint): `buildSentryOptions({ app, env }: SentryOptionsInput): NodeOptions`; `scrubSentryEvent<E extends Event>(event: E, { app }: { app: SentryApp }): E` (mutates and returns); `initSentry(options: NodeOptions): void` (calls `Sentry.init` only when `options.enabled === true`); types `SentryApp`, `SentryEnv`, `SentryOptionsInput`.
  - `baseEnvSchema` gains `SENTRY_DSN` (`http`/`https` URL), `SENTRY_ENVIRONMENT` (1–64 characters), `SENTRY_RELEASE` (1–200 characters); unset and `''` both parse to `undefined`.
  - `CoreModule.forRoot` registers `SentryModule.forRoot()` (second import, after the logger) and `{ provide: APP_FILTER, useClass: SentryGlobalFilter }`.
  - Apps: `src/instrument.ts` is the first import of `main.ts`. API image: build argument `GIT_SHA` (default `dev`) → `ENV SENTRY_RELEASE`; compose passes `GIT_SHA: ${GIT_SHA:-dev}` and `SENTRY_DSN: ${SENTRY_DSN:-}`; CI e2e exports `GIT_SHA: ${{ github.sha }}`.

Resulting options (`buildSentryOptions`): `{ dsn, enabled: dsn !== undefined, environment: SENTRY_ENVIRONMENT ?? NODE_ENV ?? 'development', release: SENTRY_RELEASE, dataCollection: { userInfo: false, cookies: false, httpBodies: [] }, tracesSampleRate: 0, includeLocalVariables: false, maxBreadcrumbs: 50, enableRuntimeChannelInjection: <false under Jest>, beforeSend: scrubSentryEvent, beforeBreadcrumb: scrubDeep }`.

- [ ] **Step 1: Add the dependency, the subpath export and the Nest-free lint rule**

`pnpm-workspace.yaml`, catalog block `# nest`: insert after the line `  '@types/express': ^5.0.6`:

```yaml
  # exact: 11.0.0 is the first release with Nest 12 peers (a bare add picks 10.75.2)
  '@sentry/nestjs': 11.0.0
```

`packages/nest-bootstrap/package.json`: add `"@sentry/nestjs": "catalog:"` to `dependencies` (alphabetical, before the `@tms/*` entries) and the subpath to `exports`, which becomes:

```json
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./sentry": { "types": "./dist/sentry/index.d.ts", "default": "./dist/sentry/index.js" }
  },
```

`packages/nest-bootstrap/eslint.config.mjs` (replaces Task 11's two-line config; `@sentry/nestjs/setup` is banned too because it imports Nest):

```js
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
```

Run: `pnpm install && pnpm peers check && ls packages/nest-bootstrap/node_modules/@sentry`
Expected: install exits 0; `pnpm peers check` reports no issues (11.0.0 peers `@nestjs/common` and `@nestjs/core` `^12.0.0`); `ls` prints `nestjs`. While 11.0.0 (published 2026-09-23 12:37 UTC) is younger than pnpm's 24 h `minimumReleaseAge`, pnpm prints `Added 7 entries to minimumReleaseAgeExclude in pnpm-workspace.yaml` and appends exactly `'@sentry/bundler-plugins@11.0.0'`, `'@sentry/core@11.0.0'`, `'@sentry/nestjs@11.0.0'`, `'@sentry/node@11.0.0'`, `'@sentry/opentelemetry@11.0.0'`, `'@sentry/server-runtime-injection@11.0.0'`, `'@sentry/server-utils@11.0.0'` (S4) — keep them; after that window nothing is appended and none are needed. No `ERR_PNPM_IGNORED_BUILDS` (no `@sentry/*` package has a build script).

- [ ] **Step 2: Write the failing tests**

`packages/nest-bootstrap/test/sentry/support.ts` (Nest-free, so the specs can import it before `Sentry.init`):

```ts
import type { Event } from '@sentry/nestjs';

/** Local shape: `@sentry/core` (which exports `Envelope`) is not resolvable under pnpm's strict layout. */
export type Envelope = [unknown, Array<[{ type?: string }, unknown]>];

/** Never dialled: Prisma connects lazily and no route in these specs touches the database. */
export const UNUSED_DATABASE_URL = 'postgresql://tms:tms@127.0.0.1:9/unused';

/** Transport factory that records envelopes instead of sending them. */
export function recordingTransport(captured: Envelope[]) {
  return () => ({
    send: (envelope: unknown) => {
      captured.push(envelope as Envelope);
      return Promise.resolve({});
    },
    flush: () => Promise.resolve(true),
  });
}

/** Error events among the envelopes; the first envelope is often a `client_report`. */
export function capturedEvents(captured: readonly Envelope[]): Event[] {
  return captured.flatMap(([, items]) =>
    items.filter(([header]) => header.type === 'event').map(([, payload]) => payload as Event),
  );
}
```

`packages/nest-bootstrap/test/sentry/boom-app.ts`:

```ts
import { Controller, Get, HttpException, type INestApplication, Query } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types';
import { CoreModule, configureApp, createEnvSchema, loadEnv } from '../../src';
import { UNUSED_DATABASE_URL } from './support';

@Controller('boom')
class BoomController {
  /** The secret reaches the message at runtime, as request data would. */
  @Get()
  boom(@Query('token') token: string): never {
    throw new Error(`boom token=${token}`);
  }

  @Get('teapot')
  teapot(): never {
    throw new HttpException("I'm a teapot", 418);
  }
}

/** api-admin's CoreModule plus one throwing controller; logs silenced, no log files. */
export async function createBoomApp(): Promise<INestApplication<App>> {
  const env = loadEnv(createEnvSchema({ defaultPort: 3001 }), {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    LOG_FILE_ENABLED: 'false',
    DATABASE_URL: UNUSED_DATABASE_URL,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [CoreModule.forRoot({ app: 'api-admin', env })],
    controllers: [BoomController],
  }).compile();
  const app = configureApp(moduleRef.createNestApplication<INestApplication<App>>());
  await app.init();
  return app;
}
```

`packages/nest-bootstrap/test/sentry/options.spec.ts`:

```ts
import type { Breadcrumb, ErrorEvent } from '@sentry/nestjs';
import { buildSentryOptions } from '../../src/sentry';

const DSN = 'https://public@o0.ingest.sentry.io/1';

describe('buildSentryOptions', () => {
  it.each([
    ['unset', {}],
    ['empty', { SENTRY_DSN: '' }],
  ])('is disabled when the DSN is %s', (_label, env) => {
    const options = buildSentryOptions({ app: 'api-admin', env });
    expect(options.enabled).toBe(false);
    expect(options.dsn).toBeUndefined();
  });

  it('is enabled with a DSN', () => {
    const options = buildSentryOptions({ app: 'api-admin', env: { SENTRY_DSN: DSN } });
    expect(options.enabled).toBe(true);
    expect(options.dsn).toBe(DSN);
  });

  it.each([
    [{ SENTRY_ENVIRONMENT: 'staging', NODE_ENV: 'production' }, 'staging'],
    [{ NODE_ENV: 'production' }, 'production'],
    [{ SENTRY_ENVIRONMENT: '', NODE_ENV: 'test' }, 'test'],
    [{}, 'development'],
  ])('derives the environment from %j as %s', (env, expected) => {
    expect(buildSentryOptions({ app: 'api-admin', env }).environment).toBe(expected);
  });

  it.each([
    [{ SENTRY_RELEASE: '3f2c1ab' }, '3f2c1ab'],
    [{ SENTRY_RELEASE: '' }, undefined],
    [{}, undefined],
  ])('takes the release from %j', (env, expected) => {
    expect(buildSentryOptions({ app: 'api-admin', env }).release).toBe(expected);
  });

  it('collects no user data, no bodies, no cookies, no traces and no local variables', () => {
    expect(buildSentryOptions({ app: 'api-admin', env: { SENTRY_DSN: DSN } })).toMatchObject({
      dataCollection: { userInfo: false, cookies: false, httpBodies: [] },
      tracesSampleRate: 0,
      includeLocalVariables: false,
      maxBreadcrumbs: 50,
    });
  });

  it('switches runtime channel injection off under Jest', () => {
    expect(process.env['JEST_WORKER_ID']).toBeDefined();
    expect(buildSentryOptions({ app: 'api-admin', env: {} }).enableRuntimeChannelInjection).toBe(
      false,
    );
  });

  it('drops the user on api-driver and keeps it on api-admin', async () => {
    const event = (): ErrorEvent => ({ type: undefined, user: { id: 'u-1' } });
    const driver = buildSentryOptions({ app: 'api-driver', env: { SENTRY_DSN: DSN } });
    const admin = buildSentryOptions({ app: 'api-admin', env: { SENTRY_DSN: DSN } });
    expect((await driver.beforeSend?.(event(), {}))?.user).toBeUndefined();
    expect((await admin.beforeSend?.(event(), {}))?.user).toEqual({ id: 'u-1' });
  });

  it('scrubs breadcrumbs before they are stored', () => {
    const { beforeBreadcrumb } = buildSentryOptions({ app: 'api-admin', env: { SENTRY_DSN: DSN } });
    const crumb: Breadcrumb = {
      category: 'http',
      message: 'GET /api/x?token=crumb-secret-1',
      data: { headers: { authorization: 'Bearer crumb-secret-2' }, status: 200 },
    };
    const scrubbed = beforeBreadcrumb?.(crumb, {});
    expect(scrubbed).toEqual({
      category: 'http',
      message: 'GET /api/x?token=[REDACTED]',
      data: { headers: { authorization: '[REDACTED]' }, status: 200 },
    });
  });
});
```

`packages/nest-bootstrap/test/sentry/scrub.spec.ts`:

```ts
import type { Event } from '@sentry/nestjs';
import { scrubSentryEvent } from '../../src/sentry';

const SECRETS = [
  'hdr-secret-1',
  'dev-secret-2',
  'ck-secret-3',
  'qs-secret-4',
  'url-secret-5',
  'pw-secret-6',
  'bearer-secret-7',
  'msg-secret-8',
  'extra-secret-9',
  'ctx-secret-10',
  'crumb-secret-11',
  'tag-secret-12',
  'log-secret-13',
];

function fullEvent(): Event {
  return {
    message: 'login failed for token=msg-secret-8',
    logentry: { message: 'retry with password=%s', params: ['log-secret-13'] },
    request: {
      url: 'http://127.0.0.1:3001/api/boom?token=url-secret-5&page=2',
      method: 'POST',
      query_string: 'token=qs-secret-4&page=2',
      headers: {
        authorization: 'Bearer hdr-secret-1',
        'x-device-key': 'dev-secret-2',
        'user-agent': 'UA/1',
        'x-request-id': 'req-1',
      },
      cookies: { sid: 'ck-secret-3' },
      data: {
        user: { email: 'a@example.test', password: 'pw-secret-6' },
        items: [{ pin: '1234' }],
      },
    },
    exception: {
      values: [{ type: 'Error', value: 'upstream said Bearer bearer-secret-7' }, { type: 'Error' }],
    },
    extra: { apiKey: 'extra-secret-9', note: 'kept' },
    contexts: { upstream: { url: 'https://svc.example.test/?token=ctx-secret-10' } },
    tags: { route: 'GET /api/x?token=tag-secret-12' },
    breadcrumbs: [{ message: 'called', data: { authorization: 'Bearer crumb-secret-11' } }],
    user: { id: 'u-1' },
  };
}

describe('scrubSentryEvent', () => {
  it('removes every secret of a fully populated event', () => {
    const serialized = JSON.stringify(scrubSentryEvent(fullEvent(), { app: 'api-admin' }));
    for (const secret of SECRETS) expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('"1234"');
  });

  it.each<[string, (e: Event) => unknown, unknown]>([
    ['authorization header', (e) => e.request?.headers?.['authorization'], '[REDACTED]'],
    ['custom device-key header', (e) => e.request?.headers?.['x-device-key'], '[REDACTED]'],
    ['harmless headers', (e) => e.request?.headers?.['user-agent'], 'UA/1'],
    ['cookies (dropped entirely)', (e) => e.request?.cookies, undefined],
    ['query string', (e) => e.request?.query_string, 'token=[REDACTED]&page=2'],
    ['url', (e) => e.request?.url, 'http://127.0.0.1:3001/api/boom?token=[REDACTED]&page=2'],
    [
      'request data',
      (e) => e.request?.data,
      { user: { email: 'a@example.test', password: '[REDACTED]' }, items: [{ pin: '[REDACTED]' }] },
    ],
    ['exception value', (e) => e.exception?.values?.[0]?.value, 'upstream said Bearer [REDACTED]'],
    ['exception without value', (e) => e.exception?.values?.[1], { type: 'Error' }],
    ['message', (e) => e.message, 'login failed for token=[REDACTED]'],
    [
      'log entry (params dropped)',
      (e) => e.logentry,
      { message: 'retry with password=[REDACTED]' },
    ],
    ['extra', (e) => e.extra, { apiKey: '[REDACTED]', note: 'kept' }],
    [
      'contexts',
      (e) => e.contexts?.['upstream'],
      { url: 'https://svc.example.test/?token=[REDACTED]' },
    ],
    ['tags', (e) => e.tags?.['route'], 'GET /api/x?token=[REDACTED]'],
    ['breadcrumb data', (e) => e.breadcrumbs?.[0]?.data, { authorization: '[REDACTED]' }],
    ['user on api-admin', (e) => e.user, { id: 'u-1' }],
  ])('scrubs %s', (_field, pick, expected) => {
    expect(pick(scrubSentryEvent(fullEvent(), { app: 'api-admin' }))).toEqual(expected);
  });

  it('turns the values Sentry filtered itself into one marker', () => {
    const event: Event = {
      request: { url: 'http://h/api/x?token=[Filtered]&page=2', query_string: 'token=[Filtered]' },
    };
    expect(scrubSentryEvent(event, { app: 'api-admin' }).request).toEqual({
      url: 'http://h/api/x?token=[REDACTED]&page=2',
      query_string: 'token=[REDACTED]',
    });
  });

  it('scrubs a query string given as key/value pairs', () => {
    const event: Event = {
      request: {
        query_string: [
          ['token', 'qs-1'],
          ['page', '2'],
        ],
      },
    };
    expect(scrubSentryEvent(event, { app: 'api-admin' }).request?.query_string).toEqual([
      ['token', '[REDACTED]'],
      ['page', '2'],
    ]);
  });

  it('removes the user on the kiosk API', () => {
    expect(scrubSentryEvent(fullEvent(), { app: 'api-driver' }).user).toBeUndefined();
  });

  it('returns the same event object and leaves a minimal event unchanged', () => {
    const event: Event = { message: 'mapping shipping keyId=7' };
    expect(scrubSentryEvent(event, { app: 'api-admin' })).toBe(event);
    expect(event).toEqual({ message: 'mapping shipping keyId=7' });
  });
});
```

`packages/nest-bootstrap/test/sentry/env.spec.ts` (the error text is the full `loadEnv` message; zod's "Invalid URL" never contains the input):

```ts
import { createEnvSchema, loadEnv } from '../../src';

const schema = createEnvSchema({ defaultPort: 3001 });
const required = { DATABASE_URL: 'postgresql://tms:tms@localhost:5432/tms' };
const DSN = 'https://public@o0.ingest.sentry.io/1';

describe('Sentry variables in the env schema', () => {
  it.each([
    ['unset', required],
    ['empty', { ...required, SENTRY_DSN: '', SENTRY_ENVIRONMENT: '', SENTRY_RELEASE: '' }],
  ])('leaves all three undefined when %s', (_label, source) => {
    const env = loadEnv(schema, source);
    expect([env.SENTRY_DSN, env.SENTRY_ENVIRONMENT, env.SENTRY_RELEASE]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('keeps a DSN, an environment and a release', () => {
    const env = loadEnv(schema, {
      ...required,
      SENTRY_DSN: DSN,
      SENTRY_ENVIRONMENT: 'staging',
      SENTRY_RELEASE: '3f2c1ab',
    });
    expect([env.SENTRY_DSN, env.SENTRY_ENVIRONMENT, env.SENTRY_RELEASE]).toEqual([
      DSN,
      'staging',
      '3f2c1ab',
    ]);
  });

  it.each(['not a dsn', 'ftp://public@example.test/1'])(
    'rejects SENTRY_DSN=%s without echoing the value',
    (dsn) => {
      let message = '';
      try {
        loadEnv(schema, { ...required, SENTRY_DSN: dsn });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toBe('Invalid environment: SENTRY_DSN: Invalid URL');
    },
  );

  it('rejects an environment name longer than 64 characters', () => {
    expect(() => loadEnv(schema, { ...required, SENTRY_ENVIRONMENT: 'x'.repeat(65) })).toThrow(
      'Invalid environment: SENTRY_ENVIRONMENT: Too big: expected string to have <=64 characters',
    );
  });
});
```

`packages/nest-bootstrap/test/sentry/capture.e2e-spec.ts` (Sentry's client is per Jest sandbox, so the enabled and the disabled case live in two files):

```ts
// Sentry is initialised before Nest is loaded, exactly as `instrument.ts` does in the apps.
import * as Sentry from '@sentry/nestjs';
import { buildSentryOptions } from '../../src/sentry';
import { type Envelope, capturedEvents, recordingTransport } from './support';

const captured: Envelope[] = [];
Sentry.init({
  ...buildSentryOptions({
    app: 'api-admin',
    env: { SENTRY_DSN: 'https://public@localhost:9/1', NODE_ENV: 'test' },
  }),
  transport: recordingTransport(captured),
});

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createBoomApp } from './boom-app';

describe('Sentry capture through SentryGlobalFilter (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createBoomApp();
  });

  afterAll(async () => {
    await app.close();
    await Sentry.close(2000);
  });

  it('reports a thrown Error once, scrubbed, and answers the standard 500', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/boom?token=abc123&pin=pin-secret-5')
      .set('Authorization', 'Bearer hdr-secret-1')
      .set('X-Device-Key', 'dev-secret-2')
      .set('Cookie', 'sid=ck-secret-3')
      .set('X-Note', 'password=pw-secret-4')
      .expect(500);
    expect(res.body).toEqual({ statusCode: 500, message: 'Internal server error' });
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.[jt]s:\d+/);

    expect(await Sentry.flush(2000)).toBe(true);
    const events = capturedEvents(captured);
    expect(events).toHaveLength(1);
    const [event] = events;
    const serialized = JSON.stringify(captured);
    expect(serialized).toContain('boom');
    const secrets = [
      'abc123',
      'hdr-secret-1',
      'dev-secret-2',
      'ck-secret-3',
      'pw-secret-4',
      'pin-secret-5',
    ];
    for (const secret of secrets) expect(serialized).not.toContain(secret);
    expect(event?.exception?.values?.[0]?.value).toBe('boom token=[REDACTED]');
    expect(event?.exception?.values?.[0]?.mechanism).toEqual({
      type: 'auto.http.nestjs.global_filter',
      handled: false,
    });
    expect(event?.request?.headers?.['authorization']).toBe('[REDACTED]');
    expect(event?.request?.headers?.['x-device-key']).toBe('[REDACTED]');
    expect(event?.request?.headers?.['x-note']).toBe('password=[REDACTED]');
    expect(event?.request?.url).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/api\/boom\?token=\[REDACTED\]&pin=\[REDACTED\]$/,
    );
    expect(event?.request?.query_string).toBe('token=[REDACTED]&pin=[REDACTED]');
    expect(event?.request?.cookies).toBeUndefined();
    expect(event?.user).toBeUndefined();
    expect(event?.environment).toBe('test');
  });

  it('does not report HttpExceptions', async () => {
    const before = capturedEvents(captured).length;
    await request(app.getHttpServer()).get('/api/boom/teapot').expect(418);
    await Sentry.flush(2000);
    expect(capturedEvents(captured)).toHaveLength(before);
  });

  it('keeps the JSON 404 body of unknown routes', async () => {
    const res = await request(app.getHttpServer()).get('/api/does-not-exist').expect(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Cannot GET /api/does-not-exist',
    });
  });
});
```

`packages/nest-bootstrap/test/sentry/disabled.e2e-spec.ts`:

```ts
// Same order as instrument.ts: initSentry runs before Nest is loaded, here with an empty DSN.
import * as Sentry from '@sentry/nestjs';
import { buildSentryOptions, initSentry } from '../../src/sentry';
import { type Envelope, recordingTransport } from './support';

const captured: Envelope[] = [];
const listenersBefore = {
  uncaughtException: process.listenerCount('uncaughtException'),
  unhandledRejection: process.listenerCount('unhandledRejection'),
};
initSentry({
  ...buildSentryOptions({ app: 'api-admin', env: { SENTRY_DSN: '', NODE_ENV: 'test' } }),
  transport: recordingTransport(captured),
});

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createBoomApp } from './boom-app';

describe('Sentry without a DSN (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createBoomApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('initialises nothing: no client and no process listeners', () => {
    expect(Sentry.getClient()).toBeUndefined();
    expect({
      uncaughtException: process.listenerCount('uncaughtException'),
      unhandledRejection: process.listenerCount('unhandledRejection'),
    }).toEqual(listenersBefore);
  });

  it('still answers the standard 500 and never calls the transport', async () => {
    const res = await request(app.getHttpServer()).get('/api/boom?token=abc123').expect(500);
    expect(res.body).toEqual({ statusCode: 500, message: 'Internal server error' });
    await Sentry.flush(500);
    expect(captured).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm turbo run test --filter=@tms/nest-bootstrap -- test/sentry`
Expected: FAIL. `options.spec.ts`, `scrub.spec.ts`, `capture.e2e-spec.ts` and `disabled.e2e-spec.ts` do not compile (`Cannot find module '../../src/sentry'`); `env.spec.ts` reports `Tests: 4 failed, 2 passed, 6 total` (the schema still strips the unknown `SENTRY_*` keys, so only the two "undefined" cases pass).

- [ ] **Step 4: Write the Sentry subpath and extend the env schema**

`packages/nest-bootstrap/src/sentry/scrub.ts`:

```ts
import type { Event, RequestEventData } from '@sentry/nestjs';
import {
  REDACTED,
  isSensitiveKey,
  scrubDeep,
  scrubString,
  scrubUrl,
} from '@tms/contracts/security';

export type SentryApp = 'api-admin' | 'api-driver';

type QueryString = NonNullable<RequestEventData['query_string']>;

/**
 * Sentry's marker for values it filtered itself. It becomes ours before `scrubUrl` runs, which
 * keeps `token=[REDACTED]` whole instead of producing `token=[REDACTED]]`.
 */
const SENTRY_FILTERED = '[Filtered]';

function scrubUrlText(text: string): string {
  return scrubUrl(text.replaceAll(SENTRY_FILTERED, REDACTED));
}

function scrubQueryString(query: QueryString): QueryString {
  if (typeof query === 'string') return scrubUrlText(query);
  if (Array.isArray(query)) {
    return query.map(([key, value]): [string, string] => [
      key,
      isSensitiveKey(key) ? REDACTED : scrubString(value),
    ]);
  }
  return scrubDeep(query);
}

/**
 * `beforeSend` hook: removes secrets before an event leaves the process. Sentry 11 filters a few
 * values itself (`authorization`, `x-device-key`, `?token=` arrive as `[Filtered]`), but not
 * `?pin=`, `?cardSerial=`, secrets inside other headers, messages, exception values or breadcrumb
 * data. Mutates and returns the event, as `beforeSend` expects.
 */
export function scrubSentryEvent<E extends Event>(event: E, { app }: { app: SentryApp }): E {
  const request = event.request;
  if (request) {
    delete request.cookies;
    if (request.headers) request.headers = scrubDeep(request.headers);
    if (request.data !== undefined) request.data = scrubDeep(request.data);
    if (request.query_string !== undefined) {
      request.query_string = scrubQueryString(request.query_string);
    }
    if (request.url) request.url = scrubUrlText(request.url);
  }
  if (event.message) event.message = scrubString(event.message);
  // Positional params cannot be matched against the scrub list, so only the template survives.
  if (event.logentry) {
    const template = event.logentry.message;
    event.logentry = template === undefined ? {} : { message: scrubString(template) };
  }
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubString(exception.value);
  }
  if (event.extra) event.extra = scrubDeep(event.extra);
  if (event.contexts) event.contexts = scrubDeep(event.contexts);
  if (event.tags) event.tags = scrubDeep(event.tags);
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map((b) => scrubDeep(b));
  // No user context on the kiosk (spec section 11).
  if (app === 'api-driver') delete event.user;
  return event;
}
```

`packages/nest-bootstrap/src/sentry/options.ts`:

```ts
import * as Sentry from '@sentry/nestjs';
import type { NodeOptions } from '@sentry/nestjs';
import { scrubDeep } from '@tms/contracts/security';
import { type SentryApp, scrubSentryEvent } from './scrub';

/** The variables Sentry reads. `instrument.ts` passes `process.env` itself (see there why). */
export interface SentryEnv {
  readonly SENTRY_DSN?: string | undefined;
  readonly SENTRY_ENVIRONMENT?: string | undefined;
  readonly SENTRY_RELEASE?: string | undefined;
  readonly NODE_ENV?: string | undefined;
}

export interface SentryOptionsInput {
  readonly app: SentryApp;
  readonly env: SentryEnv;
}

/** An empty string (`SENTRY_DSN=` in a `.env` file) means "not set", as in the env schema. */
function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

export function buildSentryOptions({ app, env }: SentryOptionsInput): NodeOptions {
  const dsn = nonEmpty(env.SENTRY_DSN);
  return {
    dsn,
    enabled: dsn !== undefined,
    environment: nonEmpty(env.SENTRY_ENVIRONMENT) ?? nonEmpty(env.NODE_ENV) ?? 'development',
    release: nonEmpty(env.SENTRY_RELEASE),
    // Sentry 11 replaced `sendDefaultPii` with `dataCollection`, whose defaults collect the user's
    // IP, cookies, headers and bodies. Headers stay collected so beforeSend can scrub them.
    dataCollection: { userInfo: false, cookies: false, httpBodies: [] },
    tracesSampleRate: 0,
    includeLocalVariables: false,
    maxBreadcrumbs: 50,
    // Jest 30 throws on module.registerHooks(); without this every init inside a test warns.
    enableRuntimeChannelInjection: process.env['JEST_WORKER_ID'] === undefined,
    beforeSend: (event) => scrubSentryEvent(event, { app }),
    beforeBreadcrumb: (breadcrumb) => scrubDeep(breadcrumb),
  };
}

/**
 * Calls `Sentry.init` only when a DSN is configured. Without one nothing is initialised: no client,
 * no process listeners, no module hooks, so `import './instrument'` has no side effects.
 */
export function initSentry(options: NodeOptions): void {
  if (options.enabled === true) Sentry.init(options);
}
```

`packages/nest-bootstrap/src/sentry/index.ts`:

```ts
// Nest-free on purpose (lint rule in eslint.config.mjs): apps load this before Nest.
export { buildSentryOptions, initSentry, type SentryEnv, type SentryOptionsInput } from './options';
export { scrubSentryEvent, type SentryApp } from './scrub';
```

`packages/nest-bootstrap/src/env.ts`: add the helper directly above `export const baseEnvSchema`, and the three keys as the last entries of the `baseEnvSchema` object (after `HEALTH_DB_TIMEOUT_MS` from Task 12). `z.preprocess` normalises `''` before validation, so one helper serves all three variables and a malformed DSN still reports `Invalid URL` (the `.or(z.literal('').transform(() => undefined))` form also works but needs its own transform per variable; `z.string().url()` is deprecated in zod 4):

```ts
/** Unset and empty (`SENTRY_DSN=` in a `.env` file) both mean "not configured". */
const emptyAsUndefined = (value: unknown): unknown => (value === '' ? undefined : value);
```

```ts
  // Read raw by instrument.ts before this schema runs; validated here so a typo stops the boot.
  SENTRY_DSN: z.preprocess(emptyAsUndefined, z.url({ protocol: /^https?$/ }).optional()),
  SENTRY_ENVIRONMENT: z.preprocess(emptyAsUndefined, z.string().min(1).max(64).optional()),
  SENTRY_RELEASE: z.preprocess(emptyAsUndefined, z.string().min(1).max(200).optional()),
```

Verified outputs of this expression (zod 4.6.5): `{}` → all three absent; `{ SENTRY_DSN: '', SENTRY_ENVIRONMENT: '', SENTRY_RELEASE: '' }` → all three `undefined`; `'not a dsn'` and `'ftp://public@example.test/1'` → `SENTRY_DSN: Invalid URL`; `'x'.repeat(65)` → `SENTRY_ENVIRONMENT: Too big: expected string to have <=64 characters`. The inferred `BaseEnv` gains `SENTRY_DSN?: string | undefined` (and the same for the other two), so Task 11's exact-defaults assertion is unaffected.

- [ ] **Step 5: Run the tests: everything but the capture passes**

Run: `pnpm turbo run test --filter=@tms/nest-bootstrap -- test/sentry`
Expected: `Tests: 1 failed, 45 passed, 46 total`. The failure is `capture.e2e-spec.ts` › "reports a thrown Error once, scrubbed, and answers the standard 500" with `Expected length: 1, Received length: 0`: without the filter nothing reports the error. `disabled.e2e-spec.ts` already passes (2 tests).

- [ ] **Step 6: Register `SentryModule` and the global filter in `CoreModule`**

`packages/nest-bootstrap/src/core.module.ts`: add the imports

```ts
import { APP_FILTER } from '@nestjs/core';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
```

and, in the object returned by `CoreModule.forRoot`, put `SentryModule.forRoot()` directly after the `createLoggerModule(...)` entry of `imports` (the phase 0 slot order: logger first, Sentry second) and register the filter in a new `providers` key (Tasks 11 and 12 add none):

```ts
      providers: [{ provide: APP_FILTER, useClass: SentryGlobalFilter }],
```

`SentryModule.forRoot()` registers only the tracing interceptor; the filter reports unexpected errors and delegates the response to Nest's `BaseExceptionFilter`, so bodies do not change (S4: 404 body identical, `HttpException`s not reported). Without a client both are no-ops.

Run: `pnpm turbo run test --filter=@tms/nest-bootstrap -- test/sentry`
Expected: `Test Suites: 5 passed, 5 total`, `Tests: 46 passed, 46 total` (options 14, scrub 21, env 6, capture 3, disabled 2).

Run: `pnpm turbo run test --filter=@tms/nest-bootstrap -- --detectOpenHandles test/sentry`
Expected: `Tests: 46 passed, 46 total`; no "open handle" and no "did not exit" output.

Run: `pnpm turbo run test --filter=@tms/nest-bootstrap`
Expected: every suite passes — `Test Suites: 13 passed, 13 total`, `Tests: 117 passed, 117 total` (Task 11's 48 and Task 12's 23 unchanged plus the 46 above).

Run: `pnpm turbo run typecheck --filter=@tms/nest-bootstrap`, then `pnpm turbo run build --filter=@tms/nest-bootstrap`, then `ls packages/nest-bootstrap/dist/sentry`
Expected: exit 0 twice; `index.d.ts index.js options.d.ts options.js scrub.d.ts scrub.js` (plus `.map` files).

- [ ] **Step 7: Prove the Nest-free rule**

Run: `printf "import '@nestjs/common';\n" > packages/nest-bootstrap/src/sentry/lint-probe.ts && pnpm turbo run lint --filter=@tms/nest-bootstrap; echo exit=$?`
Expected: exit 1 with `src/sentry/lint-probe.ts  1:1  error  '@nestjs/common' import is restricted from being used by a pattern. src/sentry must stay Nest-free: instrument.ts loads it before Nest  no-restricted-imports` (stylish drops the final period).

Run: `rm packages/nest-bootstrap/src/sentry/lint-probe.ts && pnpm turbo run lint --filter=@tms/nest-bootstrap`
Expected: exit 0.

- [ ] **Step 8: Load `instrument.ts` first in both apps**

`apps/api-admin/src/instrument.ts`:

```ts
import { buildSentryOptions, initSentry } from '@tms/nest-bootstrap/sentry';

// Runs before Nest is loaded and therefore before loadEnv: the SDK has to see modules as they are
// required. Only the four Sentry variables are read here, raw; loadEnv validates them a moment
// later and stops the boot on a malformed value.
initSentry(buildSentryOptions({ app: 'api-admin', env: process.env }));
```

`apps/api-driver/src/instrument.ts`: the same file with `app: 'api-driver'`.

`apps/api-admin/src/main.ts:1` and `apps/api-driver/src/main.ts:1` — replace the slot comment (`// Phase 1 Task 13: import './instrument' must stay the first import`) with:

```ts
// Must stay the first import: Sentry initialises before Nest is loaded.
import './instrument';
```

Append to `apps/api-admin/.env.example` and `apps/api-driver/.env.example`:

```ini
# Sentry: an empty DSN disables it (the SDK is not even initialised).
SENTRY_DSN=
SENTRY_ENVIRONMENT=development
# Set to the git SHA by the image build (GIT_SHA build argument); leave empty locally.
SENTRY_RELEASE=
```

Run: `pnpm turbo run lint --filter=@tms/api-admin`, `pnpm turbo run typecheck --filter=@tms/api-admin`, `pnpm turbo run build --filter=@tms/api-admin`, then the same three for `@tms/api-driver`
Expected: exit 0 for all six.

Run: `grep -n 'require(' apps/api-admin/dist/main.js | head -2 && grep -n 'require(' apps/api-driver/dist/main.js | head -1`
Expected: the first `require` in both files is `require("./instrument");`, before `require("reflect-metadata")` (S4 C6).

Run: `pnpm turbo run test --filter=@tms/api-admin`, then `pnpm turbo run test --filter=@tms/api-driver`
Expected: the same suite and test counts as on the parent commit (the specs never import `instrument.ts`; the preset excludes it from coverage since Task 02).

Run (no Sentry output with an empty and with an unreachable DSN; the database URL is never dialled because `/api/x` does not touch it):

```bash
for DSN in '' 'https://public@localhost:9/1'; do
  ERR=$(mktemp)
  (PORT=3101 LOG_FILE_ENABLED=false DATABASE_URL=postgresql://tms:tms@127.0.0.1:9/unused SENTRY_DSN="$DSN" \
    timeout 8 node apps/api-admin/dist/main.js > /dev/null 2> "$ERR" &)
  sleep 3; curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3101/api/x
  sleep 6; wc -c < "$ERR"; rm "$ERR"
done
```

Expected: `404` then `0` for both iterations (stderr empty: no `[Sentry]` warning, no hook message).

- [ ] **Step 9: Release = git SHA in the image, compose and CI**

`infra/docker/api.Dockerfile`, runtime stage: insert directly before `USER node` (the last layers, so a new commit rebuilds only this metadata):

```dockerfile
ARG GIT_SHA=dev
ENV SENTRY_RELEASE=${GIT_SHA}
```

`infra/docker-compose.yml`, service `api-admin`: `build.args` becomes

```yaml
      args:
        APP: api-admin
        GIT_SHA: ${GIT_SHA:-dev}
```

and `environment` gains `SENTRY_DSN: ${SENTRY_DSN:-}` (after `DATABASE_URL`). Service `api-driver`: the same with `APP: api-driver`.

Append to `infra/.env.example`:

```ini
# Sentry for the API containers; empty = disabled. The release is the GIT_SHA build argument.
SENTRY_DSN=
```

`.github/workflows/e2e.yml:19` — insert after `    timeout-minutes: 30`:

```yaml
    env:
      # Baked into both API images as SENTRY_RELEASE through the compose build argument.
      GIT_SHA: ${{ github.sha }}
```

Run: `docker build --build-arg APP=api-admin --build-arg GIT_SHA=$(git rev-parse --short HEAD) -f infra/docker/api.Dockerfile -t tms-p1-api-admin . && docker run --rm tms-p1-api-admin node -e "console.log(process.env.SENTRY_RELEASE)"`
Expected: build succeeds; prints the output of `git rev-parse --short HEAD`.

Run: `docker build --build-arg APP=api-driver -f infra/docker/api.Dockerfile -t tms-p1-api-driver . && docker run --rm tms-p1-api-driver node -e "console.log(process.env.SENTRY_RELEASE)"`
Expected: `dev` (the default of the build argument).

Run (throwaway database from the Execution notes; both DSN variants):

```bash
docker network create tms-p1-net && docker run -d --name tms-p1-pg --network tms-p1-net -p 55432:5432 \
  -e POSTGRES_USER=tms -e POSTGRES_PASSWORD=tms -e POSTGRES_DB=tms postgres:18-alpine && sleep 5
for DSN in '' 'https://public@localhost:9/1'; do
  docker run -d --name tms-p1-api-admin --network tms-p1-net --read-only --tmpfs /tmp -v tms-p1-logs:/var/log/tms \
    -e DATABASE_URL=postgresql://tms:tms@tms-p1-pg:5432/tms -e SENTRY_DSN="$DSN" -p 53001:3001 tms-p1-api-admin
  sleep 4; curl -s http://localhost:53001/api/health; echo
  docker logs tms-p1-api-admin 2>&1 | grep -c '\[Sentry\]'
  docker rm -f tms-p1-api-admin
done
docker rm -f tms-p1-pg && docker network rm tms-p1-net && docker volume rm tms-p1-logs
```

Expected: for both iterations `{"status":"ok","service":"api-admin"}` and `0` (the SDK prints nothing; `SentryModule dependencies initialized` lines do not match the bracketed pattern).

Run (compose as project `tms-p1`, alternate ports from the Execution notes):

```bash
export POSTGRES_PORT=55432 MAILPIT_UI_PORT=58025 MAILPIT_SMTP_PORT=51025 CADDY_ADMIN_PORT=58080 CADDY_KIOSK_PORT=58081
GIT_SHA=$(git rev-parse --short HEAD) pnpm compose -p tms-p1 --profile full up -d --build
pnpm compose -p tms-p1 --profile full exec -T api-admin printenv SENTRY_RELEASE
pnpm compose -p tms-p1 --profile full exec -T api-driver printenv SENTRY_RELEASE
COMPOSE_PROJECT_NAME=tms-p1 infra/smoke.sh --full
pnpm compose -p tms-p1 --profile full down -v
```

Expected: both `printenv` lines print the short SHA; `smoke.sh --full` passes exactly as after Task 12.

Run (section 17 step 10, only with a real DSN from Stefan; otherwise record "not run (no DSN provided)" in the PR):

```bash
docker run --rm -e SENTRY_DSN="$SENTRY_DSN" -e SENTRY_ENVIRONMENT=phase1-check tms-p1-api-admin node -e "
const { buildSentryOptions, initSentry } = require('@tms/nest-bootstrap/sentry');
const Sentry = require(require.resolve('@sentry/nestjs', { paths: [require.resolve('@tms/nest-bootstrap/sentry')] }));
initSentry(buildSentryOptions({ app: 'api-admin', env: process.env }));
Sentry.captureException(new Error('phase 1 Sentry check token=should-not-appear'));
Sentry.flush(5000).then((ok) => console.log('flushed', ok));"
```

Expected: `flushed true`; the Sentry project shows one issue in environment `phase1-check`, release = the short SHA, message `phase 1 Sentry check token=[REDACTED]`, no user.

- [ ] **Step 10: Document Sentry**

`docs/architecture.md`, section `## Observability — phase 1 (logs, Sentry, audit)`: insert after the Health paragraph (Task 12), before `## Testing strategy`:

```markdown
### Sentry

`@sentry/nestjs` 11 in both APIs, initialised by `src/instrument.ts`, the first import of
`main.ts`, because the SDK has to load before Nest. An empty or unset `SENTRY_DSN` means
`initSentry` does nothing: no client, no process listeners, no module hooks. Release = git SHA:
the API image turns the `GIT_SHA` build argument into `SENTRY_RELEASE` (compose passes
`${GIT_SHA:-dev}`, CI the commit SHA). `buildSentryOptions` (`@tms/nest-bootstrap/sentry`, kept
Nest-free by a lint rule) collects no user data, cookies or bodies (`dataCollection`, Sentry 11's
replacement for `sendDefaultPii`), no traces and no local variables. `beforeSend` runs
`scrubSentryEvent`, built on the same `@tms/contracts/security` scrub list as the logs, over
headers, query string, URL, request data, messages, exception values, extra, contexts, tags and
breadcrumbs; it drops cookies and removes the user on `api-driver` (no user context on the kiosk).
`SentryGlobalFilter`, registered by `CoreModule`, reports unexpected errors only; `HttpException`s
are not reported and response bodies do not change. The SPAs and source-map upload follow in
phase 8.
```

`README.md`: insert before `## Repository layout`:

```markdown
## Error reporting

Both APIs report unexpected errors to Sentry when a DSN is set; without one the SDK is not
initialised at all.

| Variable             | Default                    | Meaning                                            |
| -------------------- | -------------------------- | -------------------------------------------------- |
| `SENTRY_DSN`         | empty                      | project DSN; empty or unset disables Sentry        |
| `SENTRY_ENVIRONMENT` | `NODE_ENV`                 | environment shown in Sentry                        |
| `SENTRY_RELEASE`     | empty; images: the git SHA | release, from the image's `GIT_SHA` build argument |

Compose: `SENTRY_DSN=<dsn> GIT_SHA=$(git rev-parse --short HEAD) pnpm compose --profile full up -d --build`.
```

Run: `pnpm exec prettier --write packages/nest-bootstrap apps/api-admin/src apps/api-driver/src docs/architecture.md README.md infra/docker-compose.yml .github/workflows/e2e.yml pnpm-workspace.yaml && pnpm format:check`
Expected: exit 0.

- [ ] **Step 11: Verify the whole repository and commit**

Run: `pnpm verify`
Expected: all turbo tasks green (lint, typecheck, test, build for every package), `prettier --check` clean, `hygiene: ok (<n> tracked files, single copies ok)`, gitleaks `no leaks found`.

After pushing the branch: CI `verify`, `hygiene`, `db-drift` and `e2e` green (the `e2e` job now builds both API images with `GIT_SHA` = the commit SHA).

Append the journal row to `docs/efficiency/critical-path.md` (date, start and end from the session clock; rework `none` or what was reworked):

```
| 2026-MM-DD | Task 13: Sentry, disabled without a DSN | subagent | HH:MM | HH:MM | none | n/a | 5 Sentry suites / 46 tests (options 14, scrub 21, env 6, capture 3 with a recording transport, disabled 2); `--detectOpenHandles` clean; Nest-free lint probe 1 error then 0; `dist/main.js` requires `./instrument` first; empty and unreachable DSN boot with 0 bytes on stderr; image `SENTRY_RELEASE` = short SHA; real event: <run with DSN / not run>. |
```

```bash
git add packages/nest-bootstrap apps/api-admin apps/api-driver infra/docker/api.Dockerfile infra/docker-compose.yml infra/.env.example .github/workflows/e2e.yml pnpm-workspace.yaml pnpm-lock.yaml docs/architecture.md README.md docs/efficiency/critical-path.md
git commit -m "feat(nest-bootstrap): wire Sentry, disabled without a DSN, with the shared scrub list"
```
Expected: this commit passes all hooks (header 85 characters).

**PR body notes:**
- Diagram: Mermaid `sequenceDiagram` — client → route handler throws `Error` → `SentryGlobalFilter` (standard 500 body, `BaseExceptionFilter`) → `Sentry.captureException` → `beforeSend` = `scrubSentryEvent` (scrub list from `@tms/contracts/security`, `[Filtered]` normalised, cookies dropped, user removed on `api-driver`) → transport → Sentry; `alt` no DSN: `initSentry` never called `Sentry.init`, so capture is a no-op and nothing leaves the process.
- Boundaries: new subpath `@tms/nest-bootstrap/sentry` (Nest-free, lint-enforced); `CoreModule` gains `SentryModule` + a global exception filter; `baseEnvSchema` gains three variables; apps' `instrument.ts` + `main.ts` line 1; `api.Dockerfile` `GIT_SHA` argument; compose build argument and `SENTRY_DSN`; CI e2e `GIT_SHA`. Migration: no.
- Verification plan: `pnpm verify`; the Sentry suites RED, then all but the capture, then GREEN (and with `--detectOpenHandles`); the Nest-free lint probe; `dist/main.js` require order; local and image boots with an empty and an unreachable DSN; image `SENTRY_RELEASE`; compose `tms-p1` with `smoke.sh --full`; the section 17 step 10 test event only with a real DSN (Stefan provides it; otherwise "not run"); CI `verify`, `hygiene`, `db-drift`, `e2e`.
- Verification results (`scenario | layer | outcome`): options (enabled/disabled, environment fallback, release, no PII/traces/locals, Jest channel injection, kiosk user, breadcrumbs) | unit | 14 passed; scrub table (headers incl. custom, cookies dropped, query string string/pairs, URL, request data, exception value, message, log entry, extra, contexts, tags, breadcrumbs, `[Filtered]`, false positives) | unit | 21 passed; env variables (unset/empty/valid/invalid DSN not echoed/too long) | unit | 6 passed; capture with a recording transport (one event, six secrets absent from the envelope, mechanism `auto.http.nestjs.global_filter`, 500 body unchanged, `HttpException` not reported, 404 body unchanged) | e2e (Nest + supertest) | 3 passed; empty DSN (no client, no listeners, transport never called) | e2e | 2 passed; open handles | e2e | clean; Nest-free lint probe | lint | 1 error, then 0; first `require` of `dist/main.js` | build | `./instrument`; local boot empty / unreachable DSN | runtime | stderr 0 bytes; image `SENTRY_RELEASE` | docker | short SHA / `dev`; image boot empty / unreachable DSN | docker | `{"status":"ok","service":"api-admin"}`, 0 `[Sentry]` lines; compose `tms-p1` `printenv` + `smoke.sh --full` | compose | SHA, passed; real event | manual | not run (no DSN) or `flushed true` + event checked; `pnpm verify` | repo | green; CI | CI | green.
- Risks and notes: deviation 14 (`dataCollection` instead of `sendDefaultPii`); `@sentry/nestjs` 11.0.0 was released on 2026-09-23 and is pinned exactly (fallback if it misbehaves: hold this PR — Task 14 does not depend on it and rebases onto Task 12); Node 26 (`main`'s `engines`) for `Module.registerHooks`; `[Filtered]` normalisation stays as a second guard behind Task 03's bracket-aware `scrubUrl`; Nest's exception log line carries the exception message as the pino `msg`, scrubbed by Task 10's `streamWrite` pass; `server_name` (host or container name) is still sent — harmless, noted; compose and `infra/.env.example` gain `SENTRY_DSN` with an empty default; the section 17 step 10 test event needs Stefan's DSN.

---

---

### Task 14: `@tms/domain/shared` — transactions, audit, clock, mail port

**Branch:** `phase-1/14-domain-shared`
**PR title:** `feat(domain): add the shared module with transactions, audit, clock and mail port`

Spec section 3 ("**Transactions**: `@nestjs-cls/transactional` with the Prisma adapter. A state change that crosses a module boundary … and the audit record are **direct service calls inside one transaction**. Domain events … never for state changes"; ports `Clock`, `MailSender`), section 6 (`domain/shared`), section 7 (`AuditLog`), section 11 ("`AuditService.record()` inside the caller's transaction"; request id via AsyncLocalStorage); plan deviation 13 (no SMTP adapter, no event emitter yet). Review Focus 4 (rollback, fail-closed metadata, autocommit, unknown keys) and 8 (CLS id = log id = header under 50 concurrent requests) are pinned by `audit.e2e-spec.ts`. Depends on Task 12 (`PrismaModule`, `PrismaService`), Task 10 (`resolveRequestId`, `createLoggerModule`, `LOG_DESTINATION`, `MemoryLogStream`), Task 04 (harness), Task 03 (audit contracts). Independent of Task 13.

Spike notes (confirmed in a scratch project on 2026-09-24 with `nestjs-cls` 7.0.0, `@nestjs-cls/transactional` 4.0.0, `@nestjs-cls/transactional-adapter-prisma` 2.0.0, Prisma 7.10.0 + `@prisma/adapter-pg` 7.10.0 and nestjs-pino 5.2.0 on Node 24.21 against a throwaway Postgres 16; every file compiled, linted with the repository's `nodeConfig` and run: 4 suites / 20 tests, `--detectOpenHandles` clean): Nest runs global-module middleware in import order; with `SharedModule` imported before the logger the CLS middleware sets `req.id` first and pino-http skips its `genReqId` (`req.id = req.id || genReqId(req, res)` in pino-http 11), so `X-Request-Id` disappeared from the response (reproduced: 2 failing tests) — `SharedModule`'s CLS `setup` therefore also calls `resolveRequestId(req, res)`, which Task 10 memoizes on `req.id`, and a test pins both orders. A constructor parameter typed with the alias `AppTransactionHost` and no `@Inject` fails DI (`Nest can't resolve dependencies of the AuditService (?, ClsService, Clock, tms:audit-app)`, reproduced), hence `@Inject(TransactionHost)` on every such parameter. The transactional plugin resolves the `@Global()` `PrismaService` with no `imports`; outside a transaction `txHost.tx` is that very instance (compared with `toBe`: Prisma 7's constructor returns a proxy, so `instanceof` is never used); `Propagation.Nested` rolls back to a savepoint with `sqlFlavor: 'postgresql'`; `@Transactional<TransactionalAdapterPrisma>({ isolationLevel: 'Serializable' })` typechecks. `AuditMetadata<'admin.role.created'>` is `Record<string, never>`, so `{ unexpected: 1 }` is a compile error (TS2322) and the fail-closed test needs `as unknown as` to reach the runtime check; with the full Task 03 action table the return type of `parseAuditMetadata(...)` is assignable to `Prisma.InputJsonValue`. `packages/domain/test` cannot import files under `packages/db/test` (TS6059: `rootDir: "."` also applies with `noEmit`), which is why Task 05 publishes its row builders through `@tms/db/testing`; the domain spec takes its audit actor from `makeStaffUser` there. The spec boots two apps in one file, so both write into one shared `MemoryLogStream` (nestjs-pino keeps one pino-http per process, Task 10).

**Files:**
- Create: `packages/domain/package.json`, `packages/domain/tsconfig.json`, `packages/domain/tsconfig.build.json`, `packages/domain/eslint.config.mjs`, `packages/domain/jest.config.mjs`, `packages/domain/README.md`, `packages/domain/src/shared/request-context.ts`, `packages/domain/src/shared/clock.ts`, `packages/domain/src/shared/mail.ts`, `packages/domain/src/shared/transaction.ts`, `packages/domain/src/shared/audit.service.ts`, `packages/domain/src/shared/shared.module.ts`, `packages/domain/src/shared/index.ts`, `docs/adr/0006-transactions-and-events.md`
- Modify: `pnpm-workspace.yaml` (catalog, new `# domain` block; `packageExtensions` verified), `pnpm-lock.yaml`, `apps/api-admin/package.json` and `apps/api-driver/package.json` (dependency), `apps/api-admin/src/app.module.ts` and `apps/api-driver/src/app.module.ts` (`SharedModule`), `docs/adr/README.md:6-9` (Task 11's Accepted/Planned paragraph), `docs/architecture.md` (Task 11's Containers paragraph; section "Observability — phase 1"), `README.md` (Task 11's `packages/*` row, Task 08's Status paragraph), `CLAUDE.md:41` (line 40 on `main`, moved by Task 08), `docs/efficiency/critical-path.md`
- Test: `packages/domain/test/shared/audit.e2e-spec.ts`, `packages/domain/test/shared/clock.spec.ts`, `packages/domain/test/shared/mail.spec.ts`, `packages/domain/test/shared/exports.spec.ts`

**Interfaces:**
- Consumes: `parseAuditMetadata` (per-action strict schemas of `AUDIT_ACTIONS`), `AuditMetadataError`, `AuditAction`, `AuditMetadata<A>`, `AuditTargetType`, `AuditApp`, `AuditOutcome` from `@tms/contracts` (Task 03); `PrismaModule.forRoot({ url })`, `PrismaService` from `@tms/db/nest` (Task 12); `testDatabaseUrl()`, `resetTestDatabase()` from `@tms/db/testing` (Task 04) and `makeStaffUser` from the same subpath (Task 05); `resolveRequestId`, `createLoggerModule`, `LOG_DESTINATION`, `Logger` from `@tms/logger` and `MemoryLogStream`, `LogRecord` from `@tms/logger/testing` (Task 10); `AppModule.forRoot(env)` of both apps (Task 11); `AuditLog` model (Task 05); preset `@tms/config/tsconfig/nest-library.json`, `createJestConfig({ rootDir, database: true })`, `nodeConfig` (Task 02).
- Produces (package `@tms/domain`, CommonJS, `exports` = `"./shared"` only):
  - `SharedModule.forRoot({ app }: SharedModuleOptions): DynamicModule` — `@Global()`; imports `ClsModule.forRoot({ global: true, middleware: { mount: true, generateId: true, idGenerator, setup }, plugins: [ClsPluginTransactional + TransactionalAdapterPrisma<PrismaService>({ prismaInjectionToken: PrismaService, sqlFlavor: 'postgresql' })] })`; provides `AUDIT_APP`, `Clock → SystemClock`, `AuditService`; exports `AuditService`, `Clock`. `ClsService` and `TransactionHost` are global through `ClsModule`.
  - `AuditService.record<A extends AuditAction>(input: AuditRecordInput<A>): Promise<void>`, `AuditRecordInput<A> = { action: A; outcome: AuditOutcome; actorUserId?: string | null; target?: { type: AuditTargetType; id: string }; metadata?: AuditMetadata<A> }`.
  - `RequestContext = { requestId: string; ip?: string; userAgent?: string }` stored under `REQUEST_CONTEXT_KEY = 'tms:request-context'`; `USER_AGENT_MAX_LENGTH = 512`.
  - `abstract class Clock { now(): Date }`, `SystemClock`, `FixedClock(at)` with `set(at)` and `advance(ms)`.
  - `MailMessage = { to; subject; text; html? }`, `abstract class MailSender { send(message): Promise<void> }`, `InMemoryMailSender` (`sent`, `clear()`). `SharedModule` does not bind `MailSender` yet: phase 2 binds the SMTP adapter together with its first user (deviation 13).
  - `AppTransactionHost` (type), re-exported values `Transactional`, `Propagation`, `TransactionHost`, `ClsService`.
  - ADR-0006.

Why no `"."` export: `@tms/domain` is only ever consumed by subpath (spec section 6), and the api-driver lint rule bans the bare specifier. Without a `"."` entry (and without `main`/`types`, which would be a second way in) the bare specifier fails everywhere: at runtime with `ERR_PACKAGE_PATH_NOT_EXPORTED`, in `tsc` with TS2307, so the lint rule and module resolution say the same thing.

- [ ] **Step 1: Create the package skeleton and install**

`pnpm-workspace.yaml`, catalog: insert after the `# data` block (after its last entry):

```yaml
  # domain (dual builds: every package that imports them is CommonJS, ADR-0006)
  nestjs-cls: ^7.0.0
  '@nestjs-cls/transactional': ^4.0.0
  '@nestjs-cls/transactional-adapter-prisma': ^2.0.0
```

The `packageExtensions` entry for the adapter's `prisma` peer is already present from Task 09; verify it reads exactly:

```yaml
packageExtensions:
  '@nestjs-cls/transactional-adapter-prisma':
    peerDependenciesMeta:
      prisma:
        optional: true
```

`packages/domain/package.json` (`@nestjs/*`, `reflect-metadata`, `rxjs` are peers with catalog devDependencies, so each process holds one Nest; `@tms/db` also brings the harness for `database: true`):

```json
{
  "name": "@tms/domain",
  "version": "0.0.0",
  "private": true,
  "type": "commonjs",
  "description": "Nest service-layer modules of the TMS platform, reachable only through subpaths",
  "exports": {
    "./shared": {
      "types": "./dist/shared/index.d.ts",
      "default": "./dist/shared/index.js"
    }
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' jest"
  },
  "dependencies": {
    "@nestjs-cls/transactional": "catalog:",
    "@nestjs-cls/transactional-adapter-prisma": "catalog:",
    "@tms/contracts": "workspace:*",
    "@tms/db": "workspace:*",
    "@tms/logger": "workspace:*",
    "nestjs-cls": "catalog:"
  },
  "peerDependencies": {
    "@nestjs/common": "catalog:",
    "@nestjs/core": "catalog:",
    "reflect-metadata": "catalog:",
    "rxjs": "catalog:"
  },
  "devDependencies": {
    "@nestjs/common": "catalog:",
    "@nestjs/core": "catalog:",
    "@nestjs/platform-express": "catalog:",
    "@nestjs/testing": "catalog:",
    "@tms/config": "workspace:*",
    "@types/jest": "catalog:",
    "@types/node": "catalog:",
    "@types/supertest": "catalog:",
    "eslint": "catalog:",
    "jest": "catalog:",
    "reflect-metadata": "catalog:",
    "rxjs": "catalog:",
    "supertest": "catalog:",
    "ts-jest": "catalog:",
    "typescript": "catalog:nest-ts6"
  }
}
```

(`typescript` comes from `catalog:nest-ts6`: ts-jest needs TypeScript 6's JS API.)

`packages/domain/tsconfig.json`:

```json
{
  "extends": "@tms/config/tsconfig/nest-library.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true, "types": ["node", "jest"] },
  "include": ["src", "test"]
}
```

`packages/domain/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "rootDir": "./src", "outDir": "./dist", "noEmit": false, "types": ["node"] },
  "include": ["src"],
  "exclude": ["**/*.spec.ts", "**/*.test.ts"]
}
```

`packages/domain/eslint.config.mjs`:

```js
import { nodeConfig } from '@tms/config/eslint/node';

export default nodeConfig({ tsconfigRootDir: import.meta.dirname });
```

`packages/domain/jest.config.mjs`:

```js
import { createJestConfig } from '@tms/config/jest';

export default createJestConfig({ rootDir: import.meta.dirname, database: true });
```

`packages/domain/README.md`:

````markdown
# @tms/domain

Nest service-layer modules (spec section 6), reachable only through subpath exports; the bare
specifier `@tms/domain` does not resolve on purpose.

- `@tms/domain/shared` (phase 1): `SharedModule.forRoot({ app })` — CLS request context,
  `@nestjs-cls/transactional` over `PrismaService`, `AuditService`, `Clock`, `MailSender` port.
- `@tms/domain/admin` (phase 3b) and `@tms/domain/checkin` (phase 4) follow.

CommonJS like every Nest-aware library: `nestjs-cls` and `@nestjs-cls/*` are dual packages whose
classes differ between module graphs (ADR-0006). Tests need Docker (Testcontainers).
````

Run: `pnpm install && pnpm peers check`
Expected: exit 0; no `minimumReleaseAgeExclude` lines appended and no `ERR_PNPM_IGNORED_BUILDS` (none of the three packages is younger than the gate or has a build script, S1 Q6); `pnpm peers check` reports no issues (the adapter's `prisma` peer is optional through `packageExtensions`).

- [ ] **Step 2: Write the failing tests**

`packages/domain/test/shared/audit.e2e-spec.ts` (the probe writes its role through `txHost.tx` because that transaction is under test; the audit actor comes from `makeStaffUser` of `@tms/db/testing`):

```ts
import { Controller, Get, Inject, Injectable, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditMetadataError, type AuditMetadata } from '@tms/contracts';
import { PrismaModule, PrismaService } from '@tms/db/nest';
import { makeStaffUser, resetTestDatabase, testDatabaseUrl } from '@tms/db/testing';
import { createLoggerModule, LOG_DESTINATION, Logger } from '@tms/logger';
import { MemoryLogStream, type LogRecord } from '@tms/logger/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  type AppTransactionHost,
  AuditService,
  Clock,
  ClsService,
  FixedClock,
  Propagation,
  REQUEST_CONTEXT_KEY,
  type RequestContext,
  SharedModule,
  Transactional,
  TransactionHost,
} from '../../src/shared';

const AT = new Date('2026-09-24T08:00:00.000Z');

type RoleCreated = AuditMetadata<'admin.role.created'>;

@Injectable()
class ProbeService {
  constructor(
    @Inject(TransactionHost) private readonly txHost: AppTransactionHost,
    private readonly audit: AuditService,
  ) {}

  /** A state change and its audit record in one transaction; `fail` throws after both writes. */
  @Transactional()
  async createRoleAndAudit(
    options: { fail?: boolean; metadata?: RoleCreated } = {},
  ): Promise<string> {
    const role = await this.txHost.tx.role.create({
      data: { name: 'Probe role', description: 'Created by the audit probe', appliesTo: 'STAFF' },
    });
    await this.audit.record({
      action: 'admin.role.created',
      outcome: 'SUCCESS',
      target: { type: 'Role', id: role.id },
      metadata: options.metadata,
    });
    if (options.fail === true) throw new Error('probe failure after the audit record');
    return role.id;
  }

  /** The nested step rolls back to its savepoint; the outer work and its audit row commit. */
  @Transactional()
  async createRoleDespiteFailedNestedStep(): Promise<void> {
    await this.createRoleAndAudit();
    await this.failingNestedStep().catch(() => undefined);
  }

  @Transactional(Propagation.Nested)
  async failingNestedStep(): Promise<void> {
    await this.txHost.tx.role.create({
      data: {
        name: 'Nested role',
        description: 'Rolled back to the savepoint',
        appliesTo: 'STAFF',
      },
    });
    await this.audit.record({ action: 'admin.role.created', outcome: 'SUCCESS' });
    throw new Error('nested step failed');
  }
}

@Controller('probe')
class ProbeController {
  constructor(
    private readonly audit: AuditService,
    private readonly cls: ClsService,
  ) {}

  @Get()
  async probe(): Promise<{ clsId: string; contextId: string | undefined }> {
    await this.audit.record({ action: 'admin.role.created', outcome: 'FAILURE' });
    return {
      clsId: this.cls.getId(),
      contextId: this.cls.get<RequestContext | undefined>(REQUEST_CONTEXT_KEY)?.requestId,
    };
  }
}

const probeLineId = (record: LogRecord): string | undefined => {
  const req = record['req'] as { id?: unknown; url?: unknown } | undefined;
  return req?.url === '/api/probe' && typeof req.id === 'string' ? req.id : undefined;
};

/** pino-http logs on the response's finish event, which can trail supertest: wait, never read once. */
const waitForProbeLine = (logs: MemoryLogStream, id: string): Promise<LogRecord> =>
  logs.waitFor((record) => probeLineId(record) === id);

async function createProbeApp(options: {
  logs: MemoryLogStream;
  clock: FixedClock;
  sharedFirst?: boolean;
}): Promise<INestApplication<App>> {
  const logger = createLoggerModule({
    app: 'api-admin',
    level: 'info',
    file: { enabled: false, dir: 'logs', retentionDays: 1 },
  });
  const shared = SharedModule.forRoot({ app: 'ADMIN' });
  const moduleRef = await Test.createTestingModule({
    imports: [
      ...(options.sharedFirst === true ? [shared, logger] : [logger, shared]),
      PrismaModule.forRoot({ url: testDatabaseUrl() }),
    ],
    controllers: [ProbeController],
    providers: [ProbeService],
  })
    .overrideProvider(LOG_DESTINATION)
    .useValue(options.logs)
    .overrideProvider(Clock)
    .useValue(options.clock)
    .compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({ bufferLogs: true });
  app.setGlobalPrefix('api');
  app.useLogger(app.get(Logger));
  await app.listen(0, '127.0.0.1');
  return app;
}

describe('SharedModule: audit inside the caller transaction (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let probe: ProbeService;
  let audit: AuditService;
  let txHost: AppTransactionHost;
  // One stream for every app of this file: nestjs-pino keeps one pino-http instance per process.
  const logs = new MemoryLogStream();
  const clock = new FixedClock(AT);

  beforeAll(async () => {
    app = await createProbeApp({ logs, clock });
    prisma = app.get(PrismaService);
    probe = app.get(ProbeService);
    audit = app.get(AuditService);
    txHost = app.get<AppTransactionHost>(TransactionHost);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    clock.set(AT);
  });

  afterAll(async () => {
    await app.close();
  });

  it('commits the state change and the audit row together', async () => {
    const roleId = await probe.createRoleAndAudit();
    expect(await prisma.role.count()).toBe(1);
    const [row, ...others] = await prisma.auditLog.findMany();
    expect(others).toEqual([]);
    expect(row?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(row).toMatchObject({
      at: AT,
      app: 'ADMIN',
      actorUserId: null,
      action: 'admin.role.created',
      targetType: 'Role',
      targetId: roleId,
      outcome: 'SUCCESS',
      ip: null,
      userAgent: null,
      metadata: {},
    });
  });

  it('rolls the audit row back with the caller', async () => {
    await expect(probe.createRoleAndAudit({ fail: true })).rejects.toThrow(
      'probe failure after the audit record',
    );
    expect(await prisma.role.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('rejects unknown metadata keys and rolls back the state change (fail-closed)', async () => {
    const invalid = { unexpected: 1 } as unknown as RoleCreated;
    const error: unknown = await probe
      .createRoleAndAudit({ metadata: invalid })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuditMetadataError);
    expect(error).toMatchObject({ action: 'admin.role.created' });
    expect((error as AuditMetadataError).issues.map((issue) => issue.code)).toEqual([
      'unrecognized_keys',
    ]);
    expect(await prisma.role.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('rolls a nested step back to its savepoint and keeps the outer work', async () => {
    await probe.createRoleDespiteFailedNestedStep();
    expect((await prisma.role.findMany()).map((role) => role.name)).toEqual(['Probe role']);
    expect(await prisma.auditLog.count()).toBe(1);
  });

  it('autocommits when called outside a transaction', async () => {
    const actor = await makeStaffUser(prisma, { username: 'audit-actor' });
    clock.advance(1500);
    await audit.record({
      action: 'admin.user.role-changed',
      outcome: 'SUCCESS',
      actorUserId: actor.id,
      target: { type: 'User', id: actor.id },
      metadata: { fromRoleId: 'role-a', toRoleId: 'role-b' },
    });
    expect(await prisma.auditLog.findMany()).toMatchObject([
      {
        actorUserId: actor.id,
        action: 'admin.user.role-changed',
        targetType: 'User',
        targetId: actor.id,
        metadata: { fromRoleId: 'role-a', toRoleId: 'role-b' },
        at: new Date(AT.getTime() + 1500),
      },
    ]);
  });

  it('uses the PrismaService instance itself outside a transaction', () => {
    expect(txHost.tx).toBe(prisma);
    expect(txHost.isTransactionActive()).toBe(false);
  });

  it('stores ip and user agent of the request and shares its id with the logger', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/probe')
      .set('X-Request-Id', 'req-1')
      .set('User-Agent', 'UA/1')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('req-1');
    expect(res.body).toEqual({ clsId: 'req-1', contextId: 'req-1' });
    const [row] = await prisma.auditLog.findMany();
    expect(row).toMatchObject({ outcome: 'FAILURE', userAgent: 'UA/1', actorUserId: null });
    expect(row?.ip).toMatch(/^(::ffff:)?127\.0\.0\.1$/);
    await waitForProbeLine(logs, 'req-1');
  });

  it('truncates the user agent and replaces a hostile X-Request-Id', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/probe')
      .set('X-Request-Id', 'x'.repeat(200))
      .set('User-Agent', 'U'.repeat(600))
      .expect(200);
    const minted = res.headers['x-request-id'];
    expect(minted).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(res.body).toEqual({ clsId: minted, contextId: minted });
    const [row] = await prisma.auditLog.findMany();
    expect(row?.userAgent).toBe('U'.repeat(512));
    await waitForProbeLine(logs, minted);
  });

  it('keeps header, CLS id and log id equal under 50 concurrent requests', async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `concurrent-${i}`);
    const responses = await Promise.all(
      ids.map((id) => request(app.getHttpServer()).get('/api/probe').set('X-Request-Id', id)),
    );
    responses.forEach((res, i) => {
      expect(res.status).toBe(200);
      expect(res.headers['x-request-id']).toBe(ids[i]);
      expect(res.body).toEqual({ clsId: ids[i], contextId: ids[i] });
    });
    await Promise.all(ids.map((id) => waitForProbeLine(logs, id)));
    expect(await prisma.auditLog.count()).toBe(50);
  });

  it('echoes the request id when SharedModule is imported before the logger', async () => {
    const other = await createProbeApp({ logs, clock, sharedFirst: true });
    try {
      const res = await request(other.getHttpServer())
        .get('/api/probe')
        .set('X-Request-Id', 'req-order')
        .expect(200);
      expect(res.headers['x-request-id']).toBe('req-order');
      expect(res.body).toEqual({ clsId: 'req-order', contextId: 'req-order' });
    } finally {
      await other.close();
    }
  });
});
```

`packages/domain/test/shared/clock.spec.ts`:

```ts
import { Clock, FixedClock, SystemClock } from '../../src/shared';

describe('Clock', () => {
  it('SystemClock returns the current time', () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it('FixedClock stands still until moved', () => {
    const clock = new FixedClock(new Date('2026-09-24T08:00:00.000Z'));
    expect(clock.now().toISOString()).toBe('2026-09-24T08:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-09-24T08:00:00.000Z');
    clock.advance(90_000);
    expect(clock.now().toISOString()).toBe('2026-09-24T08:01:30.000Z');
    clock.set(new Date('2027-01-01T00:00:00.000Z'));
    expect(clock.now().toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('FixedClock hands out copies, so callers cannot move it', () => {
    const clock = new FixedClock(new Date('2026-09-24T08:00:00.000Z'));
    clock.now().setUTCFullYear(2000);
    expect(clock.now().toISOString()).toBe('2026-09-24T08:00:00.000Z');
  });

  it('both are Clocks (the DI token)', () => {
    expect(new SystemClock()).toBeInstanceOf(Clock);
    expect(new FixedClock(new Date(0))).toBeInstanceOf(Clock);
  });
});
```

`packages/domain/test/shared/mail.spec.ts`:

```ts
import { InMemoryMailSender, MailSender, type MailMessage } from '../../src/shared';

describe('InMemoryMailSender', () => {
  const invite: MailMessage = { to: 'a@example.test', subject: 'Invite', text: 'Hello' };

  it('records sent messages in order', async () => {
    const mail = new InMemoryMailSender();
    await mail.send(invite);
    await mail.send({ ...invite, to: 'b@example.test', html: '<p>Hello</p>' });
    expect(mail.sent).toEqual([invite, { ...invite, to: 'b@example.test', html: '<p>Hello</p>' }]);
  });

  it('stores a copy, not the caller object', async () => {
    const mail = new InMemoryMailSender();
    const message = { ...invite };
    await mail.send(message);
    message.subject = 'changed';
    expect(mail.sent[0]?.subject).toBe('Invite');
  });

  it('clear() empties the outbox', async () => {
    const mail = new InMemoryMailSender();
    await mail.send(invite);
    mail.clear();
    expect(mail.sent).toEqual([]);
  });

  it('is a MailSender (the DI token)', () => {
    expect(new InMemoryMailSender()).toBeInstanceOf(MailSender);
  });
});
```

`packages/domain/test/shared/exports.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as shared from '../../src/shared';

interface Manifest {
  exports: Record<string, unknown>;
  main?: string;
  types?: string;
}

describe('@tms/domain package surface', () => {
  it('exports only ./shared, so the bare specifier cannot resolve', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'),
    ) as Manifest;
    expect(manifest.exports).toEqual({
      './shared': { types: './dist/shared/index.d.ts', default: './dist/shared/index.js' },
    });
    expect(manifest.main).toBeUndefined();
    expect(manifest.types).toBeUndefined();
  });

  it('@tms/domain/shared exports exactly the phase 1 names', () => {
    expect(Object.keys(shared).sort()).toEqual([
      'AUDIT_APP',
      'AuditService',
      'Clock',
      'ClsService',
      'FixedClock',
      'InMemoryMailSender',
      'MailSender',
      'Propagation',
      'REQUEST_CONTEXT_KEY',
      'SharedModule',
      'SystemClock',
      'TransactionHost',
      'Transactional',
      'USER_AGENT_MAX_LENGTH',
    ]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm turbo run test --filter=@tms/domain`
Expected: FAIL, `Test Suites: 4 failed, 4 total` — every suite stops at Jest's `Cannot find module '../../src/shared' from 'test/shared/<file>.ts'` (ts-jest does not type-check under `isolatedModules: true`). The harness starts its container first (Docker must be running).

- [ ] **Step 4: Write the shared module**

`packages/domain/src/shared/request-context.ts`:

```ts
import type { IncomingMessage } from 'node:http';

/** Per-request data kept in the CLS store by `SharedModule`'s middleware. */
export interface RequestContext {
  readonly requestId: string;
  readonly ip?: string | undefined;
  readonly userAgent?: string | undefined;
}

export const REQUEST_CONTEXT_KEY = 'tms:request-context';

/** Longer user agents are truncated; the column is free text and the value is attacker-controlled. */
export const USER_AGENT_MAX_LENGTH = 512;

/** Express adds `ip`; plain Node requests only have the socket address. */
export type IncomingRequest = IncomingMessage & { ip?: string | undefined };

export function requestContextFrom(requestId: string, req: IncomingRequest): RequestContext {
  const userAgent = req.headers['user-agent'];
  return {
    requestId,
    ip: req.ip ?? req.socket.remoteAddress,
    userAgent:
      typeof userAgent === 'string' ? userAgent.slice(0, USER_AGENT_MAX_LENGTH) : undefined,
  };
}
```

`packages/domain/src/shared/clock.ts`:

```ts
import { Injectable } from '@nestjs/common';

/** Time port (spec section 3): services never call `new Date()` themselves. */
export abstract class Clock {
  abstract now(): Date;
}

@Injectable()
export class SystemClock extends Clock {
  override now(): Date {
    return new Date();
  }
}

/** Test clock: returns the same instant until moved with `set` or `advance`. */
export class FixedClock extends Clock {
  private current: number;

  constructor(at: Date) {
    super();
    this.current = at.getTime();
  }

  override now(): Date {
    return new Date(this.current);
  }

  set(at: Date): void {
    this.current = at.getTime();
  }

  advance(ms: number): void {
    this.current += ms;
  }
}
```

`packages/domain/src/shared/mail.ts`:

```ts
export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string | undefined;
}

/** Mail port (spec section 3). The SMTP adapter arrives in phase 2 with the first email. */
export abstract class MailSender {
  abstract send(message: MailMessage): Promise<void>;
}

/** Test adapter: keeps every message in `sent`, in order. */
export class InMemoryMailSender extends MailSender {
  readonly sent: MailMessage[] = [];

  override send(message: MailMessage): Promise<void> {
    this.sent.push({ ...message });
    return Promise.resolve();
  }

  clear(): void {
    this.sent.length = 0;
  }
}
```

`packages/domain/src/shared/transaction.ts`:

```ts
import type { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import type { PrismaService } from '@tms/db/nest';

/**
 * The transaction host of every domain service. A type alias is emitted as `Object` in decorator
 * metadata, so constructor parameters of this type need `@Inject(TransactionHost)`.
 */
export type AppTransactionHost = TransactionHost<TransactionalAdapterPrisma<PrismaService>>;
```

`packages/domain/src/shared/audit.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { ClsService } from 'nestjs-cls';
import {
  type AuditAction,
  type AuditApp,
  type AuditMetadata,
  type AuditOutcome,
  type AuditTargetType,
  parseAuditMetadata,
} from '@tms/contracts';
import { Clock } from './clock';
import { REQUEST_CONTEXT_KEY, type RequestContext } from './request-context';
import type { AppTransactionHost } from './transaction';

export const AUDIT_APP = 'tms:audit-app';

export interface AuditRecordInput<A extends AuditAction> {
  readonly action: A;
  readonly outcome: AuditOutcome;
  readonly actorUserId?: string | null | undefined;
  readonly target?: { readonly type: AuditTargetType; readonly id: string } | undefined;
  readonly metadata?: AuditMetadata<A> | undefined;
}

@Injectable()
export class AuditService {
  constructor(
    @Inject(TransactionHost) private readonly txHost: AppTransactionHost,
    private readonly cls: ClsService,
    private readonly clock: Clock,
    @Inject(AUDIT_APP) private readonly app: AuditApp,
  ) {}

  /**
   * Writes one audit row through `txHost.tx`: inside `@Transactional()` that is the caller's
   * transaction, so a rollback removes the row too; outside one it autocommits. Invalid metadata
   * throws `AuditMetadataError` before anything is written. No try/catch: a failed audit write
   * fails the caller (fail-closed).
   */
  async record<A extends AuditAction>(input: AuditRecordInput<A>): Promise<void> {
    const metadata = parseAuditMetadata(input.action, input.metadata);
    const context = this.cls.isActive()
      ? this.cls.get<RequestContext | undefined>(REQUEST_CONTEXT_KEY)
      : undefined;
    await this.txHost.tx.auditLog.create({
      data: {
        at: this.clock.now(),
        app: this.app,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        targetType: input.target?.type ?? null,
        targetId: input.target?.id ?? null,
        outcome: input.outcome,
        ip: context?.ip ?? null,
        userAgent: context?.userAgent ?? null,
        metadata,
      },
    });
  }
}
```

`packages/domain/src/shared/shared.module.ts` (`imports` of the plugin stays empty: the adapter resolves the `@Global()` `PrismaService` from Task 12, verified):

```ts
import type { ServerResponse } from 'node:http';
import { type DynamicModule, Global, Module } from '@nestjs/common';
import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { ClsModule } from 'nestjs-cls';
import type { AuditApp } from '@tms/contracts';
import { PrismaService } from '@tms/db/nest';
import { resolveRequestId } from '@tms/logger';
import { AUDIT_APP, AuditService } from './audit.service';
import { Clock, SystemClock } from './clock';
import { type IncomingRequest, REQUEST_CONTEXT_KEY, requestContextFrom } from './request-context';

export interface SharedModuleOptions {
  readonly app: AuditApp;
}

@Global()
@Module({})
export class SharedModule {
  static forRoot({ app }: SharedModuleOptions): DynamicModule {
    return {
      module: SharedModule,
      imports: [
        ClsModule.forRoot({
          global: true,
          middleware: {
            mount: true,
            generateId: true,
            idGenerator: (req: IncomingRequest) => resolveRequestId(req),
            setup: (cls, req: IncomingRequest, res: ServerResponse) => {
              // Also sets X-Request-Id: pino-http skips its genReqId once req.id exists, so the
              // echo must not depend on which of the two middlewares Nest runs first.
              resolveRequestId(req, res);
              cls.set(REQUEST_CONTEXT_KEY, requestContextFrom(cls.getId(), req));
            },
          },
          plugins: [
            new ClsPluginTransactional({
              adapter: new TransactionalAdapterPrisma<PrismaService>({
                prismaInjectionToken: PrismaService,
                sqlFlavor: 'postgresql',
              }),
            }),
          ],
        }),
      ],
      providers: [
        { provide: AUDIT_APP, useValue: app },
        { provide: Clock, useClass: SystemClock },
        AuditService,
      ],
      exports: [AuditService, Clock],
    };
  }
}
```

`packages/domain/src/shared/index.ts`:

```ts
export { AUDIT_APP, AuditService, type AuditRecordInput } from './audit.service';
export { Clock, FixedClock, SystemClock } from './clock';
export { InMemoryMailSender, MailSender, type MailMessage } from './mail';
export { REQUEST_CONTEXT_KEY, USER_AGENT_MAX_LENGTH, type RequestContext } from './request-context';
export { SharedModule, type SharedModuleOptions } from './shared.module';
export type { AppTransactionHost } from './transaction';
// Values, not only types: consumers inject them (`@Inject(TransactionHost)`, `ClsService`). Going
// through this module keeps later modules off the dual-build libraries themselves.
export { Propagation, Transactional, TransactionHost } from '@nestjs-cls/transactional';
export { ClsService } from 'nestjs-cls';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm turbo run test --filter=@tms/domain`
Expected: `Test Suites: 4 passed, 4 total`, `Tests: 20 passed, 20 total` (audit 10, clock 4, mail 4, exports 2).

Run: `pnpm turbo run test --filter=@tms/domain -- --detectOpenHandles`
Expected: `Tests: 20 passed, 20 total`; no "open handle" and no "did not exit" output.

Run: `pnpm turbo run lint --filter=@tms/domain`, then `pnpm turbo run typecheck --filter=@tms/domain`, then `pnpm turbo run build --filter=@tms/domain`, then `ls packages/domain/dist/shared`
Expected: exit 0 three times; `audit.service`, `clock`, `index`, `mail`, `request-context`, `shared.module`, `transaction` as `.js` + `.d.ts` (plus maps), and no `packages/domain/dist/index.js`.

- [ ] **Step 6: Boot `SharedModule` in both apps**

`apps/api-admin/package.json` and `apps/api-driver/package.json`: add `"@tms/domain": "workspace:*"` to `dependencies` (next to the other `@tms/*` entries).

`apps/api-admin/src/app.module.ts`: add `import { SharedModule } from '@tms/domain/shared';` and let `forRoot` import it after `CoreModule` (logger first keeps pino-http ahead of the CLS middleware; the `setup` echo makes either order safe):

```ts
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot({ app: 'api-admin', env }),
        SharedModule.forRoot({ app: 'ADMIN' }),
      ],
    };
  }
```

`apps/api-driver/src/app.module.ts`: the same with `CoreModule.forRoot({ app: 'api-driver', env })` and `SharedModule.forRoot({ app: 'DRIVER' })`. The api-driver import is `@tms/domain/shared`, the only subpath it may use besides `checkin`.

Run: `pnpm install`, then `pnpm turbo run test --filter=@tms/api-admin`, then `pnpm turbo run test --filter=@tms/api-driver`
Expected: both green with the same counts as after Task 12, `Test Suites: 2 passed, 2 total`, `Tests: 6 passed, 6 total` (the e2e specs now boot `SharedModule`; the 404 JSON body, the `X-Request-Id` header, the probe route, the SIGTERM listener count and the health body from Tasks 11–12 still hold).

Run: `pnpm turbo run lint --filter=@tms/api-admin`, `pnpm turbo run typecheck --filter=@tms/api-admin`, `pnpm turbo run build --filter=@tms/api-admin`, and the same three for `@tms/api-driver`
Expected: exit 0 for all six.

Run (the api-driver restriction, deliberately violated and then removed):

```bash
printf "import '@tms/domain';\nimport '@tms/domain/admin';\nimport '@tms/domain/shared';\n" > apps/api-driver/src/lint-probe.ts
pnpm turbo run lint --filter=@tms/api-driver; echo exit=$?
rm apps/api-driver/src/lint-probe.ts && pnpm turbo run lint --filter=@tms/api-driver; echo exit=$?
```

Expected: first `exit=1` with `1:1  error  '@tms/domain' import is restricted from being used. This app may import only @tms/domain/checkin and @tms/domain/shared (spec section 3)  no-restricted-imports` and `2:1  error  '@tms/domain/admin' import is restricted from being used by a pattern. This app may import only @tms/domain/checkin and @tms/domain/shared (spec section 3)  no-restricted-imports`, nothing for line 3; then `exit=0`.

Run: `cd apps/api-admin && node -e "require('@tms/domain')"; echo exit=$?; node -e "console.log(Object.keys(require('@tms/domain/shared')).length)"; cd ../..`
Expected: `Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in …/node_modules/@tms/domain/package.json` and `exit=1`; then `14`.

Run: `node tools/scripts/check-hygiene.mjs`
Expected: `hygiene: ok (<n> tracked files, single copies ok)` — the single-copy check (Task 02) finds exactly one `.pnpm` directory each for `nestjs-cls`, `@nestjs-cls+transactional`, `@nestjs/common`, `@nestjs/core` and `@prisma/client` now that they are installed.

Run (both images still build, boot and ship without the Prisma CLI although the adapter peers `prisma`):

```bash
for APP in api-admin api-driver; do
  docker build --build-arg APP=$APP -f infra/docker/api.Dockerfile -t tms-p1-$APP . || break
  docker run --rm tms-p1-$APP node -e "require.resolve('prisma/package.json')" 2>/dev/null; echo "$APP prisma exit=$?"
  docker run --rm tms-p1-$APP node -e "console.log('$APP', typeof require('@tms/domain/shared').SharedModule)"
done
docker network create tms-p1-net && docker run -d --name tms-p1-pg --network tms-p1-net -p 55432:5432 \
  -e POSTGRES_USER=tms -e POSTGRES_PASSWORD=tms -e POSTGRES_DB=tms postgres:18-alpine && sleep 5
docker run -d --name tms-p1-api-driver --network tms-p1-net --read-only --tmpfs /tmp -v tms-p1-logs:/var/log/tms \
  -e DATABASE_URL=postgresql://tms:tms@tms-p1-pg:5432/tms -p 53002:3002 tms-p1-api-driver
sleep 4; curl -s -D - -H 'X-Request-Id: smoke-14' http://localhost:53002/api/health | grep -i -e '^x-request-id' -e status
docker rm -f tms-p1-api-driver tms-p1-pg && docker network rm tms-p1-net && docker volume rm tms-p1-logs
```

Expected: `api-admin prisma exit=1`, `api-admin function`, `api-driver prisma exit=1`, `api-driver function`; then `x-request-id: smoke-14` and `{"status":"ok","service":"api-driver"}`.

- [ ] **Step 7: ADR and documentation**

`docs/adr/0006-transactions-and-events.md`:

````markdown
# ADR-0006: Transactions, audit and events

- Status: accepted
- Date: 2026-09-23
- Spec reference: section 3 (quality principles, "Transactions"), section 11 (Audit), section 6 (`domain/shared`)

## Context

Section 3 fixes the rule: "**Transactions**: `@nestjs-cls/transactional` with the Prisma adapter. A
state change that crosses a module boundary (e.g. cancelling an order removes its queue entry) and
the audit record are **direct service calls inside one transaction**. Domain events
(`@nestjs/event-emitter`) are for fire-and-forget side effects only (email, Sentry breadcrumb),
never for state changes." Section 11 adds that `AuditService.record()` runs inside the caller's
transaction. Modules export only a service facade, so a transaction has to span several services
without any of them knowing who opened it, and an audit row must neither survive a rollback nor be
lost after a commit.

## Decision

- `@tms/domain/shared` registers `nestjs-cls` 7 with `@nestjs-cls/transactional` 4 and
  `@nestjs-cls/transactional-adapter-prisma` 2 once, in `SharedModule.forRoot({ app })`, on top of the
  global `PrismaService` from `@tms/db/nest`. The adapter runs with `sqlFlavor: 'postgresql'`, which
  enables `Propagation.Nested` through savepoints.
- A use case's entry method is `@Transactional()`; every write goes through `txHost.tx` (injected
  with `@Inject(TransactionHost)`, typed `AppTransactionHost`). Nested calls join the transaction
  (`Propagation.Required`); outside any transaction `txHost.tx` is the plain `PrismaService` and
  each statement autocommits (CLIs, background work).
- Cross-module state changes are direct calls to the other module's exported service within the
  same `@Transactional()` method.
- `AuditService.record({ action, outcome, actorUserId?, target?, metadata? })` validates the metadata
  against the action's strict schema from `@tms/contracts` before writing, writes through
  `txHost.tx`, and has no try/catch: invalid metadata or a failed insert fails the caller and rolls
  back its state change (fail-closed). `ip` and `userAgent` come from the request context that the
  CLS middleware stores per request; its id is the logger's `req.id` and the `X-Request-Id` header
  (`resolveRequestId` from `@tms/logger`).
- Events are fire-and-forget side effects after the state change (email, Sentry breadcrumb); a
  listener never changes state and its failure never fails the request. The emitter
  (`@nestjs/event-emitter`) and the SMTP `MailSender` adapter arrive in phase 2 with the first
  email.
- Every package that touches `TransactionHost` or `ClsService` is CommonJS: both libraries ship dual
  builds whose classes differ between the CommonJS and ESM module graphs (spike S1), which would
  break dependency injection silently.

## Alternatives considered

- Prisma interactive transactions (`$transaction(async (tx) => …)`) with `tx` passed by hand: every
  service signature gains a `tx` parameter, module facades leak Prisma types, and a forgotten
  argument silently writes outside the transaction. Rejected.
- Transactional outbox for audit and events: guarantees delivery to external systems, but adds a
  table, a relay and eventual consistency for a record that lives in the same database and must be
  atomic with the state change. Rejected for audit; phase 2 may revisit it for email delivery.
- Domain events for state changes (for example "order cancelled" removing the queue entry in a
  listener): ordering and failure handling become implicit; asynchronous listeners leave
  inconsistent state after a commit, synchronous ones inside the transaction are hidden direct
  calls. Rejected (section 3).
- One transaction per request, opened by middleware or an interceptor: holds a pooled connection
  for the whole request, including reads and outbound calls, and hides where the boundary is.
  Rejected.

## Consequences

- Domain services write only through `txHost.tx`; injecting `PrismaService` directly is for reads
  that must not join a transaction. A constructor parameter typed `AppTransactionHost` needs
  `@Inject(TransactionHost)` because a type alias is emitted as `Object` in decorator metadata.
- A step that may fail on its own without aborting the use case uses
  `@Transactional(Propagation.Nested)` (savepoint); isolation other than Read Committed is set per
  method (`@Transactional<TransactionalAdapterPrisma>({ isolationLevel: 'Serializable' })`).
- No email, HTTP or other slow outbound call inside a `@Transactional()` method: those go through
  events after the state change.
- Tests use `FixedClock` and `InMemoryMailSender`, and exercise commit, rollback, nested savepoints
  and autocommit against the Testcontainers Postgres (`packages/domain/test/shared`).
````

`docs/adr/README.md:6-9` — replace the Accepted/Planned paragraph (Task 11's wording) with:

```markdown
Accepted: 0001 two Nest processes with shared packages, 0002 Prisma as the ORM, 0004 permission
catalogue and sync, 0006 transactions and events, 0007 client name kept out of the repository by
convention, 0008 shared Nest bootstrap package. Planned: 0003 origin/CSRF/sessions, 0005 kiosk
device key model.
```

`docs/architecture.md`, Containers (C4 level 2): append to the paragraph below the diagram (Task 11's version, ending "… from one Caddy container on one Docker network."):

```markdown
Both APIs import `@tms/domain/shared` (`SharedModule`: CLS request context,
`@nestjs-cls/transactional` over `PrismaService`, `AuditService`, `Clock`, `MailSender` port);
`@tms/domain` has no root export, and `api-driver` may import only its `shared` and (phase 4)
`checkin` subpaths.
```

`docs/architecture.md`, section `## Observability — phase 1 (logs, Sentry, audit)`: append after the Sentry paragraph (Task 13; after the Health paragraph if Task 13 is held), before `## Testing strategy`:

```markdown
### Audit

`AuditService.record({ action, outcome, actorUserId?, target?, metadata? })` from
`@tms/domain/shared` writes one `AuditLog` row through `txHost.tx`: inside a `@Transactional()`
use case it joins the caller's transaction (a rollback removes the row; a failed
`Propagation.Nested` step rolls back only to its savepoint), outside one it autocommits. Metadata
is validated against the action's strict schema from `@tms/contracts` first; invalid metadata or a
failed insert fails the caller (fail-closed). `app` is fixed per process (`ADMIN`, `DRIVER`), `at`
comes from the `Clock` port, `ip` and `userAgent` (at most 512 characters) from the request context
that the CLS middleware stores; the CLS id, the log `req.id` and the `X-Request-Id` header are one
value (ADR-0006). The audit screen arrives in phase 8.
```

`README.md`, table "Repository layout": the row starting with `` | `packages/*` `` becomes

```markdown
| `packages/*`                        | shared code: `config`, `contracts`, `db`, `logger`, `nest-bootstrap`, `domain` (`/shared`); `auth-core` and `ui` from phases 2 and 6 |
```

`README.md`, section "Status": replace Task 08's paragraph ("Phase 0 (bootstrap) complete. Phase 1 (foundation) in progress: …") with

```markdown
Phase 1 (foundation) complete. Next: phase 2 (auth-core, api-admin auth).
```

`CLAUDE.md:41` — replace the bullet `` - `packages/contracts`, `auth-core`, `domain`, `logger`, `ui` — arrive in phases 1–6 (see spec §6) `` with:

```markdown
- Present: `packages/contracts`, `db` (+ `/testing`, `/nest`), `logger`, `nest-bootstrap`, `domain`
  (`/shared` only); later `auth-core` (phase 2), `domain/admin` (3b), `domain/checkin` (4), `ui` (6)
```

Run: `pnpm exec prettier --write packages/domain apps/api-admin apps/api-driver docs/adr docs/architecture.md README.md CLAUDE.md pnpm-workspace.yaml && pnpm format:check && wc -l CLAUDE.md`
Expected: exit 0; `79 CLAUDE.md` (Task 11's 78; the one-line bullet became two; limit 150).

- [ ] **Step 8: Verify the whole repository and commit**

Run: `pnpm verify`
Expected: all turbo tasks green (lint, typecheck, test, build for every package, including `@tms/domain` with its Testcontainers suite), `prettier --check` clean, `hygiene: ok (<n> tracked files, single copies ok)`, gitleaks `no leaks found`.

After pushing the branch: CI `verify`, `hygiene`, `db-drift` and `e2e` green (both API images boot `SharedModule` behind Caddy; smoke and Playwright unchanged).

Append the journal row to `docs/efficiency/critical-path.md` (date, start and end from the session clock; rework `none` or what was reworked):

```
| 2026-MM-DD | Task 14: `@tms/domain/shared` — transactions, audit, clock, mail port | subagent | HH:MM | HH:MM | none | n/a | 4 suites / 20 tests (audit 10 against Testcontainers: commit, rollback, fail-closed metadata, nested savepoint, autocommit, same client outside a transaction, request context, hostile id, 50 concurrent ids, SharedModule-first order; clock 4; mail 4; exports 2); `--detectOpenHandles` clean; api-driver lint probe 2 errors then 0; bare `@tms/domain` → ERR_PACKAGE_PATH_NOT_EXPORTED; hygiene single copy ok; images without the Prisma CLI. |
```

```bash
git add packages/domain apps/api-admin apps/api-driver pnpm-workspace.yaml pnpm-lock.yaml docs/adr/0006-transactions-and-events.md docs/adr/README.md docs/architecture.md README.md CLAUDE.md docs/efficiency/critical-path.md
git commit -m "feat(domain): add the shared module with transactions, audit, clock and mail port"
```
Expected: this commit passes all hooks (header 81 characters).

**PR body notes:**
- Diagram: Mermaid `sequenceDiagram` — request → CLS middleware (request id from `resolveRequestId`, `RequestContext` stored) → controller → use-case service `@Transactional()` (BEGIN) → `txHost.tx.role.create` → `AuditService.record` (`parseAuditMetadata`, then `txHost.tx.auditLog.create` in the same transaction) → `alt` success: COMMIT (both rows) / throw or invalid metadata: ROLLBACK (neither row).
- Boundaries: new package `@tms/domain` (CommonJS, `./shared` only, no root export); both apps import `SharedModule` (`ADMIN` / `DRIVER`); catalog + lockfile (`nestjs-cls`, `@nestjs-cls/transactional`, `@nestjs-cls/transactional-adapter-prisma`); ADR-0006; architecture, README, CLAUDE.md. Migration: no.
- Verification plan: `pnpm verify`; `@tms/domain` tests RED then GREEN (and with `--detectOpenHandles`); both app suites; the api-driver lint probe; the bare-specifier check; single-copy hygiene; both images without the Prisma CLI and with the `X-Request-Id` echo; CI `verify`, `hygiene`, `db-drift`, `e2e`.
- Verification results (`scenario | layer | outcome`): commit / rollback / unknown metadata key rolls the role back / nested savepoint / autocommit with actor / `txHost.tx` is `PrismaService` / ip + user agent + log id / hostile id + 600-character user agent / 50 concurrent ids / SharedModule imported first | e2e (Testcontainers) | 10 passed; `FixedClock`/`SystemClock` | unit | 4 passed; `InMemoryMailSender` | unit | 4 passed; manifest + export surface | unit | 2 passed; open handles | e2e | clean; both app suites | e2e | 6 tests each, green; api-driver lint probe | lint | 2 errors, then 0; bare `@tms/domain` | runtime | `ERR_PACKAGE_PATH_NOT_EXPORTED`; single-copy hygiene | tooling | ok; images: no Prisma CLI, `SharedModule` loadable, `/api/health` + `X-Request-Id` echo | docker | exit 1 / `function` / `{"status":"ok","service":"api-driver"}`; `pnpm verify` | repo | green; CI | CI | green.
- Risks and notes: dual-copy hazard (`TransactionHost`/`ClsService` differ between CommonJS and ESM graphs, S1) — mitigated by CommonJS everywhere plus the single-copy hygiene check; middleware order made irrelevant by the `setup` echo (Spike notes, pinned by a test); a type alias needs `@Inject(TransactionHost)` (Spike notes, stated in ADR-0006); `req.ip` is the direct peer (Caddy in compose) until Express `trust proxy` is configured together with the throttler in phase 2 (spec section 8.4; recorded in the plan's Human steps); fixtures stay per package (Spike notes); `MailSender` is not bound in phase 1 (deviation 13).


---

## Deliberate deviations from the spec (all judged by the critic pass)

1. The permission sync is a pure function plus a CLI in `packages/db`, not a `PermissionSyncService` in `domain/admin` (sections 6 and 9): it must run from the `migrate` image, `predev` and the seed without a Nest process, and `db` already depends on `contracts`. Phase 3b's `domain/admin` reuses the same function for read/update of names and descriptions.
2. A new package `@tms/nest-bootstrap` and a boundaries element `bootstrap` (not in section 6) hold the shared bootstrap, `HealthModule` and the Sentry init, so both apps stay at `main.ts` + `AppModule` (final-review input 1). ADR 0008.
3. Additions to section 7/9: `Role.key` (nullable, unique) gives seeded roles a stable identity so the seed and the phase 2 "last admin" check survive renames; `PermissionDefinition.audience` makes "Admin = all STAFF permissions" computable; `ActionToken.createdById` is optional (self-service password reset and the seeded invite have no creating user); `Carrier.name`, `Product.code` and `LoadingPoint.code` are unique (natural keys for the seed and the admin forms); `IdentityCard.activeUserId` (nullable, unique; equals `userId` while ACTIVE, `null` once BLOCKED, the `QueueEntry.activeOrderId` pattern) makes "one ACTIVE card per driver" a database constraint (owner decision, phase 3 request P1-3).
4. The seed creates only the INVITED bootstrap admin, with no invite token, URL or email (section 8 step 1, section 17 step 3): those need `auth-core` token hashing and the accept route, both phase 2, where the seed is extended.
5. The `migrate` one-shot also runs the create-only seed after `migrate deploy` and the sync (D12 names only deploy and sync): products, loading points and the system roles are seed-only master data (section 7) that every environment needs.
6. `predev` runs `migrate deploy` + `migrate diff --exit-code` (drift) + sync + seed instead of `prisma migrate dev` (D12 wording): Prisma 7's `migrate dev` no longer runs `generate` or the seed, and without a TTY it silently creates a migration with an empty name; a schema change without a migration now fails `predev` with a message pointing to `pnpm turbo run db:migrate:dev --filter=@tms/db -- --name <change>`.
7. Log files are `LOG_DIR/<app>/<app>.<yyyy-MM-dd>.<n>.log`, not `LOG_DIR/api-admin.log` (section 17 step 10): pino-roll appends date and counter, and per-app directories let `limit.removeOtherLogFiles` enforce retention across restarts without one app deleting the other's files.
8. No `@nestjs/config` (the phase 0 `.env.example` comment promised it): a typed `loadEnv` (zod) runs before Nest starts and `AppModule.forRoot(env)` receives the parsed object; `.env` is loaded by Node's `--env-file-if-exists`.
9. Degraded health returns HTTP 503 with `{ status: 'degraded', service }`; healthy returns 200 `{ status: 'ok', service }` (D5 names no status code; `service` — `'api-admin'` or `'api-driver'` — is the routing-identity check of the phase 0 journal (I7-1), not a database detail, so D5's "only `ok`/`degraded` (no database details)" still holds).
10. Application files in the images stay root-owned and the containers run with a read-only root filesystem, instead of `COPY --chown=node:node` (final-review input 3b): the runtime user cannot rewrite its own code; the writable paths are the `logs` volume and `/tmp`.
11. `@prisma/dev` stays in the `migrate` image because the Prisma CLI hard-depends on it; it is kept out of the API images by making `prisma` an optional dependency of `@tms/db` and deploying the apps with `--no-optional`.
12. Nest-aware libraries are CommonJS; only `contracts` is ESM. `contracts` is tested with Vitest (an ESM-native runner for an ESM package used by both frontends and backends); every other backend package uses Jest (section 13 "Jest backend").
13. Out of phase 1, by section 16: `ListQueryBuilder` and the CSV streamer (phase 3b), `RandomSource` (phase 2), `TERMINAL_TZ` (phase 4), the SMTP `MailSender` adapter and `@nestjs/event-emitter` (phase 2, with their first users), Sentry source-map upload (phase 8), the compose `test` profile (phase 2), the cross-origin negative check (journal A-8; phase 2, with the Origin guard) and removing `X-Powered-By` through helmet (journal A-7; phase 2, once auth gives it something to protect).
14. Section 11 says "`sendDefaultPii=false`"; Sentry 11 removed that option. The equivalent is `dataCollection: { userInfo: false, cookies: false, httpBodies: [] }` (headers stay so `beforeSend` can scrub them) — same intent, current API.
15. The Testcontainers harness lives inside `@tms/db` (`src/testing`, exported as `@tms/db/testing`) with `testcontainers` and `@testcontainers/postgresql` as devDependencies (`pg` is a runtime dependency since Task 05, shared with the driver adapter) rather than in a separate package: the harness needs the package's `prisma.config.ts`, migrations and CLI; `pnpm deploy --prod` never ships devDependencies, so production images are unaffected. A separate `@tms/db-testing` package is the alternative if the critic prefers a hard boundary.
16. Local development loads `.env` through Node (`--env-file-if-exists` in `start`, `process.loadEnvFile` in the CLIs); libraries never read `.env`, so tests can never reach the development database through `packages/db/.env`.

## Human steps (Stefan)

- Dependabot majors are adopted, not held (owner policy): `main` 0d5f4ac already runs TypeScript 7 with the `nest-ts6` catalog for compiler-API users, Node 26 images and `engines`, `postgres:18-alpine` in compose, and `@types/node` 26. A later bump that breaks a task is fixed in that task's PR; `POSTGRES_TEST_IMAGE` follows the compose image (a harness test enforces it). Drop the `nest-ts6` catalog and `.pnpmfile.cjs` once TypeScript 7.1 ships the JS API.
- Docker must be installed and running for `pnpm verify` and the pre-push hook from Task 04 on (documented in README).
- A Sentry DSN, if the section 17 step 10 test event should be exercised in Task 13 (otherwise recorded as "not run").
- Express `trust proxy` for Caddy is configured in phase 2 together with the throttler (spec section 8, step 4); until then `req.ip`, and so `AuditLog.ip` (Task 14), is Caddy's container address in compose.
- Required status checks on `main` keep their names (`verify`, `hygiene`, `db-drift`, `e2e`); no new CI job is added by this plan.

## Critic pass over this plan: 17 findings, 17 accepted, 0 rejected

The critic ran in two passes, both 2026-09-24, as a fresh read-only `plan-critic` agent (opus) over the spec, the plan, the journal and the worktree:
- Pass 1, 07:48–08:15, against `cc47fec`. It verified versions, turbo and pnpm behaviour, and gitleaks read-only or in scratch.
- Pass 2, 08:27–08:30, a drift pass after `main` moved to `0d5f4ac`: TypeScript 7 with the `nest-ts6` catalog, Node 26, Postgres 18 and `@types/node` 26 (Dependabot majors #13–#16). Its test was TypeScript 7.0.2 in scratch against the presets.

The findings were incorporated 08:15–08:34, as exact-string replacements where each old string had to occur exactly once.

| # | Severity | Finding (abridged) | Change made |
|---|---|---|---|
| 1 | HIGH | gitleaks `generic-api-key` flags two test-fixture passwords in the plan, so the plan commit (pre-commit), CI `hygiene` and the Task 10/12 commits fail | `// gitleaks:allow` on both; Task 01 runs gitleaks on the plan before committing |
| 2 | HIGH | Parallel turbo tasks write `src/generated` and `dist/` at once: `build` = `prisma generate && tsc` and the `pretest` `tsc`, while lint, typecheck and test read them, so `verify` and CI flake | `build` is `tsc` only; `@tms/db#test` and `@tms/nest-bootstrap#test` depend on their own `build`; `pretest` scripts removed; the Dockerfiles run `generate` explicitly (Tasks 04, 05, 07, 09, 11) |
| 3 | MEDIUM | RED steps expect TS diagnostics, but ts-jest runs transpile-only under `isolatedModules: true` | RED expectations rewritten to the runtime errors; TS errors pointed to `typecheck` (Tasks 05, 06, 11, 12, 14) |
| 4 | MEDIUM | The D7 regenerate-before-merge steps have no `DATABASE_URL`, so they fall back to `packages/db/.env` (the developer's compose database) | Explicit `DATABASE_URL` for `tms-p1-pg` (Tasks 05, 06) |
| 5 | LOW | Task 11 compose line numbers taken from `main`, not from after Task 09 | Corrected; superseded by 15 |
| 6 | LOW | The dependency line misses 11 → 09 and 13 → 12, and its Task 07 fallback does not work | Dependency line rewritten |
| 7 | LOW | The sync property test never generates a DRIVER code, so the locked Driver role is never exercised | `checkin` group added; audience derived from the group |
| 8 | LOW | Unlisted §7 departures (`ActionToken.createdById?`, unique natural keys); deviation 15 says `pg` is a devDependency | Deviations 3 and 15 amended |
| 9 | LOW | Task 12 crosses several boundaries in one PR | Recommended split 12a (`@tms/db/nest`, fault proxy) / 12b (health) |
| 10 | HIGH | New Nest packages declare `typescript: catalog:` (TS 7, whose `require('typescript')` is only `lib/version.cjs`), so ts-jest, the Nest CLI and the preset compiler-API tests break; Tasks 02 and 11 would revert `main`'s `nest-ts6` | `catalog:nest-ts6` for config, db, logger, nest-bootstrap, domain and both APIs; contracts and e2e stay on TS 7; rule added to Global Constraints |
| 11 | HIGH | Task 02 lowers `engines` to `>=24.13.0`, and the Task 09/11 Dockerfiles use `node:24` while `main` requires Node 26 (`engineStrict`) | `engines` untouched; `FROM node:26-bookworm-slim`; Node 24.13 notes replaced |
| 12 | HIGH | The harness pins `postgres:16-alpine`, but compose is 18, so Task 04's own image-pin test fails | `POSTGRES_TEST_IMAGE`, all manual `docker run` steps and CI `db-drift` moved to `postgres:18-alpine` |
| 13 | MEDIUM | The human step says to hold majors that `main` already adopted; the Tech Stack header still says Node 24 / TS 6 | Human step rewritten to the adopt-majors policy; Tech Stack refreshed; "toolchain drift after the spikes" note lists which task re-runs which spike on Node 26 |
| 14 | MEDIUM | CLAUDE.md anchors and the `wc -l` expectations are 10 lines low (`main`'s Stack section grew) | Anchors and counts shifted by 10 (Tasks 02, 03, 04, 08, 11, 14) |
| 15 | LOW | Compose anchors moved by the Postgres 18 volume note | Tasks 09 and 11 line numbers corrected |
| 16 | LOW | `pnpm-workspace.yaml` anchors moved by the new catalog entries | Tasks 02 and 03 line numbers corrected |
| 17 | LOW | TS 7 reports TS2591, not TS2580, for `process` when `types` is set | Task 03 expectation corrected |

Estimated rework prevented:
- Findings 1, 2, 4, 10, 11, 12 and 14 would each have failed a task's own acceptance step, the image builds or CI.
- 2 would have made every PR flaky from Task 05 on.
- 13 keeps the owner from acting on stale toolchain guidance.

Change requests from the phase 3 plan are not critic findings; the owner decided on them the same morning:
- P1-1 and P1-2 accepted (Task 03): `drivers:reset-pin`, `cards:block`, `admin.permission.deleted` and `admin.list.exported`, with `admin.order.*` in `audit/ops.ts`. The existing `admin.driver.pin-reset` is kept. The names follow the audit naming rule.
- P1-3 accepted (Task 06): `IdentityCard.activeUserId`.
- P1-5 accepted (Tasks 04–07 and 14): the fixtures are exported from `@tms/db/testing`.
- P1-4 (`TERMINAL_TZ`) is left to phase 3a.
- P1-6 (toolchain) is covered by findings 10–17.
