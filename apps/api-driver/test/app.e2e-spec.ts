import { Test } from '@nestjs/testing';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { configureApp, loadEnv } from '@tms/nest-bootstrap';
import { AppModule, envSchema } from '../src/app.module';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Test-only route: the skeleton has none, so the /api prefix is otherwise unobservable. */
@Controller('probe')
class ProbeController {
  @Get()
  get(): { ok: true } {
    return { ok: true };
  }
}

describe('api-driver skeleton (e2e)', () => {
  let app: INestApplication<App>;
  let sigtermListenersBefore: number;

  beforeAll(async () => {
    const env = loadEnv(envSchema, { LOG_LEVEL: 'silent', LOG_FILE_ENABLED: 'false' });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
      controllers: [ProbeController],
    }).compile();
    sigtermListenersBefore = process.listenerCount('SIGTERM');
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers an unknown /api route with a JSON 404, no stack trace and a request id', async () => {
    const res = await request(app.getHttpServer()).get('/api/does-not-exist').expect(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Cannot GET /api/does-not-exist',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js:\d+/);
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('serves nothing outside the /api prefix', async () => {
    await request(app.getHttpServer()).get('/').expect(404);
  });

  it('mounts routes under /api only', async () => {
    await request(app.getHttpServer()).get('/api/probe').expect(200, { ok: true });
    await request(app.getHttpServer()).get('/probe').expect(404);
  });

  it('listens for SIGTERM so a container stops gracefully', () => {
    expect(process.listenerCount('SIGTERM')).toBe(sigtermListenersBefore + 1);
  });
});
