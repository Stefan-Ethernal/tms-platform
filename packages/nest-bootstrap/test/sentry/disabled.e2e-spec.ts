// Same order as instrument.ts: initSentry runs before Nest is loaded, here with an empty DSN.
import * as Sentry from '@sentry/nestjs';
import { buildSentryOptions, initSentry } from '../../src/sentry';
import { type Envelope, recordingTransport } from './support';

const captured: Envelope[] = [];
const listenersBefore = {
  uncaughtException: process.listenerCount('uncaughtException'),
  unhandledRejection: process.listenerCount('unhandledRejection'),
};
initSentry({
  ...buildSentryOptions({ app: 'api-admin', env: { SENTRY_DSN: '', NODE_ENV: 'test' } }),
  transport: recordingTransport(captured),
});

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createBoomApp } from './boom-app';

describe('Sentry without a DSN (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createBoomApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('initialises nothing: no client and no process listeners', () => {
    expect(Sentry.getClient()).toBeUndefined();
    expect({
      uncaughtException: process.listenerCount('uncaughtException'),
      unhandledRejection: process.listenerCount('unhandledRejection'),
    }).toEqual(listenersBefore);
  });

  it('still answers the standard 500 and never calls the transport', async () => {
    const res = await request(app.getHttpServer()).get('/api/boom?token=abc123').expect(500);
    expect(res.body).toEqual({
      statusCode: 500,
      code: 'INTERNAL',
      message: 'Internal server error',
    });
    await Sentry.flush(500);
    expect(captured).toHaveLength(0);
  });
});
