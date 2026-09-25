import { Module } from '@nestjs/common';
import { UserAdminController } from './users/user-admin.controller';

@Module({ controllers: [UserAdminController] })
export class AdminHttpModule {}
