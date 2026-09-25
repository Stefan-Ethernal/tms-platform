import type { INestApplication } from '@nestjs/common';
import { Logger } from '@tms/logger';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import helmet from 'helmet';
import type { BaseEnv } from './env';
import { noStoreMiddleware } from './http/no-store.middleware';
import { parseTrustProxy } from './http/trust-proxy';

/** Settings shared by bootstrapApi and every e2e test that builds an app from a testing module. */
export function configureApp<T extends INestApplication>(
  app: T,
  env: Pick<BaseEnv, 'TRUST_PROXY'> = { TRUST_PROXY: 'loopback' },
): T {
  const express = app.getHttpAdapter().getInstance() as Express;
  express.set('trust proxy', parseTrustProxy(env.TRUST_PROXY));
  app.use(helmet());
  app.use(cookieParser());
  app.use(noStoreMiddleware);
  app.useLogger(app.get(Logger));
  // Nest flushes the bufferLogs buffer of an HTTP app only once listen() succeeded; flushing here
  // sends a failing listen (port in use) through pino instead of leaving it in the buffer.
  app.flushLogs();
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  return app;
}
