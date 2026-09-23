# TMS Platform

Terminal management platform POC: RBAC, user administration with invite + TOTP, driver kiosk
check-in (card + PIN), FIFO loading queue, audit log. Spec:
`docs/superpowers/specs/2026-09-23-rbac-checkin-design.md`. Plans: `docs/superpowers/plans/`.

## Stack

Node 24, pnpm 12 (catalog in `pnpm-workspace.yaml` is the only place versions live), Turborepo,
TypeScript ~6.0 (not 7), NestJS 12 (apps compile to CJS, Jest 30 with `--experimental-vm-modules`),
React 19 + Vite 8 + Vitest 5, Prisma 7, zod 4, Playwright, ESLint 10 with `eslint-plugin-boundaries`.

## Commands

- `pnpm install` — also installs husky hooks; copy `infra/.env.example` and `packages/db/.env.example` to `.env` once
- `pnpm compose up -d --build && infra/smoke.sh` — postgres, mailpit, migrate
- `pnpm dev` — `predev` applies migrations; api-admin :3001, api-driver :3002, web-admin :5173,
  web-driver :5174 (Vite proxies `/api`)
- `pnpm verify` — lint, typecheck, tests, build, format check, hygiene, gitleaks. Run before every PR.
- `pnpm turbo run <task> --filter=<package>` — scoped runs (this form is allowlisted; `pnpm --filter` is not)
- `pnpm compose --profile full up -d --build && infra/smoke.sh --full && pnpm e2e` — production-like
  stack behind Caddy (:8080 admin, :8081 kiosk) plus Playwright
- The plugin `ethernal-nest-react` loads from `.claude/settings.json` (marketplace `tms`); fallback `pnpm claude`

## Where things live

- `apps/api-admin`, `apps/api-driver` — NestJS; controllers only, no logic
- `apps/web-admin`, `apps/web-driver` — React SPAs
- `packages/config` — shared tsconfig/eslint/jest presets; `packages/db` — Prisma schema and migrations
- `packages/contracts`, `auth-core`, `domain`, `logger`, `ui` — arrive in phases 1–6 (see spec §6)
- `infra/` — compose, Dockerfiles, Caddyfile, `smoke.sh`; `e2e/` — Playwright
- `tools/scripts` — hygiene + gitleaks wrapper; `tools/claude-plugin` — Claude plugin and its tests
- `docs/adr/` — decisions; `docs/architecture.md` — technical docs; `docs/efficiency/` — journals
- `docs/client/` — client documents, gitignored, never committed, never modified by Claude

## Rules

- TDD: failing test first; every task ends with its own verification (`pnpm verify` or the
  task's scoped equivalent) and real output in the PR.
- Dependency rule `contracts <- db <- domain <- apps` (eslint boundaries); `api-driver` imports
  only `@tms/domain/checkin` and `@tms/domain/shared`.
- Every route is decorated `@RequirePermissions` or `@Public` (from phase 3a); audit records are
  written inside the caller's transaction; enums and DTO schemas live in `contracts`.
- UI strings only through i18n keys; `en` is the only bundle for now.
- Versions come from the pnpm catalog; never `latest`. Secrets only in env; `.env.example` per app.
- Conventional commits; feature branch; PR to `main` filled from the PR template by the `pr` skill.
- The client is referred to as "the client"; no client name anywhere in the repository, including
  commit messages, PR titles, branch names, fixtures and seed data. Convention only, no mechanical
  check (ADR 0007).

## Working agreement

- Claude flags deviations from Claude Code best practices as a short, concrete reminder: no
  verifiable success criterion; skipping plan mode for anything beyond a small fix; prompts without
  `@` references to existing patterns; CLAUDE.md growing with what code already shows; manual
  repetition that should be a skill or hook; kitchen-sink sessions without `/clear`; a third
  correction instead of a restart; unscoped exploration in the main context (use a subagent);
  `claude -p` for CI-style automation; worktrees for parallel sessions.
- Process per phase: `superpowers:writing-plans` → `plan-critic` agent (fresh, read-only) →
  `superpowers:subagent-driven-development`. Log every task and critic pass in
  `docs/efficiency/<lane>.md` as it happens.
- Auth/RBAC/session/token PRs need `security-reviewer`; all others `/code-review`.
