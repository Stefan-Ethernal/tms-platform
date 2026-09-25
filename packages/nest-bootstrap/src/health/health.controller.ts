import { Controller, Get, Header, Inject, Res, SetMetadata } from '@nestjs/common';
import type { Response } from 'express';
import { PUBLIC_ROUTE_KEY } from '@tms/contracts';
import { HEALTH_OPTIONS, type HealthBody, type HealthModuleOptions } from './health.options';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthService,
    @Inject(HEALTH_OPTIONS) private readonly options: HealthModuleOptions,
  ) {}

  /**
   * D5: `ok` / `degraded` plus the service name, never database details; degraded is HTTP 503
   * (deviation 9). Bypasses ApiExceptionFilter (phase 2) via `@Res({ passthrough: true })` so the
   * body stays exactly `{ status, service }` instead of the generic error envelope; the pipe
   * ignores `'custom'`-type params (its own spec: "ignores custom parameter decorators").
   */
  @Get()
  @SetMetadata(PUBLIC_ROUTE_KEY, true)
  @Header('Cache-Control', 'no-store')
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthBody> {
    const { service } = this.options;
    const database = await this.health.checkDatabase();
    if (!Object.values(database).every((entry) => entry.status === 'up')) {
      res.status(503);
      return { status: 'degraded', service };
    }
    return { status: 'ok', service };
  }
}
