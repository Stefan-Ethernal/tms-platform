import { InMemoryMailSender, MailSender, type MailMessage } from '../../src/shared';

describe('InMemoryMailSender', () => {
  const invite: MailMessage = { to: 'a@example.test', subject: 'Invite', text: 'Hello' };

  it('records sent messages in order', async () => {
    const mail = new InMemoryMailSender();
    await mail.send(invite);
    await mail.send({ ...invite, to: 'b@example.test', html: '<p>Hello</p>' });
    expect(mail.sent).toEqual([invite, { ...invite, to: 'b@example.test', html: '<p>Hello</p>' }]);
  });

  it('stores a copy, not the caller object', async () => {
    const mail = new InMemoryMailSender();
    const message = { ...invite };
    await mail.send(message);
    message.subject = 'changed';
    expect(mail.sent[0]?.subject).toBe('Invite');
  });

  it('clear() empties the outbox', async () => {
    const mail = new InMemoryMailSender();
    await mail.send(invite);
    mail.clear();
    expect(mail.sent).toEqual([]);
  });

  it('is a MailSender (the DI token)', () => {
    expect(new InMemoryMailSender()).toBeInstanceOf(MailSender);
  });
});
