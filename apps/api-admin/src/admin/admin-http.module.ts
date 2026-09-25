import { Module } from '@nestjs/common';
import { RoleAdminController } from './roles/role-admin.controller';
import { UserAdminController } from './users/user-admin.controller';

@Module({ controllers: [UserAdminController, RoleAdminController] })
export class AdminHttpModule {}
