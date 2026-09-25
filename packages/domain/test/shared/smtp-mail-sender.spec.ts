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
    const sender = new SmtpMailSender({
      smtpUrl: `smtp://${mailpit.getHost()}:${mailpit.getMappedPort(1025)}`,
      from: 'TMS <no-reply@tms.local>',
    });
    await sender.send({
      to: 'ada@example.com',
      subject: 'Hello',
      text: 'plain body',
      html: '<p>html body</p>',
    });
    const search = (await (
      await fetch(`${api}/api/v1/search?query=to:ada@example.com`)
    ).json()) as { messages_count: number; messages: Array<{ ID: string }> };
    expect(search.messages_count).toBe(1);
    const detail = (await (
      await fetch(`${api}/api/v1/message/${search.messages[0]!.ID}`)
    ).json()) as { Text: string; HTML: string; From: { Address: string } };
    expect(detail.Text.trim()).toBe('plain body');
    expect(detail.HTML).toContain('html body');
    expect(detail.From.Address).toBe('no-reply@tms.local');
    sender.onApplicationShutdown();
  });

  it('fails fast and cleanly when the server is unreachable', async () => {
    const sender = new SmtpMailSender({
      smtpUrl: 'smtp://127.0.0.1:1',
      from: 'TMS <no-reply@tms.local>',
      timeoutMs: 2000,
    });
    const started = Date.now();
    await expect(sender.send({ to: 'ada@example.com', subject: 'x', text: 'x' })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(3000);
    sender.onApplicationShutdown();
  });
});
