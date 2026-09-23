import { Test } from '@nestjs/testing';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app';

/** Test-only route: the skeleton has none, so the /api prefix is otherwise unobservable. */
@Controller('probe')
class ProbeController {
  @Get()
  get(): { ok: true } {
    return { ok: true };
  }
}

describe('api-admin skeleton (e2e)', () => {
  let app: INestApplication<App>;
  let sigtermListenersBefore: number;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();
    sigtermListenersBefore = process.listenerCount('SIGTERM');
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers an unknown /api route with a JSON 404 and no stack trace', async () => {
    const res = await request(app.getHttpServer()).get('/api/does-not-exist').expect(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Cannot GET /api/does-not-exist',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js:\d+/);
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
