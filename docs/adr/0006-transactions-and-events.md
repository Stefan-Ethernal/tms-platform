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
  builds whose classes differ between the CommonJS and ESM module graphs, which would break
  dependency injection silently.

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
