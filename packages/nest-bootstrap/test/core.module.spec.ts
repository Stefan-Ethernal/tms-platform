// nestjs-pino 5.2 builds one pino-http instance per process and the first app wins (its
// rootLogger singleton has no public reset), so every spec file starts exactly one app with one
// logger configuration. File logging on: core.module.file.spec.ts.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LOG_DESTINATION, Logger, PinoLogger } from '@tms/logger';
import { MemoryLogStream, type LogRecord } from '@tms/logger/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { configureApp, createEnvSchema, loadEnv } from '../src';
import { TestAppModule } from './support/test-app.module';

const reqId = (record: LogRecord): string | undefined =>
  (record['req'] as { id?: string } | undefined)?.id;

describe('CoreModule.forRoot (file logging off)', () => {
  // pino-http writes "request completed" on the response's finish event, which can fire after
  // supertest has already resolved: MemoryLogStream.waitFor polls instead of reading once.
  const logs = new MemoryLogStream();
  const logDir = mkdtempSync(join(tmpdir(), 'nest-bootstrap-'));
  let app: INestApplication<App>;

  beforeAll(async () => {
    // debug, not the default info: proves LOG_LEVEL travels from the environment to pino.
    const env = loadEnv(createEnvSchema({ defaultPort: 3001 }), {
      LOG_LEVEL: 'debug',
      LOG_FILE_ENABLED: 'false',
      LOG_DIR: logDir,
    });
    const moduleRef = await Test.createTestingModule({ imports: [TestAppModule.forRoot(env)] })
      .overrideProvider(LOG_DESTINATION)
      .useValue(logs)
      .compile();
    app = configureApp(moduleRef.createNestApplication<INestApplication<App>>());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(logDir, { recursive: true, force: true });
  });

  it('provides the pino Logger that configureApp installs', () => {
    expect(app.get(Logger)).toBeInstanceOf(Logger);
  });

  it('passes LOG_LEVEL to the root logger', () => {
    expect(PinoLogger.root.level).toBe('debug');
  });

  it('logs each request with the id the response echoes', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/does-not-exist')
      .set('X-Request-Id', 'core-spec-1')
      .expect(404);
    expect(res.headers['x-request-id']).toBe('core-spec-1');
    const line = await logs.waitFor((record) => reqId(record) === 'core-spec-1');
    expect(line['res']).toEqual({ statusCode: 404 });
  });

  it('creates no log directory when LOG_FILE_ENABLED=false', () => {
    expect(existsSync(join(logDir, 'api-admin'))).toBe(false);
  });
});
