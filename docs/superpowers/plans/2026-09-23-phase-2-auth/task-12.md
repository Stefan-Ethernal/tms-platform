# Phase 2 — Task 12: Mail after commit — `UnitOfWork`, event emitter, SMTP adapter, templates

> Part of the phase 2 plan: read [index.md](index.md) (constraints, shared interfaces, env) and this file only.


**Files:**
- Create: `packages/domain/src/shared/tx/unit-of-work.ts`, `packages/domain/src/shared/mailer/templates.ts`, `packages/domain/src/shared/mailer/mail-notifier.ts`, `packages/domain/src/shared/mailer/mail.listener.ts`, `packages/domain/src/shared/mailer/smtp-mail-sender.ts`, `packages/domain/src/shared/mailer/mail.module.ts` (a new directory next to phase 1's port file `shared/mail.ts`, which stays as it is)
- Modify: `packages/domain/src/shared/shared.module.ts` (phase 1: provide and export `UnitOfWork`, import `EventEmitterModule.forRoot()`), `packages/domain/src/shared/index.ts`, `packages/domain/package.json`, `pnpm-workspace.yaml` (catalog), `packages/domain/test/shared/exports.spec.ts` (phase 1's names list gains the new exports)
- Modify: `apps/api-admin/src/app.module.ts` (import `MailModule.forRoot`), `apps/api-admin/src/env.ts`, `apps/api-admin/test/env.spec.ts` (defaults `toEqual`), `apps/api-admin/.env.example`, `infra/docker-compose.yml` (`SMTP_URL`, `MAIL_FROM` for `api-admin`), `apps/api-admin/test/support/fixtures.ts` (`waitForMail`)
- Create: `packages/domain/test/shared/unit-of-work.spec.ts`, `packages/domain/test/shared/mail-module.spec.ts` (phase 1 already owns `test/shared/mail.spec.ts` for `InMemoryMailSender`), `packages/domain/test/shared/smtp-mail-sender.spec.ts`

**Interfaces:**
- Consumes: phase 1 `SharedModule`, `TransactionHost` + type `AppTransactionHost`, `MailSender`, `MailMessage` (`{ to, subject, text, html? }`), `InMemoryMailSender` (`sent`, `clear()`); `nestjs-cls` `ClsService`.
- Produces:
  - `UnitOfWork.run<T>(fn: () => Promise<T>, options?: { awaitEffects?: boolean }): Promise<T>` — opens a transaction (or joins the outer unit), runs queued effects after the outermost commit, never after a rollback; `awaitEffects` makes effect failures reject with `AfterCommitError` (data stays committed). A joining (inner) call with `awaitEffects: true` throws: only the outermost unit decides whether effects are awaited.
  - `UnitOfWork.afterCommit(effect: () => Promise<unknown>): void` — queues inside a unit; runs immediately outside any transaction; throws inside a transaction that no unit owns.
  - `AfterCommitError { errors: unknown[] }`.
  - `MailTemplateId = 'invite' | 'password-reset' | 'mfa-reset'`, `MailTemplateVars`, `renderMail(id, locale, vars): { subject; text; html }`.
  - `MAIL_REQUESTED = 'mail.requested'`, `MailRequest<T>`, `MailNotifier.afterCommit(request)`, `MailListener`.
  - `SmtpMailSender` (`MailSender` over nodemailer, 10 s timeouts), `MailModule.forRoot({ smtpUrl, from }): DynamicModule` (global; binds `MailSender`, `MailNotifier`, `MailListener`).
  - Test helper `waitForMail(mail: InMemoryMailSender, to: string, timeoutMs = 1000): Promise<MailMessage>` in `apps/api-admin/test/support/fixtures.ts` — every later test that reads a mailed link uses it instead of reading `t.mail.sent` right after the response.

Facts from spikes N6, N8, N9: `@nestjs-cls/transactional` 4 has no commit hook (a CLS queue drained after the outermost `withTransaction` is the working pattern); nodemailer 10 imports as `import { createTransport } from 'nodemailer'` and takes `connectionTimeout`, `greetingTimeout`, `socketTimeout`, `dnsTimeout` in ms; a closed port fails in ~15 ms (`ESOCKET`), the timeouts only bound a black-holed host; Mailpit's `/api/v1/search?query=to:<address>` returns `messages_count` and `messages[]`, `/api/v1/message/<ID>` returns `Text` and `HTML`; Testcontainers `Wait.forHttp('/readyz', 8025)` is a reliable readiness check; `emitAsync` awaits listeners and rejects when a `{ suppressErrors: false }` listener throws, whereas sync `emit` turns that rejection into an unhandled rejection — so mail is only ever dispatched with `emitAsync`, from an after-commit effect whose failure `UnitOfWork` catches.

Phase 1's `SharedModule` binds no `MailSender` (only the abstract-class token and `InMemoryMailSender` exist): apps get the binding from `MailModule.forRoot` (SMTP), tests override `MailSender` with `InMemoryMailSender`.

- [ ] **Step 1: Write the failing tests**

`packages/domain/test/shared/unit-of-work.spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createPrismaClient } from '@tms/db';
import { PrismaModule, PrismaService } from '@tms/db/nest';
import { resetTestDatabase, testDatabaseUrl } from '@tms/db/testing';
import { AfterCommitError, type AppTransactionHost, SharedModule, TransactionHost, UnitOfWork } from '../../src/shared';

describe('UnitOfWork', () => {
  let uow: UnitOfWork;
  let prisma: PrismaService;
  let txHost: AppTransactionHost;
  const outside = createPrismaClient({ url: testDatabaseUrl() });

  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [PrismaModule.forRoot({ url: testDatabaseUrl() }), SharedModule.forRoot({ app: 'SYSTEM' })] }).compile();
    await ref.init();
    uow = ref.get(UnitOfWork);
    prisma = ref.get(PrismaService);
    txHost = ref.get<AppTransactionHost>(TransactionHost);
  });
  afterAll(() => outside.$disconnect());
  beforeEach(() => resetTestDatabase());

  const createCarrier = (name: string) => txHost.tx.carrier.create({ data: { name, isActive: true } });

  it('runs effects after commit, when other connections can see the data', async () => {
    const name = `c-${randomUUID()}`;
    let seen: number | undefined;
    await uow.run(async () => {
      await createCarrier(name);
      uow.afterCommit(async () => { seen = await outside.carrier.count({ where: { name } }); });
    }, { awaitEffects: true });
    expect(seen).toBe(1);
  });

  it('never runs effects of a rolled-back unit', async () => {
    const effect = jest.fn(async () => undefined);
    await expect(uow.run(async () => {
      uow.afterCommit(effect);
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    await new Promise((r) => setImmediate(r));
    expect(effect).not.toHaveBeenCalled();
  });

  it('joins an outer unit: inner effects run once, after the outer commit', async () => {
    const order: string[] = [];
    await uow.run(async () => {
      await uow.run(async () => { uow.afterCommit(async () => { order.push('inner effect'); }); order.push('inner body'); });
      order.push('outer body');
    }, { awaitEffects: true });
    expect(order).toEqual(['inner body', 'outer body', 'inner effect']);
  });

  it('refuses awaitEffects on a unit that joins an outer one, and rolls the outer unit back', async () => {
    const name = `c-${randomUUID()}`;
    await expect(uow.run(async () => {
      await createCarrier(name);
      await uow.run(async () => undefined, { awaitEffects: true });
    })).rejects.toThrow('awaitEffects');
    expect(await prisma.carrier.count({ where: { name } })).toBe(0);
  });

  it('runs an effect immediately outside any transaction', async () => {
    const effect = jest.fn(async () => undefined);
    uow.afterCommit(effect);
    await new Promise((r) => setImmediate(r));
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('refuses afterCommit inside a transaction that no unit owns', async () => {
    await expect(txHost.withTransaction(async () => { uow.afterCommit(async () => undefined); })).rejects.toThrow('UnitOfWork.run');
  });

  it('with awaitEffects, a failing effect rejects but the data stays committed', async () => {
    const name = `c-${randomUUID()}`;
    await expect(uow.run(async () => {
      await createCarrier(name);
      uow.afterCommit(async () => { throw new Error('SMTP down'); });
    }, { awaitEffects: true })).rejects.toBeInstanceOf(AfterCommitError);
    expect(await prisma.carrier.count({ where: { name } })).toBe(1);
  });

  it('in the background, a failing effect is logged by name only', async () => {
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await uow.run(async () => { uow.afterCommit(async () => { throw new Error('token=SECRET-VALUE'); }); });
    await new Promise((r) => setTimeout(r, 10));
    expect(spy).toHaveBeenCalled();
    expect(JSON.stringify(spy.mock.calls)).not.toContain('SECRET-VALUE');
    spy.mockRestore();
  });
});
```

(`Carrier` is a phase 1 model with no foreign keys, used here only as a table to write to.)

`packages/domain/test/shared/mail-module.spec.ts`:

```ts
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '@tms/db/nest';
import { testDatabaseUrl } from '@tms/db/testing';
import {
  InMemoryMailSender, MailModule, MailNotifier, MailSender, type MailMessage, renderMail, SharedModule, UnitOfWork,
} from '../../src/shared';

const URL_WITH_TOKEN = 'http://localhost:5173/accept-invite#t=SECRETSECRETSECRETSECRETSECRETSECRETSECRET1';

describe('mail templates', () => {
  it('puts the link on its own line and escapes HTML', () => {
    const m = renderMail('invite', 'en', { firstName: '<Ada>', url: URL_WITH_TOKEN, expiresAt: '2026-09-26T10:00:00.000Z' });
    expect(m.subject).toBe('Your TMS account invitation');
    expect(m.text.split('\n')).toContain(URL_WITH_TOKEN);
    expect(m.html).toContain('&lt;Ada&gt;');
    expect(m.html).not.toContain('<Ada>');
    expect(m.html).toContain(`href="${URL_WITH_TOKEN}"`);
  });

  it.each(['invite', 'password-reset', 'mfa-reset'] as const)('renders %s', (id) => {
    const m = renderMail(id, 'en', { firstName: 'Ada', url: 'http://x/y#t=z', expiresAt: '2026-09-26T10:00:00.000Z' });
    expect(m.subject.length).toBeGreaterThan(5);
    expect(m.text).toContain('http://x/y#t=z');
  });
});

class FailingMail extends MailSender {
  override async send(_m: MailMessage): Promise<void> {
    throw new Error(`550 rejected for ada@example.com (${URL_WITH_TOKEN})`);
  }
}

async function moduleWith(sender: MailSender) {
  const ref = await Test.createTestingModule({
    imports: [PrismaModule.forRoot({ url: testDatabaseUrl() }), SharedModule.forRoot({ app: 'SYSTEM' }), MailModule.forRoot({ smtpUrl: 'smtp://unused:1025', from: 'TMS <no-reply@tms.local>' })],
  }).overrideProvider(MailSender).useValue(sender).compile();
  await ref.init();
  return ref;
}

describe('MailNotifier', () => {
  it('delivers after commit and not after a rollback', async () => {
    const sender = new InMemoryMailSender();
    const ref = await moduleWith(sender);
    const uow = ref.get(UnitOfWork);
    const notifier = ref.get(MailNotifier);
    const request = { userId: 'u1', to: 'ada@example.com', template: 'invite' as const, vars: { firstName: 'Ada', url: URL_WITH_TOKEN, expiresAt: 'x' } };
    await expect(uow.run(async () => { notifier.afterCommit(request); throw new Error('rollback'); })).rejects.toThrow();
    await uow.run(async () => { notifier.afterCommit(request); }, { awaitEffects: true });
    expect(sender.sent.map((m) => m.to)).toEqual(['ada@example.com']);
    await ref.close();
  });

  it('a delivery failure leaks neither the token nor the address into logs (Review Focus 5)', async () => {
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const ref = await moduleWith(new FailingMail());
    await expect(ref.get(UnitOfWork).run(async () => {
      ref.get(MailNotifier).afterCommit({ userId: 'u1', to: 'ada@example.com', template: 'invite', vars: { firstName: 'Ada', url: URL_WITH_TOKEN, expiresAt: 'x' } });
    }, { awaitEffects: true })).rejects.toThrow();
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain('u1');
    expect(logged).not.toContain('SECRETSECRET');
    expect(logged).not.toContain('ada@example.com');
    spy.mockRestore();
    await ref.close();
  });
});
```

`packages/domain/test/shared/smtp-mail-sender.spec.ts`:

```ts
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { SmtpMailSender } from '../../src/shared';

describe('SmtpMailSender against Mailpit', () => {
  let mailpit: StartedTestContainer;
  let api: string;

  beforeAll(async () => {
    mailpit = await new GenericContainer('axllent/mailpit:v1.31')
      .withExposedPorts(1025, 8025)
      .withWaitStrategy(Wait.forHttp('/readyz', 8025).forStatusCode(200))
      .start();
    api = `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}`;
  }, 60_000);
  afterAll(() => mailpit?.stop());

  it('delivers text and HTML with the configured sender', async () => {
    const sender = new SmtpMailSender({ smtpUrl: `smtp://${mailpit.getHost()}:${mailpit.getMappedPort(1025)}`, from: 'TMS <no-reply@tms.local>' });
    await sender.send({ to: 'ada@example.com', subject: 'Hello', text: 'plain body', html: '<p>html body</p>' });
    const search = (await (await fetch(`${api}/api/v1/search?query=to:ada@example.com`)).json()) as { messages_count: number; messages: Array<{ ID: string }> };
    expect(search.messages_count).toBe(1);
    const detail = (await (await fetch(`${api}/api/v1/message/${search.messages[0]!.ID}`)).json()) as { Text: string; HTML: string; From: { Address: string } };
    expect(detail.Text.trim()).toBe('plain body');
    expect(detail.HTML).toContain('html body');
    expect(detail.From.Address).toBe('no-reply@tms.local');
    sender.onApplicationShutdown();
  });

  it('fails fast and cleanly when the server is unreachable', async () => {
    const sender = new SmtpMailSender({ smtpUrl: 'smtp://127.0.0.1:1', from: 'TMS <no-reply@tms.local>', timeoutMs: 2000 });
    const started = Date.now();
    await expect(sender.send({ to: 'ada@example.com', subject: 'x', text: 'x' })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(3000);
    sender.onApplicationShutdown();
  });
});
```

`testcontainers` is already a dev dependency of the workspace through `@tms/db` (phase 1); add it to `@tms/domain` `devDependencies` (catalog).

`packages/domain/test/shared/exports.spec.ts` (phase 1): the case `'@tms/domain/shared exports exactly the phase 1 names'` becomes `'@tms/domain/shared exports exactly the phase 1 and phase 2 names'`; insert the seven new runtime names into its sorted `toEqual` list (next to Task 10's additions; `Object.keys` lists values only, so the type exports do not appear): `'AfterCommitError'`, `'MAIL_REQUESTED'`, `'MailModule'`, `'MailNotifier'`, `'SmtpMailSender'`, `'UnitOfWork'`, `'renderMail'` (the default sort puts lower-case names after the capitalised ones, so it lands between Task 10's `'readRouteAccess'` and `'scanRouteAccess'`).

`apps/api-admin/test/env.spec.ts`: add `SMTP_URL: 'smtp://localhost:1025', MAIL_FROM: 'TMS <no-reply@tms.local>'` to the defaults `toEqual`.

`apps/api-admin/test/support/fixtures.ts` gains the mail helper. Delivery runs after the commit and may land after supertest resolved, so tests poll instead of reading `t.mail.sent` right after the response:

```ts
import type { InMemoryMailSender, MailMessage } from '@tms/domain/shared';

/**
 * Resolves with the newest message to `to` once one is in the outbox (polls every 10 ms).
 * Before an action whose mail replaces an earlier one to the same address, call `t.mail.clear()`.
 */
export async function waitForMail(mail: InMemoryMailSender, to: string, timeoutMs = 1000): Promise<MailMessage> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = [...mail.sent].reverse().find((m) => m.to === to);
    if (found) return found;
    if (Date.now() >= deadline) throw new Error(`no mail to ${to} within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm turbo run test --filter=@tms/domain`
Expected: FAIL — `UnitOfWork`, `MailModule`, `renderMail`, `SmtpMailSender` are not exported; the names case of `exports.spec` misses the seven names. (`waitForMail` has no test of its own; Task 13's invite tests are its first users.)

- [ ] **Step 3: Implement `UnitOfWork`**

`packages/domain/src/shared/tx/unit-of-work.ts`:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { ClsService } from 'nestjs-cls';
import type { AppTransactionHost } from '../transaction';

type Effect = () => Promise<unknown>;
const EFFECTS = Symbol('tms:after-commit-effects');

export class AfterCommitError extends Error {
  constructor(readonly errors: unknown[]) {
    super(`${errors.length} after-commit effect(s) failed`);
    this.name = 'AfterCommitError';
  }
}

/** A transaction plus side effects that run only after the outermost commit (ADR 0006: events are fire-and-forget). */
@Injectable()
export class UnitOfWork {
  private readonly logger = new Logger('UnitOfWork');

  constructor(private readonly cls: ClsService, @Inject(TransactionHost) private readonly txHost: AppTransactionHost) {}

  async run<T>(fn: () => Promise<T>, options: { awaitEffects?: boolean } = {}): Promise<T> {
    if (this.cls.isActive() && this.cls.get<Effect[] | undefined>(EFFECTS)) {
      // Joined: the effects run after the outer commit, and the outer caller decides whether they are awaited.
      if (options.awaitEffects) throw new Error('UnitOfWork.run: awaitEffects is only allowed on the outermost unit');
      return fn();
    }
    if (this.txHost.isTransactionActive()) throw new Error('UnitOfWork.run cannot start inside a transaction it does not own');
    return this.cls.run({ ifNested: 'inherit' }, async () => {
      const effects: Effect[] = [];
      this.cls.set(EFFECTS, effects);
      const result = await this.txHost.withTransaction(fn);
      this.cls.set(EFFECTS, undefined);
      await this.flush(effects, options.awaitEffects ?? false);
      return result;
    });
  }

  afterCommit(effect: Effect): void {
    const effects = this.cls.isActive() ? this.cls.get<Effect[] | undefined>(EFFECTS) : undefined;
    if (effects) {
      effects.push(effect);
      return;
    }
    if (this.txHost.isTransactionActive()) throw new Error('afterCommit needs UnitOfWork.run around the transaction');
    void this.flush([effect], false);
  }

  private async flush(effects: Effect[], wait: boolean): Promise<void> {
    if (effects.length === 0) return;
    const failures = Promise.allSettled(effects.map((effect) => effect())).then((results) =>
      results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => r.reason as unknown),
    );
    if (wait) {
      const errors = await failures;
      if (errors.length) throw new AfterCommitError(errors);
      return;
    }
    void failures.then((errors) => {
      for (const error of errors) this.logger.error(`after-commit effect failed (${error instanceof Error ? error.name : 'unknown'})`);
    });
  }
}
```

In phase 1's `SharedModule.forRoot`, add `EventEmitterModule.forRoot()` to `imports` and `UnitOfWork` to `providers` and `exports`; export `UnitOfWork`, `AfterCommitError` from `packages/domain/src/shared/index.ts`. Catalog: `'@nestjs/event-emitter': 12.0.1` (peer + dev dependency of `@tms/domain`, dependency of both apps).

- [ ] **Step 4: Implement templates, notifier, listener, SMTP sender, module**

`packages/domain/src/shared/mailer/templates.ts`:

```ts
export interface LinkMailVars {
  firstName: string;
  url: string;
  expiresAt: string;
}
export interface MailTemplateVars {
  invite: LinkMailVars;
  'password-reset': LinkMailVars;
  'mfa-reset': LinkMailVars;
}
export type MailTemplateId = keyof MailTemplateVars;
export type MailLocale = 'en';

interface TemplateText {
  subject: string;
  intro: (v: LinkMailVars) => string[];
  action: string;
}

/** The only bundle for now (UI language decision: en); keys are template ids. */
const EN: Record<MailTemplateId, TemplateText> = {
  invite: {
    subject: 'Your TMS account invitation',
    intro: (v) => [`Hello ${v.firstName},`, 'An administrator created a TMS account for you.', 'Open the link below to set your password and connect your authenticator app.', `The link can be used once and expires at ${v.expiresAt} (UTC).`],
    action: 'Accept the invitation',
  },
  'password-reset': {
    subject: 'Reset your TMS password',
    intro: (v) => [`Hello ${v.firstName},`, 'Someone asked to reset the password of your TMS account.', 'Open the link below to choose a new password. You will still need your authenticator app to sign in.', `The link can be used once and expires at ${v.expiresAt} (UTC).`],
    action: 'Choose a new password',
  },
  'mfa-reset': {
    subject: 'Set up your TMS authenticator again',
    intro: (v) => [`Hello ${v.firstName},`, 'An administrator reset the two-factor authentication of your TMS account.', 'Open the link below, confirm your password and connect your authenticator app again.', `The link can be used once and expires at ${v.expiresAt} (UTC).`],
    action: 'Set up the authenticator',
  },
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

export function renderMail<K extends MailTemplateId>(id: K, _locale: MailLocale, vars: MailTemplateVars[K]) {
  const t = EN[id];
  const lines = t.intro(vars);
  const footer = 'If you did not expect this email, you can ignore it.';
  return {
    subject: t.subject,
    text: [...lines, '', vars.url, '', footer].join('\n'),
    html: `${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('')}<p><a href="${escapeHtml(vars.url)}">${escapeHtml(t.action)}</a></p><p>${escapeHtml(footer)}</p>`,
  };
}
```

`packages/domain/src/shared/mailer/mail-notifier.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UnitOfWork } from '../tx/unit-of-work';
import type { MailLocale, MailTemplateId, MailTemplateVars } from './templates';

export const MAIL_REQUESTED = 'mail.requested';

export interface MailRequest<K extends MailTemplateId = MailTemplateId> {
  userId: string;
  to: string;
  template: K;
  vars: MailTemplateVars[K];
  locale?: MailLocale;
}

@Injectable()
export class MailNotifier {
  constructor(private readonly uow: UnitOfWork, private readonly events: EventEmitter2) {}

  /** Queues the mail for after the commit; `emitAsync` (never `emit`) so a failure is observable, not unhandled. */
  afterCommit<K extends MailTemplateId>(request: MailRequest<K>): void {
    this.uow.afterCommit(async () => {
      await this.events.emitAsync(MAIL_REQUESTED, request);
    });
  }
}
```

`packages/domain/src/shared/mailer/mail.listener.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MailSender } from '../mail';
import { MAIL_REQUESTED, type MailRequest } from './mail-notifier';
import { renderMail } from './templates';

@Injectable()
export class MailListener {
  private readonly logger = new Logger('MailListener');

  constructor(private readonly sender: MailSender) {}

  @OnEvent(MAIL_REQUESTED, { suppressErrors: false })
  async onMailRequested(request: MailRequest): Promise<void> {
    const rendered = renderMail(request.template, request.locale ?? 'en', request.vars);
    try {
      await this.sender.send({ to: request.to, ...rendered });
    } catch (error) {
      // Only ids: the address and the link (with its token) never reach the logs (Review Focus 5).
      this.logger.error(`mail delivery failed: user=${request.userId} template=${request.template} error=${error instanceof Error ? error.name : 'unknown'}`);
      throw new Error(`mail delivery failed (${request.template})`);
    }
  }
}
```

(`'../mail'` is phase 1's port file `packages/domain/src/shared/mail.ts`.)

`packages/domain/src/shared/mailer/smtp-mail-sender.ts`:

```ts
import type { OnApplicationShutdown } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { MailSender, type MailMessage } from '../mail';

export class SmtpMailSender extends MailSender implements OnApplicationShutdown {
  private readonly transporter: Transporter;

  constructor(private readonly options: { smtpUrl: string; from: string; timeoutMs?: number }) {
    super();
    const url = new URL(options.smtpUrl);
    const timeout = options.timeoutMs ?? 10_000;
    this.transporter = createTransport({
      host: url.hostname,
      port: Number(url.port || (url.protocol === 'smtps:' ? 465 : 25)),
      secure: url.protocol === 'smtps:',
      ...(url.username ? { auth: { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) } } : {}),
      connectionTimeout: timeout,
      greetingTimeout: timeout,
      socketTimeout: timeout,
      dnsTimeout: timeout,
    });
  }

  override async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.options.from, to: message.to, subject: message.subject, text: message.text, html: message.html });
  }

  onApplicationShutdown(): void {
    this.transporter.close();
  }
}
```

`packages/domain/src/shared/mailer/mail.module.ts`:

```ts
import { type DynamicModule, Module } from '@nestjs/common';
import { MailSender } from '../mail';
import { MailListener } from './mail.listener';
import { MailNotifier } from './mail-notifier';
import { SmtpMailSender } from './smtp-mail-sender';

@Module({})
export class MailModule {
  static forRoot(options: { smtpUrl: string; from: string }): DynamicModule {
    return {
      module: MailModule,
      global: true,
      providers: [{ provide: MailSender, useFactory: () => new SmtpMailSender(options) }, MailNotifier, MailListener],
      exports: [MailSender, MailNotifier],
    };
  }
}
```

Catalog: `nodemailer: 10.0.10`, `'@types/nodemailer': 8.0.2`; `@tms/domain` dependency / dev dependency. Export `MailModule`, `MailNotifier`, `MAIL_REQUESTED`, `MailRequest`, `renderMail`, `MailTemplateId`, `MailTemplateVars`, `SmtpMailSender` from `shared/index.ts`.

`apps/api-admin`: `env.ts` adds (inside the `.extend({ … })` literal) `SMTP_URL: z.url().default('smtp://localhost:1025')`, `MAIL_FROM: z.string().min(3).default('TMS <no-reply@tms.local>')`; `AppModule.forRoot` imports `MailModule.forRoot({ smtpUrl: env.SMTP_URL, from: env.MAIL_FROM })`; `.env.example` and compose `api-admin` (`SMTP_URL: smtp://mailpit:1025`).

- [ ] **Step 5: Run the tests and verify**

Run: `pnpm turbo run test --filter=@tms/domain && pnpm turbo run test --filter=@tms/api-admin && pnpm verify`
Expected: unit of work (8), mail module (6: templates 1 + `it.each` 3, notifier 2), SMTP against Mailpit (2), phase 1's `mail.spec` (4) and `exports.spec` (2) pass; api-admin tests unchanged apart from the env spec defaults (they override `MailSender`).

- [ ] **Step 6: Commit**

```bash
git add packages/domain apps/api-admin infra/docker-compose.yml pnpm-workspace.yaml pnpm-lock.yaml docs/efficiency/critical-path.md
git commit -m "feat(domain): send mail after commit through a unit of work, events and an SMTP adapter"
```

PR body: diagram `sequenceDiagram` (service → UnitOfWork → commit → effect → emitAsync → listener → SMTP; rollback path); boundaries: `@tms/domain/shared` (new exports, `SharedModule` imports the event emitter), api-admin env; no migration; reviewer: `security-reviewer` (token leakage on failure).
