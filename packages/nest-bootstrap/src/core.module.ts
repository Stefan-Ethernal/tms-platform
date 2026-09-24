import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { PrismaModule } from '@tms/db/nest';
import { createLoggerModule, type LoggerOptions } from '@tms/logger';
import type { BaseEnv } from './env';
import { HealthModule } from './health/health.module';

/** The two deployables; also the name of each app's log directory and files. */
export type ApiName = LoggerOptions['app'];

/**
 * Infrastructure every API imports: the logger now; the Prisma client, /api/health and Sentry join
 * as further `imports` entries after the logger once those pieces exist. Feature modules never
 * import it.
 */
@Module({})
export class CoreModule {
  static forRoot({ app, env }: { app: ApiName; env: BaseEnv }): DynamicModule {
    return {
      module: CoreModule,
      imports: [
        createLoggerModule({
          app,
          level: env.LOG_LEVEL,
          file: {
            enabled: env.LOG_FILE_ENABLED,
            dir: env.LOG_DIR,
            retentionDays: env.LOG_RETENTION_DAYS,
          },
        }),
        SentryModule.forRoot(),
        PrismaModule.forRoot({ url: env.DATABASE_URL }),
        HealthModule.forRoot({ service: app, dbTimeoutMs: env.HEALTH_DB_TIMEOUT_MS }),
      ],
      providers: [{ provide: APP_FILTER, useClass: SentryGlobalFilter }],
    };
  }
}
