import { createServer } from 'node:net';
import type { Server } from 'node:http';
import request from 'supertest';
import { type BaseEnv, bootstrapApi, createEnvSchema } from '../src';
import { TestAppModule } from './support/test-app.module';

const envSchema = createEnvSchema({ defaultPort: 3001 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A port nobody listens on right now (PORT must be 1-65535, so 0 is not an option). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer().once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

describe('bootstrapApi', () => {
  const exitCodeBefore = process.exitCode;

  afterEach(() => {
    process.exitCode = exitCodeBefore;
  });

  it('reports an invalid environment in one stderr line, sets exit code 1 and builds nothing', async () => {
    const written: string[] = [];
    const module = jest.fn((env: BaseEnv) => TestAppModule.forRoot(env));

    const app = await bootstrapApi({
      name: 'api-admin',
      envSchema,
      module,
      source: {
        PORT: 'abc',
        NODE_ENV: 'staging',
        DATABASE_URL: 'postgresql://tms:tms@127.0.0.1:9/tms',
      },
      stderr: { write: (message: string) => written.push(message) },
    });

    expect(app).toBeUndefined();
    expect(written).toEqual([
      'api-admin: Invalid environment: NODE_ENV: Invalid option: expected one of "development"|"test"|"production"; PORT: Invalid input: expected number, received NaN\n',
    ]);
    expect(process.exitCode).toBe(1);
    expect(module).not.toHaveBeenCalled();
  });

  it('builds the module from the parsed environment, applies configureApp and listens on PORT at the development host', async () => {
    const port = await freePort();
    const module = jest.fn((env: BaseEnv) => TestAppModule.forRoot(env));

    const app = await bootstrapApi({
      name: 'api-admin',
      envSchema,
      module,
      source: {
        PORT: String(port),
        LOG_LEVEL: 'silent',
        LOG_FILE_ENABLED: 'false',
        DATABASE_URL: 'postgresql://tms:tms@127.0.0.1:9/tms',
      },
    });
    try {
      expect(module).toHaveBeenCalledWith({
        NODE_ENV: 'development',
        LOG_LEVEL: 'silent',
        LOG_FILE_ENABLED: false,
        LOG_DIR: 'logs',
        LOG_RETENTION_DAYS: 14,
        DATABASE_URL: 'postgresql://tms:tms@127.0.0.1:9/tms',
        HEALTH_DB_TIMEOUT_MS: 1000,
        PORT: port,
        TRUST_PROXY: 'loopback',
      });
      // NODE_ENV defaults to development, so listenHost() binds the loopback interface only.
      const httpServer = app?.getHttpServer() as Server | undefined;
      expect(httpServer?.address()).toMatchObject({ address: '127.0.0.1', port });
      const res = await request(`http://127.0.0.1:${port}`).get('/api/does-not-exist').expect(404);
      expect(res.body).toEqual({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Cannot GET /api/does-not-exist',
      });
      expect(res.headers['x-request-id']).toMatch(UUID);
      await request(`http://127.0.0.1:${port}`).get('/').expect(404);
    } finally {
      await app?.close();
    }
    expect(process.exitCode).toBe(exitCodeBefore);
  });
});
