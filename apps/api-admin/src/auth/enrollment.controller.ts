import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import { EnrollmentService, SessionCookie } from '@tms/domain/admin';
import { AuthThrottle, CurrentPrincipal, type Principal, RequireSession } from '@tms/domain/shared';
import type { Response } from 'express';
import { SetPasswordDto, TotpConfirmDto } from './dto';

@Controller('auth/enrollment')
export class EnrollmentController {
  constructor(
    private readonly enrollment: EnrollmentService,
    private readonly cookie: SessionCookie,
  ) {}

  @RequireSession('ENROLLMENT')
  @Post('password')
  @HttpCode(204)
  setPassword(@CurrentPrincipal() p: Principal, @Body() body: SetPasswordDto): Promise<void> {
    return this.enrollment.setPassword(p, body.password);
  }

  @RequireSession('ENROLLMENT')
  @Post('totp')
  @HttpCode(200)
  start(@CurrentPrincipal() p: Principal): Promise<{ otpauthUri: string; secret: string }> {
    return this.enrollment.startTotp(p);
  }

  @RequireSession('ENROLLMENT')
  @AuthThrottle()
  @Post('totp/confirm')
  @HttpCode(200)
  async confirm(
    @CurrentPrincipal() p: Principal,
    @Body() body: TotpConfirmDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ recoveryCodes: string[] }> {
    const { issued, recoveryCodes } = await this.enrollment.confirmTotp(p, body.totpCode);
    this.cookie.write(res, issued.token);
    return { recoveryCodes };
  }
}
