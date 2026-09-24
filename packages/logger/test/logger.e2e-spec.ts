import { Controller, Get, Query, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  InjectPinoLogger,
  LOG_DESTINATION,
  Logger,
  PinoLogger,
  createLoggerModule,
  type LoggerOptions,
} from '../src';
import { MemoryLogStream, type LogRecord } from '../src/testing';

const SECRETS = {
  bearer: 'bearer-secret-7f3a',
  cookie: 'cookie-secret-9b1c',
  deviceKey: 'device-key-secret-2d4e',
  password: 'password-secret-5a6b',
  pin: 'pin-secret-481516',
  queryToken: 'query-token-secret-2342',
  nestedAuth: 'nested-auth-secret-8c9d',
  assigned: 'assigned-token-secret-1e2f',
  thrown: 'thrown-token-secret-6c7d',
} as const;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

@Controller()
class ProbeController {
  constructor(@InjectPinoLogger(ProbeController.name) private readonly logger: PinoLogger) {}

  @Get('probe')
  probe(): { ok: true } {
    this.logger.info(
      {
        user: { password: SECRETS.password },
        items: [{ pin: SECRETS.pin }],
        err: { config: { headers: { authorization: `Bearer ${SECRETS.nestedAuth}` } } },
      },
      `probe ?token=${SECRETS.queryToken}`,
    );
    return { ok: true };
  }

  @Get('assign')
  assign(): { ok: true } {
    this.logger.assign({ token: SECRETS.assigned });
    this.logger.info('after assign');
    return { ok: true };
  }

  @Get('echo')
  echo(@Query('n') n: string): { n: string } {
    this.logger.info({ n }, 'echo');
    return { n };
  }

  @Get('boom')
  boom(): never {
    throw new Error(`boom token=${SECRETS.thrown}`);
  }
}

type LoggedRequest = { id?: string; url?: string; headers?: Record<string, string> };
const reqOf = (record: LogRecord): LoggedRequest =>
  (record['req'] as LoggedRequest | undefined) ?? {};
const completed =
  (url: string) =>
  (record: LogRecord): boolean =>
    record.msg === 'request completed' && reqOf(record).url === url;
// pino-http logs "request errored" instead of "request completed" once res.statusCode >= 500.
const finished =
  (url: string) =>
  (record: LogRecord): boolean =>
    (record.msg === 'request completed' || record.msg === 'request errored') &&
    reqOf(record).url === url;
const logs = new MemoryLogStream();
const echoLine = (n: string): LogRecord | undefined =>
  logs.records().find((r) => r.msg === 'echo' && r['n'] === n);

describe('createLoggerModule in a Nest app (e2e)', () => {
  const options: LoggerOptions = {
    app: 'api-admin',
    level: 'info',
    file: { enabled: false, dir: 'unused', retentionDays: 1 },
  };
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [createLoggerModule(options)],
      controllers: [ProbeController],
    })
      .overrideProvider(LOG_DESTINATION)
      .useValue(logs)
      .compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    app.useLogger(app.get(Logger));
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps every secret out of the stream and marks where each one was', async () => {
    await request(app.getHttpServer())
      .get(`/api/probe?token=${SECRETS.queryToken}`)
      .set('Authorization', `Bearer ${SECRETS.bearer}`)
      .set('Cookie', `sid=${SECRETS.cookie}`)
      .set('X-Device-Key', SECRETS.deviceKey)
      .expect(200);
    await request(app.getHttpServer()).get('/api/assign').expect(200);
    const probeDone = await logs.waitFor(completed('/api/probe?token=[REDACTED]'));
    await logs.waitFor(completed('/api/assign'));

    expect(reqOf(probeDone).headers).toMatchObject({
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      'x-device-key': '[REDACTED]',
    });
    expect(logs.records().find((r) => r.msg === 'probe ?token=[REDACTED]')).toMatchObject({
      user: { password: '[REDACTED]' },
      items: [{ pin: '[REDACTED]' }],
      err: { config: { headers: { authorization: '[REDACTED]' } } },
    });
    expect(logs.records().find((r) => r.msg === 'after assign')).toMatchObject({
      token: '[REDACTED]',
    });
    const text = logs.text();
    for (const secret of Object.values(SECRETS)) expect(text).not.toContain(secret);
    expect(logs.records().every((r) => r['app'] === 'api-admin')).toBe(true);
  });

  it('echoes a well-formed X-Request-Id and logs it as req.id and reqId', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/echo?n=id-1')
      .set('X-Request-Id', 'my-id-1')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('my-id-1');
    const done = await logs.waitFor(completed('/api/echo?n=id-1'));
    expect(reqOf(done).id).toBe('my-id-1');
    expect(done['reqId']).toBe('my-id-1');
    expect(echoLine('id-1')?.['reqId']).toBe('my-id-1');
  });

  it.each([
    ['long', 'x'.repeat(200)],
    ['spaces', 'bad id with spaces'],
    ['absent', undefined],
  ])(
    'mints a UUID when the caller id is %s and uses it in response and log',
    async (label, header) => {
      const url = `/api/echo?n=${label}`;
      let call = request(app.getHttpServer()).get(url);
      if (header !== undefined) call = call.set('X-Request-Id', header);
      const res = await call.expect(200);
      const id = res.headers['x-request-id'] as string;
      expect(id).toMatch(UUID_V4);
      expect(reqOf(await logs.waitFor(completed(url))).id).toBe(id);
    },
  );

  it('keeps 50 concurrent requests apart: header, req.id and reqId agree per request', async () => {
    const responses = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        request(app.getHttpServer()).get(`/api/echo?n=c${i}`).set('X-Request-Id', `conc-${i}`),
      ),
    );
    for (const [i, res] of responses.entries()) {
      expect(res.status).toBe(200);
      expect(res.headers['x-request-id']).toBe(`conc-${i}`);
      expect(res.body).toEqual({ n: `c${i}` });
      expect(reqOf(await logs.waitFor(completed(`/api/echo?n=c${i}`))).id).toBe(`conc-${i}`);
      expect(echoLine(`c${i}`)?.['reqId']).toBe(`conc-${i}`);
    }
  });

  it('does not auto-log GET /api/health', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(404);
    await request(app.getHttpServer()).get('/api/echo?n=after-health').expect(200);
    await logs.waitFor(completed('/api/echo?n=after-health'));
    expect(logs.records().filter((r) => (reqOf(r).url ?? '').startsWith('/api/health'))).toEqual(
      [],
    );
  });

  it("scrubs the message Nest's exception handler logs for an unhandled error", async () => {
    await request(app.getHttpServer()).get('/api/boom').expect(500);
    // Nest 12 calls logger.error(exception); pino copies err.message into msg after the hooks.
    const line = await logs.waitFor((r) => r['context'] === 'ExceptionsHandler');
    expect(line.msg).toContain('token=[REDACTED]');
    expect(line.msg).not.toContain(SECRETS.thrown);
    await logs.waitFor(finished('/api/boom'));
    expect(logs.text()).not.toContain(SECRETS.thrown);
  });

  it("routes Nest's own lines through the same logger", () => {
    const mapped = logs.records().filter((r) => r['context'] === 'RouterExplorer');
    expect(mapped.map((r) => r.msg)).toEqual(
      expect.arrayContaining(['Mapped {/api/probe, GET} route', 'Mapped {/api/echo, GET} route']),
    );
  });
});
