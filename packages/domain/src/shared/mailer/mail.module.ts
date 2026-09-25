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
      providers: [
        { provide: MailSender, useFactory: () => new SmtpMailSender(options) },
        MailNotifier,
        MailListener,
      ],
      exports: [MailSender, MailNotifier],
    };
  }
}
