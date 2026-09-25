import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import type {
  ActionTokenIssuedResponse,
  CreateUserResponse,
  UserListResponse,
} from '@tms/contracts';
import { InviteService, UserAdminService } from '@tms/domain/admin';
import { CurrentPrincipal, type Principal, RequirePermissions } from '@tms/domain/shared';
import { CreateUserDto, UserIdParamDto } from '../../auth/dto';

@Controller('users')
export class UserAdminController {
  constructor(
    private readonly invites: InviteService,
    private readonly users: UserAdminService,
  ) {}

  @RequirePermissions('users:create')
  @Post()
  @HttpCode(201)
  async create(
    @Body() body: CreateUserDto,
    @CurrentPrincipal() actor: Principal,
  ): Promise<CreateUserResponse> {
    const { userId, expiresAt } = await this.users.create(actor, body);
    return { userId, expiresAt: expiresAt.toISOString() };
  }

  @RequirePermissions('users:read')
  @Get()
  async list(): Promise<UserListResponse> {
    return { users: await this.users.list() };
  }

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
