import type { INestApplication } from '@nestjs/common';

/** Applies the settings shared by main.ts and the e2e tests. */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  return app;
}
