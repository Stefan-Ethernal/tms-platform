import { Controller, HttpCode, Module, Post } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Public, RequireSession, scanRouteAccess } from '@tms/domain/shared';
import request from 'supertest';
import snapshot from './route-access.snapshot.json';
import { createAdminTestApp, ORIGIN } from './support/app';

/** Only the field this suite checks; the full envelope shape is pinned in nest-bootstrap's own tests. */
const codeOf = (res: { body: unknown }) => (res.body as { code: string }).code;

/** Test-only POST routes: guards run only on matched routes (an unmatched path answers 404 before any guard). */
@Controller('origin-probe')
class OriginProbeController {
  @Public() @Post('public') @HttpCode(204) open(): void {
    /* 204 */
  }
  @RequireSession('ANY') @Post('session') @HttpCode(204) session(): void {
    /* 204 */
  }
}
@Module({ controllers: [OriginProbeController] })
class OriginProbeModule {}

describe('api-admin route access (fail-closed)', () => {
  it('every route carries exactly one marker, none at class level, and matches the reviewed snapshot', async () => {
    const { app } = await createAdminTestApp({ extraImports: [DiscoveryModule] });
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
    expect(actual).toEqual(snapshot);
    await app.close();
  });

  it('a foreign Origin is rejected before authentication (403, not 401)', async () => {
    const { app } = await createAdminTestApp({ extraImports: [OriginProbeModule] });
    const server = app.getHttpServer();
    const foreign = await request(server)
      .post('/api/origin-probe/session')
      .set('Origin', 'https://evil.example')
      .expect(403);
    expect(codeOf(foreign)).toBe('ORIGIN_REJECTED');
    const allowed = await request(server)
      .post('/api/origin-probe/session')
      .set('Origin', ORIGIN)
      .expect(401);
    expect(codeOf(allowed)).toBe('UNAUTHENTICATED');
    await app.close();
  });

  it('a mutation needs an allowed Origin or same-origin fetch metadata, even on a public route', async () => {
    const { app } = await createAdminTestApp({ extraImports: [OriginProbeModule] });
    const server = app.getHttpServer();
    await request(server).post('/api/origin-probe/public').set('Origin', ORIGIN).expect(204);
    await request(server)
      .post('/api/origin-probe/public')
      .set('Sec-Fetch-Site', 'same-origin')
      .expect(204);
    expect(codeOf(await request(server).post('/api/origin-probe/public').expect(403))).toBe(
      'ORIGIN_REJECTED',
    );
    await app.close();
  });
});
