# Phase 2 — review tables

> Part of the phase 2 plan: see [index.md](index.md).

## Deliberate deviations (for the critic)

Numbers are stable; tasks refer to them.

1. The route-access markers, `AccessGuard` and the fail-closed rule move from phase 3a into phase 2 (owner decision), so every phase 2 route is decorated from birth and admin actions get real HTTP tests; phase 3a keeps `GET /me` and the RBAC matrix. CLAUDE.md's "(from phase 3a)" changes accordingly (Task 10).
2. A third marker, `@RequireSession(scopes)`, for authenticated routes that need no permission (pre-session steps, logout, session state, change password, step-up, recovery codes); exactly one of the three markers per handler.
3. Section 7 addition: `User.lockoutLevel` (progressive lock across consecutive lockouts) — one migration (Task 07), which also replaces the `ActionToken(userId)` index with `(userId, type)`. The nullable `ActionToken.createdById` (self-service and CLI tokens have no creator) is already in the phase 1 schema (phase 1 deviation 3).
4. The explicit locked response (423 `AUTH_ACCOUNT_LOCKED` + `Retry-After`) is given only where the caller has already proven the account: the MFA step (PRE_MFA session), step-up and change-password (FULL session); step-up and change-password answer it to any input while locked, without evaluating the code or password. On the public credential routes (login password step, 2FA-reset accept) a locked account is not checked at all: the dummy hash runs, the attempt is not counted, and the answer is the generic 401, byte-identical to a wrong password. Owner decision after the critic pass (finding C1): answering 423 to a correct password would let an attacker keep guessing through the lock with a right/wrong oracle, bounded only by the throttler.
5. New permission codes `users:deactivate` and `users:assign-role` (deactivation is terminal, role assignment changes privileges); an admin-sent password reset uses `users:update`.
6. Step-up also guards deactivation and recovery-code regeneration (the spec names 2FA reset, role change and block).
7. The bootstrap admin's invite is issued by an api-admin CLI (`bootstrap-invite`) that reuses the invite service, not by the seed; `predev` and the compose one-shot `bootstrap` run it; the URL is printed only outside production (or with `--print`). Phase 1's note that "the seed is extended in phase 2" is satisfied by the CLI instead.
8. Withdrawn (auth-core follows the phase 1 convention: CommonJS + Jest on `nest-library.json`).
9. Action tokens travel in the link's URL fragment (`#t=`), never in the path or query string.
10. `ApiExceptionFilter` replaces phase 1's `SentryGlobalFilter` as the single catch-all filter and still reports 5xx errors to Sentry (ADR 0009).
11. The status-per-scope rule refines section 8.5's "every request checks `status = ACTIVE`": ENROLLMENT sessions accept INVITED (invite) or ACTIVE (2FA reset); FULL and PRE_MFA also need an enrolled TOTP.
12. The spec's compose "profile test" is an override file, `infra/docker-compose.test.yml`, plus the script `compose:test`, because a profile cannot change an existing service's environment (Task 16).
13. The password pepper is argon2's native `secret` input rather than an HMAC pre-hash (section 8 describes HMAC for the PIN; phase 5 reuses the hasher).
14. A fresh sign-in counts as step-up: the MFA login step and the enrollment confirmation set `mfaVerifiedAt`, so step-up routes work for 10 minutes after sign-in without a separate confirmation.
15. FULL sessions survive a lockout (a lock ends PRE_MFA sessions only); step-up and password change while locked answer 423. A lockout must not become a remote logout of the real user.
16. Admin actions lock rows with `SELECT … FOR NO KEY UPDATE` (the spec says `FOR UPDATE`) in one fixed order — the ACTIVE admin rows, then actor and target — and re-check the actor's session under the lock. The NO KEY variant still serialises every admin action and every credential check on those rows, but it does not block the key-share locks that inserting sessions, tokens and audit rows takes on the referenced user, which removes a deadlock with concurrent token issuance (Task 20).
17. Admin actions on users never target the actor's own account (403 `SELF_ACTION_FORBIDDEN`); the spec only forbids changing one's own role. This also closes a self-unlock while locked, which deviation 15 would otherwise allow.
18. Section 8.7's single `SECRETS_ENC_KEY` becomes a keyring, `SECRETS_ENC_KEYS` (`kid:base64` pairs) plus `SECRETS_ENC_ACTIVE_KEY_ID`: the `keyId` rotation the spec asks for needs old keys to stay readable while new secrets use the active one (Tasks 03, 14).
19. `Cache-Control: no-store` goes on every response of both APIs (the spec's security list names auth responses): `configureApp` installs it globally, because phase 3b responses carry personal data and one-time PINs and a per-controller route list fails open when a controller is added (Task 11).
20. Admin actions on DRIVER users: block, unblock and deactivate apply (owner decision: they reuse `users:block` and `users:deactivate`); invite, 2FA reset, admin-sent password reset and unlock are staff-only and answer 409 `USER_STATE_CONFLICT` for a driver. The driver's PIN lock is cleared by phase 3b's `drivers:reset-pin` (Tasks 13, 20, 22).
21. A foreign-key RESTRICT violation (Prisma P2003) maps to a new code, 409 `REFERENCE_CONFLICT`, which names neither table nor constraint; phase 3b's role and permission deletes rely on it (Tasks 08, 09).
22. A password reset still revokes all sessions and all unused tokens (section 8.5), and when a 2FA reset is pending (ACTIVE, `totpEnabledAt = null`) it issues a fresh MFA_RESET link in the same transaction and mails it after commit; otherwise a forgot-password would silently void the admin's 2FA reset (owner decision after critic finding C3; Task 22).
23. An ops CLI, `admin:reset-mfa <email>`, issues a 2FA reset for an ACTIVE admin with a system actor (audit `auth.mfa.reset { via: 'CLI' }`): with deviation 17 and the spec's rules, the only admin who loses the authenticator and the recovery codes would otherwise be locked out for good. It also accepts an ACTIVE admin whose 2FA reset is already pending and then rotates the link (a failed delivery or an expired link must not strand the only admin); refusals (unknown e-mail, non-admin, not ACTIVE) change nothing, print one masked line and write no audit row, since there is no actor. The spec has no such tool (owner decision after critic finding C15; Task 22).

Agreed with the phase 3 plan and left to it: the route-access snapshot stays one file in phase 2 (a single lane, no parallel edits); phase 3a splits it per host module before two backend lanes add routes in parallel.

## Human steps (Stefan)

1. Stack A (Tasks 02–06) branches from `main` once `phase-1/02-config` and `phase-1/03-contracts` have merged (the phase 0 stack is already on `main`); Task 03 relies on phase 1 Task 03's `fast-check` catalog entry and its "Packages and module format" section.
2. Stack B (Tasks 07–23) branches from `main` once the whole phase 1 stack and stack A have merged.
3. Keep Docker running for every stack B task (Testcontainers Postgres and Mailpit; compose project `tms-p2` for Tasks 15 and 16).
4. Before any shared environment (anything beyond local compose and CI), generate real secrets and keep them out of the repository: `SECRETS_ENC_KEYS` as `<kid>:$(openssl rand -base64 32)` with the matching `SECRETS_ENC_ACTIVE_KEY_ID`, and `PASSWORD_PEPPER=$(openssl rand -base64 32)`. The values in `infra/.env.example` and the api-admin dev defaults are public.
5. Required status checks on `main` stay as phase 0 set them; phase 2 adds no workflow job (Task 16 only changes how the e2e job starts the stack).
6. Merge Task 07 (the only migration) alone and in stack order (D7).

## Reconcile with phase 1

Compared on 2026-09-24 with the committed phase 1 plan (`96556f9` on `phase-1/01-plan`); the phase 1 name wins in every row. Confirmed identical and not listed: enum values, the permission catalogue types, seeded roles, `parseAuditMetadata`, `testDatabaseUrl`/`resetTestDatabase`, the `database: true` Jest preset, model fields and relation names, `createPrismaClient`/`PrismaModule`, the Prisma 7 constraint path, `seedDatabase`, `createEnvSchema`/`loadEnv`/`bootstrapApi`/`CoreModule.forRoot`, `SharedModule`/`AuditService`/`Clock`/`MailSender`, the CommonJS + Jest convention, `catalog:nest-ts6` in every phase 1 Nest library, `postgres:18-alpine`, next free ADR 0009.

| # | Assumed | Phase 1 final | Tasks edited |
|---|---|---|---|
| R1 | Phase 2 audit actions (`auth.login.password`, `auth.login.mfa`, `auth.account.locked`, `auth.logout`, snake_case segments), some re-adding phase 1 keys | 50 actions, three kebab-case segments; login is `auth.login.success`/`auth.login.failure` with `method`; `auth.lockout.applied`, `auth.session.revoked`, `auth.totp.verified`, `auth.mfa.reset`, `admin.user.role-changed` and the invite/password/lifecycle keys already exist | 08 (schemas of existing keys extended with optional fields, 5 new keys, count 55), 11–22 (names) |
| R2 | Metadata key `tokensRevoked` | `tokens` is a sensitive-key token; the "metadata keys pass `!isSensitiveKey`" test would fail | 08, 20, 21, 22 (`linksRevoked`) |
| R3 | Scrub matcher extended by substring with `secret`, `otpauth`; `totpKeyId` not sensitive | whole-word matching; `secret`, `totp`, `otp` already tokens, so `totpKeyId` is sensitive | 08 (only `otpauth` added; test removed) |
| R4 | `SessionScope` used as a zod value | `SessionScope` is a type, the schema is `SessionScopeSchema` | 08 |
| R5 | `withAdminClient` opens a client on the worker database | it connects to the maintenance database `postgres` | 07 (`prisma.$queryRaw`), 20 (own `pg` `Client` on `testDatabaseUrl()`) |
| R6 | api-admin env in `src/env.ts` as `AdminEnvSchema`/`AdminEnv` | `envSchema`/`Env` in `src/app.module.ts`, pinned by `test/env.spec.ts` | 10 (moves them to `src/env.ts`, same names), every task adding a variable updates `env.spec.ts` |
| R7 | Replacing the global filter touches only the apps' 404 tests | phase 1's Sentry capture spec, `bootstrap.spec.ts` and the Playwright smoke pin the old bodies and the Sentry mechanism | 09 |
| R8 | Task 07 makes `ActionToken.createdById` optional and adds `Session @@index([userId])` | both already in the phase 1 schema | 07 (only `lockoutLevel` and the `ActionToken(userId, type)` index) |
| R9 | Two permission codes added freely | counts pinned (33 / 32), `staff(...)` helper, `users:block` described as also deactivating | 08 |
| R10 | `TRUST_PROXY` added in `createEnvSchema` | shared variables are `baseEnvSchema` entries; five env specs pin exact defaults | 09 |
| R11 | `packages/nest-bootstrap/src/configure-app.ts`, `configureApp(app, env)` | `src/app.ts`, `configureApp<T extends INestApplication>(app: T): T` with seven callers | 09 (optional `env` argument), 11 |
| R12 | Task 12 creates `packages/domain/test/shared/mail.spec.ts` | phase 1 Task 14 already creates it | 12 (`mail-module.spec.ts`) |
| R13 | New `@tms/domain` exports need no test change | `exports.spec.ts` pins the export map and the 14 `./shared` names | 10, 11, 12 |
| R14 | Bootstrap e-mail default `admin@tms.local` | `admin@example.com` | 15 |
| R15 | Task 23 fills the empty "RBAC and permission sync" heading | phase 1 Task 07 inserts `### Permission sync (phase 1)` under it | 23 |
| R16 | Task 03 adds `fast-check` and a table row to "Packages and module format" | phase 1 Task 03 adds `fast-check: ^4.10.2` and writes that section as prose | 03, head, overview, human steps (stack A also waits for `phase-1/03-contracts`, owner decision) |
| R17 | Subclasses implement abstract methods without `override` | `noImplicitOverride` is on | 10, 11, 12, 15 |
| R18 | `HealthModule` marker on the controller | on the `check()` handler | overview only (the guard reads handlers) |
| R19 | Audit files `auth, admin, checkin, system` | plus `ops` | overview |
| R20 | `PUBLIC_ROUTE_KEY` in `route-access.ts` | `src/routing.ts` | 08 |
| R21 | Permission sync prints "2 created codes" | JSON line with `inserted`, `lockedRoleGrants` | 08 |
| R22 | Phase 2 `PrismaTxHost` in `admin/auth/tx.ts` | `AppTransactionHost` exported by `@tms/domain/shared` | 11–22 |
| R23 | `RequestContext { ip, userAgent, requestId }` | `ip` and `userAgent` optional | overview |
| R24 | Fallback sentences ("if phase 1 lacks `FixedClock.set`, `InMemoryMailSender.clear`, a `MailSender` binding, `@@map`, the relation name …") | all settled in phase 1 | overview, 07, 12, 13, 16, 20 (sentences removed) |
| R25 | auth-core lint rule deferred by "phase 1 Task 11" | phase 1 Task 02's note | 03 |
| R26 | `pnpm --dir packages/db exec prisma migrate dev` | `pnpm turbo run db:migrate:dev --filter=@tms/db -- --name <change>` | 07 |
| R27 | New mail code under `packages/domain/src/shared/mail/` | phase 1 has the file `shared/mail.ts` | 12 (`shared/mailer/`) |

Also checked: every item phase 1 defers to phase 2 has a task — `RandomSource` (03), the SMTP `MailSender` and `@nestjs/event-emitter` (12), the compose test profile (16, deviation 12), helmet / `X-Powered-By` A-7 (09), `trust proxy` for `AuditLog.ip` (09), the auth-core import rule D10-6 (03), the cross-origin negative check A-8 (10), the seed note of phase 1 deviation 4 (15, deviation 7).

## Critic pass

Critic: `ethernal-nest-react:plan-critic` (fresh context, read-only), 2026-09-24, run in parallel with the reconcile and told to skip phase 1 naming. 23 findings (2 high, 6 medium, 15 low); 22 accepted, 1 rejected; the three that changed a design decision went to the owner.

| # | Severity | Finding | Change made |
|---|---|---|---|
| C1 | HIGH | A correct password on a locked account answered 423 while a wrong one answered 401: a right/wrong oracle through the lock, bounded only by the throttler (login, 2FA-reset accept) | Owner: public routes skip the check while locked and answer the generic 401; 423 only after the account is proven (MFA step, step-up, change-password). Deviation 4 rewritten; Tasks 16, 22, 23 (tests of 17–19 pin the remaining 423s) |
| C2 | HIGH | Health would be rejected because phase 1 puts the public marker on the controller | Rejected: phase 1 puts it on the `check()` handler (the phase 2 overview row was wrong, fixed by R18) |
| C3 | MEDIUM | Reset and change of password revoke a pending MFA_RESET token; the user can then never finish the admin's 2FA reset | Owner: keep revoking all tokens, and re-issue a fresh MFA_RESET link when a 2FA reset is pending (deviation 22, Task 22) |
| C4 | MEDIUM | The bootstrap CLI re-invites a second admin mid-enrollment on every `pnpm dev` | Any ACTIVE admin → "nothing to do" (Task 15) |
| C5 | MEDIUM | Two parallel TOTP confirmations both succeed (two recovery-code sets, two FULL rotations) | Conditional clear of the pending secret in the transaction, 409 for the loser, parallel test (Task 14, Review Focus 3) |
| C6 | MEDIUM | `AccessGuard` imports `@tms/auth-core` one task before `domain` depends on it | Dependency and boundaries allowance move into Task 10 |
| C7 | MEDIUM | The Origin test posts to an unmatched route, where guards never run (404, not 403) | Real POST probe route (Task 10) |
| C8 | MEDIUM | The absolute-expiry test loops 14 × 50 min = 700 min < 720, so the 401 branch never runs | Loop to 15 and assert a 401 was seen (Task 11) |
| C9 | LOW | `AccountLockService.lock` uses `FOR UPDATE`, against deviation 16 | `FOR NO KEY UPDATE` (Task 16) |
| C10 | LOW | MFA step and step-up do not re-check ACTIVE under the lock (block in between → 500) | Re-check → invalid (Tasks 17, 19) |
| C11 | LOW | Logout destroys the session and writes audit outside a transaction | One transaction (Task 11) |
| C12 | LOW | Unknown 4xx `HttpException`s become 403 `FORBIDDEN` | Keep the status with a generic code (Task 09) |
| C13 | LOW | A `domain` test imports `@tms/nest-bootstrap` against the dependency rule | Local test filter (Task 10) |
| C14 | LOW | The CLI needs `apps/api-admin/.env`, which the install steps never create | Env source named, copy step documented (Task 15) |
| C15 | LOW | The only admin who loses the authenticator and recovery codes has no way back | Owner: CLI `admin:reset-mfa <email>` in phase 2 (deviation 23, Task 22; Task 15 points to it) |
| C16 | LOW | Security-reviewer checklist says `FOR UPDATE`; spec still says `SECRETS_ENC_KEY` | Checklist says `FOR NO KEY UPDATE` in one fixed order (Task 02); the spec keeps its text, deviations 16 and 18 record the change |
| C17 | LOW | Task 02's dry-run criterion depends on LLM output | ≥ 2 of 3 seeded issues and verdict BLOCK or FIX BEFORE MERGE; a miss is a prompt fix (Task 02) |
| C18 | LOW | The dev pepper decodes to 33 bytes, not 32 | New 32-byte value, allowlist updated (Task 14) |
| C19 | LOW | Tests read the mail outbox right after the response | `waitForMail` fixture (Task 12), used by Tasks 13–22 |
| C20 | LOW | Invite FAILURE rows carry a placeholder `expiresAt` | `expiresAt` optional, omitted on FAILURE (Tasks 08, 13) |
| C21 | LOW | A joined inner `UnitOfWork.run` silently drops `awaitEffects` | Throws (Task 12) |
| C22 | LOW | The weak-password test never shows the session survives | `GET /api/auth/session` → 200 after the 422s (Task 14) |
| C23 | LOW | No test for a reset token of a user blocked after the request | Added (Task 18) |

Estimated rework prevented: about 3–4 engineer-days (critic's estimate: C1 1.5–2 days across three tasks, tests, docs and a security-review round; C3 and C4 half a day each as late state bugs; C2 would have cost half a day but did not hold). The reconcile prevented at least seven red PRs (R1–R7 would not compile or would fail phase 1's own tests).
