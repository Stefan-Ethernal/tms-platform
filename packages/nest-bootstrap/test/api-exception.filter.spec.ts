import {
  Body,
  Controller,
  Get,
  HttpException,
  INestApplication,
  Module,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DomainError, type ApiError } from '@tms/contracts';
import request from 'supertest';
import type { App } from 'supertest/types';
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
  @Post('echo') echo(@Body() body: EchoDto) {
    return body;
  }
  @Get('locked') locked() {
    throw new DomainError('AUTH_ACCOUNT_LOCKED', 'Account locked', { retryAfterSeconds: 90 });
  }
  @Get('unique') unique() {
    throw prismaError('P2002', 'User_email_key');
  }
  @Get('unique-composite') uniqueComposite() {
    throw prismaError('P2002', 'Widget_ownerId_name_key');
  }
  @Get('unique-custom') uniqueCustom() {
    throw prismaError('P2002', 'one_active_entry_per_order');
  }
  @Get('reference') reference() {
    throw prismaError('P2003', 'User_roleId_fkey');
  }
  @Get('boom') boom() {
    throw new Error('database password is hunter2');
  }
  @Get('missing') missing() {
    throw new NotFoundException();
  }
  @Get('teapot') teapot() {
    throw new HttpException("I'm a teapot", 418);
  }
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
  let app: INestApplication<App>;
  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = ref.createNestApplication<INestApplication<App>>({ logger: false });
    await app.init();
  });
  afterAll(() => app.close());

  it('turns a zod failure into 422 with field errors and strips nothing silently', async () => {
    const res = await request(app.getHttpServer())
      .post('/probe/echo')
      .send({ name: 'A', age: 1.5, extra: true })
      .expect(422);
    const body = res.body as ApiError;
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(
      body.fields
        ?.map((f) => f.path)
        .slice()
        .sort(),
    ).toEqual(['', 'age', 'name']);
  });

  it('passes parsed data to the handler', async () => {
    await request(app.getHttpServer())
      .post('/probe/echo')
      .send({ name: 'Ada', age: 36 })
      .expect(201, { name: 'Ada', age: 36 });
  });

  it('maps a domain error to its status, code and Retry-After', async () => {
    const res = await request(app.getHttpServer()).get('/probe/locked').expect(423);
    expect(res.headers['retry-after']).toBe('90');
    expect(res.body).toEqual({
      statusCode: 423,
      code: 'AUTH_ACCOUNT_LOCKED',
      message: 'Account locked',
      retryAfterSeconds: 90,
    });
  });

  it('maps a Prisma unique violation to 409 with the fields the constraint names', async () => {
    const res = await request(app.getHttpServer()).get('/probe/unique').expect(409);
    expect(res.body).toEqual({
      statusCode: 409,
      code: 'CONFLICT',
      message: 'Already exists',
      fields: [{ path: 'email', code: 'UNIQUE', message: 'Already exists' }],
    });
    const composite = await request(app.getHttpServer()).get('/probe/unique-composite').expect(409);
    const compositeBody = composite.body as ApiError;
    expect(compositeBody.fields?.map((f) => f.path)).toEqual(['ownerId', 'name']);
  });

  it('keeps 409 without fields when the constraint name is not Prisma-generated', async () => {
    const res = await request(app.getHttpServer()).get('/probe/unique-custom').expect(409);
    expect(res.body).toEqual({ statusCode: 409, code: 'CONFLICT', message: 'Already exists' });
  });

  it('maps a foreign-key RESTRICT (P2003) to 409 REFERENCE_CONFLICT without naming the constraint', async () => {
    const res = await request(app.getHttpServer()).get('/probe/reference').expect(409);
    expect(res.body).toEqual({
      statusCode: 409,
      code: 'REFERENCE_CONFLICT',
      message: 'Still referenced',
    });
  });

  it('hides unknown errors behind INTERNAL without details', async () => {
    const res = await request(app.getHttpServer()).get('/probe/boom').expect(500);
    expect(res.body).toEqual({
      statusCode: 500,
      code: 'INTERNAL',
      message: 'Internal server error',
    });
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('maps Nest HTTP exceptions by status', async () => {
    const res = await request(app.getHttpServer()).get('/probe/missing').expect(404);
    expect(res.body).toEqual({ statusCode: 404, code: 'NOT_FOUND', message: 'Not Found' });
  });

  it('keeps the status of an unlisted 4xx under the generic REQUEST_REJECTED code', async () => {
    const res = await request(app.getHttpServer()).get('/probe/teapot').expect(418);
    expect(res.body).toEqual({
      statusCode: 418,
      code: 'REQUEST_REJECTED',
      message: "I'm a teapot",
    });
  });

  it('rejects malformed JSON as a validation failure', async () => {
    const res = await request(app.getHttpServer())
      .post('/probe/echo')
      .set('Content-Type', 'application/json')
      .send('{"name":')
      .expect(422);
    expect((res.body as ApiError).code).toBe('VALIDATION_FAILED');
  });
});
