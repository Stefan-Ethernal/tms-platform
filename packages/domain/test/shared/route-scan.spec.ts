import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { scanRouteAccess } from '../../src/shared';
import { ClassMarkedController, ProbeController } from './probe.fixture';

@Module({ imports: [DiscoveryModule], controllers: [ProbeController, ClassMarkedController] })
class ScanModule {}

describe('scanRouteAccess', () => {
  it('lists every route with its access and reports missing, double and class-level markers', async () => {
    const app = (
      await Test.createTestingModule({ imports: [ScanModule] }).compile()
    ).createNestApplication({ logger: false });
    await app.init();
    const entries = scanRouteAccess(app, '');
    const byHandler = Object.fromEntries(entries.map((e) => [`${e.controller}.${e.handler}`, e]));
    expect(byHandler['ProbeController.none']?.access).toEqual({
      kind: 'invalid',
      reason: 'NONE',
      stepUp: false,
    });
    expect(byHandler['ProbeController.two']?.access).toEqual({
      kind: 'invalid',
      reason: 'MULTIPLE',
      stepUp: false,
    });
    expect(byHandler['ProbeController.perm']).toMatchObject({
      method: 'GET',
      path: '/p/perm',
      access: { kind: 'permissions', codes: ['users:read', 'users:block'], stepUp: false },
    });
    expect(byHandler['ClassMarkedController.x']?.classMarkers).toEqual(['tms:public-route']);
    expect(byHandler['ClassMarkedController.x']?.access.kind).toBe('invalid');
    expect(byHandler['ProbeController.publicStepUp']?.access).toEqual({
      kind: 'invalid',
      reason: 'MULTIPLE',
      stepUp: true,
    });
    await app.close();
  });
});
