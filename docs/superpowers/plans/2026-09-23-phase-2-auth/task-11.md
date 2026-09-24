# Phase 2 — Task 11: Sessions — `SessionService`, `StaffSessionResolver`, cookie, logout, session state

> Part of the phase 2 plan: read [index.md](index.md) (constraints, shared interfaces, env) and this file only.


**Files:**
- Modify: `packages/domain/package.json` (export `./admin`; the `@tms/auth-core` dependency is already there from Task 10), `packages/domain/test/shared/exports.spec.ts` (phase 1's package-surface spec: the manifest now has `./admin`)
- Create: `packages/domain/src/admin/index.ts`, `packages/domain/src/admin/admin-auth.module.ts`, `packages/domain/src/admin/auth/options.ts`, `packages/domain/src/admin/auth/ports.ts`, `packages/domain/src/admin/auth/sessions/session.service.ts`, `packages/domain/src/admin/auth/sessions/session-cookie.ts`, `packages/domain/src/admin/auth/sessions/evaluate-session.ts`, `packages/domain/src/admin/auth/sessions/staff-session.resolver.ts`
- Create: `packages/nest-bootstrap/src/http/no-store.middleware.ts` (export from `http/index.ts`); Modify: `packages/nest-bootstrap/src/app.ts` (phase 1's `configureApp`: install it for every route), `apps/api-driver/test/app.e2e-spec.ts` (header assertion)
- Modify: `apps/api-admin/src/env.ts`, `apps/api-admin/test/env.spec.ts` (defaults `toEqual` + production case), `apps/api-admin/src/app.module.ts`, `apps/api-admin/.env.example`, `infra/docker-compose.yml`
- Create: `apps/api-admin/src/auth/session.controller.ts`, `apps/api-admin/src/auth/auth-http.module.ts`
- Create: `packages/domain/test/admin/evaluate-session.spec.ts`, `packages/domain/test/admin/session-cookie.spec.ts`, `apps/api-admin/test/support/fixtures.ts`, `apps/api-admin/test/support/probe.module.ts`, `apps/api-admin/test/session.e2e-spec.ts`, `apps/api-admin/test/prisma-errors.e2e-spec.ts`
- Modify: `apps/api-admin/test/route-access.snapshot.json`

**Interfaces:**
- Consumes: `generateToken`, `hashToken`, `cryptoRandomSource`, `absoluteExpiry`, `isSessionExpired`, `shouldTouch`, `DEFAULT_SESSION_EXPIRY` (Tasks 03, 06); `PrincipalResolver`, `Principal`, `RequireSession`, `SkipSessionTouch`, `CurrentPrincipal` (Task 10); `SessionStateResponse`, `SessionScope`, `UserStatus`, `UserKind`, `DomainError` (Task 08, phase 1); `AuditService`, `Clock`, `ClsService`, `REQUEST_CONTEXT_KEY` + type `RequestContext` (a CLS value, not a provider), `TransactionHost` + type `AppTransactionHost`, `PrismaService` (phase 1).
- Produces:
  - `AdminAuthModule.forRoot(options: AdminAuthOptions): DynamicModule` (global) with `AdminAuthOptions = { session: { idleSeconds: number; fullAbsoluteSeconds: number; cookieSecure: boolean } }` — later tasks add fields.
  - DI tokens `AUTH_OPTIONS`, `RANDOM_SOURCE` (Task 14 adds `SECRET_CIPHER`, `PASSWORD_HASHER`, `TOTP_PROVIDER`).
  - `SessionService`: `create(userId, scope, { mfaVerified }): Promise<IssuedSession>`, `upgrade(sessionId, scope, { mfaVerified }): Promise<IssuedSession>` (rotates the token hash), `findByToken(token)`, `touch(sessionId, now)`, `destroy(sessionId)`, `revokeAllSessions(userId): Promise<number>`, `revokePreMfaSessions(userId): Promise<number>`, `recordMfaFailure(sessionId): Promise<number>` (returns attempts), `markMfaVerified(sessionId)`, `describe(principal: Pick<Principal, 'userId' | 'scope'>): Promise<SessionStateResponse>`, `logout(principal)`; `IssuedSession = { token: string; sessionId: string; userId: string; scope: SessionScope; expiresAt: Date }`.
  - `SessionCookie` (`name`, `read(req)`, `write(res, token)`, `clear(res)`); name `__Host-tms_admin_sid`, or `tms_admin_sid` when `cookieSecure` is false.
  - `evaluateStaffSession(session, now, expiry): { ok: true } | { ok: false; reason: 'EXPIRED' | 'NOT_STAFF' | 'STATUS' }` (pure).
  - `StaffSessionResolver` bound as api-admin's `PrincipalResolver`.
  - Routes `GET /api/auth/session` (`@RequireSession('ANY')`, `@SkipSessionTouch`), `POST /api/auth/logout` (`@RequireSession('ANY')`, 204).
  - `noStoreMiddleware`, installed by `configureApp` in front of every route of both APIs (errors and health included): phase 3b responses carry personal data and one-time PINs, and a per-controller route list would fail open whenever a controller is added.
  - Test fixtures: `seedBase(prisma)`, `createStaffUser(prisma, options)`, `loginAs(app, userId, scope?)`.

**Status-per-scope rule** (implemented by `evaluateStaffSession`; Review Focus 2): kind must be STAFF; `FULL` and `PRE_MFA` need `status = ACTIVE` and `totpEnabledAt ≠ null`; `ENROLLMENT` accepts `INVITED` or `ACTIVE`; `BLOCKED`/`DEACTIVATED` never pass; expired sessions (absolute `expiresAt` or idle `lastSeenAt + idle`) never pass. A failing session is deleted and its cookie cleared. The `Authorization` header is never read.

- [ ] **Step 1: Write the failing unit tests**

`packages/domain/test/admin/evaluate-session.spec.ts`:

```ts
import fc from 'fast-check';
import { DEFAULT_SESSION_EXPIRY } from '@tms/auth-core';
import { evaluateStaffSession } from '../../src/admin/auth/sessions/evaluate-session';

const NOW = new Date('2026-09-23T10:00:00Z');
const scopes = ['PRE_MFA', 'ENROLLMENT', 'FULL'] as const;
const statuses = ['INVITED', 'ACTIVE', 'BLOCKED', 'DEACTIVATED'] as const;
const kinds = ['STAFF', 'DRIVER'] as const;

function session(p: { scope: (typeof scopes)[number]; status: (typeof statuses)[number]; kind: (typeof kinds)[number]; enrolled: boolean; expired?: boolean; idle?: boolean }) {
  return {
    scope: p.scope,
    expiresAt: new Date(NOW.getTime() + (p.expired ? -1 : 60_000)),
    lastSeenAt: new Date(NOW.getTime() - (p.idle ? DEFAULT_SESSION_EXPIRY.idleSeconds * 1000 + 1 : 0)),
    user: { kind: p.kind, status: p.status, totpEnabledAt: p.enrolled ? NOW : null },
  };
}

describe('evaluateStaffSession', () => {
  it('matches the status-per-scope model for every combination', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...scopes), fc.constantFrom(...statuses), fc.constantFrom(...kinds), fc.boolean(), fc.boolean(), fc.boolean(),
        (scope, status, kind, enrolled, expired, idle) => {
          const verdict = evaluateStaffSession(session({ scope, status, kind, enrolled, expired, idle }), NOW, DEFAULT_SESSION_EXPIRY);
          const expected =
            !expired && !idle && kind === 'STAFF' &&
            (scope === 'ENROLLMENT' ? status === 'INVITED' || status === 'ACTIVE' : status === 'ACTIVE' && enrolled);
          expect(verdict.ok).toBe(expected);
        },
      ),
    );
  });

  it('never grants FULL without ACTIVE and an enrolled TOTP (invariant)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...statuses), fc.boolean(), (status, enrolled) => {
        const verdict = evaluateStaffSession(session({ scope: 'FULL', status, kind: 'STAFF', enrolled }), NOW, DEFAULT_SESSION_EXPIRY);
        if (verdict.ok) expect(status === 'ACTIVE' && enrolled).toBe(true);
      }),
    );
  });

  it('names the reason', () => {
    expect(evaluateStaffSession(session({ scope: 'FULL', status: 'ACTIVE', kind: 'DRIVER', enrolled: true }), NOW, DEFAULT_SESSION_EXPIRY)).toEqual({ ok: false, reason: 'NOT_STAFF' });
    expect(evaluateStaffSession(session({ scope: 'FULL', status: 'ACTIVE', kind: 'STAFF', enrolled: true, expired: true }), NOW, DEFAULT_SESSION_EXPIRY)).toEqual({ ok: false, reason: 'EXPIRED' });
    expect(evaluateStaffSession(session({ scope: 'FULL', status: 'BLOCKED', kind: 'STAFF', enrolled: true }), NOW, DEFAULT_SESSION_EXPIRY)).toEqual({ ok: false, reason: 'STATUS' });
  });
});
```

`packages/domain/test/admin/session-cookie.spec.ts`:

```ts
import { SessionCookie } from '../../src/admin/auth/sessions/session-cookie';

const token = 'A'.repeat(43);
function fakeRes() {
  const calls: unknown[][] = [];
  return { calls, res: { cookie: (...a: unknown[]) => calls.push(['cookie', ...a]), clearCookie: (...a: unknown[]) => calls.push(['clear', ...a]) } };
}

describe('SessionCookie', () => {
  it('writes a __Host- cookie with strict attributes and no Max-Age', () => {
    const cookie = new SessionCookie({ session: { idleSeconds: 3600, fullAbsoluteSeconds: 43200, cookieSecure: true } });
    const { calls, res } = fakeRes();
    cookie.write(res as never, token);
    expect(calls).toEqual([['cookie', '__Host-tms_admin_sid', token, { httpOnly: true, secure: true, sameSite: 'strict', path: '/' }]]);
  });

  it('falls back to a plain name when Secure is disabled (non-production only)', () => {
    const cookie = new SessionCookie({ session: { idleSeconds: 3600, fullAbsoluteSeconds: 43200, cookieSecure: false } });
    expect(cookie.name).toBe('tms_admin_sid');
  });

  it('reads only well-formed tokens', () => {
    const cookie = new SessionCookie({ session: { idleSeconds: 3600, fullAbsoluteSeconds: 43200, cookieSecure: true } });
    expect(cookie.read({ cookies: { '__Host-tms_admin_sid': token } } as never)).toBe(token);
    expect(cookie.read({ cookies: { '__Host-tms_admin_sid': 'x' } } as never)).toBeNull();
    expect(cookie.read({ cookies: {} } as never)).toBeNull();
    expect(cookie.read({ headers: { authorization: `Bearer ${token}` } } as never)).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing API tests**

`apps/api-admin/test/support/fixtures.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { SessionScope, UserKind, UserStatus } from '@tms/contracts';
import { PrismaService } from '@tms/db/nest';
import { resetTestDatabase } from '@tms/db/testing';
import { seedDatabase } from '@tms/db';
import { SessionCookie, SessionService } from '@tms/domain/admin';

export async function seedBase(app: INestApplication): Promise<PrismaService> {
  await resetTestDatabase();
  const prisma = app.get(PrismaService);
  await seedDatabase(prisma, { bootstrapAdmin: { email: 'bootstrap@example.com' } });
  return prisma;
}

export async function roleIdByKey(prisma: PrismaService, key: 'admin' | 'operator' | 'driver'): Promise<string> {
  return (await prisma.role.findUniqueOrThrow({ where: { key } })).id;
}

export interface StaffUserOptions {
  role?: 'admin' | 'operator' | 'driver';
  status?: UserStatus;
  kind?: UserKind;
  enrolled?: boolean;
  email?: string;
}

/** A user row without credentials; Tasks 14 and 16 add `withCredentials` on top. */
export async function createStaffUser(prisma: PrismaService, o: StaffUserOptions = {}) {
  const email = o.email ?? `${randomUUID()}@example.com`;
  return prisma.user.create({
    data: {
      kind: o.kind ?? 'STAFF',
      username: email.split('@')[0] ?? email,
      firstName: 'Test',
      lastName: 'User',
      email,
      status: o.status ?? 'ACTIVE',
      roleId: await roleIdByKey(prisma, o.role ?? 'admin'),
      locale: 'en',
      totpEnabledAt: (o.enrolled ?? true) ? new Date('2026-01-01T00:00:00Z') : null,
      totpSecretEnc: (o.enrolled ?? true) ? 'fixture-without-secret' : null,
    },
  });
}

/** Issues a session directly (bypassing login) and returns the Cookie header value. */
export async function loginAs(app: INestApplication, userId: string, scope: SessionScope = 'FULL'): Promise<string> {
  const issued = await app.get(SessionService).create(userId, scope, { mfaVerified: scope === 'FULL' });
  return `${app.get(SessionCookie).name}=${issued.token}`;
}
```

`apps/api-admin/test/support/probe.module.ts` (test-only routes to exercise the guards; never part of the app):

```ts
import { Controller, Get, Module } from '@nestjs/common';
import { RequirePermissions, RequireSession } from '@tms/domain/shared';

@Controller('probe')
class ProbeController {
  @RequireSession('ANY') @Get('any') any() { return { ok: true }; }
  @RequireSession('FULL') @Get('full') full() { return { ok: true }; }
  @RequirePermissions('users:read') @Get('users-read') usersRead() { return { ok: true }; }
}

@Module({ controllers: [ProbeController] })
export class ProbeModule {}
```

`apps/api-admin/test/session.e2e-spec.ts`:

```ts
import request from 'supertest';
import { createAdminTestApp, type AdminTestApp, ORIGIN } from './support/app';
import { createStaffUser, loginAs, seedBase } from './support/fixtures';
import { ProbeModule } from './support/probe.module';
import type { PrismaService } from '@tms/db/nest';

describe('staff sessions (API)', () => {
  let t: AdminTestApp;
  let prisma: PrismaService;
  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => { t = await createAdminTestApp({ extraImports: [ProbeModule] }); });
  afterAll(() => t.app.close());
  beforeEach(async () => { prisma = await seedBase(t.app); t.clock.set(new Date('2026-09-23T10:00:00Z')); });

  it('401 without a cookie; the Authorization header is ignored', async () => {
    expect((await http().get('/api/probe/any').expect(401)).body.code).toBe('UNAUTHENTICATED');
    await http().get('/api/probe/any').set('Authorization', 'Bearer abc').expect(401);
  });

  it('every response is no-store, including health and errors', async () => {
    expect((await http().get('/api/health').expect(200)).headers['cache-control']).toBe('no-store');
    expect((await http().get('/api/probe/any').expect(401)).headers['cache-control']).toBe('no-store');
    expect((await http().get('/api/does-not-exist').expect(404)).headers['cache-control']).toBe('no-store');
  });

  it('describes a FULL session with no-store', async () => {
    const user = await createStaffUser(prisma);
    const cookie = await loginAs(t.app, user.id);
    const res = await http().get('/api/auth/session').set('Cookie', cookie).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ scope: 'FULL', next: 'NONE', user: { id: user.id, email: user.email, firstName: 'Test', lastName: 'User' } });
  });

  it('expires after 60 idle minutes, extends on activity, ends at 12 hours', async () => {
    const user = await createStaffUser(prisma);
    const cookie = await loginAs(t.app, user.id);
    // 15 steps of 50 minutes: steps 1-14 end before 720 minutes (200), step 15 ends at 750 (401)
    let sawAbsoluteExpiry = false;
    for (let i = 0; i < 15; i += 1) {
      t.clock.advance(50 * 60_000);
      const expected = (i + 1) * 50 < 12 * 60 ? 200 : 401;
      await http().get('/api/probe/any').set('Cookie', cookie).expect(expected);
      if (expected === 401) {
        sawAbsoluteExpiry = true;
        break;
      }
    }
    expect(sawAbsoluteExpiry).toBe(true);
    const idle = await loginAs(t.app, user.id);
    t.clock.advance(61 * 60_000);
    await http().get('/api/probe/any').set('Cookie', idle).expect(401);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it('polling GET /auth/session does not extend the idle timeout', async () => {
    const user = await createStaffUser(prisma);
    const cookie = await loginAs(t.app, user.id);
    t.clock.advance(40 * 60_000);
    await http().get('/api/auth/session').set('Cookie', cookie).expect(200);
    t.clock.advance(21 * 60_000);
    await http().get('/api/auth/session').set('Cookie', cookie).expect(401);
  });

  it.each(['BLOCKED', 'DEACTIVATED'] as const)('rejects a %s user on the next request and deletes the session', async (status) => {
    const user = await createStaffUser(prisma);
    const cookie = await loginAs(t.app, user.id);
    await prisma.user.update({ where: { id: user.id }, data: { status } });
    const res = await http().get('/api/probe/any').set('Cookie', cookie).expect(401);
    expect(res.headers['set-cookie']?.[0]).toMatch(/^__Host-tms_admin_sid=;/);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it('rejects a DRIVER user even with a session row', async () => {
    const driver = await createStaffUser(prisma, { kind: 'DRIVER', role: 'driver' });
    await http().get('/api/probe/any').set('Cookie', await loginAs(t.app, driver.id)).expect(401);
  });

  it('pre-sessions cannot reach FULL routes', async () => {
    const user = await createStaffUser(prisma);
    await http().get('/api/probe/full').set('Cookie', await loginAs(t.app, user.id, 'PRE_MFA')).expect(401);
    await http().get('/api/probe/any').set('Cookie', await loginAs(t.app, user.id, 'PRE_MFA')).expect(200);
  });

  it('403 when the role lacks the permission', async () => {
    const operator = await createStaffUser(prisma, { role: 'operator' });
    expect((await http().get('/api/probe/users-read').set('Cookie', await loginAs(t.app, operator.id)).expect(403)).body.code).toBe('FORBIDDEN');
    const admin = await createStaffUser(prisma, { role: 'admin' });
    await http().get('/api/probe/users-read').set('Cookie', await loginAs(t.app, admin.id)).expect(200);
  });

  it('rejects an unknown token and clears the cookie', async () => {
    const res = await http().get('/api/probe/any').set('Cookie', `__Host-tms_admin_sid=${'B'.repeat(43)}`).expect(401);
    expect(res.headers['set-cookie']?.[0]).toMatch(/^__Host-tms_admin_sid=;/);
  });

  it('logout deletes the session, clears the cookie and is audited', async () => {
    const user = await createStaffUser(prisma);
    const cookie = await loginAs(t.app, user.id);
    const res = await http().post('/api/auth/logout').set('Origin', ORIGIN).set('Cookie', cookie).expect(204);
    expect(res.headers['set-cookie']?.[0]).toMatch(/^__Host-tms_admin_sid=; Path=\/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict$/);
    await http().get('/api/probe/any').set('Cookie', cookie).expect(401);
    const rows = await prisma.auditLog.findMany({ where: { action: 'auth.session.revoked', actorUserId: user.id, outcome: 'SUCCESS' } });
    expect(rows.map((r) => r.metadata)).toEqual([{ reason: 'LOGOUT', sessionCount: 1 }]);
  });
});
```

Add to `route-access.snapshot.json` (sorted by route):

```json
{ "route": "GET /api/auth/session", "access": { "kind": "session", "scopes": ["ANY"], "stepUp": false } },
{ "route": "POST /api/auth/logout", "access": { "kind": "session", "scopes": ["ANY"], "stepUp": false } }
```

`apps/api-admin/test/prisma-errors.e2e-spec.ts` pins Task 09's Prisma mapping against real Postgres errors from the driver adapter (Task 09 only fakes their shape):

```ts
import type { PrismaService } from '@tms/db/nest';
import { toApiError } from '@tms/nest-bootstrap';
import { createAdminTestApp, type AdminTestApp } from './support/app';
import { createStaffUser, seedBase } from './support/fixtures';

async function rejection(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error('expected the operation to be rejected');
}

describe('Prisma errors from real Postgres', () => {
  let t: AdminTestApp;
  let prisma: PrismaService;

  beforeAll(async () => { t = await createAdminTestApp(); });
  afterAll(() => t.app.close());
  beforeEach(async () => { prisma = await seedBase(t.app); });

  it('a duplicate email (P2002 on User_email_key) maps to 409 CONFLICT with the field', async () => {
    const first = await createStaffUser(prisma);
    const second = await createStaffUser(prisma);
    // update, not create: only the email collides (createStaffUser derives the unique username from the email)
    const error = await rejection(prisma.user.update({ where: { id: second.id }, data: { email: first.email } }));
    expect(toApiError(error)).toEqual({
      statusCode: 409, code: 'CONFLICT', message: 'Already exists',
      fields: [{ path: 'email', code: 'UNIQUE', message: 'Already exists' }],
    });
  });

  it('deleting a role a user still holds (P2003, RESTRICT) maps to 409 REFERENCE_CONFLICT', async () => {
    const user = await createStaffUser(prisma, { role: 'operator' });
    const error = await rejection(prisma.role.delete({ where: { id: user.roleId } }));
    expect(toApiError(error)).toEqual({ statusCode: 409, code: 'REFERENCE_CONFLICT', message: 'Still referenced' });
  });
});
```

In `apps/api-driver/test/app.e2e-spec.ts`, the unknown-route case (`GET /api/does-not-exist` → 404) also asserts `expect(res.headers['cache-control']).toBe('no-store')`. Phase 1's health case already asserts `no-store`: `HealthController.check()` sets the header itself; the middleware extends it to every other response.

`packages/domain/test/shared/exports.spec.ts` (phase 1 Task 14): rename the first case to `'exports only ./shared and ./admin, so the bare specifier cannot resolve'` and extend its manifest expectation:

```ts
    expect(manifest.exports).toEqual({
      './shared': { types: './dist/shared/index.d.ts', default: './dist/shared/index.js' },
      './admin': { types: './dist/admin/index.d.ts', default: './dist/admin/index.js' },
    });
```

(The names case for `@tms/domain/shared` is unchanged here: Task 11 adds nothing to `shared`.)

`apps/api-admin/test/env.spec.ts` (phase 1's exact-defaults spec, importing `envSchema` from `../src/env` since Task 10): add `SESSION_IDLE_MINUTES: 60, SESSION_ABSOLUTE_HOURS: 12, SESSION_COOKIE_SECURE: true` to the defaults `toEqual`, and a case `NODE_ENV=production SESSION_COOKIE_SECURE=false` → `loadEnv(envSchema, …)` throws a message containing `SESSION_COOKIE_SECURE`.

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm turbo run test --filter=@tms/domain && pnpm turbo run test --filter=@tms/api-admin && pnpm turbo run test --filter=@tms/api-driver`
Expected: FAIL — `@tms/domain/admin` does not exist; `/api/auth/session` returns 404; the 401 and 404 responses have no `Cache-Control` header (health has it since phase 1); the manifest case of `exports.spec` misses `./admin`; the env spec misses the three session defaults. `prisma-errors.e2e-spec` already passes if Task 09's mapping matches the real error shape; if it fails, fix `violatedConstraint` in Task 09's filter, not the test.

- [ ] **Step 4: Implement the module, options, ports and cookie**

`packages/domain/package.json`: add `"./admin": { "types": "./dist/admin/index.d.ts", "default": "./dist/admin/index.js" }` to `exports` (same shape as `./shared`). The `@tms/auth-core` dependency arrived with Task 10's `AccessGuard`; the boundaries allowance `domain → auth-core` exists since phase 1 Task 02.

`packages/domain/src/admin/auth/options.ts`:

```ts
export interface AdminAuthOptions {
  session: { idleSeconds: number; fullAbsoluteSeconds: number; cookieSecure: boolean };
}
export const AUTH_OPTIONS = 'tms:AdminAuthOptions';
```

`packages/domain/src/admin/auth/ports.ts`:

```ts
/** DI tokens for the auth-core ports (interfaces cannot be tokens). */
export const RANDOM_SOURCE = 'tms:RandomSource';
```

Every `admin` service types its transaction host with phase 1's `AppTransactionHost` (`TransactionHost<TransactionalAdapterPrisma<PrismaService>>`, exported by `packages/domain/src/shared/index.ts`) and injects it with `@Inject(TransactionHost)`: a type alias is emitted as `Object` in decorator metadata. Inside `packages/domain`, `admin` imports `shared` by relative path, never by its own package specifier.

`packages/domain/src/admin/auth/sessions/session-cookie.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AUTH_OPTIONS, type AdminAuthOptions } from '../options';

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

@Injectable()
export class SessionCookie {
  readonly name: string;
  private readonly secure: boolean;

  constructor(@Inject(AUTH_OPTIONS) options: Pick<AdminAuthOptions, 'session'>) {
    this.secure = options.session.cookieSecure;
    this.name = this.secure ? '__Host-tms_admin_sid' : 'tms_admin_sid';
  }

  read(req: Request): string | null {
    const value = (req.cookies as Record<string, unknown> | undefined)?.[this.name];
    return typeof value === 'string' && TOKEN_SHAPE.test(value) ? value : null;
  }

  write(res: Response, token: string): void {
    res.cookie(this.name, token, { httpOnly: true, secure: this.secure, sameSite: 'strict', path: '/' });
  }

  clear(res: Response): void {
    res.clearCookie(this.name, { httpOnly: true, secure: this.secure, sameSite: 'strict', path: '/' });
  }
}
```

`packages/domain/src/admin/auth/sessions/evaluate-session.ts`:

```ts
import { isSessionExpired, type SessionExpiryConfig } from '@tms/auth-core';

export interface SessionForEvaluation {
  scope: 'PRE_MFA' | 'ENROLLMENT' | 'FULL';
  expiresAt: Date;
  lastSeenAt: Date;
  user: { kind: string; status: string; totpEnabledAt: Date | null };
}

export type SessionVerdict = { ok: true } | { ok: false; reason: 'EXPIRED' | 'NOT_STAFF' | 'STATUS' };

/** Status-per-scope rule (plan Task 11): FULL ⇒ ACTIVE ∧ enrolled; ENROLLMENT ⇒ INVITED ∨ ACTIVE. */
export function evaluateStaffSession(s: SessionForEvaluation, now: Date, expiry: SessionExpiryConfig): SessionVerdict {
  if (isSessionExpired(s, now, expiry)) return { ok: false, reason: 'EXPIRED' };
  if (s.user.kind !== 'STAFF') return { ok: false, reason: 'NOT_STAFF' };
  const { status, totpEnabledAt } = s.user;
  const allowed =
    s.scope === 'ENROLLMENT' ? status === 'INVITED' || status === 'ACTIVE' : status === 'ACTIVE' && totpEnabledAt !== null;
  return allowed ? { ok: true } : { ok: false, reason: 'STATUS' };
}
```

- [ ] **Step 5: Implement `SessionService` and the resolver**

`packages/domain/src/admin/auth/sessions/session.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import {
  absoluteExpiry, DEFAULT_SESSION_EXPIRY, generateToken, hashToken, type RandomSource, type SessionExpiryConfig,
} from '@tms/auth-core';
import type { SessionScope, SessionStateResponse } from '@tms/contracts';
import {
  type AppTransactionHost, AuditService, Clock, ClsService, type Principal, REQUEST_CONTEXT_KEY, type RequestContext,
  TransactionHost,
} from '../../../shared';
import { AUTH_OPTIONS, type AdminAuthOptions } from '../options';
import { RANDOM_SOURCE } from '../ports';

export interface IssuedSession {
  token: string;
  sessionId: string;
  userId: string;
  scope: SessionScope;
  expiresAt: Date;
}

const TOUCH_INTERVAL_MS = 60_000;

@Injectable()
export class SessionService {
  readonly expiry: SessionExpiryConfig;

  constructor(
    @Inject(TransactionHost) private readonly txHost: AppTransactionHost,
    private readonly clock: Clock,
    private readonly cls: ClsService,
    private readonly audit: AuditService,
    @Inject(RANDOM_SOURCE) private readonly random: RandomSource,
    @Inject(AUTH_OPTIONS) options: AdminAuthOptions,
  ) {
    this.expiry = {
      ...DEFAULT_SESSION_EXPIRY,
      idleSeconds: options.session.idleSeconds,
      fullAbsoluteSeconds: options.session.fullAbsoluteSeconds,
    };
  }

  private get db() {
    return this.txHost.tx;
  }

  /** Phase 1's CLS middleware stores the request context; CLIs and tests without a request have none. */
  private get context(): RequestContext | undefined {
    return this.cls.isActive() ? this.cls.get<RequestContext | undefined>(REQUEST_CONTEXT_KEY) : undefined;
  }

  async create(userId: string, scope: SessionScope, opts: { mfaVerified: boolean }): Promise<IssuedSession> {
    const now = this.clock.now();
    const token = generateToken(this.random);
    const context = this.context;
    const session = await this.db.session.create({
      data: {
        userId,
        scope,
        tokenHash: hashToken(token),
        mfaVerifiedAt: opts.mfaVerified ? now : null,
        mfaAttempts: 0,
        expiresAt: absoluteExpiry(scope, now, this.expiry),
        lastSeenAt: now,
        ip: context?.ip ?? null,
        userAgent: context?.userAgent ?? null, // already cut to USER_AGENT_MAX_LENGTH by phase 1
      },
    });
    return { token, sessionId: session.id, userId: session.userId, scope, expiresAt: session.expiresAt };
  }

  /** Scope change on the same row (D4) with a new token hash (no session fixation). */
  async upgrade(sessionId: string, scope: SessionScope, opts: { mfaVerified: boolean }): Promise<IssuedSession> {
    const now = this.clock.now();
    const token = generateToken(this.random);
    const session = await this.db.session.update({
      where: { id: sessionId },
      data: {
        scope,
        tokenHash: hashToken(token),
        totpPendingSecretEnc: null,
        mfaAttempts: 0,
        ...(opts.mfaVerified ? { mfaVerifiedAt: now } : {}),
        expiresAt: absoluteExpiry(scope, now, this.expiry),
        lastSeenAt: now,
      },
    });
    return { token, sessionId: session.id, userId: session.userId, scope, expiresAt: session.expiresAt };
  }

  findByToken(token: string) {
    return this.db.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        user: {
          select: {
            id: true, kind: true, status: true, totpEnabledAt: true,
            role: { select: { permissions: { select: { permissionCode: true } } } },
          },
        },
      },
    });
  }

  async touch(sessionId: string, now: Date): Promise<void> {
    await this.db.session.updateMany({
      where: { id: sessionId, lastSeenAt: { lt: new Date(now.getTime() - TOUCH_INTERVAL_MS) } },
      data: { lastSeenAt: now },
    });
  }

  async destroy(sessionId: string): Promise<void> {
    await this.db.session.deleteMany({ where: { id: sessionId } });
  }

  async revokeAllSessions(userId: string): Promise<number> {
    return (await this.db.session.deleteMany({ where: { userId } })).count;
  }

  async revokePreMfaSessions(userId: string): Promise<number> {
    return (await this.db.session.deleteMany({ where: { userId, scope: 'PRE_MFA' } })).count;
  }

  async recordMfaFailure(sessionId: string): Promise<number> {
    const s = await this.db.session.update({ where: { id: sessionId }, data: { mfaAttempts: { increment: 1 } }, select: { mfaAttempts: true } });
    return s.mfaAttempts;
  }

  async markMfaVerified(sessionId: string): Promise<void> {
    await this.db.session.update({ where: { id: sessionId }, data: { mfaVerifiedAt: this.clock.now() } });
  }

  async describe(principal: Pick<Principal, 'userId' | 'scope'>): Promise<SessionStateResponse> {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: principal.userId },
      select: { id: true, email: true, firstName: true, lastName: true, passwordHash: true },
    });
    const next =
      principal.scope === 'FULL' ? 'NONE' : principal.scope === 'PRE_MFA' ? 'VERIFY_MFA' : user.passwordHash ? 'ENROLL_TOTP' : 'SET_PASSWORD';
    return { scope: principal.scope, next, user: { id: user.id, email: user.email ?? '', firstName: user.firstName, lastName: user.lastName } };
  }

  /** Delete and audit in one transaction (CLAUDE.md: audit rows are written inside the caller's transaction). */
  logout(principal: Principal): Promise<void> {
    return this.txHost.withTransaction(async () => {
      const { count } = await this.db.session.deleteMany({ where: { id: principal.sessionId } });
      await this.audit.record({
        action: 'auth.session.revoked', outcome: 'SUCCESS', actorUserId: principal.userId,
        metadata: { reason: 'LOGOUT', sessionCount: count },
      });
    });
  }
}
```

(`UnitOfWork` arrives only in Task 12; logout queues no after-commit effect, so the plain `txHost.withTransaction` is enough. Phase 1's `RequestContext` is `{ requestId; ip?; userAgent? }` in the CLS store under `REQUEST_CONTEXT_KEY`, read the same way `AuditService` reads it.)

`packages/domain/src/admin/auth/sessions/staff-session.resolver.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { shouldTouch } from '@tms/auth-core';
import type { PermissionCode } from '@tms/contracts';
import type { Request, Response } from 'express';
import { Clock, type Principal, PrincipalResolver } from '../../../shared';
import { evaluateStaffSession } from './evaluate-session';
import { SessionCookie } from './session-cookie';
import { SessionService } from './session.service';

@Injectable()
export class StaffSessionResolver extends PrincipalResolver {
  constructor(
    private readonly sessions: SessionService,
    private readonly cookie: SessionCookie,
    private readonly clock: Clock,
  ) {
    super();
  }

  override async resolve(req: Request, res: Response, options: { touch: boolean }): Promise<Principal | null> {
    const token = this.cookie.read(req);
    if (!token) return null;
    const now = this.clock.now();
    const session = await this.sessions.findByToken(token);
    if (!session) {
      this.cookie.clear(res);
      return null;
    }
    if (!evaluateStaffSession(session, now, this.sessions.expiry).ok) {
      await this.sessions.destroy(session.id);
      this.cookie.clear(res);
      return null;
    }
    if (options.touch && shouldTouch(session.lastSeenAt, now)) await this.sessions.touch(session.id, now);
    const codes = session.scope === 'FULL' ? session.user.role.permissions.map((p) => p.permissionCode as PermissionCode) : [];
    return {
      userId: session.userId,
      sessionId: session.id,
      scope: session.scope,
      permissions: new Set(codes),
      mfaVerifiedAt: session.mfaVerifiedAt,
    };
  }
}
```

`packages/domain/src/admin/admin-auth.module.ts`:

```ts
import { type DynamicModule, Module } from '@nestjs/common';
import { cryptoRandomSource } from '@tms/auth-core';
import { AUTH_OPTIONS, type AdminAuthOptions } from './auth/options';
import { RANDOM_SOURCE } from './auth/ports';
import { SessionCookie } from './auth/sessions/session-cookie';
import { SessionService } from './auth/sessions/session.service';
import { StaffSessionResolver } from './auth/sessions/staff-session.resolver';

@Module({})
export class AdminAuthModule {
  static forRoot(options: AdminAuthOptions): DynamicModule {
    return {
      module: AdminAuthModule,
      global: true,
      providers: [
        { provide: AUTH_OPTIONS, useValue: options },
        { provide: RANDOM_SOURCE, useValue: cryptoRandomSource },
        SessionCookie,
        SessionService,
        StaffSessionResolver,
      ],
      exports: [AUTH_OPTIONS, SessionCookie, SessionService, StaffSessionResolver],
    };
  }
}
```

`packages/domain/src/admin/index.ts` exports `AdminAuthModule`, `AdminAuthOptions`, `AUTH_OPTIONS`, `SessionService`, `IssuedSession`, `SessionCookie`, `StaffSessionResolver`, `evaluateStaffSession`.

`packages/nest-bootstrap/src/http/no-store.middleware.ts`:

```ts
import type { NextFunction, Request, Response } from 'express';

/** No API response may be cached: tokens, recovery codes, session state, personal data, one-time PINs. */
export function noStoreMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  next();
}
```

- [ ] **Step 6: Wire api-admin**

`apps/api-admin/src/env.ts` (Task 10's file; phase 1's names `envSchema` and `Env`) — add to the object literal of its `.extend({ … })` call:

```ts
SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).max(24 * 60).default(60),
SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(7 * 24).default(12),
SESSION_COOKIE_SECURE: z.stringbool().default(true),
```

and chain a refinement after the `.extend(…)`: `.refine((env) => env.NODE_ENV !== 'production' || env.SESSION_COOKIE_SECURE, { path: ['SESSION_COOKIE_SECURE'], message: 'must be true in production' })`. zod 4 refuses `.extend()` on a refined object schema, so from here on every task adds its variables inside that one object literal and its refinements to the chain after it; nothing calls `envSchema.extend`. The env spec cases are in Step 2.

`apps/api-admin/src/auth/session.controller.ts`:

```ts
import { Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import type { SessionStateResponse } from '@tms/contracts';
import { SessionCookie, SessionService } from '@tms/domain/admin';
import { CurrentPrincipal, type Principal, RequireSession, SkipSessionTouch } from '@tms/domain/shared';
import type { Response } from 'express';

@Controller('auth')
export class SessionController {
  constructor(private readonly sessions: SessionService, private readonly cookie: SessionCookie) {}

  @RequireSession('ANY')
  @SkipSessionTouch()
  @Get('session')
  state(@CurrentPrincipal() principal: Principal): Promise<SessionStateResponse> {
    return this.sessions.describe(principal);
  }

  @RequireSession('ANY')
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentPrincipal() principal: Principal, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.sessions.logout(principal);
    this.cookie.clear(res);
  }
}
```

`apps/api-admin/src/auth/auth-http.module.ts`: `@Module({ controllers: [SessionController] }) export class AuthHttpModule {}` (later tasks add controllers here).

`apps/api-admin/src/app.module.ts` (`forRoot(env)`): import `AdminAuthModule.forRoot({ session: { idleSeconds: env.SESSION_IDLE_MINUTES * 60, fullAbsoluteSeconds: env.SESSION_ABSOLUTE_HOURS * 3600, cookieSecure: env.SESSION_COOKIE_SECURE } })` and `AuthHttpModule`; replace `{ provide: PrincipalResolver, useClass: DenyAllPrincipalResolver }` with `{ provide: PrincipalResolver, useExisting: StaffSessionResolver }`.

`packages/nest-bootstrap/src/app.ts` (`configureApp`): add `app.use(noStoreMiddleware);` right after `app.use(cookieParser());` (Task 09), so both APIs send `Cache-Control: no-store` on every response, including the ones the guards or the filter produce.

`.env.example` and compose `api-admin`: `SESSION_IDLE_MINUTES=60`, `SESSION_ABSOLUTE_HOURS=12`, `SESSION_COOKIE_SECURE=true`.

- [ ] **Step 7: Run the tests**

Run: `pnpm turbo run test --filter=@tms/domain && pnpm turbo run test --filter=@tms/api-admin && pnpm turbo run test --filter=@tms/api-driver`
Expected: `evaluate-session` (3), `session-cookie` (3), `session.e2e-spec` (12 cases incl. `it.each`), `prisma-errors.e2e-spec` (2), `exports.spec` (2), route-access snapshot, env spec (defaults + production case), api-driver 404 with `no-store` — all pass.

- [ ] **Step 8: Verify, commit**

Run: `pnpm verify`
Expected: green; boundaries report no violation for `@tms/domain/admin` → `@tms/auth-core` (allowance from phase 1 Task 02).

```bash
git add packages/domain packages/nest-bootstrap apps/api-admin apps/api-driver infra/docker-compose.yml docs/efficiency/critical-path.md
git commit -m "feat(domain): add staff sessions with a status-per-scope resolver, logout and session state"
```

PR body: diagram `stateDiagram-v2` (no session → PRE_MFA/ENROLLMENT → FULL, expiry and revocation edges); boundaries: new subpath `@tms/domain/admin`, api-admin routes, env, `configureApp` now sets `Cache-Control: no-store` on every response of both APIs; no migration; reviewer: `security-reviewer`.
