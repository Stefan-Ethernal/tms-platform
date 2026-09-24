import { Controller, Get, INestApplication, Module, Req } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createLoggerModule } from '@tms/logger';
import type { Request } from 'express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { parseTrustProxy } from '../src/http';
import { configureApp } from '../src';

@Controller('ip')
class IpController {
  @Get() ip(@Req() req: Request) {
    return { ip: req.ip, cookies: req.cookies as unknown };
  }
}
// configureApp installs the pino Logger (`app.get(Logger)`); one silent logger configuration for every
// app of this file (nestjs-pino keeps the first app's configuration per process).
@Module({
  imports: [
    createLoggerModule({
      app: 'api-admin',
      level: 'silent',
      file: { enabled: false, dir: 'logs', retentionDays: 1 },
    }),
  ],
  controllers: [IpController],
})
class IpModule {}

interface IpProbeBody {
  ip: string;
  cookies: Record<string, string>;
}

async function appWith(trustProxy: string): Promise<INestApplication<App>> {
  const ref = await Test.createTestingModule({ imports: [IpModule] }).compile();
  const app = ref.createNestApplication<INestApplication<App>>({ logger: false });
  configureApp(app, { TRUST_PROXY: trustProxy });
  await app.init();
  return app;
}

describe('trust proxy, cookies and security headers', () => {
  it.each([
    ['false', false],
    ['loopback', 'loopback'],
    ['loopback, uniquelocal', 'loopback, uniquelocal'],
    ['1', 1],
  ])('parses %s', (raw, parsed) => expect(parseTrustProxy(raw)).toEqual(parsed));

  it('honours X-Forwarded-For only from a trusted proxy', async () => {
    const trusted = await appWith('loopback');
    const res = await request(trusted.getHttpServer())
      .get('/api/ip')
      .set('X-Forwarded-For', '203.0.113.9')
      .expect(200);
    expect((res.body as IpProbeBody).ip).toBe('203.0.113.9');
    await trusted.close();

    const untrusted = await appWith('false');
    const res2 = await request(untrusted.getHttpServer())
      .get('/api/ip')
      .set('X-Forwarded-For', '203.0.113.9')
      .expect(200);
    expect((res2.body as IpProbeBody).ip).not.toBe('203.0.113.9');
    await untrusted.close();
  });

  it('parses cookies', async () => {
    const app = await appWith('false');
    const res = await request(app.getHttpServer())
      .get('/api/ip')
      .set('Cookie', 'a=1; b=2')
      .expect(200);
    expect((res.body as IpProbeBody).cookies).toEqual({ a: '1', b: '2' });
    await app.close();
  });

  it('sends helmet headers and hides X-Powered-By on handled and unmatched routes', async () => {
    const app = await appWith('false');
    for (const path of ['/api/ip', '/api/does-not-exist']) {
      const res = await request(app.getHttpServer()).get(path);
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    }
    await app.close();
  });
});
