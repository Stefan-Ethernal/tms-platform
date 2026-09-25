import type { DynamicModule, INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { testDatabaseUrl } from '@tms/db/testing';
import { Clock, FixedClock, InMemoryMailSender, MailSender } from '@tms/domain/shared';
import { configureApp, loadEnv } from '@tms/nest-bootstrap';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { type Env, envSchema } from '../../src/env';

export const ORIGIN = 'http://localhost:5173';
export const TEST_NOW = new Date('2026-09-23T10:00:00Z');

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv(envSchema, {
    NODE_ENV: 'test',
    DATABASE_URL: testDatabaseUrl(),
    LOG_FILE_ENABLED: 'false',
    TRUST_PROXY: 'false',
    ADMIN_WEB_ORIGINS: ORIGIN,
    ...overrides,
  });
}

export interface AdminTestApp {
  app: INestApplication<App>;
  clock: FixedClock;
  mail: InMemoryMailSender;
  env: Env;
}

export async function createAdminTestApp(
  options: { env?: Record<string, string>; extraImports?: Array<Type | DynamicModule> } = {},
): Promise<AdminTestApp> {
  const env = testEnv(options.env);
  const clock = new FixedClock(TEST_NOW);
  const mail = new InMemoryMailSender();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env), ...(options.extraImports ?? [])],
  })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(MailSender)
    .useValue(mail)
    .compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({ logger: false });
  configureApp(app, env);
  await app.init();
  return { app, clock, mail, env };
}
