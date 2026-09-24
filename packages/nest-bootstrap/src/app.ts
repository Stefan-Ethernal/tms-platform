import type { INestApplication } from '@nestjs/common';
import { Logger } from '@tms/logger';

/** Settings shared by bootstrapApi and every e2e test that builds an app from a testing module. */
export function configureApp<T extends INestApplication>(app: T): T {
  app.useLogger(app.get(Logger));
  // Nest flushes the bufferLogs buffer of an HTTP app only once listen() succeeded; flushing here
  // sends a failing listen (port in use) through pino instead of leaving it in the buffer.
  app.flushLogs();
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  return app;
}
