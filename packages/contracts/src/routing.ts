/**
 * Nest metadata key of `@Public()` (phase 3a). Reserved here so `nest-bootstrap` (health route)
 * and `domain` (guard) share it without importing each other.
 */
export const PUBLIC_ROUTE_KEY = 'tms:public-route' as const;

/** Metadata keys of the route-access markers (ADR 0010). Plain strings so every package can read them. */
export const SESSION_SCOPES_KEY = 'tms:session-scopes';
export const REQUIRED_PERMISSIONS_KEY = 'tms:required-permissions';
export const STEP_UP_KEY = 'tms:step-up';
export const AUTH_THROTTLE_KEY = 'tms:auth-throttle';
