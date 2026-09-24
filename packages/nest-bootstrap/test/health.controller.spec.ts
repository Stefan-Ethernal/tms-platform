import 'reflect-metadata';
import { ServiceUnavailableException } from '@nestjs/common';
import type { HealthIndicatorResult } from '@nestjs/terminus';
import { PUBLIC_ROUTE_KEY } from '@tms/contracts';
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

describe('HealthController', () => {
  it('is marked public for the phase 3a guard', () => {
    const handler = Object.getOwnPropertyDescriptor(HealthController.prototype, 'check')
      ?.value as object;
    expect(Reflect.getMetadata(PUBLIC_ROUTE_KEY, handler)).toBe(true);
  });

  it('answers { status: "ok", service } when the database is up', async () => {
    await expect(controllerWith('up').check()).resolves.toEqual({
      status: 'ok',
      service: 'api-driver',
    });
  });

  it('throws a 503 whose body is exactly { status: "degraded", service } when the database is down', async () => {
    const error = await controllerWith('down')
      .check()
      .then(
        () => undefined,
        (thrown: unknown) => thrown,
      );
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getStatus()).toBe(503);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      status: 'degraded',
      service: 'api-driver',
    });
  });
});
