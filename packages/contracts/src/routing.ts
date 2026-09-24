/**
 * Nest metadata key of `@Public()` (phase 3a). Reserved here so `nest-bootstrap` (health route)
 * and `domain` (guard) share it without importing each other.
 */
export const PUBLIC_ROUTE_KEY = 'tms:public-route' as const;
