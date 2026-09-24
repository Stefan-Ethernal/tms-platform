# Phase 2 — Task 09: nest-bootstrap — error envelope filter, zod validation pipe, cookies, trust proxy, security headers

> Part of the phase 2 plan: read [index.md](index.md) (constraints, shared interfaces, env) and this file only.


**Files:**
- Create: `packages/nest-bootstrap/src/http/api-exception.filter.ts`, `packages/nest-bootstrap/src/http/zod-validation.pipe.ts`, `packages/nest-bootstrap/src/http/trust-proxy.ts`, `packages/nest-bootstrap/src/http/index.ts`
- Modify: `packages/nest-bootstrap/src/core.module.ts` (filter and pipe registration), `packages/nest-bootstrap/src/app.ts` (`configureApp`: cookie-parser, trust proxy, helmet), `packages/nest-bootstrap/src/bootstrap.ts` (passes `env` to `configureApp`), `packages/nest-bootstrap/src/env.ts` (`TRUST_PROXY` in `baseEnvSchema`), `packages/nest-bootstrap/src/index.ts`, `packages/nest-bootstrap/package.json` (`cookie-parser`, `helmet`, `@types/cookie-parser`, `@types/express`), `pnpm-workspace.yaml` (catalog), `pnpm-lock.yaml`, `infra/docker-compose.yml` (`TRUST_PROXY` for both APIs), `apps/api-*/.env.example`, `docs/architecture.md` (the `SentryGlobalFilter` sentence of the Observability section), `docs/efficiency/critical-path.md` (strike input A-7)
- Modify (phase 1 tests that pin Nest's default bodies, the Sentry filter or the exact env defaults): `packages/nest-bootstrap/test/env.spec.ts` (`DEFAULTS`), `packages/nest-bootstrap/test/bootstrap.spec.ts` (`toHaveBeenCalledWith` object, 404 body), `packages/nest-bootstrap/test/sentry/capture.e2e-spec.ts` (500 and 404 bodies, describe title), `packages/nest-bootstrap/test/sentry/boom-app.ts` (query DTO), `apps/api-admin/test/env.spec.ts` and `apps/api-driver/test/env.spec.ts` (`toEqual` defaults), `apps/api-admin/test/app.e2e-spec.ts` and `apps/api-driver/test/app.e2e-spec.ts` (404 body, no `X-Powered-By`), `e2e/tests/support/smoke.ts` (Playwright 404 shape). Unaffected (checked): `test/env-database.spec.ts` and `test/sentry/env.spec.ts` assert with `toMatchObject` or on picked fields.
- Create: `packages/nest-bootstrap/test/api-exception.filter.spec.ts`, `packages/nest-bootstrap/test/zod-validation.pipe.spec.ts`, `packages/nest-bootstrap/test/trust-proxy.spec.ts`

**Interfaces:**
- Consumes: `API_ERROR_CODES`, `ApiError`, `DomainError`, `isDomainError` (Task 08); phase 1 `CoreModule` (`packages/nest-bootstrap/src/core.module.ts`), `configureApp` (`src/app.ts`), `baseEnvSchema`/`BaseEnv` (`src/env.ts`, composition rule: a new shared variable is one more entry of the `baseEnvSchema` object literal), `bootstrapApi` (`src/bootstrap.ts`), `createLoggerModule` (`@tms/logger`).
- Produces: `ApiExceptionFilter` and `ZodValidationPipe` registered globally by `CoreModule` (`APP_FILTER`, `APP_PIPE`), replacing phase 1's `SentryGlobalFilter` (5xx still reach Sentry with the same `mechanism`); `zodDto(schema)`; `toApiError(exception): ApiError` (P2002 → 409 `CONFLICT` with fields from the constraint name, P2003 → 409 `REFERENCE_CONFLICT`, an unlisted 4xx keeps its status under `REQUEST_REJECTED`); `configureApp<T extends INestApplication>(app: T, env: Pick<BaseEnv, 'TRUST_PROXY'> = { TRUST_PROXY: 'loopback' }): T` now also installs `helmet` (default headers, no `X-Powered-By`) and `cookie-parser` and sets `trust proxy` from `TRUST_PROXY` (the default keeps every phase 1 caller unchanged); `baseEnvSchema.TRUST_PROXY` (default `'loopback'`); `parseTrustProxy(value: string): boolean | number | string`. `src/index.ts` re-exports `./http`, so all of these come from the package root.

- [ ] **Step 1: Write the failing tests**

`packages/nest-bootstrap/test/api-exception.filter.spec.ts`:

```ts
import { Body, Controller, Get, HttpException, INestApplication, Module, NotFoundException, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DomainError } from '@tms/contracts';
import request from 'supertest';
import { z } from 'zod';
import { ApiExceptionFilter, ZodValidationPipe, zodDto } from '../src/http';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';

class EchoDto extends zodDto(z.strictObject({ name: z.string().min(2), age: z.number().int() })) {}

/** The shape of a Prisma 7 driver-adapter error (phase 1 `expectKnownRequestError`); `meta.target` no longer exists. */
function prismaError(code: 'P2002' | 'P2003', constraint: string): Error {
  return Object.assign(new Error(`${code} on ${constraint}`), {
    code,
    meta: { driverAdapterError: { cause: { constraint: { index: constraint } } } },
  });
}

@Controller('probe')
class ProbeController {
  @Post('echo') echo(@Body() body: EchoDto) { return body; }
  @Get('locked') locked() { throw new DomainError('AUTH_ACCOUNT_LOCKED', 'Account locked', { retryAfterSeconds: 90 }); }
  @Get('unique') unique() { throw prismaError('P2002', 'User_email_key'); }
  @Get('unique-composite') uniqueComposite() { throw prismaError('P2002', 'Widget_ownerId_name_key'); }
  @Get('unique-custom') uniqueCustom() { throw prismaError('P2002', 'one_active_entry_per_order'); }
  @Get('reference') reference() { throw prismaError('P2003', 'User_roleId_fkey'); }
  @Get('boom') boom() { throw new Error('database password is hunter2'); }
  @Get('missing') missing() { throw new NotFoundException(); }
  @Get('teapot') teapot() { throw new HttpException("I'm a teapot", 418); }
}

@Module({
  controllers: [ProbeController],
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
  ],
})
class ProbeModule {}

describe('ApiExceptionFilter + ZodValidationPipe', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = ref.createNestApplication({ logger: false });
    await app.init();
  });
  afterAll(() => app.close());

  it('turns a zod failure into 422 with field errors and strips nothing silently', async () => {
    const res = await request(app.getHttpServer()).post('/probe/echo').send({ name: 'A', age: 1.5, extra: true }).expect(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.fields.map((f: { path: string }) => f.path).sort()).toEqual(['', 'age', 'name']);
  });

  it('passes parsed data to the handler', async () => {
    await request(app.getHttpServer()).post('/probe/echo').send({ name: 'Ada', age: 36 }).expect(201, { name: 'Ada', age: 36 });
  });

  it('maps a domain error to its status, code and Retry-After', async () => {
    const res = await request(app.getHttpServer()).get('/probe/locked').expect(423);
    expect(res.headers['retry-after']).toBe('90');
    expect(res.body).toEqual({ statusCode: 423, code: 'AUTH_ACCOUNT_LOCKED', message: 'Account locked', retryAfterSeconds: 90 });
  });

  it('maps a Prisma unique violation to 409 with the fields the constraint names', async () => {
    const res = await request(app.getHttpServer()).get('/probe/unique').expect(409);
    expect(res.body).toEqual({ statusCode: 409, code: 'CONFLICT', message: 'Already exists', fields: [{ path: 'email', code: 'UNIQUE', message: 'Already exists' }] });
    const composite = await request(app.getHttpServer()).get('/probe/unique-composite').expect(409);
    expect(composite.body.fields.map((f: { path: string }) => f.path)).toEqual(['ownerId', 'name']);
  });

  it('keeps 409 without fields when the constraint name is not Prisma-generated', async () => {
    const res = await request(app.getHttpServer()).get('/probe/unique-custom').expect(409);
    expect(res.body).toEqual({ statusCode: 409, code: 'CONFLICT', message: 'Already exists' });
  });

  it('maps a foreign-key RESTRICT (P2003) to 409 REFERENCE_CONFLICT without naming the constraint', async () => {
    const res = await request(app.getHttpServer()).get('/probe/reference').expect(409);
    expect(res.body).toEqual({ statusCode: 409, code: 'REFERENCE_CONFLICT', message: 'Still referenced' });
  });

  it('hides unknown errors behind INTERNAL without details', async () => {
    const res = await request(app.getHttpServer()).get('/probe/boom').expect(500);
    expect(res.body).toEqual({ statusCode: 500, code: 'INTERNAL', message: 'Internal server error' });
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('maps Nest HTTP exceptions by status', async () => {
    const res = await request(app.getHttpServer()).get('/probe/missing').expect(404);
    expect(res.body).toEqual({ statusCode: 404, code: 'NOT_FOUND', message: 'Not Found' });
  });

  it('keeps the status of an unlisted 4xx under the generic REQUEST_REJECTED code', async () => {
    const res = await request(app.getHttpServer()).get('/probe/teapot').expect(418);
    expect(res.body).toEqual({ statusCode: 418, code: 'REQUEST_REJECTED', message: "I'm a teapot" });
  });

  it('rejects malformed JSON as a validation failure', async () => {
    const res = await request(app.getHttpServer()).post('/probe/echo').set('Content-Type', 'application/json').send('{"name":').expect(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});
```

`packages/nest-bootstrap/test/zod-validation.pipe.spec.ts`:

```ts
import { ZodValidationPipe } from '../src/http';

describe('ZodValidationPipe without a schema', () => {
  const pipe = new ZodValidationPipe();
  it.each(['body', 'query', 'param'] as const)('refuses a %s whose type carries no zod schema', (type) => {
    expect(() => pipe.transform({ a: 1 }, { type, metatype: Object, data: undefined })).toThrow(/no zod DTO schema/);
  });
  it('ignores custom parameter decorators', () => {
    expect(pipe.transform('x', { type: 'custom', metatype: String, data: undefined })).toBe('x');
  });
});
```

`packages/nest-bootstrap/test/trust-proxy.spec.ts`:

```ts
import { Controller, Get, INestApplication, Module, Req } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createLoggerModule } from '@tms/logger';
import type { Request } from 'express';
import request from 'supertest';
import { parseTrustProxy } from '../src/http';
import { configureApp } from '../src';

@Controller('ip') class IpController { @Get() ip(@Req() req: Request) { return { ip: req.ip, cookies: req.cookies as unknown }; } }
// configureApp installs the pino Logger (`app.get(Logger)`); one silent logger configuration for every
// app of this file (nestjs-pino keeps the first app's configuration per process).
@Module({
  imports: [createLoggerModule({ app: 'api-admin', level: 'silent', file: { enabled: false, dir: 'logs', retentionDays: 1 } })],
  controllers: [IpController],
})
class IpModule {}

async function appWith(trustProxy: string): Promise<INestApplication> {
  const ref = await Test.createTestingModule({ imports: [IpModule] }).compile();
  const app = ref.createNestApplication({ logger: false });
  configureApp(app, { TRUST_PROXY: trustProxy });
  await app.init();
  return app;
}

describe('trust proxy, cookies and security headers', () => {
  it.each([
    ['false', false], ['loopback', 'loopback'], ['loopback, uniquelocal', 'loopback, uniquelocal'], ['1', 1],
  ])('parses %s', (raw, parsed) => expect(parseTrustProxy(raw)).toEqual(parsed));

  it('honours X-Forwarded-For only from a trusted proxy', async () => {
    const trusted = await appWith('loopback');
    const res = await request(trusted.getHttpServer()).get('/api/ip').set('X-Forwarded-For', '203.0.113.9').expect(200);
    expect(res.body.ip).toBe('203.0.113.9');
    await trusted.close();

    const untrusted = await appWith('false');
    const res2 = await request(untrusted.getHttpServer()).get('/api/ip').set('X-Forwarded-For', '203.0.113.9').expect(200);
    expect(res2.body.ip).not.toBe('203.0.113.9');
    await untrusted.close();
  });

  it('parses cookies', async () => {
    const app = await appWith('false');
    const res = await request(app.getHttpServer()).get('/api/ip').set('Cookie', 'a=1; b=2').expect(200);
    expect(res.body.cookies).toEqual({ a: '1', b: '2' });
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm turbo run test --filter=@tms/nest-bootstrap`
Expected: FAIL — `../src/http` does not exist (the three new suites fail to load); phase 1's suites stay green.

- [ ] **Step 3: Implement**

Add to the catalog: `cookie-parser: 1.4.7`, `'@types/cookie-parser': 1.4.10`, `helmet: 8.3.0` (ships its own types and a CJS entry whose `module.exports` is the function, so `import helmet from 'helmet'` works under `esModuleInterop`); `packages/nest-bootstrap/package.json` → `dependencies: { "cookie-parser": "catalog:", "helmet": "catalog:" }`, `devDependencies: { "@types/cookie-parser": "catalog:", "@types/express": "catalog:" }` (`@types/express` is already in phase 1's `# nest` catalog group; the filter and the tests import Express types).

`packages/nest-bootstrap/src/http/api-exception.filter.ts`:

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { API_ERROR_CODES, type ApiError, type ApiErrorCode, isDomainError } from '@tms/contracts';
import type { Response } from 'express';

const BY_STATUS: Partial<Record<number, ApiErrorCode>> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'VALIDATION_FAILED',
  415: 'VALIDATION_FAILED',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
};

function envelope(code: ApiErrorCode, message: string, extra: Partial<ApiError> = {}): ApiError {
  return { statusCode: API_ERROR_CODES[code], code, message, ...extra };
}

interface PrismaKnownError {
  code: 'P2002' | 'P2003';
  meta?: unknown;
}

/** Duck-typed so nest-bootstrap needs no Prisma dependency: P2002 = unique violation, P2003 = foreign-key RESTRICT. */
function asPrismaKnownError(e: unknown): PrismaKnownError | null {
  if (typeof e !== 'object' || e === null) return null;
  const code = (e as { code?: unknown }).code;
  return code === 'P2002' || code === 'P2003' ? (e as PrismaKnownError) : null;
}

/** Prisma 7 driver-adapter errors name the constraint at `meta.driverAdapterError.cause.constraint.index`. */
function violatedConstraint(meta: unknown): string | undefined {
  const index = (meta as { driverAdapterError?: { cause?: { constraint?: { index?: unknown } } } } | undefined)
    ?.driverAdapterError?.cause?.constraint?.index;
  return typeof index === 'string' ? index : undefined;
}

/** Prisma's default names: `User_email_key` → ['email'], `Widget_ownerId_name_key` → ['ownerId', 'name']; other names → []. */
function uniqueFields(constraint: string | undefined): string[] {
  const match = constraint?.match(/^[A-Z][A-Za-z0-9]*_([A-Za-z0-9_]+)_key$/);
  return match?.[1] ? match[1].split('_') : [];
}

/** Maps any thrown value to the ADR 0009 envelope. Unknown errors never leak details. */
export function toApiError(exception: unknown): ApiError {
  if (isDomainError(exception)) {
    const { fields, retryAfterSeconds } = exception.details;
    return envelope(exception.code, exception.message, {
      ...(fields ? { fields } : {}),
      ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
    });
  }
  const prisma = asPrismaKnownError(exception);
  if (prisma?.code === 'P2002') {
    const fields = uniqueFields(violatedConstraint(prisma.meta)).map((path) => ({
      path,
      code: 'UNIQUE',
      message: 'Already exists',
    }));
    return envelope('CONFLICT', 'Already exists', fields.length ? { fields } : {});
  }
  if (prisma?.code === 'P2003') return envelope('REFERENCE_CONFLICT', 'Still referenced');
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status >= 500) return envelope('INTERNAL', 'Internal server error');
    const code = BY_STATUS[status];
    if (code === 'VALIDATION_FAILED') return envelope(code, 'Malformed request');
    const response = exception.getResponse();
    const message =
      typeof response === 'object' && response !== null && typeof (response as { message?: unknown }).message === 'string'
        ? (response as { message: string }).message
        : exception.message;
    // An unlisted 4xx (405, 406, 418, 431, ...) keeps its status; only the code is generic.
    return code ? envelope(code, message) : envelope('REQUEST_REJECTED', message, { statusCode: status });
  }
  return envelope('INTERNAL', 'Internal server error');
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const body = toApiError(exception);
    if (body.statusCode === 429 && body.retryAfterSeconds === undefined) {
      // @nestjs/throttler 6 sets one `retry-after-<throttler name>` header per throttler, not `Retry-After` (spike N3).
      const waits = Object.entries(res.getHeaders())
        .filter(([name]) => name.startsWith('retry-after-'))
        .map(([, value]) => Number(value))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (waits.length) body.retryAfterSeconds = Math.ceil(Math.max(...waits));
    }
    if (body.statusCode >= 500) {
      // Same mechanism as phase 1's SentryGlobalFilter, so the capture spec's assertion stays.
      Sentry.captureException(exception, { mechanism: { type: 'auto.http.nestjs.global_filter', handled: false } });
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    if (body.retryAfterSeconds) res.setHeader('Retry-After', String(body.retryAfterSeconds));
    res.status(body.statusCode).json(body);
  }
}
```

Prisma 7 over `@prisma/adapter-pg` no longer fills `meta.target`; the violated constraint's name sits at `meta.driverAdapterError.cause.constraint.index` (phase 1's `packages/db/test/support/prisma-errors.ts` asserts exactly this path). The unit test fakes that shape; Task 11's `prisma-errors.e2e-spec.ts` pins it against real Postgres errors, so a Prisma upgrade that moves the field fails a test instead of silently dropping `fields`. A P2003 answer names neither the table nor the constraint: the caller learns only that the row is still referenced (phase 3b role and permission deletes).

The throttler's `ThrottlerException` (an `HttpException` with status 429, spike N3) maps to `RATE_LIMITED` through `BY_STATUS`; the filter turns the per-throttler `retry-after-<name>` headers into the standard `Retry-After` header and `retryAfterSeconds` (asserted in Task 16). `Sentry.captureException` is a no-op while Sentry is not initialised (spike N7); phase 1's `{ provide: APP_FILTER, useClass: SentryGlobalFilter }` in `CoreModule.forRoot`'s `providers` is replaced by `{ provide: APP_FILTER, useClass: ApiExceptionFilter }` and `{ provide: APP_PIPE, useClass: ZodValidationPipe }` (drop the `SentryGlobalFilter` import; `SentryModule.forRoot()` stays in `imports`), so exactly one catch-all filter exists. 5xx errors are still captured, with phase 1's mechanism `{ type: 'auto.http.nestjs.global_filter', handled: false }`; `HttpException`s (4xx) are still not reported.

Phase 1's Sentry capture spec (`packages/nest-bootstrap/test/sentry/capture.e2e-spec.ts`) keeps every scrubbing and mechanism assertion; change only: the describe title to `'Sentry capture through ApiExceptionFilter (e2e)'`, the 500 body to `expect(res.body).toEqual({ statusCode: 500, code: 'INTERNAL', message: 'Internal server error' })`, and the 404 body (test "keeps the JSON 404 body of unknown routes") to `{ statusCode: 404, code: 'NOT_FOUND', message: 'Cannot GET /api/does-not-exist' }`. The teapot case keeps `.expect(418)` (unlisted 4xx keep their status). Its `test/sentry/boom-app.ts` reads the query through a DTO, because the global `ZodValidationPipe` refuses a bare `@Query('token') token: string`:

```ts
class BoomQuery extends zodDto(z.object({ token: z.string() })) {}

  @Get()
  boom(@Query() query: BoomQuery): never {
    throw new Error(`boom token=${query.token}`);
  }
```

(`zodDto` from `'../../src'`, `z` from `'zod'`; `z.object` strips the extra `pin` query parameter, so the thrown message is unchanged.) `packages/nest-bootstrap/test/bootstrap.spec.ts`: its unknown-route body becomes `{ statusCode: 404, code: 'NOT_FOUND', message: 'Cannot GET /api/does-not-exist' }`. `e2e/tests/support/smoke.ts` (Playwright, both origins): `toMatchObject({ statusCode: 404, code: 'NOT_FOUND' })` instead of `error: 'Not Found'`. `docs/architecture.md`, Observability: replace "`SentryGlobalFilter`, registered by `CoreModule`, reports unexpected errors only; `HttpException`s are not reported and response bodies do not change." with "`ApiExceptionFilter` (phase 2, ADR 0009), registered by `CoreModule`, answers with the error envelope and reports unexpected (5xx) errors to Sentry only; `HttpException`s are not reported."

`packages/nest-bootstrap/src/http/zod-validation.pipe.ts`:

```ts
import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { DomainError } from '@tms/contracts';
import type { z } from 'zod';

export interface ZodDtoClass<S extends z.ZodType = z.ZodType> {
  new (): z.infer<S>;
  readonly schema: S;
  readonly isZodDto: true;
}

/** `class LoginDto extends zodDto(LoginRequestSchema) {}` — import the class as a value, never `import type`. */
export function zodDto<S extends z.ZodType>(schema: S): ZodDtoClass<S> {
  class ZodDto {
    static readonly schema = schema;
    static readonly isZodDto = true as const;
  }
  return ZodDto as unknown as ZodDtoClass<S>;
}

function isZodDto(value: unknown): value is ZodDtoClass {
  return typeof value === 'function' && (value as Partial<ZodDtoClass>).isZodDto === true;
}

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type === 'custom') return value;
    if (!isZodDto(metadata.metatype)) {
      throw new Error(`Route ${metadata.type} parameter has no zod DTO schema (use zodDto()).`);
    }
    const result = metadata.metatype.schema.safeParse(value);
    if (!result.success) {
      throw new DomainError('VALIDATION_FAILED', 'Validation failed', {
        fields: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
```

A handler parameter without a DTO is a programming error; it surfaces as a 500 in tests and the route-scan test of Task 10 lists every body/query/param type.

`packages/nest-bootstrap/src/http/trust-proxy.ts`:

```ts
/** `TRUST_PROXY` → Express `trust proxy` value: 'false' | hop count | subnet/preset list. */
export function parseTrustProxy(value: string): boolean | number | string {
  const trimmed = value.trim();
  if (trimmed === 'false') return false;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}
```

`packages/nest-bootstrap/src/app.ts` (phase 1's `configureApp<T extends INestApplication>(app: T): T`) becomes:

```ts
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@tms/logger';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import helmet from 'helmet';
import type { BaseEnv } from './env';
import { parseTrustProxy } from './http/trust-proxy';

/** Settings shared by bootstrapApi and every e2e test that builds an app from a testing module. */
export function configureApp<T extends INestApplication>(
  app: T,
  env: Pick<BaseEnv, 'TRUST_PROXY'> = { TRUST_PROXY: 'loopback' },
): T {
  const express = app.getHttpAdapter().getInstance() as Express;
  express.set('trust proxy', parseTrustProxy(env.TRUST_PROXY));
  app.use(helmet());
  app.use(cookieParser());
  app.useLogger(app.get(Logger));
  // Nest flushes the bufferLogs buffer of an HTTP app only once listen() succeeded; flushing here
  // sends a failing listen (port in use) through pino instead of leaving it in the buffer.
  app.flushLogs();
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  return app;
}
```

The default equals the schema default, so phase 1's callers (`test/core.module.spec.ts`, `test/core.module.file.spec.ts`, `test/health.e2e-spec.ts`, `test/sentry/boom-app.ts`, both apps' `test/app.e2e-spec.ts`) stay `configureApp(app)`; only `src/bootstrap.ts` changes to `configureApp(app, env)`.

`helmet()` runs with its defaults and before any route, so 404s, guard rejections and filter output carry the same headers; it removes Express's `X-Powered-By` (architect review A-7, deferred from phase 0). Its default CSP is harmless on JSON responses; the SPAs are served by Caddy/Vite and are not affected. `Strict-Transport-Security` is ignored by browsers over plain HTTP (compose `full` on :8080/:8081).

In `docs/efficiency/critical-path.md` "Inputs for later phase plans", strike the A-7 bullet: `- ~~Phase 2: remove the \`X-Powered-By\` header via helmet~~ — done in phase 2/09 (A-7).`

`packages/nest-bootstrap/src/env.ts`: add `TRUST_PROXY` as the last entry of the `baseEnvSchema` object literal (phase 1's composition rule; `createEnvSchema`, `BaseEnv` and both apps pick it up unchanged):

```ts
  // Express `trust proxy`: 'false', a hop count or a preset/subnet list (Caddy in compose).
  TRUST_PROXY: z.string().min(1).default('loopback'),
```

The new default ripples into phase 1's exact-equality tests: add `TRUST_PROXY: 'loopback'` to `DEFAULTS` in `packages/nest-bootstrap/test/env.spec.ts` (its "ignores unrelated variables" and `.extend()` cases reuse `DEFAULTS`), to the `toHaveBeenCalledWith` object in `test/bootstrap.spec.ts`, and to the `toEqual` in both apps' `test/env.spec.ts`. Compose `api-admin` and `api-driver` get `TRUST_PROXY: 'loopback, uniquelocal'` (Caddy reaches them over the compose network). `.env.example` of both APIs: `TRUST_PROXY=loopback`.

Update the phase 0/1 404 assertions in `apps/api-*/test/app.e2e-spec.ts` to:

```ts
expect(res.body).toEqual({ statusCode: 404, code: 'NOT_FOUND', message: 'Cannot GET /api/does-not-exist' });
expect(res.headers['x-powered-by']).toBeUndefined();
```

- [ ] **Step 4: Run the tests**

Run: `pnpm turbo run test --filter=@tms/nest-bootstrap && pnpm turbo run test --filter=@tms/api-admin && pnpm turbo run test --filter=@tms/api-driver`
Expected: the new filter (10), pipe (4) and proxy/header (7) tests pass; phase 1's env, bootstrap, health and Sentry suites pass with `TRUST_PROXY` in the defaults, the envelope bodies and the unchanged Sentry mechanism; both apps' 404 and health tests pass with the new envelope and without `X-Powered-By`. The Playwright smoke (`e2e/tests/support/smoke.ts`) runs in CI's e2e job.

- [ ] **Step 5: Verify, commit**

Run: `pnpm verify`
Expected: green.

```bash
git add packages/nest-bootstrap apps/api-admin apps/api-driver infra/docker-compose.yml e2e/tests/support/smoke.ts pnpm-workspace.yaml pnpm-lock.yaml docs/architecture.md docs/efficiency/critical-path.md
git commit -m "feat(nest-bootstrap): add the error envelope filter, zod pipe, cookies, trust proxy and helmet"
```

PR body: diagram `flowchart` (exception → toApiError branches → status, incl. P2002/P2003); boundaries: `@tms/nest-bootstrap` public API (`configureApp` gains an optional `env`, `baseEnvSchema.TRUST_PROXY`, new exports), both apps' 404 body, the Sentry capture path; no migration; reviewer: `security-reviewer` (error leakage, trust proxy, security headers).
