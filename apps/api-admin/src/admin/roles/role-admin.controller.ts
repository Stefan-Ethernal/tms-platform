import { Controller, Get } from '@nestjs/common';
import type { RoleListResponse } from '@tms/contracts';
import { RoleAdminService } from '@tms/domain/admin';
import { RequirePermissions } from '@tms/domain/shared';

@Controller('roles')
export class RoleAdminController {
  constructor(private readonly roles: RoleAdminService) {}

  @RequirePermissions('roles:read')
  @Get()
  async list(): Promise<RoleListResponse> {
    return { roles: await this.roles.list() };
  }
}
