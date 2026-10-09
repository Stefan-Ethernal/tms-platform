import { Controller, Get, Param } from '@nestjs/common';
import type { RoleDetailResponse, RoleListResponse } from '@tms/contracts';
import { RoleAdminService } from '@tms/domain/admin';
import { RequirePermissions } from '@tms/domain/shared';
import { RoleIdParamDto } from '../../auth/dto';

@Controller('roles')
export class RoleAdminController {
  constructor(private readonly roles: RoleAdminService) {}

  @RequirePermissions('roles:read')
  @Get()
  async list(): Promise<RoleListResponse> {
    return { roles: await this.roles.list() };
  }

  @RequirePermissions('roles:read')
  @Get(':id')
  get(@Param() params: RoleIdParamDto): Promise<RoleDetailResponse> {
    return this.roles.get(params.id);
  }
}
