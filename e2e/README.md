# End-to-end tests

Playwright projects `web-admin` and `web-driver` run against the compose `full` profile
(`pnpm compose --profile full up -d --build && infra/smoke.sh --full`), the same topology as
production: Caddy serves each SPA and forwards `/api` to its API on one origin.

- `pnpm --filter @tms/e2e install-browsers` once per machine.
- `pnpm e2e` runs everything; `E2E_ADMIN_URL` / `E2E_DRIVER_URL` override the origins.
- Traces and screenshots are kept on failure (`playwright-report/`, `test-results/`).
- Every test creates its own users, cards and orders (from phase 2 on) so tests can run in parallel.
