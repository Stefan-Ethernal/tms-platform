import { Module } from '@nestjs/common';
import { EnrollmentController } from './enrollment.controller';
import { InviteController } from './invite.controller';
import { LoginController } from './login.controller';
import { SessionController } from './session.controller';

/** Later tasks add controllers here (resets, admin lifecycle). */
@Module({
  controllers: [SessionController, InviteController, EnrollmentController, LoginController],
})
export class AuthHttpModule {}
