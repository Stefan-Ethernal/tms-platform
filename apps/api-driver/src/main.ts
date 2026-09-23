// Phase 1 slot: `import './instrument';` (Sentry) must stay the first import of this file.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = loadEnv(process.env);
  const app = await NestFactory.create(AppModule, {
    // Phase 1 slot: bufferLogs lets nestjs-pino take over via app.useLogger(app.get(Logger)).
    bufferLogs: true,
  });
  configureApp(app);
  await app.listen(env.PORT);
}

void bootstrap();
