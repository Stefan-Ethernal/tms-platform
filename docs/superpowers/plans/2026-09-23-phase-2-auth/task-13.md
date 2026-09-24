# Phase 2 — Task 13: Invite — action tokens, issue/resend, accept → ENROLLMENT

> Part of the phase 2 plan: read [index.md](index.md) (constraints, shared interfaces, env) and this file only.


**Files:**
- Create: `packages/domain/src/admin/auth/tokens/action-token.service.ts`, `packages/domain/src/admin/auth/invites/invite.service.ts`
- Modify: `packages/domain/src/admin/auth/options.ts` (`invite`, `webBaseUrl`), `packages/domain/src/admin/admin-auth.module.ts`, `packages/domain/src/admin/index.ts`
- Create: `apps/api-admin/src/auth/dto.ts`, `apps/api-admin/src/auth/invite.controller.ts`, `apps/api-admin/src/admin/users/user-admin.controller.ts`, `apps/api-admin/src/admin/admin-http.module.ts`
- Modify: `apps/api-admin/src/env.ts`, `apps/api-admin/test/env.spec.ts` (defaults `toEqual`), `apps/api-admin/src/app.module.ts`, `apps/api-admin/src/auth/auth-http.module.ts`, `apps/api-admin/.env.example`, `infra/docker-compose.yml`
- Create: `apps/api-admin/test/invite.e2e-spec.ts`; Modify: `apps/api-admin/test/route-access.snapshot.json`

**Interfaces:**
- Consumes: `generateToken`, `hashToken` (03); `UnitOfWork`, `MailNotifier`, `waitForMail` (12); `SessionService`, `SessionCookie` (11); `AuditService`, `Clock`, `AppTransactionHost`, `InMemoryMailSender` (`sent`, `clear()`) (phase 1); DTO schemas `AcceptInviteRequestSchema`, `UserIdParamSchema` and the audit actions `auth.invite.issued` / `auth.invite.resent` / `auth.invite.accepted` (08); `zodDto` (09).
- Produces:
  - `ActionTokenService`: `issue(userId, type, ttlSeconds, createdById: string | null): Promise<{ token: string; expiresAt: Date }>` (deletes the user's unused tokens of the same type first), `consume(token, type): Promise<{ userId: string } | null>` (one conditional update: `usedAt IS NULL AND expiresAt > now`, count must be 1), `peek(token, type): Promise<{ userId: string } | null>`, `findPending(userId, type): Promise<{ expiresAt: Date } | null>`, `revokeUnusedTokens(userId): Promise<number>`.
  - `InviteService`: `issue(userId, actorUserId: string | null, options?: { via?: 'ADMIN' | 'BOOTSTRAP'; awaitDelivery?: boolean }): Promise<{ expiresAt: Date; url: string }>` — audits `auth.invite.issued { via, expiresAt }` for the user's first INVITE token and `auth.invite.resent { expiresAt }` when an INVITE token (used or not) already exists; FAILURE rows carry no `expiresAt`; `accept(token): Promise<IssuedSession>`.
  - Routes: `POST /api/auth/invite/accept` (`@Public`, `@AuthThrottle`) → 200 `SessionStateResponse` + ENROLLMENT cookie; `POST /api/users/:id/invite` (`@RequirePermissions('users:invite')`) → 202 `{ expiresAt }` (the URL is never returned over HTTP).
  - `AdminAuthOptions.invite = { ttlSeconds }`, `AdminAuthOptions.webBaseUrl`.

Rules: only a STAFF user in status INVITED with an email can be invited; issuing revokes the user's sessions (an abandoned ENROLLMENT) and previous INVITE tokens; accepting clears `passwordHash` and TOTP fields (the user starts enrollment clean), revokes other sessions and opens an ENROLLMENT session; the link is `${webBaseUrl}/accept-invite#t=<token>`.

- [ ] **Step 1: Write the failing API tests**

`apps/api-admin/test/invite.e2e-spec.ts`:

```ts
import request from 'supertest';
import type { PrismaService } from '@tms/db/nest';
import { createAdminTestApp, type AdminTestApp, ORIGIN } from './support/app';
import { createStaffUser, loginAs, seedBase, waitForMail } from './support/fixtures';

const TOKEN_IN_LINK = /\/accept-invite#t=([A-Za-z0-9_-]{43})$/m;

describe('invite (API)', () => {
  let t: AdminTestApp;
  let prisma: PrismaService;
  let adminCookie: string;
  const http = () => request(t.app.getHttpServer());
  const resend = (id: string, cookie = adminCookie) => http().post(`/api/users/${id}/invite`).set('Origin', ORIGIN).set('Cookie', cookie);
  const accept = (token: string) => http().post('/api/auth/invite/accept').set('Origin', ORIGIN).send({ token });
  const tokenFromLastMail = async (to: string) => {
    const match = TOKEN_IN_LINK.exec((await waitForMail(t.mail, to)).text);
    if (!match?.[1]) throw new Error(`no invite link in the mail to ${to}`);
    return match[1];
  };

  beforeAll(async () => { t = await createAdminTestApp(); });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    prisma = await seedBase(t.app);
    t.mail.clear();
    adminCookie = await loginAs(t.app, (await createStaffUser(prisma, { role: 'admin' })).id);
  });

  it('issues an invite by mail, stores only the token hash and audits it', async () => {
    const invited = await createStaffUser(prisma, { status: 'INVITED', enrolled: false, role: 'operator' });
    const res = await resend(invited.id).expect(202);
    expect(Object.keys(res.body)).toEqual(['expiresAt']);
    const token = await tokenFromLastMail(invited.email!);
    const row = await prisma.actionToken.findFirstOrThrow({ where: { userId: invited.id, type: 'INVITE' } });
    expect(row.tokenHash).not.toContain(token);
    expect(row.expiresAt.getTime() - t.clock.now().getTime()).toBe(72 * 3600_000);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'auth.invite.issued', targetId: invited.id } });
    expect(audit.metadata).toEqual({ via: 'ADMIN', expiresAt: row.expiresAt.toISOString() });
    expect(JSON.stringify(audit)).not.toContain(token);
  });

  it('403 without users:invite; 409 for a user who is not an INVITED staff member', async () => {
    const operatorCookie = await loginAs(t.app, (await createStaffUser(prisma, { role: 'operator' })).id);
    const invited = await createStaffUser(prisma, { status: 'INVITED', enrolled: false });
    await resend(invited.id, operatorCookie).expect(403);
    const active = await createStaffUser(prisma);
    expect((await resend(active.id).expect(409)).body.code).toBe('USER_STATE_CONFLICT');
    const refused = await prisma.auditLog.findFirstOrThrow({ where: { action: 'auth.invite.issued', outcome: 'FAILURE', targetId: active.id } });
    expect(refused.metadata).toEqual({ via: 'ADMIN' }); // no expiresAt: nothing was issued
    // drivers sign in with card + PIN (phase 5) and never get an invite, even with an email on file
    const driver = await createStaffUser(prisma, { kind: 'DRIVER', role: 'driver', status: 'INVITED', enrolled: false });
    expect((await resend(driver.id).expect(409)).body.code).toBe('USER_STATE_CONFLICT');
    expect(t.mail.sent.filter((m) => m.to === driver.email)).toHaveLength(0);
    expect(await prisma.actionToken.count({ where: { userId: driver.id } })).toBe(0);
  });

  it('accept opens an ENROLLMENT session with a strict __Host- cookie', async () => {
    const invited = await createStaffUser(prisma, { status: 'INVITED', enrolled: false });
    await resend(invited.id).expect(202);
    const res = await accept(await tokenFromLastMail(invited.email!)).expect(200);
    expect(res.body).toMatchObject({ scope: 'ENROLLMENT', next: 'SET_PASSWORD' });
    const setCookie = res.headers['set-cookie']?.[0] ?? '';
    expect(setCookie).toMatch(/^__Host-tms_admin_sid=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict$/);
    await http().get('/api/auth/session').set('Cookie', setCookie.split(';')[0]!).expect(200);
  });

  it('rejects reused, expired, superseded and malformed tokens with one code', async () => {
    const invited = await createStaffUser(prisma, { status: 'INVITED', enrolled: false });
    await resend(invited.id).expect(202);
    const first = await tokenFromLastMail(invited.email!);
    t.mail.clear(); // the next mail to the same address replaces this one
    await resend(invited.id).expect(202);
    const second = await tokenFromLastMail(invited.email!);
    const resent = await prisma.auditLog.findFirstOrThrow({ where: { action: 'auth.invite.resent', targetId: invited.id } });
    expect(Object.keys(resent.metadata as object)).toEqual(['expiresAt']);
    expect((await accept(first).expect(400)).body.code).toBe('AUTH_TOKEN_INVALID');
    await accept(second).expect(200);
    expect((await accept(second).expect(400)).body.code).toBe('AUTH_TOKEN_INVALID');

    const other = await createStaffUser(prisma, { status: 'INVITED', enrolled: false });
    await resend(other.id).expect(202);
    const late = await tokenFromLastMail(other.email!);
    t.clock.advance(72 * 3600_000 + 1000);
    await accept(late).expect(400);
    expect((await accept('short').expect(422)).body.code).toBe('VALIDATION_FAILED');
  });

  it('a token for a user who is no longer INVITED is invalid', async () => {
    const invited = await createStaffUser(prisma, { status: 'INVITED', enrolled: false });
    await resend(invited.id).expect(202);
    await prisma.user.update({ where: { id: invited.id }, data: { status: 'BLOCKED' } });
    await accept(await tokenFromLastMail(invited.email!)).expect(400);
  });

  it('exactly one of five parallel accepts wins (Review Focus 3)', async () => {
    const invited = await createStaffUser(prisma, { status: 'INVITED', enrolled: false });
    await resend(invited.id).expect(202);
    const token = await tokenFromLastMail(invited.email!);
    const results = await Promise.all(Array.from({ length: 5 }, () => accept(token)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400, 400, 400]);
    expect(await prisma.session.count({ where: { userId: invited.id, scope: 'ENROLLMENT' } })).toBe(1);
  });

  it('resend revokes an abandoned enrollment session', async () => {
    const invited = await createStaffUser(prisma, { status: 'INVITED', enrolled: false });
    await resend(invited.id).expect(202);
    const cookie = (await accept(await tokenFromLastMail(invited.email!)).expect(200)).headers['set-cookie']![0]!.split(';')[0]!;
    await resend(invited.id).expect(202);
    await http().get('/api/auth/session').set('Cookie', cookie).expect(401);
  });

  it('accept without an allowed Origin is rejected', async () => {
    await http().post('/api/auth/invite/accept').send({ token: 'A'.repeat(43) }).expect(403);
  });
});
```

`apps/api-admin/test/env.spec.ts`: add `ADMIN_WEB_URL: 'http://localhost:5173', INVITE_TTL_HOURS: 72` to the defaults `toEqual`.

Add to `route-access.snapshot.json`:

```json
{ "route": "POST /api/auth/invite/accept", "access": { "kind": "public", "stepUp": false } },
{ "route": "POST /api/users/:id/invite", "access": { "kind": "permissions", "codes": ["users:invite"], "stepUp": false } }
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm turbo run test --filter=@tms/api-admin`
Expected: FAIL — both routes 404 (the test's 202/200 expectations fail); snapshot mismatch.

- [ ] **Step 3: Implement `ActionTokenService`**

`packages/domain/src/admin/auth/tokens/action-token.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { generateToken, hashToken, type RandomSource } from '@tms/auth-core';
import type { ActionTokenType } from '@tms/contracts';
import { type AppTransactionHost, Clock, TransactionHost } from '../../../shared';
import { RANDOM_SOURCE } from '../ports';

@Injectable()
export class ActionTokenService {
  constructor(
    @Inject(TransactionHost) private readonly txHost: AppTransactionHost,
    private readonly clock: Clock,
    @Inject(RANDOM_SOURCE) private readonly random: RandomSource,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  async issue(userId: string, type: ActionTokenType, ttlSeconds: number, createdById: string | null) {
    const now = this.clock.now();
    await this.db.actionToken.deleteMany({ where: { userId, type, usedAt: null } });
    const token = generateToken(this.random);
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    await this.db.actionToken.create({ data: { userId, type, tokenHash: hashToken(token), expiresAt, createdById } });
    return { token, expiresAt };
  }

  /** Single use: one conditional update decides the winner of concurrent requests. */
  async consume(token: string, type: ActionTokenType): Promise<{ userId: string } | null> {
    const now = this.clock.now();
    const tokenHash = hashToken(token);
    const { count } = await this.db.actionToken.updateMany({
      where: { tokenHash, type, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (count !== 1) return null;
    const row = await this.db.actionToken.findFirstOrThrow({ where: { tokenHash, type }, select: { userId: true } });
    return { userId: row.userId };
  }

  async peek(token: string, type: ActionTokenType): Promise<{ userId: string } | null> {
    const row = await this.db.actionToken.findFirst({
      where: { tokenHash: hashToken(token), type, usedAt: null, expiresAt: { gt: this.clock.now() } },
      select: { userId: true },
    });
    return row ?? null;
  }

  async findPending(userId: string, type: ActionTokenType): Promise<{ expiresAt: Date } | null> {
    return this.db.actionToken.findFirst({
      where: { userId, type, usedAt: null, expiresAt: { gt: this.clock.now() } },
      select: { expiresAt: true },
      orderBy: { expiresAt: 'desc' },
    });
  }

  async revokeUnusedTokens(userId: string): Promise<number> {
    return (await this.db.actionToken.deleteMany({ where: { userId, usedAt: null } })).count;
  }
}
```

- [ ] **Step 4: Implement `InviteService`**

`packages/domain/src/admin/auth/invites/invite.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '@tms/contracts';
import { type AppTransactionHost, AuditService, MailNotifier, TransactionHost, UnitOfWork } from '../../../shared';
import { AUTH_OPTIONS, type AdminAuthOptions } from '../options';
import { type IssuedSession, SessionService } from '../sessions/session.service';
import { ActionTokenService } from '../tokens/action-token.service';

type Via = 'ADMIN' | 'BOOTSTRAP';

@Injectable()
export class InviteService {
  constructor(
    @Inject(TransactionHost) private readonly txHost: AppTransactionHost,
    private readonly uow: UnitOfWork,
    private readonly tokens: ActionTokenService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly mail: MailNotifier,
    @Inject(AUTH_OPTIONS) private readonly options: AdminAuthOptions,
  ) {}

  async issue(
    userId: string,
    actorUserId: string | null,
    options: { via?: Via; awaitDelivery?: boolean } = {},
  ): Promise<{ expiresAt: Date; url: string }> {
    const via = options.via ?? 'ADMIN';
    const outcome = await this.uow.run(
      async () => {
        const user = await this.txHost.tx.user.findUnique({ where: { id: userId } });
        // Any earlier INVITE token (used, expired or pending) makes this a resend.
        const resent = (await this.txHost.tx.actionToken.count({ where: { userId, type: 'INVITE' } })) > 0;
        if (!user || user.kind !== 'STAFF' || user.status !== 'INVITED' || !user.email) {
          await this.recordIssue(resent, 'FAILURE', { userId, actorUserId, via });
          return null;
        }
        await this.sessions.revokeAllSessions(userId);
        const { token, expiresAt } = await this.tokens.issue(userId, 'INVITE', this.options.invite.ttlSeconds, actorUserId);
        const url = `${this.options.webBaseUrl}/accept-invite#t=${token}`;
        await this.recordIssue(resent, 'SUCCESS', { userId, actorUserId, via, expiresAt });
        this.mail.afterCommit({ userId, to: user.email, template: 'invite', vars: { firstName: user.firstName, url, expiresAt: expiresAt.toISOString() } });
        return { expiresAt, url };
      },
      { awaitEffects: options.awaitDelivery ?? false },
    );
    if (!outcome) throw new DomainError('USER_STATE_CONFLICT', 'Only invited staff users can receive an invite');
    return outcome;
  }

  /** `auth.invite.issued { via, expiresAt }` or `auth.invite.resent { expiresAt }`; FAILURE rows have no `expiresAt`. */
  private async recordIssue(
    resent: boolean,
    outcome: 'SUCCESS' | 'FAILURE',
    p: { userId: string; actorUserId: string | null; via: Via; expiresAt?: Date },
  ): Promise<void> {
    const target = { type: 'User', id: p.userId } as const;
    const expiry = p.expiresAt ? { expiresAt: p.expiresAt.toISOString() } : {};
    if (resent) {
      await this.audit.record({ action: 'auth.invite.resent', outcome, actorUserId: p.actorUserId, target, metadata: expiry });
    } else {
      await this.audit.record({ action: 'auth.invite.issued', outcome, actorUserId: p.actorUserId, target, metadata: { via: p.via, ...expiry } });
    }
  }

  async accept(token: string): Promise<IssuedSession> {
    const outcome = await this.uow.run(async () => {
      const consumed = await this.tokens.consume(token, 'INVITE');
      const user = consumed ? await this.txHost.tx.user.findUnique({ where: { id: consumed.userId } }) : null;
      if (!consumed || !user || user.kind !== 'STAFF' || user.status !== 'INVITED') {
        await this.audit.record({ action: 'auth.invite.accepted', outcome: 'FAILURE', ...(user ? { target: { type: 'User', id: user.id } } : {}), metadata: { reason: 'INVALID_TOKEN' } });
        return null;
      }
      await this.txHost.tx.user.update({
        where: { id: user.id },
        data: { passwordHash: null, totpSecretEnc: null, totpKeyId: null, totpEnabledAt: null, totpLastUsedStep: null },
      });
      await this.sessions.revokeAllSessions(user.id);
      const issued = await this.sessions.create(user.id, 'ENROLLMENT', { mfaVerified: false });
      await this.audit.record({ action: 'auth.invite.accepted', outcome: 'SUCCESS', actorUserId: user.id, target: { type: 'User', id: user.id }, metadata: {} });
      return issued;
    });
    if (!outcome) throw new DomainError('AUTH_TOKEN_INVALID', 'This link is invalid or has expired');
    return outcome;
  }
}
```

The failure audit rows of `issue` and `accept` commit because the transaction returns normally and the error is thrown after commit (the pattern every later service uses: decide inside the transaction, throw outside); throwing inside `uow.run` would roll the FAILURE row back.

In `options.ts` add `invite: { ttlSeconds: number }` and `webBaseUrl: string`; register `ActionTokenService` and `InviteService` in `AdminAuthModule` and export them.

- [ ] **Step 5: Controllers and env**

`apps/api-admin/src/auth/dto.ts` (grows in later tasks; classes are imported as values, never `import type`, so the pipe sees them):

```ts
import { AcceptInviteRequestSchema, UserIdParamSchema } from '@tms/contracts';
import { zodDto } from '@tms/nest-bootstrap';

export class AcceptInviteDto extends zodDto(AcceptInviteRequestSchema) {}
export class UserIdParamDto extends zodDto(UserIdParamSchema) {}
```

`apps/api-admin/src/auth/invite.controller.ts`:

```ts
import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import type { SessionStateResponse } from '@tms/contracts';
import { InviteService, SessionCookie, SessionService } from '@tms/domain/admin';
import { AuthThrottle, Public } from '@tms/domain/shared';
import type { Response } from 'express';
import { AcceptInviteDto } from './dto';

@Controller('auth/invite')
export class InviteController {
  constructor(private readonly invites: InviteService, private readonly sessions: SessionService, private readonly cookie: SessionCookie) {}

  @Public()
  @AuthThrottle()
  @Post('accept')
  @HttpCode(200)
  async accept(@Body() body: AcceptInviteDto, @Res({ passthrough: true }) res: Response): Promise<SessionStateResponse> {
    const issued = await this.invites.accept(body.token);
    this.cookie.write(res, issued.token);
    return this.sessions.describe({ userId: issued.userId, scope: issued.scope });
  }
}
```

`apps/api-admin/src/admin/users/user-admin.controller.ts`:

```ts
import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import type { ActionTokenIssuedResponse } from '@tms/contracts';
import { InviteService } from '@tms/domain/admin';
import { CurrentPrincipal, type Principal, RequirePermissions } from '@tms/domain/shared';
import { UserIdParamDto } from '../../auth/dto';

@Controller('users')
export class UserAdminController {
  constructor(private readonly invites: InviteService) {}

  @RequirePermissions('users:invite')
  @Post(':id/invite')
  @HttpCode(202)
  async resendInvite(@Param() params: UserIdParamDto, @CurrentPrincipal() actor: Principal): Promise<ActionTokenIssuedResponse> {
    const { expiresAt } = await this.invites.issue(params.id, actor.userId);
    return { expiresAt: expiresAt.toISOString() };
  }
}
```

`apps/api-admin/src/admin/admin-http.module.ts`: `@Module({ controllers: [UserAdminController] })`; import it in `AppModule`; add `InviteController` to `AuthHttpModule`.

`apps/api-admin/src/env.ts` (inside the `.extend({ … })` literal): `ADMIN_WEB_URL: z.url().default('http://localhost:5173')`, `INVITE_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 14).default(72)`; `AppModule.forRoot` maps them to `webBaseUrl` (trailing `/` removed) and `invite.ttlSeconds`. `.env.example` + compose `api-admin` (`ADMIN_WEB_URL: http://localhost:${CADDY_ADMIN_PORT:-8080}`).

- [ ] **Step 6: Run the tests and verify**

Run: `pnpm turbo run test --filter=@tms/domain && pnpm turbo run test --filter=@tms/api-admin && pnpm verify`
Expected: `invite.e2e-spec` (8 tests), the env spec defaults and the route-access snapshot pass; `pnpm verify` green.

- [ ] **Step 7: Commit**

```bash
git add packages/domain apps/api-admin infra/docker-compose.yml docs/efficiency/critical-path.md
git commit -m "feat(domain): add single-use action tokens and the invite issue and accept flow"
```

PR body: diagram `sequenceDiagram` (admin → API → DB/tx → after-commit mail → user → accept → ENROLLMENT cookie); boundaries: `@tms/domain/admin` (new services), api-admin routes; no migration; reviewer: `security-reviewer`.
