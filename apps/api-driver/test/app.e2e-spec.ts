import { Test } from '@nestjs/testing';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '@tms/db/nest';
import { testDatabaseUrl } from '@tms/db/testing';
import { configureApp, loadEnv } from '@tms/nest-bootstrap';
import {
  AUDIT_APP,
  AuditService,
  ClsService,
  REQUEST_CONTEXT_KEY,
  type RequestContext,
} from '@tms/domain/shared';
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

/**
 * Test-only route on the real AppModule (CoreModule + SharedModule, exactly as bootstrapApi wires
 * it): writes an audit row outside a transaction and echoes the CLS request id, so a test can check
 * the response header, the CLS id and the audit row's context all agree for the same request.
 */
@Controller('probe')
class AuditProbeController {
  constructor(
    private readonly audit: AuditService,
    private readonly cls: ClsService,
  ) {}

  @Get('audit')
  async auditProbe(): Promise<{ clsId: string; contextId: string | undefined }> {
    await this.audit.record({ action: 'auth.invite.issued', outcome: 'SUCCESS' });
    return {
      clsId: this.cls.getId(),
      contextId: this.cls.get<RequestContext | undefined>(REQUEST_CONTEXT_KEY)?.requestId,
    };
  }
}

describe('api-driver skeleton (e2e)', () => {
  let app: INestApplication<App>;
  let sigtermListenersBefore: number;

  beforeAll(async () => {
    const env = loadEnv(envSchema, {
      DATABASE_URL: testDatabaseUrl(),
      LOG_LEVEL: 'silent',
      LOG_FILE_ENABLED: 'false',
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
      controllers: [ProbeController, AuditProbeController],
    }).compile();
    sigtermListenersBefore = process.listenerCount('SIGTERM');
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    // Prisma connects lazily; without this the /api/health test below would be the pool's first
    // ever query and would race a cold TCP+auth handshake against HEALTH_DB_TIMEOUT_MS (1000ms
    // default) instead of testing whether the endpoint reports a reachable database. Untimed here
    // on purpose: this is connection setup, not the bound the health check itself is meant to test.
    await app.get(PrismaService).$queryRaw`SELECT 1`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers an unknown /api route with a JSON 404, no stack trace and a request id', async () => {
    const res = await request(app.getHttpServer()).get('/api/does-not-exist').expect(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Cannot GET /api/does-not-exist',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js:\d+/);
    expect(res.headers['x-request-id']).toMatch(UUID);
    expect(res.headers['x-powered-by']).toBeUndefined();
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

  it('answers GET /api/health with 200, the service name and no-store', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.text).toBe('{"status":"ok","service":"api-driver"}');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('registers SharedModule with AUDIT_APP=DRIVER, not any other app', () => {
    expect(app.get(AUDIT_APP)).toBe('DRIVER');
  });

  it('agrees on the request id across the response header, CLS and the audit row it writes', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/probe/audit')
      .set('User-Agent', 'app-module-probe/api-driver')
      .expect(200);
    const requestId = res.headers['x-request-id'] as string;
    expect(requestId).toMatch(UUID);
    expect(res.body).toEqual({ clsId: requestId, contextId: requestId });
    const row = await app.get(PrismaService).auditLog.findFirst({
      where: { action: 'auth.invite.issued', userAgent: 'app-module-probe/api-driver' },
    });
    expect(row).toMatchObject({
      app: 'DRIVER',
      action: 'auth.invite.issued',
      outcome: 'SUCCESS',
      userAgent: 'app-module-probe/api-driver',
    });
  });
});
