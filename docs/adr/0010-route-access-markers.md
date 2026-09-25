# ADR-0010: Route access markers and the fail-closed guard pipeline

- Status: accepted
- Date: 2026-09-25
- Spec reference: section 3 (fail-closed rule), section 9 (enforcement)

## Context

Section 3 states the platform's central invariant: "a route without `@RequirePermissions` or
`@Public` cannot exist (guard + test)." Phase 1 reserved `PUBLIC_ROUTE_KEY` for exactly this reason
(the health route already carries it) but had no permission system yet to enforce the other side.
Phase 2 adds staff authentication, and with it a class of routes that need an authenticated caller
but no specific permission — accepting an invite, confirming TOTP during enrollment, reading the
current session state. Two markers cannot express "authenticated, any permission" or "authenticated,
in this particular session scope" without every such route reaching for a manufactured permission
that exists only to satisfy the guard, so the phase 2 plan's own stress test (deviation 2) added a
third marker before any code was written.

## Decision

Three method-level markers, exactly one required per handler, checked by a single fail-closed guard:

- `@Public()` — no authentication;
- `@RequireSession(...scopes)` — an authenticated principal whose session `scope` is one of the
  given values, or the literal `'ANY'` for "authenticated, scope does not matter" (e.g. `GET
/auth/session`, pollable from any scope);
- `@RequirePermissions(...codes)` — an authenticated principal with a `FULL` session and every one
  of the given permission codes (D3: AND, not OR).

Two independent modifiers stack onto any of the three: `@RequireStepUp()` (a TOTP confirmation
within the last 10 minutes, section 8.5) and `@AuthThrottle()` (subject to the auth-specific rate
limits, Task 16). A third, `@SkipSessionTouch()`, is domain-internal (not exported from
`@tms/domain/shared`) and tells the guard not to extend the session's idle timeout for a route that
only reads session state.

The keys themselves (`PUBLIC_ROUTE_KEY`, `SESSION_SCOPES_KEY`, `REQUIRED_PERMISSIONS_KEY`,
`STEP_UP_KEY`, `AUTH_THROTTLE_KEY`) live in `@tms/contracts`, reachable by both `@tms/nest-bootstrap`
(the health route) and `@tms/domain/shared` (the guard) without either package depending on the
other. `readRouteAccess(reflector, handler)` counts how many of the three primary markers are set on
a handler and returns a closed `RouteAccess` union; zero or more than one is `{ kind: 'invalid',
reason: 'NONE' | 'MULTIPLE' }`. `AccessGuard` (`@tms/domain/shared`) is the single `APP_GUARD` that
enforces it: an invalid route throws `ROUTE_NOT_DECLARED` (403) before any principal is resolved —
the failure mode for a route the guard cannot classify is "reject", never "allow". A public route
returns `true` immediately, without ever calling the principal resolver. Every other route resolves
a `Principal` through the abstract `PrincipalResolver` (Task 11 supplies `StaffSessionResolver` for
`api-admin`; phase 5 supplies a kiosk resolver for `api-driver`; both apps run `DenyAllPrincipalResolver`
until then, so an unfinished authentication story fails closed rather than open), checks scope or
permissions, then step-up, in that order.

Markers are read at method level only; a marker set on the controller class itself is ignored by
`readRouteAccess` (and therefore treated as "no marker", i.e. rejected) — `scanRouteAccess`
separately reports any class-level marker it finds (`classMarkers`) so a reviewer sees the mistake
instead of the guard silently trusting it. `scanRouteAccess(app, globalPrefix)` (test-only, needs
`DiscoveryModule`) walks every controller and produces one `RouteAccessEntry` per handler
(`controller`, `handler`, `method`, `path`, `access`, `classMarkers`); each app's
`route-access.e2e-spec.ts` runs it against the real `AppModule` and compares the sorted result to a
reviewed snapshot committed alongside the code (`apps/api-admin/test/route-access.snapshot.json`),
asserting in the same test that no entry is `invalid` and no controller carries a class-level
marker. Every later task in this plan that adds a route updates that snapshot in its own PR — it is
the mechanism phase 3a's RBAC matrix builds on.

Guard order matters and is fixed in one `providers` array per app: `OriginGuard` (ADR 0003) first,
so a cross-origin mutation is rejected before authentication is even attempted; `AccessGuard` last
(Task 16 inserts `ThrottlerGuard` between the two, so a throttled request is also rejected before
authentication runs).

## Alternatives considered

- Two markers (`@Public()`, `@RequirePermissions()`) with manual scope checks inside every
  pre-session or self-service handler: rejected — it pushes the same scope logic into every service
  that needs it instead of the guard, is easy to get wrong per-route, and defeats the point of a
  single fail-closed choke point the scan test can verify exhaustively.
- Class-level markers (one marker per controller, inherited by every handler): rejected — a
  controller in this API mixes access levels by nature (an admin controller has both `@Public()`
  invite-accept and `@RequirePermissions()` user-management routes), so a class-level marker would
  either force artificial controller splits or silently misclassify a handler; method-level markers
  plus the scanner's explicit class-marker report catch the mistake instead of hiding it.

## Consequences

- A new route with no marker, or two markers, fails its own suite immediately (`ROUTE_NOT_DECLARED`
  in `access.guard.spec.ts`, `invalid` in `route-scan.spec.ts`) and fails the app-level snapshot test
  before it can reach review.
- Phase 3a's RBAC matrix reads the same `scanRouteAccess` output rather than re-deriving route access
  from scratch.
- Phase 5's kiosk `PrincipalResolver` and `api-driver`'s own `OriginGuard` wiring are follow-up work
  under this same ADR, not a new decision.
