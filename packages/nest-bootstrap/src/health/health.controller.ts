import {
  Controller,
  Get,
  Header,
  Inject,
  ServiceUnavailableException,
  SetMetadata,
} from '@nestjs/common';
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
   * (deviation 9). Nest sets route headers before the handler runs, so `no-store` is also on the 503.
   */
  @Get()
  @SetMetadata(PUBLIC_ROUTE_KEY, true)
  @Header('Cache-Control', 'no-store')
  async check(): Promise<HealthBody> {
    const { service } = this.options;
    const database = await this.health.checkDatabase();
    if (!Object.values(database).every((entry) => entry.status === 'up')) {
      throw new ServiceUnavailableException({ status: 'degraded', service } satisfies HealthBody);
    }
    return { status: 'ok', service };
  }
}
