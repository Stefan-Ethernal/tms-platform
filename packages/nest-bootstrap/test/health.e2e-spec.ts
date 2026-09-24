import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import type { App } from 'supertest/types';
import { POSTGRES_TEST_IMAGE, startFaultProxy, type FaultProxy } from '@tms/db/testing';
import { LOG_DESTINATION } from '@tms/logger';
import { MemoryLogStream, type LogRecord } from '@tms/logger/testing';
import { CoreModule, configureApp, createEnvSchema, loadEnv } from '../src';
import { DEGRADED_LOG_MESSAGE } from '../src/health/health.service';

const TIMEOUT_MS = 1000;
const PASSWORD = 'health-secret-pw-7731'; // gitleaks:allow (test fixture, not a secret)
const envSchema = createEnvSchema({ defaultPort: 3001 });
const logs = new MemoryLogStream();

type HealthResult = {
  status: number;
  text: string;
  body: unknown;
  cacheControl?: string;
  elapsedMs: number;
};

async function health(app: INestApplication<App>): Promise<HealthResult> {
  const started = performance.now();
  const res = await request(app.getHttpServer()).get('/api/health');
  return {
    status: res.status,
    text: res.text,
    body: res.body as unknown,
    cacheControl: res.headers['cache-control'],
    elapsedMs: performance.now() - started,
  };
}

function expectDegraded(result: HealthResult): void {
  expect(result.status).toBe(503);
  expect(result.text).toBe('{"status":"degraded","service":"api-admin"}');
  expect(result.cacheControl).toBe('no-store');
}

const healthRequestLines = (records: LogRecord[]): LogRecord[] =>
  records.filter((r) =>
    ((r['req'] as { url?: string } | undefined)?.url ?? '').startsWith('/api/health'),
  );
const degradedWarning = (record: LogRecord): boolean =>
  record.level === 40 && record.msg === DEGRADED_LOG_MESSAGE;

describe('GET /api/health (e2e, dedicated Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let containerStopped = false;
  let proxy: FaultProxy;
  let primary: INestApplication<App>;
  const apps: INestApplication<App>[] = [];
  const proxies: FaultProxy[] = [];

  const urlThrough = (p: FaultProxy): string =>
    `postgresql://health:${PASSWORD}@127.0.0.1:${p.port}/health`;

  async function track(started: Promise<FaultProxy>): Promise<FaultProxy> {
    const p = await started;
    proxies.push(p);
    return p;
  }

  async function boot(databaseUrl: string): Promise<INestApplication<App>> {
    const env = loadEnv(envSchema, {
      DATABASE_URL: databaseUrl,
      HEALTH_DB_TIMEOUT_MS: String(TIMEOUT_MS),
      LOG_FILE_ENABLED: 'false',
      LOG_LEVEL: 'info',
    });
    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule.forRoot({ app: 'api-admin', env })],
    })
      .overrideProvider(LOG_DESTINATION)
      .useValue(logs)
      .compile();
    const app: INestApplication<App> = configureApp(
      moduleRef.createNestApplication({ bufferLogs: true }),
    );
    await app.init();
    apps.push(app);
    return app;
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_TEST_IMAGE)
      .withUsername('health')
      .withPassword(PASSWORD)
      .withDatabase('health')
      .start();
    proxy = await track(
      startFaultProxy({ upstream: { host: container.getHost(), port: container.getPort() } }),
    );
    primary = await boot(urlThrough(proxy));
  }, 120_000);

  afterAll(async () => {
    // Proxies first: dropping their sockets ends pending connects, so each pool drains at once.
    for (const p of proxies) await p.close();
    for (const app of apps) await app.close();
    if (!containerStopped) await container.stop();
  }, 60_000);

  it('answers 200 {"status":"ok","service":"api-admin"} with Cache-Control: no-store and writes no request line', async () => {
    const mark = logs.mark();
    const result = await health(primary);
    expect(result.status).toBe(200);
    expect(result.text).toBe('{"status":"ok","service":"api-admin"}');
    expect(result.cacheControl).toBe('no-store');
    await request(primary.getHttpServer()).get('/api/does-not-exist').expect(404);
    await logs.waitFor((r) => r.msg === 'request completed', { from: mark });
    expect(healthRequestLines(logs.since(mark))).toEqual([]);
  });

  it('answers 503 fast while the database refuses connections, warns once, then recovers', async () => {
    const mark = logs.mark();
    proxy.setMode('refuse');
    const down = await health(primary);
    expectDegraded(down);
    expect(down.elapsedMs).toBeLessThan(TIMEOUT_MS);
    const warning = await logs.waitFor(degradedWarning, { from: mark });
    expect(typeof warning['reason']).toBe('string');
    proxy.setMode('forward');
    const up = await health(primary);
    expect(up.status).toBe(200);
    expect(up.body).toEqual({ status: 'ok', service: 'api-admin' });
  });

  it('bounds a black-holed database by HEALTH_DB_TIMEOUT_MS', async () => {
    const hole = await track(startFaultProxy({ mode: 'blackhole' }));
    const app = await boot(urlThrough(hole));
    const mark = logs.mark();
    const result = await health(app);
    expectDegraded(result);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(TIMEOUT_MS - 50);
    expect(result.elapsedMs).toBeLessThan(TIMEOUT_MS + 500);
    expect(hole.accepted).toBeGreaterThanOrEqual(1);
    const warning = await logs.waitFor(degradedWarning, { from: mark });
    expect(warning['reason']).toBe(`database ping timed out after ${TIMEOUT_MS} ms`);
  });

  it('boots while the database is unreachable and recovers when it comes back', async () => {
    const gate = await track(
      startFaultProxy({
        upstream: { host: container.getHost(), port: container.getPort() },
        mode: 'refuse',
      }),
    );
    const app = await boot(urlThrough(gate));
    expectDegraded(await health(app));
    gate.setMode('forward');
    const up = await health(app);
    expect(up.status).toBe(200);
    expect(up.body).toEqual({ status: 'ok', service: 'api-admin' });
  });

  it('answers 503 within the budget after the database container stops', async () => {
    const app = await boot(container.getConnectionUri());
    expect((await health(app)).status).toBe(200);
    await container.stop();
    containerStopped = true;
    const result = await health(app);
    expectDegraded(result);
    expect(result.elapsedMs).toBeLessThan(TIMEOUT_MS + 500);
  }, 60_000);

  it('never logs the connection string or the password, and never an access line for /api/health', () => {
    const text = logs.text();
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toMatch(/postgres(ql)?:\/\//);
    expect(healthRequestLines(logs.records())).toEqual([]);
    expect(logs.records().filter(degradedWarning).length).toBeGreaterThanOrEqual(4);
  });
});
