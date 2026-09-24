# Phase 2 — Task 10: Route access markers, `AccessGuard` and `OriginGuard`

> Part of the phase 2 plan: read [index.md](index.md) (constraints, shared interfaces, env) and this file only.


**Files:**
- Create: `packages/domain/src/shared/access/markers.ts`, `packages/domain/src/shared/access/principal.ts`, `packages/domain/src/shared/access/access.guard.ts`, `packages/domain/src/shared/access/route-scan.ts`, `packages/domain/src/shared/access/index.ts`
- Modify: `packages/domain/src/shared/index.ts`, `packages/domain/package.json` (`@tms/auth-core` dependency for `isStepUpFresh`, `@types/express` devDependency), `pnpm-lock.yaml`, `packages/domain/test/shared/exports.spec.ts` (phase 1 Task 14: the pinned `./shared` names gain the access exports)
- Create: `packages/nest-bootstrap/src/http/origin.guard.ts`; Modify: `packages/nest-bootstrap/src/http/index.ts`
- Create: `apps/api-admin/src/env.ts` (moves phase 1's `envSchema`/`Env` out of `app.module.ts`, names kept); Modify: `apps/api-admin/src/app.module.ts`, `apps/api-admin/src/main.ts`, `apps/api-driver/src/app.module.ts`, `apps/api-admin/.env.example`, `infra/docker-compose.yml`
- Modify (phase 1 app tests): `apps/api-admin/test/env.spec.ts` (import path, `ADMIN_WEB_ORIGINS` default), `apps/api-admin/test/app.e2e-spec.ts` (import path, `@Public()` on its probe route), `apps/api-driver/test/app.e2e-spec.ts` (`@Public()` on its probe route)
- Create: `packages/domain/test/shared/probe.fixture.ts`, `packages/domain/test/shared/access.guard.spec.ts`, `packages/domain/test/shared/route-scan.spec.ts`, `packages/nest-bootstrap/test/origin.guard.spec.ts`, `apps/api-admin/test/support/app.ts`, `apps/api-admin/test/route-access.e2e-spec.ts`, `apps/api-admin/test/route-access.snapshot.json`, `apps/api-driver/test/route-access.e2e-spec.ts`
- Create: `docs/adr/0003-origin-csrf-and-session-cookies.md`, `docs/adr/0010-route-access-markers.md`; Modify: `docs/adr/README.md`, `CLAUDE.md`, `docs/efficiency/critical-path.md` (strike input A-8)

**Interfaces:**
- Consumes: `PUBLIC_ROUTE_KEY`, `SESSION_SCOPES_KEY`, `REQUIRED_PERMISSIONS_KEY`, `STEP_UP_KEY`, `AUTH_THROTTLE_KEY`, `DomainError`, `isDomainError`, `API_ERROR_CODES`, `PermissionCode`, `SessionScope` (type) (Task 08); `Clock`, `FixedClock` and the pinned export list of `packages/domain/test/shared/exports.spec.ts` (phase 1 Task 14); `isStepUpFresh` (Task 06, `@tms/auth-core`; phase 1's boundaries policy already allows `domain → auth-core`, only the manifest dependency is new); `ApiExceptionFilter`, `configureApp`, `loadEnv`, `createEnvSchema` (Task 09 / phase 1, apps only); phase 1's `envSchema`/`Env` of api-admin.
- Produces:
  - `Public()`, `RequireSession(...scopes: [SessionScope | 'ANY', ...])`, `RequirePermissions(...codes: [PermissionCode, ...])`, `RequireStepUp()`, `AuthThrottle()`, `SkipSessionTouch()` (key `SKIP_SESSION_TOUCH_KEY = 'tms:skip-session-touch'`, domain-internal: not exported from `@tms/domain/shared`), `readRouteAccess(reflector, handler): RouteAccess`.
  - `interface Principal { userId: string; sessionId: string; scope: SessionScope; permissions: ReadonlySet<PermissionCode>; mfaVerifiedAt: Date | null }`; `abstract class PrincipalResolver { abstract resolve(req: Request, res: Response, options: { touch: boolean }): Promise<Principal | null> }`; `DenyAllPrincipalResolver`; `CurrentPrincipal()` param decorator; `PRINCIPAL_REQUEST_KEY = 'tmsPrincipal'`.
  - `AccessGuard` (fail-closed: exactly one marker per handler).
  - `scanRouteAccess(app: INestApplication, globalPrefix = 'api'): RouteAccessEntry[]` with `RouteAccessEntry = { controller: string; handler: string; method: string; path: string; access: RouteAccess; classMarkers: string[] }`.
  - `OriginGuard` + token `ORIGIN_ALLOWLIST` (`readonly string[]`).
  - api-admin `AppModule` providers in this order: `APP_GUARD OriginGuard`, `APP_GUARD AccessGuard`, `PrincipalResolver → DenyAllPrincipalResolver` (Task 11 swaps in `StaffSessionResolver`; Task 16 inserts `ThrottlerGuard` between the two guards).
  - `apps/api-admin/src/env.ts`: `envSchema` (phase 1's name) = `createEnvSchema({ defaultPort: 3001 }).extend({ ADMIN_WEB_ORIGINS })`, `type Env`; every later api-admin variable is added here and to the `toEqual` of `apps/api-admin/test/env.spec.ts`.
  - `apps/api-admin/test/support/app.ts`: `ORIGIN`, `TEST_NOW`, `testEnv(overrides)`, `createAdminTestApp({ env?, extraImports? }): Promise<AdminTestApp>` with `AdminTestApp = { app, clock, mail, env }`.

- [ ] **Step 1: Write the failing tests**

`packages/nest-bootstrap/test/origin.guard.spec.ts`:

```ts
import type { ExecutionContext } from '@nestjs/common';
import { OriginGuard } from '../src/http';

function ctx(method: string, headers: Record<string, string>): ExecutionContext {
  const req = { method, headers };
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe('OriginGuard (D11)', () => {
  const guard = new OriginGuard(['http://localhost:5173', 'http://localhost:8080']);

  it.each(['GET', 'HEAD', 'OPTIONS'])('lets safe method %s through without headers', (m) => {
    expect(guard.canActivate(ctx(m, {}))).toBe(true);
  });

  it.each([
    ['allowed Origin', { origin: 'http://localhost:5173' }, true],
    ['second allowed Origin', { origin: 'http://localhost:8080' }, true],
    ['same-origin fetch metadata without Origin', { 'sec-fetch-site': 'same-origin' }, true],
    ['foreign Origin', { origin: 'https://evil.example' }, false],
    ['Origin null', { origin: 'null' }, false],
    ['allowed prefix trick', { origin: 'http://localhost:5173.evil.example' }, false],
    ['same-site fetch metadata', { 'sec-fetch-site': 'same-site' }, false],
    ['none fetch metadata', { 'sec-fetch-site': 'none' }, false],
    ['no headers at all', {}, false],
    ['foreign Origin wins over same-origin metadata', { origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' }, false],
  ])('POST with %s', (_name, headers, allowed) => {
    if (allowed) expect(guard.canActivate(ctx('POST', headers))).toBe(true);
    else expect(() => guard.canActivate(ctx('POST', headers))).toThrow(expect.objectContaining({ code: 'ORIGIN_REJECTED' }));
  });

  it.each(['PUT', 'PATCH', 'DELETE'])('guards %s like POST', (m) => {
    expect(() => guard.canActivate(ctx(m, {}))).toThrow(expect.objectContaining({ code: 'ORIGIN_REJECTED' }));
  });
});
```

`packages/domain/test/shared/probe.fixture.ts` (shared by the guard and the scan spec; `packages/domain` must not import `@tms/nest-bootstrap`, so a ten-line local filter stands in for `ApiExceptionFilter`):

```ts
import { type ArgumentsHost, Catch, Controller, type ExceptionFilter, Get, SetMetadata } from '@nestjs/common';
import { API_ERROR_CODES, isDomainError, PUBLIC_ROUTE_KEY } from '@tms/contracts';
import type { Response } from 'express';
import {
  CurrentPrincipal, type Principal, Public, RequirePermissions, RequireSession, RequireStepUp,
} from '../../src/shared';

@Controller('p')
export class ProbeController {
  @Get('none') none() { return 'none'; }
  @Public() @RequireSession('FULL') @Get('two') two() { return 'two'; }
  @Public() @Get('public') pub() { return 'public'; }
  @RequireSession('ENROLLMENT') @Get('enrol') enrol(@CurrentPrincipal() p: Principal) { return p.userId; }
  @RequireSession('ANY') @Get('any') any() { return 'any'; }
  @RequirePermissions('users:read', 'users:block') @Get('perm') perm() { return 'perm'; }
  @RequirePermissions('users:block') @RequireStepUp() @Get('stepup') stepUp() { return 'stepup'; }
}

@SetMetadata(PUBLIC_ROUTE_KEY, true)
@Controller('c')
export class ClassMarkedController { @Get() x() { return 'x'; } }

/** Test-only: DomainError → `{ statusCode, code, message }`, anything else → 500. */
@Catch()
export class DomainErrorTestFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (!isDomainError(exception)) {
      res.status(500).json({ statusCode: 500, code: 'INTERNAL', message: 'Internal server error' });
      return;
    }
    const statusCode = API_ERROR_CODES[exception.code];
    res.status(statusCode).json({ statusCode, code: exception.code, message: exception.message });
  }
}
```

`packages/domain/test/shared/access.guard.spec.ts`:

```ts
import { INestApplication, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AccessGuard, Clock, FixedClock, Principal, PrincipalResolver } from '../../src/shared';
import { ClassMarkedController, DomainErrorTestFilter, ProbeController } from './probe.fixture';

const NOW = new Date('2026-09-23T10:00:00Z');
let principal: Principal | null = null;
let resolveCalls = 0;

class FakeResolver extends PrincipalResolver {
  override async resolve(): Promise<Principal | null> { resolveCalls += 1; return principal; }
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
  userId: 'u1', sessionId: 's1', scope: 'FULL', permissions: new Set(codes) as Principal['permissions'], mfaVerifiedAt,
});

describe('AccessGuard', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [ProbeModule] }).compile()).createNestApplication({ logger: false });
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => { principal = null; resolveCalls = 0; });
  const get = (path: string) => request(app.getHttpServer()).get(path);

  it('rejects a handler without a marker (fail-closed)', async () => {
    principal = full(['users:read']);
    expect((await get('/p/none').expect(403)).body.code).toBe('ROUTE_NOT_DECLARED');
  });
  it('rejects a handler with two markers', async () => {
    expect((await get('/p/two').expect(403)).body.code).toBe('ROUTE_NOT_DECLARED');
  });
  it('ignores class-level markers (method level only)', async () => {
    expect((await get('/c').expect(403)).body.code).toBe('ROUTE_NOT_DECLARED');
  });
  it('lets public routes through without resolving a principal', async () => {
    await get('/p/public').expect(200, 'public');
    expect(resolveCalls).toBe(0);
  });
  it('401 without a principal', async () => {
    expect((await get('/p/any').expect(401)).body.code).toBe('UNAUTHENTICATED');
  });
  it('401 when the session scope does not match', async () => {
    principal = { ...full([]), scope: 'PRE_MFA' };
    expect((await get('/p/enrol').expect(401)).body.code).toBe('UNAUTHENTICATED');
    principal = { ...full([]), scope: 'ENROLLMENT' };
    await get('/p/enrol').expect(200, 'u1');
  });
  it('permission routes need a FULL session', async () => {
    principal = { ...full(['users:read', 'users:block']), scope: 'ENROLLMENT' };
    expect((await get('/p/perm').expect(401)).body.code).toBe('UNAUTHENTICATED');
  });
  it('permissions are AND (D3)', async () => {
    principal = full(['users:read']);
    expect((await get('/p/perm').expect(403)).body.code).toBe('FORBIDDEN');
    principal = full(['users:read', 'users:block']);
    await get('/p/perm').expect(200, 'perm');
  });
  it('step-up needs a TOTP confirmation within 10 minutes', async () => {
    principal = full(['users:block'], new Date(NOW.getTime() - 11 * 60_000));
    expect((await get('/p/stepup').expect(403)).body.code).toBe('AUTH_STEP_UP_REQUIRED');
    principal = full(['users:block'], new Date(NOW.getTime() - 9 * 60_000));
    await get('/p/stepup').expect(200, 'stepup');
    principal = full(['users:block'], null);
    await get('/p/stepup').expect(403);
  });
});
```

`packages/domain/test/shared/route-scan.spec.ts` (the probe app has no global prefix, hence `scanRouteAccess(app, '')`):

```ts
import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { scanRouteAccess } from '../../src/shared';
import { ClassMarkedController, ProbeController } from './probe.fixture';

@Module({ imports: [DiscoveryModule], controllers: [ProbeController, ClassMarkedController] })
class ScanModule {}

describe('scanRouteAccess', () => {
  it('lists every route with its access and reports missing, double and class-level markers', async () => {
    const app = (await Test.createTestingModule({ imports: [ScanModule] }).compile()).createNestApplication({ logger: false });
    await app.init();
    const entries = scanRouteAccess(app, '');
    const byHandler = Object.fromEntries(entries.map((e) => [`${e.controller}.${e.handler}`, e]));
    expect(byHandler['ProbeController.none']?.access).toEqual({ kind: 'invalid', reason: 'NONE', stepUp: false });
    expect(byHandler['ProbeController.two']?.access).toEqual({ kind: 'invalid', reason: 'MULTIPLE', stepUp: false });
    expect(byHandler['ProbeController.perm']).toMatchObject({ method: 'GET', path: '/p/perm', access: { kind: 'permissions', codes: ['users:read', 'users:block'], stepUp: false } });
    expect(byHandler['ClassMarkedController.x']?.classMarkers).toEqual(['tms:public-route']);
    await app.close();
  });
});
```

`apps/api-admin/test/route-access.e2e-spec.ts` (the real application; the snapshot is the reviewed list every later task updates):

```ts
import { Controller, HttpCode, Module, Post } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Public, RequireSession, scanRouteAccess } from '@tms/domain/shared';
import request from 'supertest';
import snapshot from './route-access.snapshot.json';
import { createAdminTestApp, ORIGIN } from './support/app';

/** Test-only POST routes: guards run only on matched routes (an unmatched path answers 404 before any guard). */
@Controller('origin-probe')
class OriginProbeController {
  @Public() @Post('public') @HttpCode(204) open(): void { /* 204 */ }
  @RequireSession('ANY') @Post('session') @HttpCode(204) session(): void { /* 204 */ }
}
@Module({ controllers: [OriginProbeController] })
class OriginProbeModule {}

describe('api-admin route access (fail-closed)', () => {
  it('every route carries exactly one marker, none at class level, and matches the reviewed snapshot', async () => {
    const { app } = await createAdminTestApp({ extraImports: [DiscoveryModule] });
    const entries = scanRouteAccess(app);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect({ route: `${e.method} ${e.path}`, access: e.access.kind }).not.toMatchObject({ access: 'invalid' });
      expect(e.classMarkers).toEqual([]);
    }
    const actual = entries
      .map((e) => ({ route: `${e.method} ${e.path}`, access: e.access }))
      .sort((a, b) => a.route.localeCompare(b.route));
    expect(actual).toEqual(snapshot);
    await app.close();
  });

  it('a foreign Origin is rejected before authentication (403, not 401)', async () => {
    const { app } = await createAdminTestApp({ extraImports: [OriginProbeModule] });
    const server = app.getHttpServer();
    const foreign = await request(server).post('/api/origin-probe/session').set('Origin', 'https://evil.example').expect(403);
    expect(foreign.body.code).toBe('ORIGIN_REJECTED');
    const allowed = await request(server).post('/api/origin-probe/session').set('Origin', ORIGIN).expect(401);
    expect(allowed.body.code).toBe('UNAUTHENTICATED');
    await app.close();
  });

  it('a mutation needs an allowed Origin or same-origin fetch metadata, even on a public route', async () => {
    const { app } = await createAdminTestApp({ extraImports: [OriginProbeModule] });
    const server = app.getHttpServer();
    await request(server).post('/api/origin-probe/public').set('Origin', ORIGIN).expect(204);
    await request(server).post('/api/origin-probe/public').set('Sec-Fetch-Site', 'same-origin').expect(204);
    expect((await request(server).post('/api/origin-probe/public').expect(403)).body.code).toBe('ORIGIN_REJECTED');
    await app.close();
  });
});
```

`apps/api-admin/test/route-access.snapshot.json` starts with the health route only:

```json
[{ "route": "GET /api/health", "access": { "kind": "public", "stepUp": false } }]
```

`apps/api-admin/test/support/app.ts` (grows in later tasks):

```ts
import type { DynamicModule, INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { testDatabaseUrl } from '@tms/db/testing';
import { Clock, FixedClock, InMemoryMailSender, MailSender } from '@tms/domain/shared';
import { configureApp, loadEnv } from '@tms/nest-bootstrap';
import { AppModule } from '../../src/app.module';
import { type Env, envSchema } from '../../src/env';

export const ORIGIN = 'http://localhost:5173';
export const TEST_NOW = new Date('2026-09-23T10:00:00Z');

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv(envSchema, {
    NODE_ENV: 'test',
    DATABASE_URL: testDatabaseUrl(),
    LOG_FILE_ENABLED: 'false',
    TRUST_PROXY: 'false',
    ADMIN_WEB_ORIGINS: ORIGIN,
    ...overrides,
  });
}

export interface AdminTestApp {
  app: INestApplication;
  clock: FixedClock;
  mail: InMemoryMailSender;
  env: Env;
}

export async function createAdminTestApp(
  options: { env?: Record<string, string>; extraImports?: Array<Type | DynamicModule> } = {},
): Promise<AdminTestApp> {
  const env = testEnv(options.env);
  const clock = new FixedClock(TEST_NOW);
  const mail = new InMemoryMailSender();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env), ...(options.extraImports ?? [])],
  })
    .overrideProvider(Clock).useValue(clock)
    .overrideProvider(MailSender).useValue(mail)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, env);
  await app.init();
  return { app, clock, mail, env };
}
```

`apps/api-driver/test/route-access.e2e-spec.ts`: same first test against api-driver's `AppModule` (only `GET /api/health`, public), without the snapshot file (inline expectation).

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm turbo run test --filter=@tms/nest-bootstrap && pnpm turbo run test --filter=@tms/domain && pnpm turbo run test --filter=@tms/api-admin`
Expected: FAIL — `OriginGuard`, `AccessGuard`, markers, `scanRouteAccess` and `apps/api-admin/src/env.ts` do not exist (the new suites fail to load); phase 1's suites stay green.

- [ ] **Step 3: Implement the markers and the principal types**

`packages/domain/src/shared/access/markers.ts`:

```ts
import { SetMetadata } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import {
  AUTH_THROTTLE_KEY, type PermissionCode, PUBLIC_ROUTE_KEY, REQUIRED_PERMISSIONS_KEY,
  SESSION_SCOPES_KEY, type SessionScope, STEP_UP_KEY,
} from '@tms/contracts';

export const SKIP_SESSION_TOUCH_KEY = 'tms:skip-session-touch';
export type ScopeRequirement = SessionScope | 'ANY';

/** Route markers (ADR 0010). Exactly one of the first three per handler, at method level. */
export const Public = (): MethodDecorator => SetMetadata(PUBLIC_ROUTE_KEY, true);
export const RequireSession = (...scopes: [ScopeRequirement, ...ScopeRequirement[]]): MethodDecorator =>
  SetMetadata(SESSION_SCOPES_KEY, scopes);
export const RequirePermissions = (...codes: [PermissionCode, ...PermissionCode[]]): MethodDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, codes);
/** Modifier: a TOTP confirmation within the last 10 minutes (section 8.5). */
export const RequireStepUp = (): MethodDecorator => SetMetadata(STEP_UP_KEY, true);
/** Modifier: the route is subject to the auth rate limits (Task 16). */
export const AuthThrottle = (): MethodDecorator => SetMetadata(AUTH_THROTTLE_KEY, true);
/** Modifier: reading the route must not extend the idle timeout (e.g. polling `GET /auth/session`). */
export const SkipSessionTouch = (): MethodDecorator => SetMetadata(SKIP_SESSION_TOUCH_KEY, true);

export const ROUTE_MARKER_KEYS = [PUBLIC_ROUTE_KEY, SESSION_SCOPES_KEY, REQUIRED_PERMISSIONS_KEY] as const;

export type RouteAccess =
  | { kind: 'public'; stepUp: boolean }
  | { kind: 'session'; scopes: ScopeRequirement[]; stepUp: boolean }
  | { kind: 'permissions'; codes: PermissionCode[]; stepUp: boolean }
  | { kind: 'invalid'; reason: 'NONE' | 'MULTIPLE'; stepUp: boolean };

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- Nest handlers are plain functions
export function readRouteAccess(reflector: Reflector, handler: Function): RouteAccess {
  const isPublic = reflector.get<boolean | undefined>(PUBLIC_ROUTE_KEY, handler) === true;
  const scopes = reflector.get<ScopeRequirement[] | undefined>(SESSION_SCOPES_KEY, handler);
  const codes = reflector.get<PermissionCode[] | undefined>(REQUIRED_PERMISSIONS_KEY, handler);
  const stepUp = reflector.get<boolean | undefined>(STEP_UP_KEY, handler) === true;
  const count = Number(isPublic) + Number(scopes !== undefined) + Number(codes !== undefined);
  if (count === 0) return { kind: 'invalid', reason: 'NONE', stepUp };
  if (count > 1) return { kind: 'invalid', reason: 'MULTIPLE', stepUp };
  if (isPublic) return { kind: 'public', stepUp };
  if (scopes) return { kind: 'session', scopes, stepUp };
  return { kind: 'permissions', codes: codes ?? [], stepUp };
}
```

`packages/domain/src/shared/access/principal.ts`:

```ts
import { createParamDecorator, type ExecutionContext, Injectable } from '@nestjs/common';
import type { PermissionCode, SessionScope } from '@tms/contracts';
import type { Request, Response } from 'express';

export const PRINCIPAL_REQUEST_KEY = 'tmsPrincipal';

export interface Principal {
  userId: string;
  sessionId: string;
  scope: SessionScope;
  permissions: ReadonlySet<PermissionCode>;
  mfaVerifiedAt: Date | null;
}

/** Turns a request into a principal (or null). api-admin: staff session cookie; api-driver: kiosk JWT (phase 5). */
export abstract class PrincipalResolver {
  abstract resolve(req: Request, res: Response, options: { touch: boolean }): Promise<Principal | null>;
}

@Injectable()
export class DenyAllPrincipalResolver extends PrincipalResolver {
  override resolve(): Promise<Principal | null> {
    return Promise.resolve(null);
  }
}

export const CurrentPrincipal = createParamDecorator((_data: unknown, ctx: ExecutionContext): Principal => {
  const req = ctx.switchToHttp().getRequest<Request & { [PRINCIPAL_REQUEST_KEY]?: Principal }>();
  const principal = req[PRINCIPAL_REQUEST_KEY];
  if (!principal) throw new Error('CurrentPrincipal used on a route without a resolved principal');
  return principal;
});
```

- [ ] **Step 4: Implement the guards and the scanner**

`packages/domain/src/shared/access/access.guard.ts`:

```ts
import { type CanActivate, type ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isStepUpFresh } from '@tms/auth-core';
import { DomainError } from '@tms/contracts';
import type { Request, Response } from 'express';
import { Clock } from '../clock';
import { readRouteAccess, SKIP_SESSION_TOUCH_KEY } from './markers';
import { type Principal, PRINCIPAL_REQUEST_KEY, PrincipalResolver } from './principal';

/** Fail-closed route access (ADR 0010): marker check → principal → scope → permissions (AND) → step-up. */
@Injectable()
export class AccessGuard implements CanActivate {
  private readonly logger = new Logger('AccessGuard');

  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: PrincipalResolver,
    private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const access = readRouteAccess(this.reflector, handler);
    if (access.kind === 'invalid') {
      this.logger.error(`Route ${context.getClass().name}.${handler.name} has ${access.reason === 'NONE' ? 'no' : 'more than one'} access marker`);
      throw new DomainError('ROUTE_NOT_DECLARED', 'Route access is not declared');
    }
    if (access.kind === 'public') return true;

    const http = context.switchToHttp();
    const req = http.getRequest<Request & { [PRINCIPAL_REQUEST_KEY]?: Principal }>();
    const touch = this.reflector.get<boolean | undefined>(SKIP_SESSION_TOUCH_KEY, handler) !== true;
    const principal = await this.resolver.resolve(req, http.getResponse<Response>(), { touch });
    if (!principal) throw new DomainError('UNAUTHENTICATED', 'Authentication required');

    if (access.kind === 'session') {
      if (!access.scopes.includes('ANY') && !access.scopes.includes(principal.scope)) {
        throw new DomainError('UNAUTHENTICATED', 'Authentication required');
      }
    } else {
      if (principal.scope !== 'FULL') throw new DomainError('UNAUTHENTICATED', 'Authentication required');
      if (!access.codes.every((code) => principal.permissions.has(code))) {
        throw new DomainError('FORBIDDEN', 'Missing permission');
      }
    }
    if (access.stepUp && !isStepUpFresh(principal.mfaVerifiedAt, this.clock.now())) {
      throw new DomainError('AUTH_STEP_UP_REQUIRED', 'Confirm with your authenticator first');
    }
    req[PRINCIPAL_REQUEST_KEY] = principal;
    return true;
  }
}
```

`packages/domain/src/shared/access/route-scan.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { readRouteAccess, ROUTE_MARKER_KEYS, type RouteAccess } from './markers';

export interface RouteAccessEntry {
  controller: string;
  handler: string;
  method: string;
  path: string;
  access: RouteAccess;
  classMarkers: string[];
}

const join = (...parts: string[]) =>
  `/${parts.flatMap((p) => p.split('/')).filter(Boolean).join('/')}`;

/** Test helper: every route of the app with its access marker (needs DiscoveryModule imported). */
export function scanRouteAccess(app: INestApplication, globalPrefix = 'api'): RouteAccessEntry[] {
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);
  const entries: RouteAccessEntry[] = [];
  for (const wrapper of discovery.getControllers()) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;
    const controllerPath = String(Reflect.getMetadata(PATH_METADATA, metatype) ?? '');
    const classMarkers = ROUTE_MARKER_KEYS.filter((key) => Reflect.getMetadata(key, metatype) !== undefined);
    const proto = Object.getPrototypeOf(instance) as Record<string, unknown>;
    for (const name of scanner.getAllMethodNames(proto)) {
      const handler = proto[name];
      if (typeof handler !== 'function') continue;
      const methodPath = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (methodPath === undefined || method === undefined) continue;
      entries.push({
        controller: metatype.name,
        handler: name,
        method: RequestMethod[method],
        path: join(globalPrefix, controllerPath, methodPath),
        access: readRouteAccess(reflector, handler),
        classMarkers: [...classMarkers],
      });
    }
  }
  return entries;
}
```

`globalPrefix` defaults to `'api'` (the prefix `configureApp` sets), which the app tests use; the domain spec's probe app has no prefix and passes `''`.

`packages/domain/src/shared/access/index.ts`:

```ts
export { AccessGuard } from './access.guard';
export {
  AuthThrottle, Public, readRouteAccess, RequirePermissions, RequireSession, RequireStepUp, SkipSessionTouch,
  type RouteAccess, type ScopeRequirement,
} from './markers';
export {
  CurrentPrincipal, DenyAllPrincipalResolver, type Principal, PRINCIPAL_REQUEST_KEY, PrincipalResolver,
} from './principal';
export { type RouteAccessEntry, scanRouteAccess } from './route-scan';
```

`packages/domain/src/shared/index.ts` (phase 1's explicit export list) adds `export * from './access';` (`SKIP_SESSION_TOUCH_KEY` and `ROUTE_MARKER_KEYS` stay internal: the guard and the scanner import them from `./markers`).

`packages/domain/package.json`: add `"@tms/auth-core": "workspace:*"` to `dependencies` (the guard imports `isStepUpFresh`; Task 11 finds it there) and `"@types/express": "catalog:"` to `devDependencies` (`PrincipalResolver.resolve` takes Express's `Request`/`Response`). No ESLint change: phase 1 Task 02's boundaries policy already lists `auth-core` for `domain`.

`packages/domain/test/shared/exports.spec.ts` (phase 1 Task 14; keep the test title, Task 12 renames it): insert the 13 new runtime names into the sorted `toEqual` list, which becomes `['AUDIT_APP', 'AccessGuard', 'AuditService', 'AuthThrottle', 'Clock', 'ClsService', 'CurrentPrincipal', 'DenyAllPrincipalResolver', 'FixedClock', 'InMemoryMailSender', 'MailSender', 'PRINCIPAL_REQUEST_KEY', 'PrincipalResolver', 'Propagation', 'Public', 'REQUEST_CONTEXT_KEY', 'RequirePermissions', 'RequireSession', 'RequireStepUp', 'SharedModule', 'SkipSessionTouch', 'SystemClock', 'TransactionHost', 'Transactional', 'USER_AGENT_MAX_LENGTH', 'readRouteAccess', 'scanRouteAccess']` (27 names; `Object.keys` lists values only, the type exports do not appear).

`packages/nest-bootstrap/src/http/origin.guard.ts`:

```ts
import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { DomainError } from '@tms/contracts';

export const ORIGIN_ALLOWLIST = 'tms:origin-allowlist';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** D11: mutations need an allowed Origin, or Sec-Fetch-Site: same-origin when Origin is absent. Fail-closed. */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowed: ReadonlySet<string>;

  constructor(@Inject(ORIGIN_ALLOWLIST) allowlist: readonly string[]) {
    this.allowed = new Set(allowlist);
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ method: string; headers: Record<string, string | undefined> }>();
    if (SAFE_METHODS.has(req.method.toUpperCase())) return true;
    const origin = req.headers['origin'];
    if (origin !== undefined) {
      if (this.allowed.has(origin)) return true;
    } else if (req.headers['sec-fetch-site'] === 'same-origin') {
      return true;
    }
    throw new DomainError('ORIGIN_REJECTED', 'Cross-origin request rejected');
  }
}
```

- [ ] **Step 5: Wire both apps**

`apps/api-admin/src/env.ts` (phase 1 keeps `envSchema` and `Env` in `app.module.ts`; they move here with their names, because the schema now grows with every phase 2 task):

```ts
import { createEnvSchema } from '@tms/nest-bootstrap';
import { z } from 'zod';

const OriginList = z
  .string()
  .transform((value) => value.split(',').map((o) => o.trim()).filter(Boolean))
  .pipe(z.array(z.url()).min(1));

/** The back-office API's environment: the shared variables, PORT defaulting to 3001, the admin-only variables. */
export const envSchema = createEnvSchema({ defaultPort: 3001 }).extend({
  ADMIN_WEB_ORIGINS: OriginList.default(['http://localhost:5173']),
});
export type Env = z.infer<typeof envSchema>;
```

`apps/api-admin/src/app.module.ts`: delete the `envSchema`/`Env` declarations and the `createEnvSchema` and `zod` imports, add `import type { Env } from './env';`. `apps/api-admin/src/main.ts`: `import { AppModule } from './app.module';` and `import { envSchema } from './env';` (phase 1's `import './instrument';` and `import 'reflect-metadata';` stay the first two imports). `apps/api-admin/test/env.spec.ts`: `import { envSchema } from '../src/env';` and add `ADMIN_WEB_ORIGINS: ['http://localhost:5173']` to its `toEqual` (next to Task 09's `TRUST_PROXY: 'loopback'`). `apps/api-admin/test/app.e2e-spec.ts`: import `AppModule` from `'../src/app.module'` and `envSchema` from `'../src/env'`. Both apps' `test/app.e2e-spec.ts`: the test-only `ProbeController.get` gains `@Public()` (`import { Public } from '@tms/domain/shared'`), otherwise the fail-closed guard answers its "mounts routes under /api only" case with 403 `ROUTE_NOT_DECLARED`.

In `apps/api-admin/src/app.module.ts` (`AppModule.forRoot(env)` from phase 1) add, in this order:

```ts
providers: [
  { provide: ORIGIN_ALLOWLIST, useValue: env.ADMIN_WEB_ORIGINS },
  { provide: APP_GUARD, useClass: OriginGuard },
  // Task 16 inserts { provide: APP_GUARD, useClass: ThrottlerGuard } here.
  { provide: APP_GUARD, useClass: AccessGuard },
  { provide: PrincipalResolver, useClass: DenyAllPrincipalResolver }, // Task 11: StaffSessionResolver
],
```

`apps/api-driver/src/app.module.ts`: `{ provide: APP_GUARD, useClass: AccessGuard }` and `{ provide: PrincipalResolver, useClass: DenyAllPrincipalResolver }` (phase 5 adds the Origin guard and the kiosk resolver). `.env.example` (api-admin): `ADMIN_WEB_ORIGINS=http://localhost:5173`; compose `api-admin`: `ADMIN_WEB_ORIGINS: 'http://localhost:8080,http://localhost:${CADDY_ADMIN_PORT:-8080}'`.

- [ ] **Step 6: ADRs and CLAUDE.md**

`docs/adr/0003-origin-csrf-and-session-cookies.md`: context (D11, SPA and API on one origin, cookie sessions); decision (single origin via Caddy/Vite proxy, no CORS with credentials; session cookie `__Host-tms_admin_sid` HttpOnly/Secure/SameSite=Strict/Path=/ without Max-Age, hashed token at rest, rotation on scope upgrade; `OriginGuard` on every non-safe method, fail-closed when both `Origin` and `Sec-Fetch-Site` are absent; `trust proxy` limited to loopback/private ranges); alternatives (double-submit CSRF token, CORS with credentials, `Origin`-only check that allows headerless requests) and why not; consequences (curl and scripts must send `Origin`; the `SESSION_COOKIE_SECURE=false` fallback for non-localhost HTTP dev is forbidden in production).

`docs/adr/0010-route-access-markers.md`: context (section 3 fail-closed rule; pre-session and self-service routes need authentication without a permission); decision (three markers, exactly one per handler at method level; `@RequireStepUp`, `@AuthThrottle`, `@SkipSessionTouch` modifiers; keys in contracts; `AccessGuard` in `domain/shared` over an abstract `PrincipalResolver`; the scan test with a reviewed snapshot; guard order Origin → Throttler → Access in one providers array); alternatives (two markers with `@Public` on pre-session routes plus manual checks; class-level markers) and why not; consequences (phase 3a's RBAC matrix is derived from the same scan; every new route updates the snapshot in its PR).

`docs/adr/README.md`: add `0003 origin, CSRF and session cookies` and `0010 route-access markers and guard pipeline` to the `Accepted:` sentence and drop 0003 from `Planned:`.

`CLAUDE.md`, Rules: replace "Every route is decorated `@RequirePermissions` or `@Public` (from phase 3a)" with "Every route carries exactly one of `@Public`, `@RequireSession`, `@RequirePermissions` (ADR 0010; the route-access snapshot test lists them)".

In `docs/efficiency/critical-path.md` "Inputs for later phase plans", strike the A-8 bullet: `- ~~Phase 1: a cross-origin negative check once api-admin and api-driver actually diverge enough for one to matter~~ — done in phase 2/10 (A-8): the \`OriginGuard\` matrix and the api-admin route-access e2e cases.`

- [ ] **Step 7: Run the tests and verify**

Run: `pnpm turbo run test --filter=@tms/nest-bootstrap && pnpm turbo run test --filter=@tms/domain && pnpm turbo run test --filter=@tms/api-admin && pnpm turbo run test --filter=@tms/api-driver && pnpm verify`
Expected: Origin matrix 16 cases, AccessGuard 9 tests, scan test, `exports.spec` (2) with the 27 names, api-admin route-access 3 tests (snapshot, Origin before authentication, Origin on a public mutation), api-driver route-access 1, both apps' phase 1 e2e and env specs pass; `pnpm verify` green (hygiene: CLAUDE.md ≤ 150 lines; boundaries: `@tms/domain` → `@tms/auth-core` allowed, no `@tms/nest-bootstrap` import under `packages/domain`).

- [ ] **Step 8: Commit**

```bash
git add packages/domain packages/nest-bootstrap apps/api-admin apps/api-driver infra/docker-compose.yml pnpm-lock.yaml docs/adr CLAUDE.md docs/efficiency/critical-path.md
git commit -m "feat(domain): add fail-closed route access markers, AccessGuard and the Origin guard"
```

PR body: diagram `flowchart` (request → OriginGuard → AccessGuard decision tree); boundaries: `@tms/domain/shared` and `@tms/nest-bootstrap` public API, both apps' guard setup, CLAUDE.md rule; no migration; reviewer: `security-reviewer`.
