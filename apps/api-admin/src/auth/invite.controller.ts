import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import type { SessionStateResponse } from '@tms/contracts';
import { InviteService, SessionCookie, SessionService } from '@tms/domain/admin';
import { AuthThrottle, Public } from '@tms/domain/shared';
import type { Response } from 'express';
import { AcceptInviteDto } from './dto';

@Controller('auth/invite')
export class InviteController {
  constructor(
    private readonly invites: InviteService,
    private readonly sessions: SessionService,
    private readonly cookie: SessionCookie,
  ) {}

  @Public()
  @AuthThrottle()
  @Post('accept')
  @HttpCode(200)
  async accept(
    @Body() body: AcceptInviteDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionStateResponse> {
    const issued = await this.invites.accept(body.token);
    this.cookie.write(res, issued.token);
    return this.sessions.describe({ userId: issued.userId, scope: issued.scope });
  }
}
