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
      this.logger.error(
        `mail delivery failed: user=${request.userId} template=${request.template} error=${error instanceof Error ? error.name : 'unknown'}`,
      );
      // No `cause`: the caught error's message may embed the address or the link (Review Focus 5).
      // eslint-disable-next-line preserve-caught-error
      throw new Error(`mail delivery failed (${request.template})`);
    }
  }
}
