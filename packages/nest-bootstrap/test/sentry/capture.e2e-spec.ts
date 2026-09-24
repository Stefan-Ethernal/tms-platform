// Sentry is initialised before Nest is loaded, exactly as `instrument.ts` does in the apps.
import * as Sentry from '@sentry/nestjs';
import { buildSentryOptions } from '../../src/sentry';
import { type Envelope, capturedEvents, recordingTransport } from './support';

const captured: Envelope[] = [];
Sentry.init({
  ...buildSentryOptions({
    app: 'api-admin',
    env: { SENTRY_DSN: 'https://public@localhost:9/1', NODE_ENV: 'test' },
  }),
  transport: recordingTransport(captured),
});

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createBoomApp } from './boom-app';

describe('Sentry capture through ApiExceptionFilter (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createBoomApp();
  });

  afterAll(async () => {
    await app.close();
    await Sentry.close(2000);
  });

  it('reports a thrown Error once, scrubbed, and answers the standard 500', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/boom?token=abc123&pin=pin-secret-5')
      .set('Authorization', 'Bearer hdr-secret-1')
      .set('X-Device-Key', 'dev-secret-2')
      .set('Cookie', 'sid=ck-secret-3')
      .set('X-Note', 'password=pw-secret-4')
      .expect(500);
    expect(res.body).toEqual({
      statusCode: 500,
      code: 'INTERNAL',
      message: 'Internal server error',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.[jt]s:\d+/);

    expect(await Sentry.flush(2000)).toBe(true);
    const events = capturedEvents(captured);
    expect(events).toHaveLength(1);
    const [event] = events;
    const serialized = JSON.stringify(captured);
    expect(serialized).toContain('boom');
    const secrets = [
      'abc123',
      'hdr-secret-1',
      'dev-secret-2',
      'ck-secret-3',
      'pw-secret-4',
      'pin-secret-5',
    ];
    for (const secret of secrets) expect(serialized).not.toContain(secret);
    expect(event?.exception?.values?.[0]?.value).toBe('boom token=[REDACTED]');
    expect(event?.exception?.values?.[0]?.mechanism).toEqual({
      type: 'auto.http.nestjs.global_filter',
      handled: false,
    });
    expect(event?.request?.headers?.['authorization']).toBe('[REDACTED]');
    expect(event?.request?.headers?.['x-device-key']).toBe('[REDACTED]');
    expect(event?.request?.headers?.['x-note']).toBe('password=[REDACTED]');
    expect(event?.request?.url).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/api\/boom\?token=\[REDACTED\]&pin=\[REDACTED\]$/,
    );
    expect(event?.request?.query_string).toBe('token=[REDACTED]&pin=[REDACTED]');
    expect(event?.request?.cookies).toBeUndefined();
    expect(event?.user).toBeUndefined();
    expect(event?.environment).toBe('test');
  });

  it('does not report HttpExceptions', async () => {
    const before = capturedEvents(captured).length;
    await request(app.getHttpServer()).get('/api/boom/teapot').expect(418);
    await Sentry.flush(2000);
    expect(capturedEvents(captured)).toHaveLength(before);
  });

  it('keeps the JSON 404 body of unknown routes', async () => {
    const res = await request(app.getHttpServer()).get('/api/does-not-exist').expect(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Cannot GET /api/does-not-exist',
    });
  });
});
