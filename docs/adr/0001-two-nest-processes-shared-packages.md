# ADR-0001: Two NestJS processes sharing workspace packages and one database

- Status: accepted
- Date: 2026-09-23
- Spec reference: section 5

## Context

The back office (admin, operator) and the kiosk (driver, queue display) have different users,
authentication methods and network exposure: the kiosk API is reachable only from the isolated
terminal network. They share the data model, permission catalogue and check-in domain.

## Decision

`api-admin` and `api-driver` are separate NestJS deployables. They share the Prisma client,
`contracts`, `auth-core` and `domain` through pnpm workspace packages. `api-driver` imports only
`@tms/domain/checkin` and `@tms/domain/shared` (subpath exports enforced by eslint), so
administrative modules are not in its import graph.

## Alternatives considered

- One Nest process with two route prefixes: simpler, no process or network isolation.
- Microservices with separate databases: real isolation, excessive complexity for this phase.

## Consequences

Isolation is at the level of loaded modules and lint rules, not a package-level guarantee; the
real boundary is the network. Two Dockerfiles/containers, shared migrations (one `migrate` job).
