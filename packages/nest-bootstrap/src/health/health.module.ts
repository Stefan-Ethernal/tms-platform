import { type DynamicModule, Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { HEALTH_OPTIONS, type HealthModuleOptions } from './health.options';
import { HealthService } from './health.service';

@Module({})
export class HealthModule {
  static forRoot(options: HealthModuleOptions): DynamicModule {
    return {
      module: HealthModule,
      // logger: false, or terminus prints its own error JSON on every 503.
      imports: [TerminusModule.forRoot({ logger: false, errorLogStyle: 'json' })],
      controllers: [HealthController],
      providers: [{ provide: HEALTH_OPTIONS, useValue: options }, HealthService],
    };
  }
}
