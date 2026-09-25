import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { testDatabaseUrl } from '@tms/db/testing';
import { scanRouteAccess } from '@tms/domain/shared';
import { configureApp, loadEnv } from '@tms/nest-bootstrap';
import { AppModule, envSchema } from '../src/app.module';

describe('api-driver route access (fail-closed)', () => {
  it('every route carries exactly one marker, none at class level, and matches the reviewed list', async () => {
    const env = loadEnv(envSchema, {
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl(),
      LOG_FILE_ENABLED: 'false',
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env), DiscoveryModule],
    }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    configureApp(app, env);
    await app.init();

    const entries = scanRouteAccess(app);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect({ route: `${e.method} ${e.path}`, access: e.access.kind }).not.toMatchObject({
        access: 'invalid',
      });
      expect(e.classMarkers).toEqual([]);
    }
    const actual = entries
      .map((e) => ({ route: `${e.method} ${e.path}`, access: e.access }))
      .sort((a, b) => a.route.localeCompare(b.route));
    expect(actual).toEqual([
      { route: 'GET /api/health', access: { kind: 'public', stepUp: false } },
    ]);

    await app.close();
  });
});
