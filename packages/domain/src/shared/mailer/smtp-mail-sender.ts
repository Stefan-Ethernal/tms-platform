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
      ...(url.username
        ? {
            auth: {
              user: decodeURIComponent(url.username),
              pass: decodeURIComponent(url.password),
            },
          }
        : {}),
      connectionTimeout: timeout,
      greetingTimeout: timeout,
      socketTimeout: timeout,
      dnsTimeout: timeout,
    });
  }

  override async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.options.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }

  onApplicationShutdown(): void {
    this.transporter.close();
  }
}
