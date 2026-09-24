# Phase 2 — Task 15: Bootstrap invite CLI, `predev`, compose `bootstrap` service

> Part of the phase 2 plan: read [index.md](index.md) (constraints, shared interfaces, env) and this file only.


**Files:**
- Create: `packages/domain/src/admin/auth/invites/bootstrap-invite.service.ts`; Modify: `packages/domain/src/admin/admin-auth.module.ts`, `packages/domain/src/admin/index.ts`
- Create: `apps/api-admin/src/auth-options.ts` (env → `AdminAuthOptions`, shared by `AppModule` and the CLI), `apps/api-admin/src/cli/cli.module.ts`, `apps/api-admin/src/cli/bootstrap-invite.ts`
- Modify: `apps/api-admin/src/app.module.ts` (use `adminAuthOptionsFromEnv`), `apps/api-admin/package.json` (script `bootstrap:invite`), root `package.json` (`predev`), root `turbo.json` (task `@tms/api-admin#test`), `infra/docker-compose.yml` (service `bootstrap`), `infra/smoke.sh` (`--full` checks the invite mail), `README.md` (first sign-in; phase 1's "Phase 2 adds the invite email." sentence), `CLAUDE.md` (Commands: the `pnpm install` bullet names the api-admin `.env` copy)
- Create: `packages/domain/test/admin/support/options.ts`, `packages/domain/test/admin/bootstrap-invite.spec.ts`, `apps/api-admin/test/bootstrap-invite.e2e-spec.ts`

**Interfaces:**
- Consumes: `InviteService.issue(..., { via: 'BOOTSTRAP', awaitDelivery: true })`, `ActionTokenService.findPending`, `revokeUnusedTokens` (13); `AfterCommitError` (12); `envSchema`, `Env` (`apps/api-admin/src/env.ts`, Task 10); `ADMIN_ROLE_KEY`, `AppTransactionHost` (phase 1); `seedDatabase` (phase 1, creates the INVITED admin).
- Produces:
  - `BootstrapInviteService.run(options: { reissue: boolean; print: boolean; production: boolean }): Promise<{ exitCode: 0 | 1; lines: string[] }>`.
  - `adminAuthOptionsFromEnv(env: Env): AdminAuthOptions`.
  - `CliModule.forRoot(env)`; entry `dist/cli/bootstrap-invite.js` (flags `--reissue`, `--print`).
  - Compose service `bootstrap` (profile `full`; api-admin image; one-shot).

Environment source: in local development the CLI reads `apps/api-admin/.env` (`node --env-file-if-exists=.env`, run from `apps/api-admin`), copied once from `apps/api-admin/.env.example`, which carries `DATABASE_URL` since phase 1 Task 12 and `SMTP_URL`, `MAIL_FROM`, `ADMIN_WEB_URL` since Tasks 12–13; without that file `DATABASE_URL` is missing and the CLI exits 1 naming it. Compose passes the variables to the `bootstrap` service directly.

The sole-admin recovery mode `--reset-mfa <email>` (script `admin:reset-mfa`) is not part of this task: it reuses `MfaResetService.issue` and lands in Task 22.

Behaviour table (each row is a test):

| State | Flags | Output | Exit |
|---|---|---|---|
| No user with the Admin role | — | `no bootstrap admin: run the seed with BOOTSTRAP_ADMIN_EMAIL` | 1 |
| Any ACTIVE admin exists (INVITED admins are ignored: bootstrap is complete, and a re-issue would end a second admin's enrollment) | any | `bootstrap admin already active; nothing to do` | 0 |
| INVITED admin, valid unused invite | — | `invite pending until <ISO>; use --reissue to send a new one` | 0 |
| INVITED admin, valid unused invite | `--reissue` | new invite (old token revoked), line per the next two rows | 0 |
| INVITED admin, no valid invite, not production | — | `invite URL: <url>` and `invite mailed to <email>` | 0 |
| same, production | — | `invite mailed to a***@example.com` (no URL) | 0 |
| same, production | `--print` | URL printed as well | 0 |
| mail delivery fails after commit | any | `mail delivery failed; the new invite was revoked, try again` | 1 |

- [ ] **Step 1: Write the failing tests**

`packages/domain/test/admin/bootstrap-invite.spec.ts` builds a Nest testing module with `PrismaModule.forRoot({ url: testDatabaseUrl() })`, `SharedModule.forRoot({ app: 'SYSTEM' })`, `MailModule.forRoot(...)` with `MailSender` overridden by a controllable fake, and `AdminAuthModule.forRoot(testAuthOptions)`. The helper `packages/domain/test/admin/support/options.ts` (Tasks 16, 18 and 22 add `lockout`, `passwordReset` and `mfaReset` to it when they extend `AdminAuthOptions`):

```ts
import { parseKeyring } from '@tms/auth-core';
import type { AdminAuthOptions } from '../../../src/admin';

/** The public dev defaults of apps/api-admin/src/env.ts, for domain tests that build AdminAuthModule directly. */
export const testAuthOptions: AdminAuthOptions = {
  session: { idleSeconds: 60 * 60, fullAbsoluteSeconds: 12 * 60 * 60, cookieSecure: true },
  invite: { ttlSeconds: 72 * 60 * 60 },
  webBaseUrl: 'http://localhost:5173',
  secrets: { keyring: parseKeyring('dev1:ZGV2LW9ubHktc2VjcmV0cy1lbmMta2V5LTMyLWJ5dGU='), activeKeyId: 'dev1' },
  passwordPepper: Buffer.from('ZGV2LW9ubHktcGFzc3dvcmQtcGVwcGVyLTMyYnl0ZXM=', 'base64'),
  totpIssuer: 'TMS',
};
```

The spec:

```ts
import { Test } from '@nestjs/testing';
import { ADMIN_ROLE_KEY } from '@tms/contracts';
import { seedDatabase } from '@tms/db';
import { PrismaModule, PrismaService } from '@tms/db/nest';
import { resetTestDatabase, testDatabaseUrl } from '@tms/db/testing';
import { AdminAuthModule, BootstrapInviteService } from '../../src/admin';
import { Clock, FixedClock, MailModule, MailSender, type MailMessage, SharedModule } from '../../src/shared';
import { testAuthOptions } from './support/options';

class FlakyMail extends MailSender {
  failNext = false;
  sent: MailMessage[] = [];
  override async send(m: MailMessage): Promise<void> {
    if (this.failNext) { this.failNext = false; throw new Error('SMTP down'); }
    this.sent.push(m);
  }
}

describe('BootstrapInviteService', () => {
  const clock = new FixedClock(new Date('2026-09-23T10:00:00Z'));
  const mail = new FlakyMail();
  let service: BootstrapInviteService;
  let prisma: PrismaService;
  const run = (o: Partial<{ reissue: boolean; print: boolean; production: boolean }> = {}) =>
    service.run({ reissue: false, print: false, production: false, ...o });

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      imports: [
        PrismaModule.forRoot({ url: testDatabaseUrl() }),
        SharedModule.forRoot({ app: 'SYSTEM' }),
        MailModule.forRoot({ smtpUrl: 'smtp://unused:1025', from: 'TMS <no-reply@tms.local>' }),
        AdminAuthModule.forRoot(testAuthOptions),
      ],
    }).overrideProvider(Clock).useValue(clock).overrideProvider(MailSender).useValue(mail).compile();
    await ref.init();
    service = ref.get(BootstrapInviteService);
    prisma = ref.get(PrismaService);
  });
  beforeEach(async () => { await resetTestDatabase(); mail.sent = []; });

  it('fails without a bootstrap admin', async () => {
    expect(await run()).toEqual({ exitCode: 1, lines: ['no bootstrap admin: run the seed with BOOTSTRAP_ADMIN_EMAIL'] });
  });

  it('issues, then reports the pending invite, then reissues on request', async () => {
    await seedDatabase(prisma, { bootstrapAdmin: { email: 'root@example.com' } });
    const first = await run();
    expect(first.exitCode).toBe(0);
    expect(first.lines[0]).toMatch(/^invite URL: http:\/\/localhost:5173\/accept-invite#t=[A-Za-z0-9_-]{43}$/);
    expect(first.lines[1]).toBe('invite mailed to root@example.com');
    expect(mail.sent).toHaveLength(1);

    const second = await run();
    expect(second).toEqual({ exitCode: 0, lines: ['invite pending until 2026-09-26T10:00:00.000Z; use --reissue to send a new one'] });
    expect(mail.sent).toHaveLength(1);

    const third = await run({ reissue: true });
    expect(third.exitCode).toBe(0);
    expect(third.lines[0]).not.toBe(first.lines[0]);
    expect(await prisma.actionToken.count({ where: { type: 'INVITE', usedAt: null } })).toBe(1);
  });

  it('masks the address and hides the URL in production unless --print', async () => {
    await seedDatabase(prisma, { bootstrapAdmin: { email: 'root@example.com' } });
    expect(await run({ production: true })).toEqual({ exitCode: 0, lines: ['invite mailed to r***@example.com'] });
    const printed = await run({ production: true, reissue: true, print: true });
    expect(printed.lines[0]).toMatch(/^invite URL: /);
  });

  it('revokes the new token when delivery fails, so a retry is possible', async () => {
    await seedDatabase(prisma, { bootstrapAdmin: { email: 'root@example.com' } });
    mail.failNext = true;
    expect(await run()).toEqual({ exitCode: 1, lines: ['mail delivery failed; the new invite was revoked, try again'] });
    expect(await prisma.actionToken.count({ where: { type: 'INVITE', usedAt: null } })).toBe(0);
    expect((await run()).exitCode).toBe(0);
  });

  it('does nothing once the admin is active', async () => {
    await seedDatabase(prisma, { bootstrapAdmin: { email: 'root@example.com' } });
    await prisma.user.updateMany({ data: { status: 'ACTIVE', totpEnabledAt: new Date() } });
    expect(await run()).toEqual({ exitCode: 0, lines: ['bootstrap admin already active; nothing to do'] });
  });

  it('does nothing while any admin is active, even with another admin still INVITED (no re-issue on every predev)', async () => {
    await seedDatabase(prisma, { bootstrapAdmin: { email: 'root@example.com' } });
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: ADMIN_ROLE_KEY } });
    await prisma.user.create({
      data: {
        kind: 'STAFF', username: 'second-admin', firstName: 'Second', lastName: 'Admin', email: 'second@example.com',
        status: 'ACTIVE', roleId: adminRole.id, locale: 'en', totpEnabledAt: new Date('2026-01-01T00:00:00Z'),
      },
    });
    expect(await run({ reissue: true })).toEqual({ exitCode: 0, lines: ['bootstrap admin already active; nothing to do'] });
    expect(mail.sent).toHaveLength(0);
    expect(await prisma.actionToken.count()).toBe(0);
  });
});
```

`apps/api-admin/test/bootstrap-invite.e2e-spec.ts` runs the built CLI as a child process against the harness database (proves the entry point, exit codes and that no stack trace or env value is printed):

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { seedDatabase, createPrismaClient } from '@tms/db';
import { resetTestDatabase, testDatabaseUrl } from '@tms/db/testing';

const run = promisify(execFile);
const cli = join(__dirname, '..', 'dist', 'cli', 'bootstrap-invite.js');

describe('bootstrap-invite CLI', () => {
  it('exits 1 with a plain message and no secret or stack trace when SMTP is unreachable', async () => {
    await resetTestDatabase();
    const prisma = createPrismaClient({ url: testDatabaseUrl() });
    await seedDatabase(prisma, { bootstrapAdmin: { email: 'root@example.com' } });
    await prisma.$disconnect();
    const env = { ...process.env, NODE_ENV: 'development', DATABASE_URL: testDatabaseUrl(), SMTP_URL: 'smtp://127.0.0.1:1', LOG_FILE_ENABLED: 'false' };
    const failed = await run('node', [cli], { env }).catch((e: { code: number; stdout: string; stderr: string }) => e);
    expect(failed).toMatchObject({ code: 1 });
    expect((failed as { stdout: string }).stdout).toContain('mail delivery failed');
    expect(`${(failed as { stdout: string }).stdout}${(failed as { stderr: string }).stderr}`).not.toMatch(/postgresql:\/\/|at .*\.js:\d+/);
  });
});
```

The `test` task of api-admin must run after its own `build`, so `dist/cli/bootstrap-invite.js` exists. Follow phase 1's pattern (`@tms/db#test`, `@tms/nest-bootstrap#test`): root `turbo.json` — add after the `"@tms/nest-bootstrap#test"` entry (a `pkg#task` entry replaces the base `test` definition, so it restates `dependsOn` and `outputs`):

```json
    "@tms/api-admin#test": { "dependsOn": ["^build", "build"], "outputs": [] },
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm turbo run test --filter=@tms/domain && pnpm turbo run test --filter=@tms/api-admin`
Expected: FAIL — `BootstrapInviteService` is not exported; `dist/cli/bootstrap-invite.js` does not exist.

- [ ] **Step 3: Implement `BootstrapInviteService`**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { ADMIN_ROLE_KEY } from '@tms/contracts';
import { type AppTransactionHost, AfterCommitError, TransactionHost } from '../../../shared';
import { ActionTokenService } from '../tokens/action-token.service';
import { InviteService } from './invite.service';

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

@Injectable()
export class BootstrapInviteService {
  constructor(
    @Inject(TransactionHost) private readonly txHost: AppTransactionHost,
    private readonly invites: InviteService,
    private readonly tokens: ActionTokenService,
  ) {}

  async run(o: { reissue: boolean; print: boolean; production: boolean }): Promise<{ exitCode: 0 | 1; lines: string[] }> {
    const admins = await this.txHost.tx.user.findMany({
      where: { role: { key: ADMIN_ROLE_KEY } },
      select: { id: true, status: true, email: true },
      orderBy: { createdAt: 'asc' },
    });
    // Checked first: once any admin is ACTIVE, bootstrap is over. An INVITED second admin is the active admin's
    // job (resend); re-issuing here would revoke that admin's ENROLLMENT session on every `pnpm dev`.
    if (admins.some((a) => a.status === 'ACTIVE')) return { exitCode: 0, lines: ['bootstrap admin already active; nothing to do'] };
    const invited = admins.find((a) => a.status === 'INVITED');
    if (!invited) return { exitCode: 1, lines: ['no bootstrap admin: run the seed with BOOTSTRAP_ADMIN_EMAIL'] };
    const pending = await this.tokens.findPending(invited.id, 'INVITE');
    if (pending && !o.reissue) {
      return { exitCode: 0, lines: [`invite pending until ${pending.expiresAt.toISOString()}; use --reissue to send a new one`] };
    }
    try {
      const { url } = await this.invites.issue(invited.id, null, { via: 'BOOTSTRAP', awaitDelivery: true });
      const email = invited.email ?? '';
      const lines = !o.production || o.print ? [`invite URL: ${url}`, `invite mailed to ${email}`] : [`invite mailed to ${maskEmail(email)}`];
      return { exitCode: 0, lines };
    } catch (error) {
      if (!(error instanceof AfterCommitError)) throw error;
      await this.tokens.revokeUnusedTokens(invited.id);
      return { exitCode: 1, lines: ['mail delivery failed; the new invite was revoked, try again'] };
    }
  }
}
```

Register and export it in `AdminAuthModule`.

- [ ] **Step 4: CLI module, entry point, shared options**

`apps/api-admin/src/auth-options.ts` moves the env → options mapping out of `AppModule.forRoot` into `adminAuthOptionsFromEnv(env)`; `AppModule.forRoot` calls it.

`apps/api-admin/src/cli/cli.module.ts`:

```ts
import { type DynamicModule, Module } from '@nestjs/common';
import { PrismaModule } from '@tms/db/nest';
import { AdminAuthModule } from '@tms/domain/admin';
import { MailModule, SharedModule } from '@tms/domain/shared';
import { adminAuthOptionsFromEnv } from '../auth-options';
import type { Env } from '../env';

@Module({})
export class CliModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: CliModule,
      imports: [
        PrismaModule.forRoot({ url: env.DATABASE_URL }),
        SharedModule.forRoot({ app: 'SYSTEM' }),
        MailModule.forRoot({ smtpUrl: env.SMTP_URL, from: env.MAIL_FROM }),
        AdminAuthModule.forRoot(adminAuthOptionsFromEnv(env)),
      ],
    };
  }
}
```

`apps/api-admin/src/cli/bootstrap-invite.ts`:

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { BootstrapInviteService } from '@tms/domain/admin';
import { loadEnv } from '@tms/nest-bootstrap';
import { envSchema } from '../env';
import { CliModule } from './cli.module';

async function main(argv: readonly string[]): Promise<number> {
  const env = loadEnv(envSchema, process.env);
  const app = await NestFactory.createApplicationContext(CliModule.forRoot(env), { logger: ['error', 'warn'] });
  try {
    const result = await app.get(BootstrapInviteService).run({
      reissue: argv.includes('--reissue'),
      print: argv.includes('--print'),
      production: env.NODE_ENV === 'production',
    });
    for (const line of result.lines) process.stdout.write(`${line}\n`);
    return result.exitCode;
  } finally {
    await app.close();
  }
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (error: unknown) => {
    process.stderr.write(`bootstrap-invite failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  },
);
```

`loadEnv` errors name variables, never values (phase 1), so the failure line cannot print `DATABASE_URL`.

`apps/api-admin/package.json`: `"bootstrap:invite": "node --env-file-if-exists=.env dist/cli/bootstrap-invite.js"` (the `.env` is `apps/api-admin/.env`: pnpm runs package scripts in the package directory).

Root `package.json` `predev` (phase 1: build db → deploy → drift → sync → seed) gets the suffix:

```
 && pnpm turbo run build --filter=@tms/api-admin && (pnpm --dir apps/api-admin run bootstrap:invite || echo 'WARNING: bootstrap invite failed (is Mailpit up?). Retry: pnpm --dir apps/api-admin run bootstrap:invite')
```

The CLI failing does not stop `pnpm dev` (mail is a side effect; D12's "fail clearly" is about migrations), but the warning is explicit.

- [ ] **Step 5: Compose service and smoke check**

`infra/docker-compose.yml`:

```yaml
  # One-shot: issues the bootstrap admin's invite (phase 2). The apps do not depend on it:
  # a mail outage must not block the API.
  bootstrap:
    profiles: [full]
    build:
      context: ..
      dockerfile: infra/docker/api.Dockerfile
      args:
        APP: api-admin
    command: ['node', 'dist/cli/bootstrap-invite.js']
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://tms:${POSTGRES_PASSWORD:-tms}@postgres:5432/tms
      SMTP_URL: smtp://mailpit:1025
      MAIL_FROM: 'TMS <no-reply@tms.local>'
      ADMIN_WEB_URL: http://localhost:${CADDY_ADMIN_PORT:-8080}
      LOG_FILE_ENABLED: 'false'
      # same secret variables as api-admin (SECRETS_ENC_KEYS, SECRETS_ENC_ACTIVE_KEY_ID, PASSWORD_PEPPER)
    depends_on:
      migrate:
        condition: service_completed_successfully
      mailpit:
        condition: service_healthy
    restart: 'no'
```

Compose `NODE_ENV: production` means the URL is not printed; `bootstrap` receives the same `SECRETS_ENC_KEYS`, `SECRETS_ENC_ACTIVE_KEY_ID` and `PASSWORD_PEPPER` interpolations as `api-admin` (Task 14, from `infra/.env`).

`infra/smoke.sh --full` gains, after the API checks:

```bash
echo "bootstrap: invite mail delivered"
for i in $(seq 1 30); do
  count=$(curl -fsS "http://127.0.0.1:${MAILPIT_UI_PORT:-8025}/api/v1/search?query=to:${BOOTSTRAP_ADMIN_EMAIL:-admin@example.com}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).messages_count))')
  [ "${count}" -ge 1 ] && break
  sleep 1
done
[ "${count}" -ge 1 ] || { echo "no invite mail for the bootstrap admin"; exit 1; }
```

(Field names of the Mailpit search response per spike N8; `admin@example.com` is phase 1's default in `packages/db/.env.example`, `infra/.env.example` and the compose `migrate` service.)

- [ ] **Step 6: README**

README "Quick start" gains "First sign-in": `pnpm dev` prints `invite URL: ...` (also in Mailpit at http://localhost:8025) → open it → set a password → scan the QR code → store the recovery codes. Re-run with `pnpm --dir apps/api-admin run bootstrap:invite --reissue` if the link expired. The CLI reads `apps/api-admin/.env` (phase 1's Quick start already copies it from `.env.example`); without it `DATABASE_URL` is missing and `predev` prints the warning. In the compose `full` stack the invite is only mailed (Mailpit), never printed. One sentence notes that recovering the only admin (lost authenticator and recovery codes) is Task 22's `admin:reset-mfa`.

In phase 1's `predev` paragraph, replace the last sentence "Phase 2 adds the invite email." with: "Afterwards `predev` sends the bootstrap administrator's invite (see First sign-in); once any administrator is active it does nothing."

`CLAUDE.md`, Commands, first bullet — replace "copy `infra/.env.example` and `packages/db/.env.example` to `.env` once" with "copy `infra/.env.example`, `packages/db/.env.example` and `apps/api-admin/.env.example` to `.env` once (the last one feeds the bootstrap invite CLI in `predev`)". The line count stays the same (hygiene: ≤ 150).

- [ ] **Step 7: Run the tests and the compose smoke**

Run: `pnpm turbo run test --filter=@tms/domain && pnpm turbo run test --filter=@tms/api-admin && pnpm verify`
Expected: 6 service tests + the CLI child-process test pass; turbo runs `@tms/api-admin#build` before `@tms/api-admin#test`.

Run (project `tms-p2`, see Execution notes):
```bash
POSTGRES_PORT=56432 MAILPIT_UI_PORT=58125 MAILPIT_SMTP_PORT=51125 CADDY_ADMIN_PORT=58180 CADDY_KIOSK_PORT=58181 \
  pnpm compose -p tms-p2 --profile full up -d --build
COMPOSE_PROJECT_NAME=tms-p2 POSTGRES_PORT=56432 MAILPIT_UI_PORT=58125 MAILPIT_SMTP_PORT=51125 CADDY_ADMIN_PORT=58180 CADDY_KIOSK_PORT=58181 infra/smoke.sh --full
pnpm compose -p tms-p2 logs bootstrap --no-color | tail -3
pnpm compose -p tms-p2 --profile full down -v
```
Expected: smoke green including "invite mail delivered"; the `bootstrap` log shows `invite mailed to a***@...` and no URL; exit code 0.

- [ ] **Step 8: Commit**

```bash
git add packages/domain apps/api-admin package.json turbo.json infra README.md CLAUDE.md docs/efficiency/critical-path.md
git commit -m "feat(api-admin): add the bootstrap invite CLI, predev step and compose one-shot"
```

PR body: diagram `flowchart` (behaviour table as decisions); boundaries: api-admin CLI entry, compose service, root `predev`; no migration; reviewer: `security-reviewer` (token printing, masking, revocation on failure).
