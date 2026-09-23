import { Module } from '@nestjs/common';

@Module({
  imports: [
    // Phase 1 slot: LoggerModule.forRoot(...) from @tms/logger must be the first import.
    // Phase 1 slot: SentryModule.forRoot() from @sentry/nestjs/setup follows the logger.
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
