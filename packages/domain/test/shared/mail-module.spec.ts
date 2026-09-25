import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '@tms/db/nest';
import { testDatabaseUrl } from '@tms/db/testing';
import {
  InMemoryMailSender,
  MailModule,
  MailNotifier,
  MailSender,
  type MailMessage,
  renderMail,
  SharedModule,
  UnitOfWork,
} from '../../src/shared';

const URL_WITH_TOKEN =
  'http://localhost:5173/accept-invite#t=SECRETSECRETSECRETSECRETSECRETSECRETSECRET1';

describe('mail templates', () => {
  it('puts the link on its own line and escapes HTML', () => {
    const m = renderMail('invite', 'en', {
      firstName: '<Ada>',
      url: URL_WITH_TOKEN,
      expiresAt: '2026-09-26T10:00:00.000Z',
    });
    expect(m.subject).toBe('Your TMS account invitation');
    expect(m.text.split('\n')).toContain(URL_WITH_TOKEN);
    expect(m.html).toContain('&lt;Ada&gt;');
    expect(m.html).not.toContain('<Ada>');
    expect(m.html).toContain(`href="${URL_WITH_TOKEN}"`);
  });

  it.each(['invite', 'password-reset', 'mfa-reset'] as const)('renders %s', (id) => {
    const m = renderMail(id, 'en', {
      firstName: 'Ada',
      url: 'http://x/y#t=z',
      expiresAt: '2026-09-26T10:00:00.000Z',
    });
    expect(m.subject.length).toBeGreaterThan(5);
    expect(m.text).toContain('http://x/y#t=z');
  });
});

class FailingMail extends MailSender {
  override send(_m: MailMessage): Promise<void> {
    throw new Error(`550 rejected for ada@example.com (${URL_WITH_TOKEN})`);
  }
}

async function moduleWith(sender: MailSender) {
  const ref = await Test.createTestingModule({
    imports: [
      PrismaModule.forRoot({ url: testDatabaseUrl() }),
      SharedModule.forRoot({ app: 'ADMIN' }),
      MailModule.forRoot({ smtpUrl: 'smtp://unused:1025', from: 'TMS <no-reply@tms.local>' }),
    ],
  })
    .overrideProvider(MailSender)
    .useValue(sender)
    .compile();
  await ref.init();
  return ref;
}

describe('MailNotifier', () => {
  it('delivers after commit and not after a rollback', async () => {
    const sender = new InMemoryMailSender();
    const ref = await moduleWith(sender);
    const uow = ref.get(UnitOfWork);
    const notifier = ref.get(MailNotifier);
    const request = {
      userId: 'u1',
      to: 'ada@example.com',
      template: 'invite' as const,
      vars: { firstName: 'Ada', url: URL_WITH_TOKEN, expiresAt: 'x' },
    };
    await expect(
      uow.run(() => {
        notifier.afterCommit(request);
        throw new Error('rollback');
      }),
    ).rejects.toThrow();
    await uow.run(
      async () => {
        await Promise.resolve();
        notifier.afterCommit(request);
      },
      { awaitEffects: true },
    );
    expect(sender.sent.map((m) => m.to)).toEqual(['ada@example.com']);
    await ref.close();
  });

  it('a delivery failure leaks neither the token nor the address into logs (Review Focus 5)', async () => {
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const ref = await moduleWith(new FailingMail());
    await expect(
      ref.get(UnitOfWork).run(
        async () => {
          await Promise.resolve();
          ref.get(MailNotifier).afterCommit({
            userId: 'u1',
            to: 'ada@example.com',
            template: 'invite',
            vars: { firstName: 'Ada', url: URL_WITH_TOKEN, expiresAt: 'x' },
          });
        },
        { awaitEffects: true },
      ),
    ).rejects.toThrow();
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain('u1');
    expect(logged).not.toContain('SECRETSECRET');
    expect(logged).not.toContain('ada@example.com');
    spy.mockRestore();
    await ref.close();
  });
});
