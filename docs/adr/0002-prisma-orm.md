# ADR-0002: Prisma as the ORM

- Status: accepted
- Date: 2026-09-23
- Spec reference: section 2 (decisions table), section 7

## Context

The data model is relational with strong typing needs (statuses, enums mirrored in `contracts`),
migrations must run as a separate step (D12) and a drift check is part of CI.

## Decision

Prisma 7 (`prisma-client` generator, driver adapter for PostgreSQL, `prisma.config.ts` holding
the datasource URL). Schema and migrations live in `packages/db`; enums are defined in
`contracts` and mirrored in the schema with a unit test asserting set equality.

## Alternatives considered

- TypeORM or MikroORM: decorator-based entities in the Nest style, weaker migration tooling.
- Kysely/Drizzle: lighter, but the team's Prisma experience and the migration workflow won.

## Consequences

`prisma migrate deploy` in the compose `migrate` one-shot and in `predev`; CI drift check
`migrate diff --from-config-datasource --to-schema`. Prisma 8 is an rc at the time of writing;
the catalog pins `^7.10.0`.
