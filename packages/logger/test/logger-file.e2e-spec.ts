import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { InjectPinoLogger, Logger, PinoLogger, createLoggerModule } from '../src';

const SECRET = 'file-e2e-secret-2718';

@Controller()
class FileProbeController {
  constructor(@InjectPinoLogger(FileProbeController.name) private readonly logger: PinoLogger) {}

  @Get('file-probe')
  probe(): { ok: true } {
    this.logger.warn({ authorization: `Bearer ${SECRET}` }, 'file probe');
    return { ok: true };
  }
}

describe('file logging inside a Nest app (e2e)', () => {
  it('writes LOG_DIR/<app>/<app>.<date>.1.log and LoggerShutdown flushes it on app.close()', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tms-logger-nest-'));
    const moduleRef = await Test.createTestingModule({
      imports: [
        createLoggerModule({
          app: 'api-driver',
          level: 'warn',
          file: { enabled: true, dir, retentionDays: 3 },
        }),
      ],
      controllers: [FileProbeController],
    }).compile();
    const app: INestApplication<App> = moduleRef.createNestApplication({ bufferLogs: true });
    app.useLogger(app.get(Logger));
    app.setGlobalPrefix('api');
    await app.init();
    await request(app.getHttpServer()).get('/api/file-probe').expect(200);
    await app.close();

    const appDir = path.join(dir, 'api-driver');
    const files = readdirSync(appDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^api-driver\.\d{4}-\d{2}-\d{2}\.1\.log$/);
    const content = readFileSync(path.join(appDir, files[0] ?? ''), 'utf8');
    expect(content).toContain('"msg":"file probe"');
    expect(content).toContain('"app":"api-driver"');
    expect(content).toContain('"authorization":"[REDACTED]"');
    expect(content).not.toContain(SECRET);
  });
});
