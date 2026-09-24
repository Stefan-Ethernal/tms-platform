import 'reflect-metadata';
import type { HealthIndicatorResult } from '@nestjs/terminus';
import { PUBLIC_ROUTE_KEY } from '@tms/contracts';
import type { Response } from 'express';
import { HealthController } from '../src/health/health.controller';
import type { HealthService } from '../src/health/health.service';

const controllerWith = (status: 'up' | 'down'): HealthController =>
  new HealthController(
    {
      checkDatabase: (): Promise<HealthIndicatorResult<'db'>> =>
        Promise.resolve({ db: { status } }),
    } as unknown as HealthService,
    { service: 'api-driver', dbTimeoutMs: 1000 },
  );

/** `check()` sets the status on `@Res({ passthrough: true })` directly (bypasses ApiExceptionFilter). */
const fakeRes = (): { status: jest.Mock } => ({ status: jest.fn() });

describe('HealthController', () => {
  it('is marked public for the phase 3a guard', () => {
    const handler = Object.getOwnPropertyDescriptor(HealthController.prototype, 'check')
      ?.value as object;
    expect(Reflect.getMetadata(PUBLIC_ROUTE_KEY, handler)).toBe(true);
  });

  it('answers { status: "ok", service } when the database is up, without touching the response status', async () => {
    const res = fakeRes();
    await expect(controllerWith('up').check(res as unknown as Response)).resolves.toEqual({
      status: 'ok',
      service: 'api-driver',
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('answers { status: "degraded", service } with a 503 response status when the database is down', async () => {
    const res = fakeRes();
    await expect(controllerWith('down').check(res as unknown as Response)).resolves.toEqual({
      status: 'degraded',
      service: 'api-driver',
    });
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
