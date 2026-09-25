import { Module } from '@nestjs/common';
import { EnrollmentController } from './enrollment.controller';
import { InviteController } from './invite.controller';
import { SessionController } from './session.controller';

/** Later tasks add controllers here (login, resets, admin lifecycle). */
@Module({ controllers: [SessionController, InviteController, EnrollmentController] })
export class AuthHttpModule {}
