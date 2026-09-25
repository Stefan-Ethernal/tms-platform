import { SetMetadata } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import {
  AUTH_THROTTLE_KEY,
  type PermissionCode,
  PUBLIC_ROUTE_KEY,
  REQUIRED_PERMISSIONS_KEY,
  SESSION_SCOPES_KEY,
  type SessionScope,
  STEP_UP_KEY,
} from '@tms/contracts';

export const SKIP_SESSION_TOUCH_KEY = 'tms:skip-session-touch';
export type ScopeRequirement = SessionScope | 'ANY';

/** Route markers (ADR 0010). Exactly one of the first three per handler, at method level. */
export const Public = (): MethodDecorator => SetMetadata(PUBLIC_ROUTE_KEY, true);
export const RequireSession = (
  ...scopes: [ScopeRequirement, ...ScopeRequirement[]]
): MethodDecorator => SetMetadata(SESSION_SCOPES_KEY, scopes);
export const RequirePermissions = (
  ...codes: [PermissionCode, ...PermissionCode[]]
): MethodDecorator => SetMetadata(REQUIRED_PERMISSIONS_KEY, codes);
/** Modifier: a TOTP confirmation within the last 10 minutes (section 8.5). */
export const RequireStepUp = (): MethodDecorator => SetMetadata(STEP_UP_KEY, true);
/** Modifier: the route is subject to the auth rate limits (Task 16). */
export const AuthThrottle = (): MethodDecorator => SetMetadata(AUTH_THROTTLE_KEY, true);
/** Modifier: reading the route must not extend the idle timeout (e.g. polling `GET /auth/session`). */
export const SkipSessionTouch = (): MethodDecorator => SetMetadata(SKIP_SESSION_TOUCH_KEY, true);

export const ROUTE_MARKER_KEYS = [
  PUBLIC_ROUTE_KEY,
  SESSION_SCOPES_KEY,
  REQUIRED_PERMISSIONS_KEY,
] as const;

export type RouteAccess =
  | { kind: 'public'; stepUp: boolean }
  | { kind: 'session'; scopes: ScopeRequirement[]; stepUp: boolean }
  | { kind: 'permissions'; codes: PermissionCode[]; stepUp: boolean }
  | { kind: 'invalid'; reason: 'NONE' | 'MULTIPLE'; stepUp: boolean };

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- Nest handlers are plain functions
export function readRouteAccess(reflector: Reflector, handler: Function): RouteAccess {
  const isPublic = reflector.get<boolean | undefined>(PUBLIC_ROUTE_KEY, handler) === true;
  const scopes = reflector.get<ScopeRequirement[] | undefined>(SESSION_SCOPES_KEY, handler);
  const codes = reflector.get<PermissionCode[] | undefined>(REQUIRED_PERMISSIONS_KEY, handler);
  const stepUp = reflector.get<boolean | undefined>(STEP_UP_KEY, handler) === true;
  const count = Number(isPublic) + Number(scopes !== undefined) + Number(codes !== undefined);
  if (count === 0) return { kind: 'invalid', reason: 'NONE', stepUp };
  if (count > 1) return { kind: 'invalid', reason: 'MULTIPLE', stepUp };
  // @RequireStepUp() only makes sense on an authenticated route; paired with @Public() it is the
  // same ambiguity as two primary markers, not a silently-dropped modifier.
  if (isPublic && stepUp) return { kind: 'invalid', reason: 'MULTIPLE', stepUp };
  if (isPublic) return { kind: 'public', stepUp };
  if (scopes) return { kind: 'session', scopes, stepUp };
  return { kind: 'permissions', codes: codes ?? [], stepUp };
}
