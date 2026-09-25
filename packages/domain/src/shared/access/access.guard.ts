import { type CanActivate, type ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isStepUpFresh } from '@tms/auth-core';
import { DomainError } from '@tms/contracts';
import type { Request, Response } from 'express';
import { Clock } from '../clock';
import { readRouteAccess, SKIP_SESSION_TOUCH_KEY } from './markers';
import { type Principal, PRINCIPAL_REQUEST_KEY, PrincipalResolver } from './principal';

/** Fail-closed route access (ADR 0010): marker check → principal → scope → permissions (AND) → step-up. */
@Injectable()
export class AccessGuard implements CanActivate {
  private readonly logger = new Logger('AccessGuard');

  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: PrincipalResolver,
    private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const access = readRouteAccess(this.reflector, handler);
    if (access.kind === 'invalid') {
      this.logger.error(
        `Route ${context.getClass().name}.${handler.name} has ${access.reason === 'NONE' ? 'no' : 'more than one'} access marker`,
      );
      throw new DomainError('ROUTE_NOT_DECLARED', 'Route access is not declared');
    }
    if (access.kind === 'public') return true;

    const http = context.switchToHttp();
    const req = http.getRequest<Request & { [PRINCIPAL_REQUEST_KEY]?: Principal }>();
    const touch = this.reflector.get<boolean | undefined>(SKIP_SESSION_TOUCH_KEY, handler) !== true;
    const principal = await this.resolver.resolve(req, http.getResponse<Response>(), { touch });
    if (!principal) throw new DomainError('UNAUTHENTICATED', 'Authentication required');

    if (access.kind === 'session') {
      if (!access.scopes.includes('ANY') && !access.scopes.includes(principal.scope)) {
        throw new DomainError('UNAUTHENTICATED', 'Authentication required');
      }
    } else {
      if (principal.scope !== 'FULL')
        throw new DomainError('UNAUTHENTICATED', 'Authentication required');
      if (!access.codes.every((code) => principal.permissions.has(code))) {
        throw new DomainError('FORBIDDEN', 'Missing permission');
      }
    }
    if (access.stepUp && !isStepUpFresh(principal.mfaVerifiedAt, this.clock.now())) {
      throw new DomainError('AUTH_STEP_UP_REQUIRED', 'Confirm with your authenticator first');
    }
    req[PRINCIPAL_REQUEST_KEY] = principal;
    return true;
  }
}
