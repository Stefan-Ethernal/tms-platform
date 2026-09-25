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
  constructor(
    private readonly uow: UnitOfWork,
    private readonly events: EventEmitter2,
  ) {}

  /** Queues the mail for after the commit; `emitAsync` (never `emit`) so a failure is observable, not unhandled. */
  afterCommit<K extends MailTemplateId>(request: MailRequest<K>): void {
    this.uow.afterCommit(async () => {
      await this.events.emitAsync(MAIL_REQUESTED, request);
    });
  }
}
