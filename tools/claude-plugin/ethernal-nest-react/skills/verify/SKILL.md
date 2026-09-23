---
name: verify
description: Use before claiming any change is done, before committing a task and before opening a PR - runs the repository's verification (pnpm verify, Playwright and a claude --chrome walkthrough for frontend changes) and records what was actually run and its outcome as a scenario | layer | outcome table.
---

# Verify

Evidence before assertions. Nothing is "done" until the commands below ran in this session and
their real output is recorded.

## Backend or shared package change

1. `pnpm verify` from the repository root (lint, typecheck, unit + e2e-spec tests, build,
   format check, hygiene, gitleaks). Paste the last 20 lines of output.
2. If a migration is involved: `pnpm --filter @tms/db db:migrate:deploy` against the compose
   database, then `pnpm --filter @tms/db db:drift` (exit 0 = no drift).
3. Record a table:

   | scenario                                   | layer               | outcome        |
   | ------------------------------------------ | ------------------- | -------------- |
   | e.g. "unknown /api route returns JSON 404" | API e2e (supertest) | pass (2 tests) |

   Layers: unit, property, API e2e, UI e2e, security, manual.

## Frontend change

1. Everything above, then `pnpm compose --profile full up -d --build && infra/smoke.sh --full`.
2. `pnpm e2e` (Playwright). Paste the summary line.
3. In a terminal session started with `claude --chrome` (Claude in Chrome extension 1.0.36+,
   signed in with `/login`), open the affected origin (`http://localhost:8080` admin,
   `http://localhost:8081` kiosk), walk the changed flow in a real tab, take 2-4 screenshots and
   list the numbered steps you performed.

## Rules

- A failing or skipped step is reported as such, with the output. Never describe a check that did
  not run as if it had.
- If a command cannot run in the current environment (no Docker, no Chrome), say so explicitly
  and mark the row `not run: <reason>`.
