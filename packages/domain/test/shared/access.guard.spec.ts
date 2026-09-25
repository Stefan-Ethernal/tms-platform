import { INestApplication, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { type ApiError } from '@tms/contracts';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AccessGuard, Clock, FixedClock, Principal, PrincipalResolver } from '../../src/shared';
import { ClassMarkedController, DomainErrorTestFilter, ProbeController } from './probe.fixture';

const NOW = new Date('2026-09-23T10:00:00Z');
let principal: Principal | null = null;
let resolveCalls = 0;

class FakeResolver extends PrincipalResolver {
  override resolve(): Promise<Principal | null> {
    resolveCalls += 1;
    return Promise.resolve(principal);
  }
}

@Module({
  controllers: [ProbeController, ClassMarkedController],
  providers: [
    { provide: APP_FILTER, useClass: DomainErrorTestFilter },
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: PrincipalResolver, useClass: FakeResolver },
    { provide: Clock, useValue: new FixedClock(NOW) },
  ],
})
class ProbeModule {}

const full = (codes: string[], mfaVerifiedAt: Date | null = NOW): Principal => ({
  userId: 'u1',
  sessionId: 's1',
  scope: 'FULL',
  permissions: new Set(codes) as Principal['permissions'],
  mfaVerifiedAt,
});

describe('AccessGuard', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [ProbeModule] }).compile()
    ).createNestApplication<INestApplication<App>>({ logger: false });
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => {
    principal = null;
    resolveCalls = 0;
  });
  const get = (path: string) => request(app.getHttpServer()).get(path);
  const codeOf = async (pending: request.Test) => ((await pending).body as ApiError).code;

  it('rejects a handler without a marker (fail-closed)', async () => {
    principal = full(['users:read']);
    expect(await codeOf(get('/p/none').expect(403))).toBe('ROUTE_NOT_DECLARED');
  });
  it('rejects a handler with two markers', async () => {
    expect(await codeOf(get('/p/two').expect(403))).toBe('ROUTE_NOT_DECLARED');
  });
  it('rejects @Public() combined with @RequireStepUp() instead of silently dropping step-up', async () => {
    expect(await codeOf(get('/p/public-stepup').expect(403))).toBe('ROUTE_NOT_DECLARED');
  });
  it('ignores class-level markers (method level only)', async () => {
    expect(await codeOf(get('/c').expect(403))).toBe('ROUTE_NOT_DECLARED');
  });
  it('lets public routes through without resolving a principal', async () => {
    await get('/p/public').expect(200, 'public');
    expect(resolveCalls).toBe(0);
  });
  it('401 without a principal', async () => {
    expect(await codeOf(get('/p/any').expect(401))).toBe('UNAUTHENTICATED');
  });
  it('401 when the session scope does not match', async () => {
    principal = { ...full([]), scope: 'PRE_MFA' };
    expect(await codeOf(get('/p/enrol').expect(401))).toBe('UNAUTHENTICATED');
    principal = { ...full([]), scope: 'ENROLLMENT' };
    await get('/p/enrol').expect(200, 'u1');
  });
  it('permission routes need a FULL session', async () => {
    principal = { ...full(['users:read', 'users:block']), scope: 'ENROLLMENT' };
    expect(await codeOf(get('/p/perm').expect(401))).toBe('UNAUTHENTICATED');
  });
  it('permissions are AND (D3)', async () => {
    principal = full(['users:read']);
    expect(await codeOf(get('/p/perm').expect(403))).toBe('FORBIDDEN');
    principal = full(['users:read', 'users:block']);
    await get('/p/perm').expect(200, 'perm');
  });
  it('step-up needs a TOTP confirmation within 10 minutes', async () => {
    principal = full(['users:block'], new Date(NOW.getTime() - 11 * 60_000));
    expect(await codeOf(get('/p/stepup').expect(403))).toBe('AUTH_STEP_UP_REQUIRED');
    principal = full(['users:block'], new Date(NOW.getTime() - 9 * 60_000));
    await get('/p/stepup').expect(200, 'stepup');
    principal = full(['users:block'], null);
    await get('/p/stepup').expect(403);
  });
});
