import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PinoLogger } from '@tms/logger';
import { configureApp, createEnvSchema, loadEnv } from '../src';
import { TestAppModule } from './support/test-app.module';

describe('CoreModule.forRoot (file logging on, the default)', () => {
  const logDir = mkdtempSync(join(tmpdir(), 'nest-bootstrap-file-'));
  let app: INestApplication;

  beforeAll(async () => {
    const env = loadEnv(createEnvSchema({ defaultPort: 3001 }), {
      DATABASE_URL: 'postgresql://tms:tms@127.0.0.1:9/tms',
      LOG_LEVEL: 'silent',
      LOG_DIR: logDir,
    });
    const moduleRef = await Test.createTestingModule({
      imports: [TestAppModule.forRoot(env)],
    }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(logDir, { recursive: true, force: true });
  });

  it('opens LOG_DIR/<app> for the rolling files', () => {
    expect(existsSync(join(logDir, 'api-admin'))).toBe(true);
  });

  it('passes LOG_LEVEL=silent to the root logger', () => {
    expect(PinoLogger.root.level).toBe('silent');
  });
});
