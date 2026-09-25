import { Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import type { SessionStateResponse } from '@tms/contracts';
import { SessionCookie, SessionService } from '@tms/domain/admin';
import {
  CurrentPrincipal,
  type Principal,
  RequireSession,
  SkipSessionTouch,
} from '@tms/domain/shared';
import type { Response } from 'express';

@Controller('auth')
export class SessionController {
  constructor(
    private readonly sessions: SessionService,
    private readonly cookie: SessionCookie,
  ) {}

  @RequireSession('ANY')
  @SkipSessionTouch()
  @Get('session')
  state(@CurrentPrincipal() principal: Principal): Promise<SessionStateResponse> {
    return this.sessions.describe(principal);
  }

  @RequireSession('ANY')
  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentPrincipal() principal: Principal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.sessions.logout(principal);
    this.cookie.clear(res);
  }
}
