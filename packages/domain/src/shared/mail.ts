export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string | undefined;
}

/** Mail port (spec section 3). The SMTP adapter arrives in phase 2 with the first email. */
export abstract class MailSender {
  abstract send(message: MailMessage): Promise<void>;
}

/** Test adapter: keeps every message in `sent`, in order. */
export class InMemoryMailSender extends MailSender {
  readonly sent: MailMessage[] = [];

  override send(message: MailMessage): Promise<void> {
    this.sent.push({ ...message });
    return Promise.resolve();
  }

  clear(): void {
    this.sent.length = 0;
  }
}
