import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import type { SessionStateResponse } from '@tms/contracts';
import { LoginService, SessionCookie, SessionService } from '@tms/domain/admin';
import {
  AuthThrottle,
  CurrentPrincipal,
  type Principal,
  Public,
  RequireSession,
} from '@tms/domain/shared';
import type { Response } from 'express';
import { LoginDto, MfaDto } from './dto';

@Controller('auth')
export class LoginController {
  constructor(
    private readonly login: LoginService,
    private readonly sessions: SessionService,
    private readonly cookie: SessionCookie,
  ) {}

  @Public()
  @AuthThrottle()
  @Post('login')
  @HttpCode(200)
  async passwordStep(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionStateResponse> {
    const issued = await this.login.passwordStep(body.email, body.password);
    this.cookie.write(res, issued.token);
    return this.sessions.describe({ userId: issued.userId, scope: issued.scope });
  }

  @RequireSession('PRE_MFA')
  @AuthThrottle()
  @Post('mfa')
  @HttpCode(200)
  async mfaStep(
    @CurrentPrincipal() p: Principal,
    @Body() body: MfaDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionStateResponse> {
    const issued = await this.login.mfaStep(p, body);
    this.cookie.write(res, issued.token);
    return this.sessions.describe({ userId: issued.userId, scope: issued.scope });
  }
}
