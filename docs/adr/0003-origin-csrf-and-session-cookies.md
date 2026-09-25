# ADR-0003: Origin, CSRF and session cookies

- Status: accepted
- Date: 2026-09-25
- Spec reference: section 4 (D11), section 8 (staff authentication)

## Context

D11 requires "Cookie `SameSite=Strict` plus a global guard checking `Origin`/`Sec-Fetch-Site` on
mutations." Each API and its SPA are served from one origin in every environment (the Vite dev proxy
in development, Caddy in the production-like compose profile), and sessions are cookie-based, not
bearer tokens: `SameSite=Strict` already stops a foreign site's browser-issued request from carrying
the cookie, but a same-site attacker (another origin the browser still treats as "safe" under
looser policies, or a future relaxation of the cookie attribute) and non-browser clients that never
set `Origin` are not covered by the cookie attribute alone. A second, server-side check is needed so
a mutating request is rejected before it reaches any handler, independent of the cookie's own
defence.

## Decision

Single origin per environment: the SPA and its API share one origin (Vite's `/api` proxy in
development, Caddy in the production-like profile), so no CORS configuration ever has to allow
credentials from a second origin. The session cookie is `__Host-tms_admin_sid`: `HttpOnly`,
`Secure`, `SameSite=Strict`, `Path=/`, no `Max-Age` (a session cookie, cleared on browser close;
server-side expiry is enforced independently by the session service); the `__Host-` prefix pins it
to `Secure`, `Path=/`, no `Domain` attribute, which stops a subdomain from ever setting a cookie of
the same name. Only a hash of the session token is stored at rest, and the token itself rotates on
every scope upgrade (`PRE_MFA` → `FULL`, etc.): this defends against session fixation (an attacker
who fixed or intercepted the pre-escalation token loses access once the session moves to a new
scope) and against replay of a stale pre-MFA token after the session has already escalated to
`FULL` — not against a leaked hash, since the hash is never itself a usable credential (only the
raw token is, and the raw token is never stored).

`OriginGuard` (`@tms/nest-bootstrap`) runs on every request, ahead of authentication (`AccessGuard`,
ADR 0010), so a rejected cross-origin request never reaches the principal resolver:

- safe methods (`GET`, `HEAD`, `OPTIONS`) always pass — they must never mutate state, and blocking
  them would break plain navigation and prefetching;
- a mutating method with an `Origin` header passes only if that origin is in `ORIGIN_ALLOWLIST`
  (the app's own env-configured web origin(s)); an origin outside the allowlist is rejected, even a
  prefix or suffix match of an allowed origin (`http://localhost:5173.evil.example` is not
  `http://localhost:5173`) and even the literal string `null` (a browser sends this for some
  redirected or sandboxed requests, and it must not be treated as "no origin");
- a mutating method with no `Origin` header passes only if `Sec-Fetch-Site: same-origin` is present
  (a modern browser's Fetch Metadata, sent even when `Origin` itself is stripped for a same-origin
  request in some configurations) — any other Fetch Metadata value (`same-site`, `cross-site`,
  `none`) or the header's absence is rejected;
- an `Origin` header wins over Fetch Metadata: a foreign `Origin` is rejected even alongside
  `Sec-Fetch-Site: same-origin`, since `Origin` is authoritative when present and a same-origin
  metadata claim does not override a foreign origin actually stated by the request.

`trust proxy` (ADR 0009) is limited to `loopback` in development and to the compose network's
private range in the production-like profile, so `req.ip` (used by the per-IP auth throttler)
cannot be spoofed by an `X-Forwarded-For` header from outside that trusted hop.

## Alternatives considered

- Double-submit CSRF token (a token in both a cookie and a request header/body, compared server
  side): the standard mitigation for cookie-based sessions, but it needs its own issuance,
  transport and rotation logic on top of what `SameSite=Strict` and the Origin check already give
  for a single-origin SPA — extra surface with no coverage gain here, since neither the admin nor
  the driver SPA ever calls a second origin.
- CORS configured to allow credentials from the SPA's origin: unnecessary once the SPA and API share
  an origin behind Vite's proxy or Caddy, and it would have to be kept in lockstep with the same
  allowlist `OriginGuard` already reads, duplicating one decision in two places (browser-enforced
  CORS and the server-side guard).
- An `Origin`-only check that lets a request with neither `Origin` nor `Sec-Fetch-Site` through
  (treating "no signal" as same-origin): rejected — fail-closed means an absent signal is not
  evidence of same-origin, only its presence is, and older clients or proxies that strip both
  headers must not get a free pass on a mutation.

## Consequences

- Any script or `curl` invocation against a mutating route needs to set `Origin` (or run from a
  context a browser marks `Sec-Fetch-Site: same-origin`); this is exercised directly in
  `apps/api-admin/test/route-access.e2e-spec.ts`.
- `SESSION_COOKIE_SECURE=false` (a fallback for non-localhost HTTP development, e.g. testing from a
  phone on the LAN) is a development-only escape hatch that follows directly from this ADR's
  `Secure`-cookie decision. The variable does not exist in the environment schema yet — it and its
  `loadEnv` rejection under `NODE_ENV=production` are added by the work that introduces staff
  sessions, not by this ADR's own change; the rule is recorded here because it is this decision's
  consequence, not because it already exists.
- Phase 5's kiosk API is out of scope for this ADR: it authenticates via a device key, not a cookie
  session, and `OriginGuard` is not wired into `api-driver` until that phase needs it.
