import { Module } from '@nestjs/common';
import { SessionController } from './session.controller';

/** Later tasks add controllers here (invite, enrollment, login, resets, admin lifecycle). */
@Module({ controllers: [SessionController] })
export class AuthHttpModule {}
