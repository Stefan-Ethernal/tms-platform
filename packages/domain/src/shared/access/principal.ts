import { createParamDecorator, type ExecutionContext, Injectable } from '@nestjs/common';
import type { PermissionCode, SessionScope } from '@tms/contracts';
import type { Request, Response } from 'express';

export const PRINCIPAL_REQUEST_KEY = 'tmsPrincipal';

export interface Principal {
  userId: string;
  sessionId: string;
  scope: SessionScope;
  permissions: ReadonlySet<PermissionCode>;
  mfaVerifiedAt: Date | null;
}

/** Turns a request into a principal (or null). api-admin: staff session cookie; api-driver: kiosk JWT (phase 5). */
export abstract class PrincipalResolver {
  abstract resolve(
    req: Request,
    res: Response,
    options: { touch: boolean },
  ): Promise<Principal | null>;
}

@Injectable()
export class DenyAllPrincipalResolver extends PrincipalResolver {
  override resolve(): Promise<Principal | null> {
    return Promise.resolve(null);
  }
}

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal => {
    const req = ctx.switchToHttp().getRequest<Request & { [PRINCIPAL_REQUEST_KEY]?: Principal }>();
    const principal = req[PRINCIPAL_REQUEST_KEY];
    if (!principal)
      throw new Error('CurrentPrincipal used on a route without a resolved principal');
    return principal;
  },
);
