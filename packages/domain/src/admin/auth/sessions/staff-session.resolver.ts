import { Injectable } from '@nestjs/common';
import { shouldTouch } from '@tms/auth-core';
import type { PermissionCode } from '@tms/contracts';
import type { Request, Response } from 'express';
import { Clock, type Principal, PrincipalResolver } from '../../../shared';
import { evaluateStaffSession } from './evaluate-session';
import { SessionCookie } from './session-cookie';
import { SessionService } from './session.service';

@Injectable()
export class StaffSessionResolver extends PrincipalResolver {
  constructor(
    private readonly sessions: SessionService,
    private readonly cookie: SessionCookie,
    private readonly clock: Clock,
  ) {
    super();
  }

  override async resolve(
    req: Request,
    res: Response,
    options: { touch: boolean },
  ): Promise<Principal | null> {
    const token = this.cookie.read(req);
    if (!token) return null;
    const now = this.clock.now();
    const session = await this.sessions.findByToken(token);
    if (!session) {
      this.cookie.clear(res);
      return null;
    }
    if (!evaluateStaffSession(session, now, this.sessions.expiry).ok) {
      await this.sessions.destroy(session.id);
      this.cookie.clear(res);
      return null;
    }
    if (options.touch && shouldTouch(session.lastSeenAt, now))
      await this.sessions.touch(session.id, now);
    const codes =
      session.scope === 'FULL'
        ? session.user.role.permissions.map((p) => p.permissionCode as PermissionCode)
        : [];
    return {
      userId: session.userId,
      sessionId: session.id,
      scope: session.scope,
      permissions: new Set(codes),
      mfaVerifiedAt: session.mfaVerifiedAt,
    };
  }
}
