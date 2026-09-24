# ADR-0009: API error envelope

- Status: accepted
- Date: 2026-09-24
- Spec reference: section 12 (input validation and error mapping)

## Context

Section 12 asks for a 422 response carrying a list of fields and messages on validation failure and
a 409 carrying the conflicting field on a unique violation. The admin and driver SPAs map every
error to an i18n key, so the shape the client can switch on has to be small, closed and shared with
the server, not re-derived per route. Nest's default `HttpException` body is
`{ statusCode, message: string | string[], error }`, which gives the client only a status code and a
free-text (and sometimes localized-by-Nest) message to pattern-match against — not stable enough to
drive an i18n lookup, and it has no place for a field list or a retry hint.

## Decision

One envelope, `{ statusCode, code, message, fields?, retryAfterSeconds? }`
(`ApiErrorSchema` in `@tms/contracts`), returned by both APIs for every non-2xx response. `code` is
one of `API_ERROR_CODES`, a fixed map from a machine-readable string to its nominal HTTP status;
`fields` (path, code, message) is populated only for `VALIDATION_FAILED` and similar per-field
errors, `retryAfterSeconds` only where the client should back off (lockout, throttling).

Services never construct the envelope directly: they throw `DomainError` (a code plus optional
`fields`/`retryAfterSeconds`), and a single global exception filter (`@tms/nest-bootstrap`, Task 09)
maps every thrown value to the envelope in one place:

- a `DomainError` maps through its `code` to `API_ERROR_CODES[code]` and carries its `details`;
- a Prisma unique violation (`P2002`) maps to `CONFLICT` with the violated constraint's fields;
- a Prisma foreign-key `RESTRICT` violation (`P2003`, e.g. deleting a role that users still hold,
  phase 3b) maps to `REFERENCE_CONFLICT` without field details (the referencing rows are not
  necessarily visible to the caller);
- a Nest `HttpException` with a status the catalogue has no dedicated code for (405, 406, 431, ...)
  keeps that original status under the generic code `REQUEST_REJECTED`;
- anything else (a programming error, an unexpected exception) maps to `INTERNAL` with no details,
  after being reported to Sentry (ADR 0008) and logged with the request id.

`DomainError` is recognised by `isDomainError`, a brand check (`isDomainError === true` plus a known
`code`), never `instanceof` — the same technique the audit and scrub helpers use elsewhere in this
package, so a duplicated copy of `@tms/contracts` in the dependency graph cannot silently stop the
filter from recognising a domain error.

## Alternatives considered

- RFC 9457 `application/problem+json`: a reasonable, standard shape, but its `type`/`title` pair
  duplicates what `code`/`message` already give us, and neither field is a small closed enum the
  client can build an exhaustive i18n switch over without also parsing `type` URIs.
- Nest's default body plus only a `code` field bolted on: keeps `message` as the client-facing string
  (undermining i18n, since Nest and validation libraries produce English text) and leaves `fields`
  and `retryAfterSeconds` as undocumented, ad hoc additions instead of part of one validated schema.

## Consequences

- The FE `code → i18n key` map can be exhaustive by type (`ApiErrorCode`), checked at compile time;
  a route that throws a code without a mapped key is a type error, not a runtime fallback string.
- Adding a new error code is a `@tms/contracts` change (one entry in `API_ERROR_CODES`, reviewed like
  any other shared vocabulary), not a per-route decision.
- Every service that wants a specific status throws `DomainError`, never a raw Nest `HttpException`,
  keeping the mapping (and its test coverage, the error envelope matrix of Task 09) in one place.
