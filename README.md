# TMS Platform

Proof of concept for a terminal management platform replacing a legacy TMS/TAS at petroleum
storage terminals: role-based access control, user administration with invite and TOTP, a driver
self-service kiosk (card + PIN), a FIFO loading queue for operators, and an audit log. Built by
Ethernal with Claude Code; the process itself is a deliverable (see `docs/RETROSPECTIVE.md` at the
end of the POC).

## Prerequisites

- Node 26 (`.nvmrc`; `engines` enforces it) and the pnpm version pinned in
  `package.json#packageManager`. Node 26 no longer ships corepack, so install it from the
  repository root, as the Dockerfiles do:
  `npm install -g "$(node -p "require('./package.json').packageManager")"`
- Docker with Compose v2 and the daemon running (`docker info` succeeds): Postgres, Mailpit,
  migrations and the production-like stack, and the Testcontainers Postgres that database tests
  start in `pnpm verify`, the pre-push hook and CI `verify` (without it they stop with
  "Testcontainers could not reach Docker")
- Claude Code 2.1+ with the Claude in Chrome extension for visual verification (optional). If the
  `claude` binary is not on `PATH` in your shell, set `CLAUDE_BIN=~/.local/bin/claude`.

## Quick start

```bash
pnpm install                                   # installs dependencies and git hooks
cp infra/.env.example infra/.env
cp packages/db/.env.example packages/db/.env   # set BOOTSTRAP_ADMIN_EMAIL to your address
pnpm compose up -d --build && infra/smoke.sh   # postgres :5432, mailpit :8025, migrate: deploy, sync, seed
pnpm dev                                       # predev: migrate deploy, drift check, permission sync, seed;
                                               # then api-admin :3001, api-driver :3002, web-admin :5173, web-driver :5174
```

`predev` is idempotent and create-only: it deploys pending migrations, fails with a hint if
`schema.prisma` changed without a migration (`pnpm turbo run db:migrate:dev --filter=@tms/db -- --name <change>`),
synchronises the permission catalogue and seeds the system roles (Admin, Operator, Driver), five
products, eight loading points and one INVITED bootstrap administrator (`BOOTSTRAP_ADMIN_EMAIL`,
username `admin`). Rows an administrator edited later are never overwritten. Phase 2 adds the invite email.

Production-like stack (Caddy on one origin per app): `pnpm compose --profile full up -d --build`,
then `infra/smoke.sh --full` and `pnpm e2e`. Admin at http://localhost:8080, kiosk at
http://localhost:8081.

The compose `migrate` one-shot applies migrations, synchronises the permission catalogue and runs
the same create-only seed as `predev`; the APIs start only after it exited 0. The INVITED bootstrap
administrator comes from `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_USERNAME` in `infra/.env`
(defaults `admin@example.com` / `admin`); on an empty database without an email `migrate` exits 2.

## Verification

`pnpm verify` runs lint, typecheck, unit and API tests, build, format check, hygiene checks and
gitleaks. CI runs the same plus a Prisma drift check and the Playwright suite against the compose
stack. Every pull request records what was actually verified (see the PR template).

## Repository layout

| Path                                | Content                                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `apps/api-admin`, `apps/api-driver` | NestJS back-office and kiosk APIs                                                                        |
| `apps/web-admin`, `apps/web-driver` | React SPAs (back office, kiosk + queue display)                                                          |
| `packages/*`                        | shared code: `config`, `db` (Prisma); `contracts`, `auth-core`, `domain`, `logger`, `ui` from phase 1 on |
| `infra/`                            | docker-compose, Dockerfiles, Caddyfile, smoke test                                                       |
| `e2e/`                              | Playwright tests                                                                                         |
| `tools/`                            | hygiene scripts, gitleaks wrapper, Claude Code plugin                                                    |
| `docs/`                             | spec, plans, ADRs, architecture, efficiency journals                                                     |

## Documentation

- Design spec: `docs/superpowers/specs/2026-09-23-rbac-checkin-design.md`
- Architecture: `docs/architecture.md`; decisions: `docs/adr/`
- Working with Claude Code in this repository: `CLAUDE.md`

## Status

Phase 0 (bootstrap) complete. Phase 1 (foundation) in progress: contracts, schema, permission sync and
seed landed; logger, health, Sentry and the shared domain module follow.
