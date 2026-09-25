import { Controller, Get, Module } from '@nestjs/common';
import { RequirePermissions, RequireSession } from '@tms/domain/shared';

@Controller('probe')
class ProbeController {
  @RequireSession('ANY')
  @Get('any')
  any() {
    return { ok: true };
  }

  @RequireSession('FULL')
  @Get('full')
  full() {
    return { ok: true };
  }

  @RequirePermissions('users:read')
  @Get('users-read')
  usersRead() {
    return { ok: true };
  }
}

@Module({ controllers: [ProbeController] })
export class ProbeModule {}
