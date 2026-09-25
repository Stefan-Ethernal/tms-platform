import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import type { ActionTokenIssuedResponse } from '@tms/contracts';
import { InviteService } from '@tms/domain/admin';
import { CurrentPrincipal, type Principal, RequirePermissions } from '@tms/domain/shared';
import { UserIdParamDto } from '../../auth/dto';

@Controller('users')
export class UserAdminController {
  constructor(private readonly invites: InviteService) {}

  @RequirePermissions('users:invite')
  @Post(':id/invite')
  @HttpCode(202)
  async resendInvite(
    @Param() params: UserIdParamDto,
    @CurrentPrincipal() actor: Principal,
  ): Promise<ActionTokenIssuedResponse> {
    const { expiresAt } = await this.invites.issue(params.id, actor.userId);
    return { expiresAt: expiresAt.toISOString() };
  }
}
