import { Controller, Get, HttpException, type INestApplication, Query } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types';
import { z } from 'zod';
import { CoreModule, configureApp, createEnvSchema, loadEnv, zodDto } from '../../src';
import { UNUSED_DATABASE_URL } from './support';

class BoomQuery extends zodDto(z.object({ token: z.string() })) {}

@Controller('boom')
class BoomController {
  /** The secret reaches the message at runtime, as request data would. */
  @Get()
  boom(@Query() query: BoomQuery): never {
    throw new Error(`boom token=${query.token}`);
  }

  @Get('teapot')
  teapot(): never {
    throw new HttpException("I'm a teapot", 418);
  }
}

/** api-admin's CoreModule plus one throwing controller; logs silenced, no log files. */
export async function createBoomApp(): Promise<INestApplication<App>> {
  const env = loadEnv(createEnvSchema({ defaultPort: 3001 }), {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    LOG_FILE_ENABLED: 'false',
    DATABASE_URL: UNUSED_DATABASE_URL,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [CoreModule.forRoot({ app: 'api-admin', env })],
    controllers: [BoomController],
  }).compile();
  const app = configureApp(moduleRef.createNestApplication<INestApplication<App>>());
  await app.init();
  return app;
}
